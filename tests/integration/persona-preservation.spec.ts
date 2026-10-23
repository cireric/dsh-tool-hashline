import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  MODEL,
  PERSONA_PATH,
  PERSONA_SUFFIX as SHIPPED_SUFFIX,
  createPersonaHarness,
  loadIdentityPlugin,
} from './persona-harness.ts'

/**
 * The de-brand plugin is a deployment artifact outside this repository. Its
 * location is an input (never a hard-coded personal path); when it is absent the
 * suite is reported as skipped instead of silently passing.
 */
const PLUGIN_DIR = process.env.HIDE_HARNESS_IDENTITY_PATH
  ?? path.resolve(process.cwd(), '..', '..', 'default', 'plugins', 'hide-harness-identity')
const HAS_PLUGIN = existsSync(path.join(PLUGIN_DIR, 'index.js'))

/** The config the deployment's cordis.patch.yml currently passes. */
const DEPLOYED_CONFIG = {
  text: 'You are a helpful assistant.',
  neutralText: 'You are a helpful AI assistant.',
  brands: ['DeepSeek Harness', 'DeepSeek', 'Harness'],
  replace: [{ from: 'DeepSeek Harness', to: '' }],
  scrubTools: true,
}

/** `apply` before the agent exists, then announce it through `agent/created`. */
async function mountBeforeAgentCreation(config: Record<string, unknown>) {
  const harness = await createPersonaHarness()
  const plugin = await loadIdentityPlugin(PLUGIN_DIR)
  harness.agents.list = () => []
  plugin.apply(harness.ctx, config)
  harness.agents.list = () => [harness.agent]
  harness.ctx.emit('agent/created', { agent: harness.agent } as never)
  return harness
}

describe.skipIf(!HAS_PLUGIN)('de-brand plugin keeps the preset persona (D2)', () => {
  it('mounts on an existing agent and keeps Phase 0, the buckets and the suffix', async () => {
    const harness = await createPersonaHarness()
    onTestFinished(() => harness.dispose())
    const plugin = await loadIdentityPlugin(PLUGIN_DIR)
    plugin.apply(harness.ctx, DEPLOYED_CONFIG)
    const text = await harness.render()
    expect(text).toContain('## Phase 0 — Intent Gate')
    expect(text).toContain('Intent: <bucket> — <what the user wants, in outcome terms>')
    expect(text).toContain('| Surface form | Bucket | What decides it (never the phrasing) |')
    expect(text.endsWith(SHIPPED_SUFFIX)).toBe(true)
  })

  it('mounts through agent/created and produces the same persona', async () => {
    const harness = await mountBeforeAgentCreation(DEPLOYED_CONFIG)
    onTestFinished(() => harness.dispose())
    const text = await harness.render()
    expect(text).toContain('## Phase 0 — Intent Gate')
  })

  it('rewrites only the brand self-introduction sentence of the shipped persona', async () => {
    const harness = await createPersonaHarness()
    onTestFinished(() => harness.dispose())
    const plugin = await loadIdentityPlugin(PLUGIN_DIR)
    plugin.apply(harness.ctx, DEPLOYED_CONFIG)
    const text = await harness.render()
    const persona = await readFile(PERSONA_PATH, 'utf8')
    // renderPrompt() resolves the two registered variables after the waterfall.
    const expected = persona
      .replace('You are a coding agent powered by the {{model}} model.', 'You are a helpful AI assistant.')
      .replaceAll('{{model}}', MODEL)
      .replaceAll('{{provider}}', 'deepseek')
      + '\n\n' + SHIPPED_SUFFIX
    expect(text).toBe(expected)
  })
it('leaves a no-brand multi-section persona untouched', async () => {
    const harness = await createPersonaHarness({
      personaText: 'You are a careful reviewer.\n\nRules:\n- Keep answers short.',
      suffix: 'Workspace note.',
    })
    onTestFinished(() => harness.dispose())
    const plugin = await loadIdentityPlugin(PLUGIN_DIR)
    plugin.apply(harness.ctx, { neutralText: 'You are a helpful AI assistant.', replace: [{ from: 'DeepSeek Harness', to: '' }] })
    expect(await harness.render()).toBe('You are a careful reviewer.\n\nRules:\n- Keep answers short.\n\nWorkspace note.')
  })

  it('keeps a complete persona intact and reports the scrub limit', async () => {
    const harness = await createPersonaHarness({ personaText: 'You are DeepSeek Harness.', complete: true })
    onTestFinished(() => harness.dispose())
    const plugin = await loadIdentityPlugin(PLUGIN_DIR)
    plugin.apply(harness.ctx, DEPLOYED_CONFIG)
    // assemble() restores a complete section AFTER the waterfall, so no listener
    // can rewrite it. This branch is deliberately out of the scrub's reach.
    expect(await harness.render()).toBe('You are DeepSeek Harness.')
  })

  it('scrubs runtime context once and keeps it through refresh and repeated assembly', async () => {
    const harness = await createPersonaHarness({
      contexts: [{ name: 'harness:source', text: 'The runtime context names the DeepSeek Harness implementation checkout.' }],
    })
    onTestFinished(() => harness.dispose())
    const plugin = await loadIdentityPlugin(PLUGIN_DIR)
    plugin.apply(harness.ctx, DEPLOYED_CONFIG)
    const first = await harness.assemble()
    const context = first.contexts.find(entry => entry.name.startsWith('harness:source'))
    expect(context?.name).toBe('harness:source#brand-scrubbed')
    expect(context?.text).toBe('The runtime context names the implementation checkout.')
    const refreshed = harness.refresh(first)
    expect(refreshed.contexts.find(entry => entry.name.startsWith('harness:source'))?.text)
      .toBe('The runtime context names the implementation checkout.')
    const second = await harness.assemble()
    expect(second.contexts.filter(entry => entry.name.includes('#brand-scrubbed')).length).toBe(1)
    expect(second.contexts.some(entry => entry.name.includes('#brand-scrubbed#brand-scrubbed'))).toBe(false)
    const rendered = renderPrompt(second)
    expect(rendered.match(/## Phase 0 — Intent Gate/gu)).toHaveLength(1)
  })

  it('can be unmounted and remounted without a duplicate listener or a leftover override', async () => {
    const harness = await createPersonaHarness()
    onTestFinished(() => harness.dispose())
    const plugin = await loadIdentityPlugin(PLUGIN_DIR)
    const first = harness.mount(plugin, DEPLOYED_CONFIG)
    await first.dispose()
    const second = harness.mount(plugin, DEPLOYED_CONFIG)
    onTestFinished(() => second.dispose())
    const rendered = await harness.render()
    expect(rendered).toContain('## Phase 0 — Intent Gate')
    expect(rendered.split(SHIPPED_SUFFIX)).toHaveLength(2)
  })

  it("keeps a child scope's own persona instead of forcing the parent text", async () => {
    const harness = await createPersonaHarness()
    onTestFinished(() => harness.dispose())
    const plugin = await loadIdentityPlugin(PLUGIN_DIR)
    plugin.apply(harness.ctx, DEPLOYED_CONFIG)
    const child = await harness.childScope('subagent')
    onTestFinished(() => child.dispose())
    child.ctx.systemPrompt.section({
      name: 'deployment:persona-prefix',
      order: harness.ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      text: 'You are a child agent.',
    })
    const childText = renderPrompt(await harness.ctx.systemPrompt.assemble({ scope: scopeOf(child.ctx) }))
    expect(childText).toContain('You are a child agent.')
    expect(childText).not.toContain('## Phase 0 — Intent Gate')
    expect(await harness.render()).toContain('## Phase 0 — Intent Gate')
  })

  it('rejects the removed text/complete fields with a migration diagnostic', async () => {
    const plugin = await loadIdentityPlugin(PLUGIN_DIR) as unknown as {
      Config: { '~standard': { validate(raw: unknown): { issues?: { path: unknown; message: string }[] } } }
    }
    for (const config of [{ text: 'You are a helpful assistant.' }, { text: '' }, { complete: true }]) {
      const outcome = plugin.Config['~standard'].validate(config)
      expect(outcome.issues?.length).toBe(1)
      expect(outcome.issues?.[0]?.path).toEqual([Object.keys(config)[0]])
      expect(outcome.issues?.[0]?.message).toContain('removed in 1.4.0')
    }
  })
})
