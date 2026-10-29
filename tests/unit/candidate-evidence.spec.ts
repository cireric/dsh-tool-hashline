import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  candidateEvidence,
  tallyDelivery,
  worstVerdict,
} from '../../scripts/candidate-evidence.mjs'
import { IDENTITY_ASSETS, expectedIdentity } from '../../scripts/host-gate-evidence.mjs'

/**
 * The candidate table: identity, each gate, and the delivery run — read together so a claim can
 * name what it measured. The rules pinned here are the ones that stop a convenient story:
 * evidence from two different gate modules is FAIL, a missing gate is BLOCKED, and a delivery
 * run with blocked ids is GAP — never PASS.
 */
const identity = async () => expectedIdentity(process.cwd())

const hostResult = async (overrides: Record<string, unknown> = {}) => {
  const digests = await identity()
  return {
    status: 'PASS',
    cases: [{ id: 'IG01-01', status: 'PASS' }, { id: 'IG04-01', status: 'PASS' }],
    installed: { bundleRoot: 'C:/tmp/profile/node_modules/dsh-tool-hashline', gateModuleSha256: digests[IDENTITY_ASSETS[0]], personaSha256: digests[IDENTITY_ASSETS[1]] },
    ...overrides,
  }
}

const surfaceResult = async (overrides: Record<string, unknown> = {}) => {
  const digests = await identity()
  return {
    status: 'PASS',
    cases: [{ id: 'IG07-S1', status: 'PASS' }, { id: 'IG07-S2', status: 'PASS' }, { id: 'IG07-S3', status: 'PASS' }],
    browserScreenshot: true,
    installed: { gateModuleSha256: digests[IDENTITY_ASSETS[0]], personaSha256: digests[IDENTITY_ASSETS[1]] },
    ...overrides,
  }
}

const delivery = (verdicts: Record<string, string>) => ({
  install: { bundleRoot: 'C:/tmp/profile/node_modules/dsh-tool-hashline' },
  verdicts,
  rows: [{ id: 'X', part: 'a', detail: 'b' }],
  gates: [{ command: 'pnpm build', exitCode: 0 }],
})

describe('candidate evidence: one candidate, or no claim', () => {
  it('passes only when every axis passes', async () => {
    const result = candidateEvidence({
      installation: { profile: 'C:/tmp/profile', bundleRoot: 'C:/tmp/profile/node_modules/dsh-tool-hashline' },
      hostResult: await hostResult(),
      surfaceResult: await surfaceResult(),
      deliverySummary: delivery({ 'PACK-01': 'PASS', 'REG-01': 'PASS' }),
    })
    expect(result.verdict).toBe('PASS')
    expect(result.findings).toEqual([])
    expect(result.axes.host).toMatchObject({ verdict: 'PASS', cases: 2, pass: 2 })
    expect(result.axes.surface).toMatchObject({ verdict: 'PASS', browser: true })
  })

  it('refuses a set whose gates measured different gate modules', async () => {
    const result = candidateEvidence({
      hostResult: await hostResult(),
      surfaceResult: await surfaceResult({ installed: { gateModuleSha256: 'deadbeef', personaSha256: (await identity())[IDENTITY_ASSETS[1]] } }),
      deliverySummary: delivery({ 'PACK-01': 'PASS' }),
    })
    expect(result.verdict).toBe('FAIL')
    expect(result.findings.map(finding => finding.detail)).toContain('host and surface evidence name different gate modules')
  })

  it('treats a missing gate as BLOCKED, and a delivery run with blocked ids as GAP', async () => {
    const noSurface = candidateEvidence({ hostResult: await hostResult(), deliverySummary: delivery({ 'PACK-01': 'PASS' }) })
    expect(noSurface.verdict).toBe('BLOCKED')
    expect(noSurface.axes.surface.verdict).toBe('BLOCKED')

    const withBlockedIds = candidateEvidence({
      hostResult: await hostResult(),
      surfaceResult: await surfaceResult(),
      deliverySummary: delivery({ 'PACK-01': 'PASS', 'UPG-02': 'BLOCKED', 'INC-02': 'BLOCKED' }),
    })
    expect(withBlockedIds.verdict).toBe('GAP')
    expect(withBlockedIds.axes.delivery.tally).toMatchObject({ PASS: 1, BLOCKED: 2 })
  })

  it('refuses evidence that records no digest at all, and a delivery bundle that is not the measured one', async () => {
    const noDigest = candidateEvidence({
      hostResult: { status: 'PASS', cases: [{ id: 'A', status: 'PASS' }] },
      surfaceResult: { status: 'PASS', cases: [{ id: 'B', status: 'PASS' }], browserScreenshot: true },
      deliverySummary: delivery({ 'PACK-01': 'PASS' }),
    })
    expect(noDigest.verdict).toBe('BLOCKED')
    expect(noDigest.findings.map(finding => finding.detail)).toContain('no artifact recorded an asset digest: the evidence cannot name the candidate it measured')

    const foreignBundle = candidateEvidence({
      installation: { bundleRoot: 'C:/tmp/profile/node_modules/dsh-tool-hashline' },
      hostResult: await hostResult(),
      surfaceResult: await surfaceResult(),
      deliverySummary: { ...delivery({ 'PACK-01': 'PASS' }), install: { bundleRoot: 'D:/other/node_modules/another-plugin' } },
    })
    expect(foreignBundle.verdict).toBe('FAIL')
    expect(foreignBundle.findings.map(finding => finding.detail)).toContain('the delivery run installed a different bundle than the gates measured')
  })

  it('keeps a FAIL above every other verdict, and an unknown verdict is not a pass', () => {
    expect(worstVerdict(['PASS', 'GAP', 'BLOCKED'])).toBe('BLOCKED')
    expect(worstVerdict(['PASS', 'GAP', 'FAIL'])).toBe('FAIL')
    expect(worstVerdict(['PASS', 'PASS'])).toBe('PASS')
    expect(worstVerdict(['SOMETHING-NEW'])).toBe('BLOCKED')
    expect(tallyDelivery({ verdicts: { a: 'PASS', b: 'BLOCKED', c: 'weird' } })).toMatchObject({ PASS: 1, BLOCKED: 1, unknown: 1 })
  })
})

describe('candidate evidence: the shipped delivery record', () => {
  it('reads the real 2026-10-28 summary and reports its blocked ids as GAP, not PASS', async () => {
    const summary = JSON.parse(await readFile(new URL('../../docs/acceptance/2026-10-28-delivery-acceptance-summary.json', import.meta.url), 'utf8'))
    const tally = tallyDelivery(summary)
    expect(tally.PASS).toBeGreaterThan(0)
    expect(tally.BLOCKED).toBeGreaterThan(0)
    expect(tally.FAIL).toBe(0)
    const result = candidateEvidence({ hostResult: await hostResult(), surfaceResult: await surfaceResult(), deliverySummary: summary })
    expect(result.axes.delivery.verdict).toBe('GAP')
    expect(result.verdict).toBe('GAP')
  })
})
