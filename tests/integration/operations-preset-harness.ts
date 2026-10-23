/**
 * Real-assembly fixture for the operations skills (SCOPE-01/02/03/07).
 *
 * The rows under test are read from the shipped `presets/ptc-hashline/preset.patch.yml`
 * and mounted through the production path: the real
 * `@deepseek-ai/dsh-agent-preset-registry` (which composes an EntryTree through
 * `@deepseek-ai/cordis-plugin-loader` under a real `createScope` revision
 * scope), the real `@deepseek-ai/dsh-skill` registry and the real
 * `@deepseek-ai/dsh-skill-filesystem` provider. A flattened fixture or a
 * frontmatter string check cannot substitute for this assembly.
 *
 * Claim boundary: this fixture mounts the shipped skill rows (or an explicit row
 * list), not the whole preset tree — the full-preset mount belongs to the
 * delivery-acceptance ticket. The rows themselves are the shipped ones, so a
 * missing/duplicated provider row or a wrong frontmatter policy fails here.
 * @module dsh-tool-hashline/tests/integration/operations-preset-harness
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Group from '@deepseek-ai/cordis-plugin-group'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as yaml from 'js-yaml'

/** One plugin row exactly as the shipped patch declares it. */
export interface PresetRow {
  id?: string
  name: string
  config?: Record<string, unknown> | PresetRow[]
  group?: boolean
  disabled?: boolean
}

/** The shipped preset patch: its rows and its raw text. */
export interface PresetRows {
  rows: PresetRow[]
  text: string
}

/** Rows that only need the skill registry and the tool registry to activate. */
export const SKILL_ROW_IDS = ['skill-filesystem', 'tool-skill', 'ptc-hashline-operations-skills'] as const

/** The provider name the operations row must use (unique within one layer). */
export const OPERATIONS_PROVIDER = 'ptc-hashline-operations'

/** Read the shipped preset rows with the loader's own YAML dialect. */
export async function readPresetRows(): Promise<PresetRows> {
  const file = new URL('../../presets/ptc-hashline/preset.patch.yml', import.meta.url)
  const text = await readFile(file, 'utf8')
  const documents = yaml.load(text, { schema: entryListSchema }) as { insert?: unknown[] }[]
  const entries = documents.flatMap(document => Array.isArray(document?.insert) ? document.insert : [])
  const preset = entries.find(entry => (entry as { config?: { id?: string } })?.config?.id === 'ptc-hashline') as
    { config?: { plugins?: unknown[] } } | undefined
  if (preset === undefined) throw new Error('shipped preset patch declares no ptc-hashline preset')
  return { rows: (preset.config?.plugins ?? []) as PresetRow[], text }
}

/** Rows of the shipped preset by id, including nested group rows. */
export function rowsById(rows: readonly PresetRow[]): Map<string, PresetRow> {
  const byId = new Map<string, PresetRow>()
  const walk = (entries: readonly PresetRow[]): void => {
    for (const entry of entries) {
      if (typeof entry.id === 'string') byId.set(entry.id, entry)
      if (Array.isArray(entry.config)) walk(entry.config)
    }
  }
  walk(rows)
  return byId
}

/** A structural Agent: the loop uses the Agent object itself as its scope key. */
export interface AgentFixture {
  id: string
  ctx: Context
  session: { id: string; cwd: string; header: { cwd: string; id: string }; append: () => number }
  dispose(): Promise<void>
}

/** One registered preset revision plus the agents composed under it. */
export interface MountedPreset {
  id: string
  /** Revision scope key agents are parented to. */
  key: object
  /** Compose an agent under this revision (the production `setup` call). */
  agent(id: string): Promise<AgentFixture>
  /** Retire the definition and collect its revision (production unregister). */
  unregister(): Promise<void>
}

export interface OperationsPresetHarness {
  /** Host-plane context: loader, preset registry, skill registry, tools, prompt. */
  root: Context
  /** Temporary workspace used as the sessions' cwd. */
  dir: string
  runtime: ToolRuntime
  /**
   * Register and mount one preset revision.
   * @param id preset id recorded on the revision
   * @param options.rows rows to mount (defaults to the shipped skill rows)
   */
  mount(id: string, options?: { rows?: PresetRow[] }): Promise<MountedPreset>
  cleanup(): Promise<void>
}

/** The shipped skill rows, in declaration order. */
export function skillRows(rows: readonly PresetRow[]): PresetRow[] {
  const byId = rowsById(rows)
  return SKILL_ROW_IDS.map(id => {
    const row = byId.get(id)
    if (row === undefined) throw new Error('shipped preset declares no row "' + id + '"')
    return row
  })
}

/**
 * Build the host plane and expose a real preset mount.
 * @returns the harness; call `cleanup` when done.
 */
export async function createOperationsPresetHarness(): Promise<OperationsPresetHarness> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'operations-skills-'))
  const ctx = new Context()
  // The Loader resolves a plugin name relative to its composition base URL, and
  // this bundle's preset lives beside its own assets.
  ctx.baseUrl = pathToFileURL(path.join(process.cwd(), 'presets', 'ptc-hashline') + path.sep).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '', includeRuntimeContext: false, includeHarnessIdentity: false })
  const runtime = new ToolRuntime(ctx)
  await ctx.plugin(AgentPresets, { default: 'ptc-hashline' })
  provideWorkingDirectoryFixture(ctx, dir)
  // The preset registry's own injection chain is structural here: `agents` is
  // what `tool-skill` waits for, and this fixture never creates production
  // Agents (the acceptance ticket does). A live roster of the structural Agent
  // fixtures keeps the row activatable without pretending to be the loop.
  const roster: unknown[] = []
  ctx.provide('agents', { list: () => roster })

  const agents: AgentFixture[] = []
  const mount = async (id: string, options: { rows?: PresetRow[] } = {}): Promise<MountedPreset> => {
    const rows = options.rows ?? skillRows((await readPresetRows()).rows)
    const unregister = await ctx.agentPresets.register({ id, plugins: rows as never })
    // Hold a revision lease for the lifetime of this mounted fixture: without
    // one the registry could collect the revision before an agent joins it.
    const lease = await ctx.agentPresets.acquireScope(id)
    return {
      id,
      key: lease.key,
      async agent(agentId: string) {
        const session = {
          id: agentId,
          cwd: dir,
          header: { cwd: dir, id: agentId },
          append: () => 0,
        }
        // The loop uses the Agent object itself as its scope key, so the fixture
        // must be that object — a copy would carry a different routing key and
        // the preset's scoped layer would never be reached.
        const agent = { id: agentId, session } as unknown as AgentFixture
        const scope = createScope(ctx, agent)
        ;(agent as { ctx: Context }).ctx = scope.ctx
        ;(agent as { dispose(): Promise<void> }).dispose = () => scope.dispose()
        // The production agent setup joins the revision through this scope.
        await ctx.agentPresets.mount(agent.ctx, id)
        agents.push(agent)
        return agent
      },
      async unregister() {
        await unregister()
        await lease[Symbol.asyncDispose]()
      },
    }
  }

  return {
    root: ctx,
    dir,
    runtime,
    mount,
    async cleanup() {
      await Promise.all(agents.splice(0).map(agent => agent.dispose()))
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/**
 * Assert helper: a real scope key is present for a fixture.
 * @param agent agent fixture created by a mounted preset
 * @returns its scope key
 */
export function scopeKeyOf(agent: AgentFixture): object | undefined {
  return scopeOf(agent.ctx) as object | undefined
}
