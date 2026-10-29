import { describe, expect, it } from 'vitest'
import {
  IDENTITY_ASSETS,
  REQUIRED_EVIDENCE_FIELDS,
  SURFACE_CASE_IDS,
  checkHostGateEvidence,
  checkSurfaceGateEvidence,
  expectedIdentity,
} from '../../scripts/host-gate-evidence.mjs'

/**
 * The pre-check for installed-host evidence (`host-result.json`).
 *
 * What it proves: the artifact cannot be read as PASS unless it names the candidate it tested
 * (asset digests), used the fixed adapter only, carries unique case ids, and covers every case
 * the caller requires. What it cannot do: run the host. A missing case is a GAP, a failed case
 * is a FAIL, and neither is ever "not applicable".
 */
const artifact = async (overrides: Record<string, unknown> = {}) => {
  const identity = await expectedIdentity(process.cwd())
  return {
    status: 'PASS',
    finishedAt: '2026-10-28T00:00:00.000Z',
    scriptedLlmRequests: 42,
    realModelRequests: 0,
    installed: {
      gateModuleSha256: identity[IDENTITY_ASSETS[0]],
      personaSha256: identity[IDENTITY_ASSETS[1]],
    },
    cases: [
      { id: 'IG01-01', status: 'PASS' },
      { id: 'IG04-01', status: 'PASS' },
    ],
    ...overrides,
  }
}

const check = async (overrides: Record<string, unknown> = {}, options: Record<string, unknown> = {}) => {
  const identity = await expectedIdentity(process.cwd())
  return checkHostGateEvidence(await artifact(overrides), { expected: identity, ...options })
}

describe('installed-host evidence: what it must carry', () => {
  it('accepts an artifact that names the current candidate, the fixed adapter and its cases', async () => {
    const result = await check({}, { requiredCaseIds: ['IG01-01', 'IG04-01'] })
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.summary).toEqual({ cases: 2, pass: 2, fail: 0 })
    expect(result.coverage).toMatchObject({ required: 2, present: 2, missing: [], failed: [] })
  })

  it('names every required field when one is absent', async () => {
    expect(REQUIRED_EVIDENCE_FIELDS).toContain('installed')
    const result = await check({ finishedAt: undefined })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('missing field: finishedAt')
  })

  it('refuses evidence whose asset digests are not the ones in this tree', async () => {
    const identity = await expectedIdentity(process.cwd())
    const result = checkHostGateEvidence(await artifact({ installed: { gateModuleSha256: 'deadbeef', personaSha256: identity[IDENTITY_ASSETS[1]] } }), { expected: identity })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('identity mismatch')
  })

  it('refuses an artifact that reports a real model request or no scripted request at all', async () => {
    expect((await check({ realModelRequests: 3 })).errors.join(' ')).toContain('real model requests')
    expect((await check({ scriptedLlmRequests: 0 })).errors.join(' ')).toContain('never ran')
  })

  it('reports a failed case as a FAIL, never as not applicable', async () => {
    const result = await check({ cases: [{ id: 'IG01-01', status: 'PASS' }, { id: 'IG08-02', status: 'FAIL', error: 'expected 0 published' }], status: 'FAIL' })
    expect(result.ok).toBe(false)
    expect(result.summary).toEqual({ cases: 2, pass: 1, fail: 1 })
    expect(result.errors.join(' ')).toContain('IG08-02 FAILED: expected 0 published')
  })

  it('treats a required case that is absent as a gap, and a duplicate id as a defect', async () => {
    const missing = await check({ cases: [{ id: 'IG01-01', status: 'PASS' }] }, { requiredCaseIds: ['IG01-01', 'IG07-02'] })
    expect(missing.errors.join(' ')).toContain('required cases are missing from the artifact: IG07-02')
    expect(missing.coverage.missing).toEqual(['IG07-02'])
    const duplicated = await check({ cases: [{ id: 'IG01-01', status: 'PASS' }, { id: 'IG01-01', status: 'PASS' }] })
    expect(duplicated.errors.join(' ')).toContain('duplicate case id: IG01-01')
  })

  it('requires the evidence to name the gate and persona it tested', async () => {
    const result = await check({ installed: {} })
    expect(result.errors.join(' ')).toContain('gateModuleSha256 is missing')
    expect(result.errors.join(' ')).toContain('personaSha256 is missing')
  })
})

/**
 * The presentation-surface pre-check. Its claim is narrower than the host tier's: the frames the
 * browser would receive, not a rendered page. So a passing artifact must still show each case's
 * own payload, and "no screenshot was taken" is a declared GAP rather than silence.
 */
const surfaceArtifact = async (overrides: Record<string, unknown> = {}) => {
  const identity = await expectedIdentity(process.cwd())
  return {
    status: 'PASS',
    finishedAt: '2026-10-28T00:00:00.000Z',
    surface: 'agent/assistant-stream (the 1:1 source of the client assistant-stream frames) + session surface events',
    browserScreenshot: false,
    scriptedLlmRequests: 12,
    realModelRequests: 0,
    installed: { gateModuleSha256: identity[IDENTITY_ASSETS[0]], personaSha256: identity[IDENTITY_ASSETS[1]] },
    cases: [
      { id: 'IG07-S1', status: 'PASS', clientVisibleText: 'Intent: write the file after the correction; I will write it once.', withheldDispatch: false, declarationFirst: true },
      { id: 'IG07-S2', status: 'PASS', clientVisibleText: 'Intent: answer the surface case; I will reply in prose.' },
      { id: 'IG07-S3', status: 'PASS', clientVisibleText: '', assistantMessages: 0 },
    ],
    ...overrides,
  }
}

const checkSurface = async (overrides: Record<string, unknown> = {}, options: Record<string, unknown> = {}) => {
  const identity = await expectedIdentity(process.cwd())
  return checkSurfaceGateEvidence(await surfaceArtifact(overrides), { expected: identity, ...options })
}

describe('presentation-surface evidence: frames are not a screenshot', () => {
  it('accepts a complete artifact and records the browser gap it cannot prove', async () => {
    const result = await checkSurface()
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.summary).toEqual({ cases: 3, pass: 3, fail: 0 })
    expect(result.gaps).toContain('browser-not-verified: the artifact proves the controller frames, not what a page rendered')
    expect(SURFACE_CASE_IDS).toEqual(['IG07-S1', 'IG07-S2', 'IG07-S3'])
  })

  it('drops the browser gap only when the artifact really claims a screenshot', async () => {
    expect((await checkSurface({ browserScreenshot: true })).gaps).toEqual([])
  })

  it('re-checks each case payload instead of trusting the PASS label', async () => {
    const withheld = await checkSurface({
      cases: [
        { id: 'IG07-S1', status: 'PASS', clientVisibleText: 'something', withheldDispatch: true, declarationFirst: true },
        { id: 'IG07-S2', status: 'PASS', clientVisibleText: 'x' },
        { id: 'IG07-S3', status: 'PASS', clientVisibleText: 'a body leaked', assistantMessages: 1 },
      ],
    })
    expect(withheld.ok).toBe(false)
    expect(withheld.errors.join(' ')).toContain('withheldDispatch=false')
    expect(withheld.errors.join(' ')).toContain('empty client-visible text')
    expect(withheld.errors.join(' ')).toContain('zero assistant messages')
  })

  it('refuses an artifact that does not name the frames as its surface, or that used a real model', async () => {
    expect((await checkSurface({ surface: 'a screenshot' })).errors.join(' ')).toContain('assistant-stream')
    expect((await checkSurface({ realModelRequests: 1 })).errors.join(' ')).toContain('real model requests')
  })

  it('treats a missing or failing case as a gap/failure, and a foreign candidate as unusable', async () => {
    const missing = await checkSurface({ cases: [{ id: 'IG07-S1', status: 'PASS', clientVisibleText: 'x', withheldDispatch: false, declarationFirst: true }] })
    expect(missing.coverage.missing).toEqual(['IG07-S2', 'IG07-S3'])
    expect(missing.errors.join(' ')).toContain('required cases are missing')
    const failed = await checkSurface({ status: 'FAIL', cases: [{ id: 'IG07-S1', status: 'FAIL', error: 'the client saw withheld words' }] })
    expect(failed.errors.join(' ')).toContain('IG07-S1 FAILED: the client saw withheld words')
    const identity = await expectedIdentity(process.cwd())
    const foreign = checkSurfaceGateEvidence(await surfaceArtifact({ installed: { gateModuleSha256: 'abc', personaSha256: identity[IDENTITY_ASSETS[1]] } }), { expected: identity })
    expect(foreign.errors.join(' ')).toContain('identity mismatch')
    const noIdentity = await checkSurface({ installed: {} })
    expect(noIdentity.errors.join(' ')).toContain('gateModuleSha256 is missing')
  })
})
