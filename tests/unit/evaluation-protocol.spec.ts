/**
 * Ticket 10: the evaluation protocol freezes before a run, and the driver obeys
 * the counting rules SRS §7.2 fixes.
 *
 * These are unit tests of the driver's OWN rules: they prove the denominators,
 * batch boundaries and unknown handling. They are NOT a model result and say
 * nothing about adoption or benefit.
 * @module dsh-tool-hashline/tests/unit/evaluation-protocol
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- the evaluation driver is plain ESM with no declaration file
import { canonicalJson, freezeProtocol, protocolGaps, ProtocolError, REQUIRED_TASK_FAMILIES } from '../../scripts/evaluation/protocol.mjs'
// @ts-expect-error -- the evaluation driver is plain ESM with no declaration file
import { adoption, CountingError, validateBatch, validateCost } from '../../scripts/evaluation/counting.mjs'

const DRIVER = fileURLToPath(new URL('../../scripts/evaluation/driver.mjs', import.meta.url))

/** A complete protocol, so each test can break exactly one thing. */
const complete = () => ({
  id: 'eval-1',
  kind: 'formal',
  tools: { presetHash: 'fixture', providerPlugin: 'fixture', providerConfig: {}, credentialEnv: 'EVAL_KEY', arms: { 'stock-edit': 'a', 'hashline-default': 'b' } },
  createdAt: '2026-10-24T00:00:00Z',
  comparison: ['stock-edit', 'hashline-default'],
  model: { provider: 'p', model: 'm', parameters: { maxTokens: 1000 } },
  dependencies: { packages: { fixture: '0' }, patches: {}, resources: {}, inputs: {}, profileInputs: {}, driverInputs: {}, environment: {}, readEngine: 'fixture', editEngine: 'fixture' },
  samples: { repetitions: 3, seed: 7 },
  order: 'interleaved',
  budget: { maxModelRequests: 100, maxTotalTokens: 500000, timeoutMs: 1000 },
  passConditions: { minFirstCandidateCorrect: 0.8, maxTotalTokensPerTask: 20000 },
  tasks: (REQUIRED_TASK_FAMILIES as string[]).map((family: string) => ({ id: family, family, initial: { 'a.txt': 'x' }, prompt: 'do it', expected: { 'a.txt': 'y' }, class: 'known-applicable', batchBoundary: 'task-end' })),
})

describe('protocol freezing', () => {
  it('accepts a complete protocol and refuses an incomplete one, naming every gap', () => {
    expect(protocolGaps(complete())).toEqual([])
    const partial = { ...complete(), model: undefined, budget: undefined }
    const gaps = protocolGaps(partial)
    expect(gaps.join(' | ')).toContain('missing required field: model')
    expect(gaps.join(' | ')).toContain('missing required field: budget')
    expect(() => freezeProtocol(partial)).toThrow(ProtocolError)
  })

  it('refuses a protocol that skips a required task family', () => {
    const partial = { ...complete(), tasks: complete().tasks.filter((task: { family: string }) => task.family !== 'user-override') }
    expect(protocolGaps(partial).join(' ')).toContain('user-override')
  })

  it('gives the same identity regardless of key order and formatting', () => {
    const a = { b: 2, a: [1, { z: 1, y: 2 }] }
    const b = { a: [1, { y: 2, z: 1 }], b: 2 }
    expect(canonicalJson(a)).toBe(canonicalJson(b))
    expect(freezeProtocol(complete()).protocolHash).toBe(freezeProtocol(complete()).protocolHash)
  })
})

describe('counting rules', () => {
  it('keeps the known-applicable denominator and never removes a non-Hashline first attempt', () => {
    const rates = adoption([
      { id: 'a', class: 'known-applicable', firstAttempt: 'hashline', mode: 'hashline' },
      { id: 'b', class: 'known-applicable', firstAttempt: 'non-hashline', mode: 'non-hashline' },
      { id: 'c', class: 'declared-exception', firstAttempt: 'not-attempted', mode: 'not-attempted' },
      { id: 'd', class: 'applicability-unknown', firstAttempt: 'unknown', mode: 'unknown' },
    ])
    expect(rates.knownApplicable).toBe(2)
    expect(rates.hashlineFirst).toBe(1)
    expect(rates.adoptionRate).toBe(0.5)
    // The non-Hashline first attempt is still counted, not dropped.
    expect(rates.byMode['non-hashline']).toBe(1)
    expect(rates.byClass['applicability-unknown']).toBe(1)
  })

  it('reports a zero denominator as not applicable instead of a rate', () => {
    const rates = adoption([{ id: 'a', class: 'no-change-needed', firstAttempt: 'not-attempted', mode: 'not-attempted' }])
    expect(rates.adoptionRate).toBeNull()
    expect(rates.adoptionRateNote).toContain('not applicable')
  })

  it('refuses a retry disguised as a first attempt', () => {
    expect(() => validateBatch({ targetId: 'a', attempt: 0, calls: [1], outcome: 'first-correct', retryOf: 'a' })).toThrow(CountingError)
    expect(() => validateBatch({ targetId: 'a', attempt: 1, calls: [1], outcome: 'first-correct' })).toThrow(CountingError)
    expect(() => validateBatch({ targetId: 'a', attempt: 1, calls: [1], outcome: 'first-correct', retryOf: 'a' })).toThrow(CountingError)
    expect(() => validateBatch({ targetId: 'a', attempt: 1, calls: [1], outcome: 'eventually-correct', retryOf: 'a' })).not.toThrow()
  })

  it('refuses an invented zero cost and demands unknown instead', () => {
    const unknown = Object.fromEntries(['inputTokens', 'outputTokens', 'wallMs', 'modelRequests', 'runCodeCalls', 'innerToolCalls', 'reads', 'verifications'].map(field => [field, 'unknown']))
    expect(() => validateCost(unknown)).not.toThrow()
    expect(() => validateCost({ ...unknown, reads: undefined })).toThrow(CountingError)
  })
})

describe('the driver', () => {
  it('freezes to a file and then accepts a report that matches the frozen protocol', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'eval-driver-'))
    try {
      const protocolPath = path.join(dir, 'protocol.json')
      const frozenPath = path.join(dir, 'frozen.json')
      writeFileSync(protocolPath, JSON.stringify(complete(), null, 2))
      execFileSync(process.execPath, [DRIVER, 'freeze', protocolPath, '--out', frozenPath], { encoding: 'utf8' })
      const frozen = JSON.parse(execFileSync(process.execPath, ['-e', 'console.log(require("fs").readFileSync(process.argv[1],"utf8"))', frozenPath], { encoding: 'utf8' }))

      const reportPath = path.join(dir, 'report.json')
      const unknownCosts = Object.fromEntries(['inputTokens', 'outputTokens', 'wallMs', 'modelRequests', 'runCodeCalls', 'innerToolCalls', 'reads', 'verifications'].map(field => [field, 'unknown']))
      writeFileSync(reportPath, JSON.stringify({
        protocolHash: frozen.protocolHash,
        kind: 'formal',
        runs: Array.from({ length: 3 }, (_, repeat) => complete().tasks.flatMap((task, index) => Array.from({ length: 2 }, (_, i) => ({ taskId: task.id, repeat, arm: complete().comparison[(7 + repeat + index + i) % 2], status: 'BLOCKED', reason: 'fixture only', finalCorrect: 'unknown' })))).flat(),
        targets: [{ id: 'a', class: 'known-applicable', firstAttempt: 'hashline', mode: 'hashline' }],
        rates: { knownApplicable: 1, adoptionRate: 1 },
        batches: [{ targetId: 'a', attempt: 0, calls: [1], outcome: 'first-correct' }],
        costs: unknownCosts,
        outcomes: {},
        exceptions: [],
        unknowns: [],
      }))
      const out = execFileSync(process.execPath, [DRIVER, 'check', frozenPath, reportPath], { encoding: 'utf8' })
      expect(out).toContain('report accepted')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a report whose denominator disagrees with its own targets', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'eval-driver-'))
    try {
      const frozenPath = path.join(dir, 'frozen.json')
      writeFileSync(frozenPath, JSON.stringify(freezeProtocol(complete())))
      const frozen = JSON.parse(execFileSync(process.execPath, ['-e', 'console.log(require("fs").readFileSync(process.argv[1],"utf8"))', frozenPath], { encoding: 'utf8' }))
      const reportPath = path.join(dir, 'report.json')
      writeFileSync(reportPath, JSON.stringify({
        protocolHash: frozen.protocolHash,
        targets: [
          { id: 'a', class: 'known-applicable', firstAttempt: 'hashline', mode: 'hashline' },
          { id: 'b', class: 'known-applicable', firstAttempt: 'non-hashline', mode: 'non-hashline' },
        ],
        // Claims 1/1 by dropping the non-Hashline attempt from the denominator.
        rates: { knownApplicable: 1, adoptionRate: 1 },
        batches: [],
        costs: Object.fromEntries(['inputTokens', 'outputTokens', 'wallMs', 'modelRequests', 'runCodeCalls', 'innerToolCalls', 'reads', 'verifications'].map(field => [field, 'unknown'])),
        outcomes: {},
        exceptions: [],
        unknowns: [],
      }))
      let exitCode = 0
      try {
        execFileSync(process.execPath, [DRIVER, 'check', frozenPath, reportPath], { encoding: 'utf8', stdio: 'pipe' })
      } catch (error) {
        exitCode = (error as { status?: number }).status ?? 1
      }
      expect(exitCode).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a drifted frozen protocol', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'eval-driver-'))
    try {
      const frozen = freezeProtocol(complete())
      // Tamper: the body changed but the recorded hash did not.
      const tampered = { ...frozen, budget: { maxModelRequests: 1, maxTotalTokens: 1 } }
      const frozenPath = path.join(dir, 'frozen.json')
      writeFileSync(frozenPath, JSON.stringify(tampered))
      const reportPath = path.join(dir, 'report.json')
      writeFileSync(reportPath, JSON.stringify({ protocolHash: frozen.protocolHash, targets: [], batches: [], costs: {}, outcomes: {}, exceptions: [], unknowns: [] }))
      let exitCode = 0
      try {
        execFileSync(process.execPath, [DRIVER, 'check', frozenPath, reportPath], { encoding: 'utf8', stdio: 'pipe' })
      } catch (error) {
        exitCode = (error as { status?: number }).status ?? 1
      }
      expect(exitCode).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
