import { describe, expect, it } from 'vitest'
import { TRIAGE_KIND, classifyRow, parseTriageLog, summarize } from '../../scripts/suite-triage.mjs'

/**
 * Suite triage classification: the four reasons a spec can fail to run must never be conflated.
 * "runs" is the only one that says anything about the spec; the rest say something about the
 * ENVIRONMENT, and a permissive host has to re-establish them.
 */
describe('suite triage: what a non-green spec actually means', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({ file: 'tests/x.spec.ts', code: 1, summary: '', env: false, shim: false, fails: '', detail: '', ...overrides })

  it('separates a green run, a runner gap, a sandbox denial and an empty subprocess', () => {
    expect(classifyRow(row({ code: 0, summary: '3 passed, 0 failed' }))).toBe(TRIAGE_KIND.RUNS)
    expect(classifyRow(row({ env: true, detail: 'spawnSync git EPERM' }))).toBe(TRIAGE_KIND.ENVIRONMENT_SANDBOX)
    expect(classifyRow(row({ detail: "Cannot read properties of undefined (reading 'toThrow')" }))).toBe(TRIAGE_KIND.RUNNER_GAP)
    expect(classifyRow(row({ detail: 'expected null to be 0' }))).toBe(TRIAGE_KIND.ENVIRONMENT_SUBPROCESS)
    expect(classifyRow(row({ detail: 'expected true to be false' }))).toBe(TRIAGE_KIND.ENVIRONMENT_SANDBOX)
    expect(classifyRow(row({ detail: 'expected 2 to be 3' }))).toBe(TRIAGE_KIND.NEEDS_HUMAN)
  })

  it('parses the per-spec log format and ignores anything else', () => {
    const text = [
      'FILE|tests/unit/a.spec.ts|0|4 passed, 0 failed|0|0||',
      'noise',
      'FILE|tests/integration/b.spec.ts|1|2 passed, 1 failed|1|0|FAIL x>y|spawnSync pwsh EPERM',
    ].join('\n')
    const rows = parseTriageLog(text)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ file: 'tests/unit/a.spec.ts', code: 0, env: false })
    expect(rows[1]).toMatchObject({ code: 1, env: true, fails: 'FAIL x>y' })
  })

  it('writes both artifacts with the "not a product verdict" scope note', () => {
    const result = summarize([
      row({ code: 0, summary: '3 passed, 0 failed' }),
      row({ file: 'tests/y.spec.ts', env: true, detail: 'EACCES' }),
    ], { generatedAt: '2026-10-28T00:00:00.000Z' })
    expect(result.counts).toMatchObject({ [TRIAGE_KIND.RUNS]: 1, [TRIAGE_KIND.ENVIRONMENT_SANDBOX]: 1 })
    expect(result.json.scopeNote).toContain('not a verdict on the product')
    expect(result.markdown).toContain('| class | specs |')
    expect(result.markdown).toContain('## Green under this runner')
    expect(result.markdown).toContain('## Not green, with the reason as observed')
    expect(result.classified.every(entry => typeof entry.kind === 'string')).toBe(true)
  })
})
