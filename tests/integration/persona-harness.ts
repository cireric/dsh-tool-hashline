/**
 * Real prompt-registry fixture for the persona-override defect (runtime-fix-plan
 * phase A/C, D2).
 *
 * The registry, the scope layering, the persona/suffix sections, prompt-variable
 * interpolation and the assembly waterfall are all the host's own. A "preset"
 * scope registers the shipped orchestrator persona exactly as `@deepseek-ai/dsh-persona`
 * would; an "agent" scope sits under it. Only the `agents` service is structural,
 * because the plugin under test reads it for the per-agent install lifecycle.
 * @module @dsh-tool-hashline/tests/persona-harness
 */

import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Scope, ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

/** The shipped persona this repo owns. */
export const PERSONA_PATH = path.resolve(process.cwd(), 'presets/ptc-hashline/personas/orchestrator.md')
/** The suffix the preset row configures. */
export const PERSONA_SUFFIX = "Work from the session's working directory; the environment section states it."
/** What the model route renders `{{model}}` to in this fixture. */
export const MODEL = 'deepseek-v4.1-flash'

/** One loaded plugin module, as `apply` sees it. */
export interface PluginModule {
  apply(ctx: Context, config?: unknown): void
  inject?: readonly string[]
}

/** Options for {@link createPersonaHarness}. */
export interface PersonaHarnessOptions {
  /** `complete: true` mirrors a persona row that replaces the whole prompt. */
  complete?: boolean
  /** Override the shipped persona text (for a no-brand multi-section persona). */
  personaText?: string
  /** Override the suffix section text. */
  suffix?: string
  /** Extra named sections at the preset scope. */
  sections?: { name: string; text: string; order?: number }[]
  /** Runtime-context contributions at the preset scope (for refresh tests). */
  contexts?: { name: string; text: string; order?: number }[]
}

/** A mounted prompt registry plus the scope an assembly is requested for. */
export interface PersonaHarness {
  ctx: Context
  /** The agent scope's key; assembly for this scope is what the model receives. */
  key: ScopeKey
  /** The agent scope itself (for plugin install/removal). */
  agentScope: Scope
  /** The structural Agent the plugin installs against. */
  agent: { ctx: Context; session: object }
  /** Register or re-acquire the structural agents service. */
  agents: { list(): { ctx: Context; session: object }[] }
  /** Run one full assembly and render it (interpolation included). */
  render(): Promise<string>
  /** The raw assembly, before rendering. */
  assemble(): Promise<PromptAssembly>
  /** Re-resolve contexts exactly as the loop does before a request. */
  refresh(assembly: PromptAssembly): PromptAssembly
  /** Mount one plugin through a disposable fiber (for uninstall/re-mount tests). */
  mount(module: PluginModule, config?: unknown): { dispose(): Promise<void | void> }
  /** Mint a child scope under the agent scope. */
  childScope(name: string): Promise<Scope>
  dispose(): Promise<void>
}

/** Mint a child scope whose holders can reach `systemPrompt` (as the host does). */
async function mintScope(parent: Context, name: string, enclosing?: ScopeKey): Promise<Scope> {
  let scope!: Scope
  await parent.plugin(Object.assign((inner: Context) => {
    scope = createScope(inner, { name }, enclosing === undefined ? {} : { parent: enclosing })
  }, { inject: ['systemPrompt'] }))
  return scope
}

/**
 * Mount the real registry with a preset persona, a suffix, and one agent scope.
 * @param options - `complete` mirrors a persona row that sets `complete: true`.
 * @returns the harness; call `dispose` when done.
 */
export async function createPersonaHarness(options: PersonaHarnessOptions = {}): Promise<PersonaHarness> {
  const persona = options.personaText ?? await readFile(PERSONA_PATH, 'utf8')
  const ctx = new Context()
  // Runtime contexts are suppressed unless the case needs them (refresh tests).
  await ctx.plugin(SystemPrompt, { personaPrefix: '', includeRuntimeContext: options.contexts !== undefined, includeHarnessIdentity: false })
  ctx.systemPrompt.variable('model', () => MODEL)
  ctx.systemPrompt.variable('provider', () => 'deepseek')
  const preset = await mintScope(ctx, 'preset-ptc-hashline')
  preset.ctx.systemPrompt.section({
    name: 'deployment:persona-prefix',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: persona,
    ...options.complete === true ? { complete: true } : {},
  })
  preset.ctx.systemPrompt.section({
    name: 'deployment:persona-suffix',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text: options.suffix ?? PERSONA_SUFFIX,
  })
  for (const section of options.sections ?? []) {
    preset.ctx.systemPrompt.section({ name: section.name, order: section.order ?? 100, text: section.text })
  }
  for (const context of options.contexts ?? []) {
    preset.ctx.systemPrompt.context({ name: context.name, order: context.order ?? 100, text: context.text })
  }
  const agentScope = await mintScope(preset.ctx, 'agent', scopeOf(preset.ctx))
  const agent = { ctx: agentScope.ctx, session: { header: { cwd: process.cwd() } } }
  const service = { list: () => [agent] }
  ctx.provide('agents', service)
  const key = scopeOf(agentScope.ctx)!
  // One macrotask lets the plugin's own `agent.ctx.inject(...)` install settle
  // before the model request, exactly as a real loop does.
  const assemble = async () => {
    await new Promise(resolve => setImmediate(resolve))
    return ctx.systemPrompt.assemble({ scope: key })
  }
  return {
    ctx,
    key,
    agentScope,
    agent,
    agents: service,
    // `agent.ctx.inject(...)` installs on a dependency-ready microtask; one
    // macrotask lets the plugin's own install settle before the model request.
    assemble,
    async render() { return renderPrompt(await assemble()) },
    refresh: assembly => ctx.systemPrompt.refreshContext(assembly, { scope: key }),
    mount(module, config) {
      const fiber = ctx.plugin(Object.assign((inner: Context) => module.apply(inner, config), { inject: module.inject ?? [] }))
      return { dispose: () => fiber.dispose() }
    },
    childScope: name => mintScope(agentScope.ctx, name, key),
    async dispose() { await ctx.fiber.dispose() },
  }
}

/**
 * Load the real de-brand plugin from the deployment that links it.
 *
 * The path is an input, never a hard-coded personal path: callers pass it from
 * `HIDE_HARNESS_IDENTITY_PATH` (or the documented sibling default) and skip the
 * suite when the module is absent.
 * @param pathLike - directory or `index.js` path of the plugin.
 * @returns the module namespace with its `apply`.
 */
export async function loadIdentityPlugin(pathLike: string): Promise<PluginModule> {
  const file = pathLike.endsWith('.js') ? pathLike : path.join(pathLike, 'index.js')
  const module = await import(pathToFileURL(file).href) as unknown as PluginModule
  if (typeof module.apply !== 'function') throw new Error('plugin has no apply(): ' + file)
  return module
}
