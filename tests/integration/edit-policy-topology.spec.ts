import { describe, expect, it, onTestFinished } from 'vitest'
import { createPolicyHarness } from './edit-policy-harness.ts'

describe('POL: the composition the shipped preset actually creates', () => {
  it('routes the preset rows through a real scope while fs and the policy stay on the host plane', async () => {
    const harness = await createPolicyHarness({ policy: true })
    onTestFinished(() => harness.cleanup())

    // The registry routes by agent, so the preset scope must be a real scope key.
    expect(harness.scopeKey).toBe(harness.agent)
    // No realm sits between the preset rows and the host filesystem, and the
    // policy owns both decision slots on the host plane.
    expect(harness.fsRealmMatchesHost).toBe(true)
    expect(harness.intentOwnedByHostPlane).toBe(true)
    expect(harness.intentListeners).toEqual({ edit: 1, write: 1 })
  })

  it('leaves both decision slots empty without the policy (the negative control)', async () => {
    const harness = await createPolicyHarness({ policy: false })
    onTestFinished(() => harness.cleanup())
    expect(harness.intentListeners).toEqual({ edit: 0, write: 0 })
  })

  it('the shipped preset declares no realm around fs or tools', async () => {
    const { readFile } = await import('node:fs/promises')
    const preset = await readFile(new URL('../../presets/ptc-hashline/preset.patch.yml', import.meta.url), 'utf8')
    // Every isolate block in the preset resolves to one of these services.
    const isolated = [...preset.matchAll(/^\s+isolate:\s*$([\s\S]*?)(?=^\s*- id:|^\s{2}# |\Z)/gm)]
      .flatMap(match => [...match[1]!.matchAll(/^\s{2,}([A-Za-z][\w]*):\s+true\s*$/gm)].map(found => found[1]!))
    expect([...new Set(isolated)].sort()).toEqual(['compaction', 'planMode', 'toolResultPruner', 'workflowEngine'])
    expect(isolated).not.toContain('fs')
    expect(isolated).not.toContain('tools')
    // ...and the filesystem rows really are preset rows, not host rows.
    expect(preset).toContain("name: '@deepseek-ai/dsh-tool-fs'")
    expect(preset).toContain("name: '@dsh-tool-hashline/tool-read'")
    expect(preset).toContain("name: '@dsh-tool-hashline/tool-edit'")
  })
})
