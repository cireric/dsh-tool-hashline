import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
// @ts-expect-error plain ESM evaluation module
import { traceSummary, decodeTrace, verifyTree, candidateSummary } from '../../scripts/evaluation/evidence.mjs'
// @ts-expect-error plain ESM evaluation module
import { armRows, assertIdentity } from '../../scripts/evaluation/identity.mjs'
// @ts-expect-error plain ESM evaluation module
import { preflight, runEvaluation, schedule } from '../../scripts/evaluation/run.mjs'
// @ts-expect-error plain ESM evaluation module
import { freezeProtocol, protocolGaps, protocolHash } from '../../scripts/evaluation/protocol.mjs'
// @ts-expect-error plain ESM evaluation module
import { checkRunReport } from '../../scripts/evaluation/report.mjs'
// @ts-expect-error plain ESM evaluation module
import { validateCost, summarizeRuns } from '../../scripts/evaluation/counting.mjs'

const event = (seq: number, type: string, data: object = {}) => ({ seq, type, data })
const records = () => [
  event(0, 'turn/start'),
  event(1, 'tool/call', { callId: 'outer', name: 'run_code', arguments: '{}' }),
  event(2, 'tool/ptc-dispatch-start', { subCallId: 'inner', rootCallId: 'outer', name: 'edit', arguments: { input: '[x#ABCD]\nPUT 1:\n+y' } }),
  event(3, 'tool/ptc-dispatch', { subCallId: 'inner', rootCallId: 'outer', name: 'edit', isError: true, content: [{ type: 'text', text: '[EDIT_POLICY_FALLBACK_REQUIRED] private body' }] }),
  event(4, 'tool/result', { message: { toolCallId: 'outer', isError: false } }),
  event(5, 'assistant/message', { usage: { inputTokens: 3, cacheReadTokens: 10, outputTokens: 2, totalTokens: 15 } }),
  event(6, 'turn/end', { reason: { kind: 'completed' } }),
]
const protocol = () => ({
  id: 'offline-fixture', kind: 'probe', limits: ['No model evidence'], createdAt: '2026-10-25',
  comparison: ['stock-edit', 'hashline-default', 'hashline-fallback'],
  tools: { arms: { 'stock-edit': 'a', 'hashline-default': 'b', 'hashline-fallback': 'c' }, presetHash: 'fixture', providerPlugin: 'missing-provider', providerConfig: {}, credentialEnv: 'EVALUATION_TEST_KEY' },
  model: { provider: 'fixture', model: 'fixture', parameters: { maxTokens: 10 } }, dependencies: { packages: {}, patches: {}, resources: {}, inputs: {}, profileInputs: {}, driverInputs: {}, environment: {}, readEngine: 'fixture', editEngine: 'fixture' },
  samples: { repetitions: 2, seed: 7 }, order: 'interleaved', budget: { maxModelRequests: 5, maxTotalTokens: 100, timeoutMs: 100 },
  passConditions: { minFirstCandidateCorrect: 0.9, maxTotalTokensPerTask: 100 },
  tasks: [{ id: 'a', family: 'single-point', class: 'known-applicable', batchBoundary: 'task-end', initial: { 'a.txt': 'x' }, expected: { 'a.txt': 'y' }, prompt: 'change x to y' }],
})

describe('evaluation protocol and identity', () => {
  it('freezes a limited probe, never a formal subset or an unspecified kind', () => {
    expect(protocolGaps(protocol())).toEqual([])
    expect(protocolGaps({ ...protocol(), kind: 'formal' }).join()).toContain('user-override')
    expect(protocolGaps({ ...protocol(), limits: [] }).join()).toContain('limits')
    expect(protocolGaps({ ...protocol(), kind: undefined }).join()).toContain('kind')
    expect(protocolGaps({ ...protocol(), comparison: 'bad' }).length).toBeGreaterThan(0)
  })
  it('rejects unsafe files, duplicate tasks, unsupported parameters and literal secrets', () => {
    const p = protocol()
    expect(protocolGaps({ ...p, tasks: [{ ...p.tasks[0], initial: { '../escape': 'x' } }] }).join()).toContain('unsafe')
    expect(protocolGaps({ ...p, tasks: [p.tasks[0], p.tasks[0]] }).join()).toContain('duplicate')
    expect(protocolGaps({ ...p, model: { ...p.model, parameters: { temperature: 0 } } }).join()).toContain('unsupported')
    expect(protocolGaps({ ...p, tools: { ...p.tools, providerConfig: { apiKey: 'private' } } }).join()).toContain('literal credentials')
  })
  it('freezes config and patch bytes; equal versions do not hide drift', () => {
    const p = protocol(), a = freezeProtocol(p)
    expect(freezeProtocol({ ...p, tools: { ...p.tools, presetHash: 'changed' } }).protocolHash).not.toBe(a.protocolHash)
    expect(protocolHash({ a: 1, missing: undefined })).toBe(protocolHash(JSON.parse(JSON.stringify({ a: 1, missing: undefined }))))
    const identity = { readEngine: 'same', editEngine: 'same', packages: { edit: { version: '1', entryHash: 'a' } }, patches: { edit: { status: 'patched' } } }
    expect(() => assertIdentity(identity, identity)).not.toThrow()
    expect(() => assertIdentity(identity, { ...identity, packages: { edit: { version: '1', entryHash: 'b' } } })).toThrow('DRIFT')
    expect(() => assertIdentity({ ...identity, editEngine: 'other' }, { ...identity, editEngine: 'other' })).toThrow('ENGINE')
  })
  it('derives three arms without mutating shared PTC/persona/watchdog rows', () => {
    const rows = [{ id: 'tool-fs', config: { read: false, edit: false } }, { id: 'tool-read' }, { id: 'tool-edit', config: { mode: 'auto', contentPolicyModule: 'policy' } }, { id: 'watchdog', config: { mode: 'enforce' } }]
    expect(armRows(rows, 'stock-edit').map((r: { id: string }) => r.id)).toEqual(['tool-fs', 'watchdog'])
    expect(armRows(rows, 'hashline-default')[2].config.mode).toBe('hashline')
    expect(armRows(rows, 'hashline-fallback')[2].config.contentPolicyModule).toBe('policy')
    expect(rows[2].config?.mode).toBe('auto')
    expect(schedule(protocol())).toHaveLength(6)
  })
})

describe('trajectory and independent final state', () => {
  it('decodes every concatenated frame (regression for E3 header-only observation)', () => {
    const bytes = Buffer.concat([zstdCompressSync(JSON.stringify({ type: 'session', id: 's' }) + '\n'), zstdCompressSync(records().map(r => JSON.stringify(r)).join('\n') + '\n')])
    const result = decodeTrace(bytes, 's')
    expect(result.frames).toBe(2)
    expect(result.calls).toHaveLength(2)
    expect(result.status).toBe('PASS')
    expect(() => decodeTrace(bytes, 'another')).toThrow('IDENTITY')
    expect(decodeTrace(bytes.subarray(0, bytes.length - 3), 's').status).toBe('GAP')
    expect(JSON.stringify(result)).not.toContain('private body')
  })
  it('keeps inner failure when outer succeeds and uses receipts for actual mode', () => {
    const trace = traceSummary(records(), { receipts: [{ callId: 'inner', mode: 'replace', result: 'refused', retry: 1 }] })
    expect(trace.failures).toBe(1)
    expect(trace.calls[1].selectedMode).toBe('replace')
    expect(trace.calls[1].actualMode).toBe('unknown')
    expect(trace.calls[1].execution).toBe('refused')
    expect(trace.calls[1].code).toBe('EDIT_POLICY_FALLBACK_REQUIRED')
    expect(trace.internalRetries).toBe(1)
    expect(trace.costs.inputTokens).toBe(13)
    expect(trace.costs.outputTokens).toBe(2)
    expect(trace.firstCandidateCorrect).toBe('unknown')
    expect(traceSummary(records()).calls[1].actualMode).toBe('unknown')
  })
  it.each(['missing-end', 'duplicate', 'no-outer', 'seq-gap', 'no-turn'])('marks incomplete %s trace GAP', kind => {
    let r = records()
    if (kind === 'missing-end') r = r.filter(e => e.seq !== 3)
    if (kind === 'duplicate') r.splice(3, 0, r[2]!)
    if (kind === 'no-outer') r = r.filter(e => e.seq !== 1)
    if (kind === 'seq-gap') r[1]!.seq = 99
    if (kind === 'no-turn') r = r.slice(0, -1)
    expect(traceSummary(r).status).toBe('GAP')
  })
  it('preserves unknown usage, rejects invalid cost, and checks unexpected files/deletions/bytes', () => {
    const trace = traceSummary(records().filter(r => r.type !== 'assistant/message'))
    expect(trace.costs.inputTokens).toBe('unknown')
    expect(() => validateCost({ ...trace.costs, reads: -1 })).toThrow()
    expect(() => validateCost({ ...trace.costs, reads: NaN })).toThrow()
    expect(verifyTree({ a: 'x', b: 'keep' }, { a: 'y' }, { a: Buffer.from('y'), b: Buffer.from('keep') }).correct).toBe(true)
    expect(verifyTree({ a: 'x' }, { a: 'y' }, { a: Buffer.from('y '), extra: Buffer.from('bad') }).correct).toBe(false)
    expect(verifyTree({ a: 'x' }, { a: null }, {}).correct).toBe(true)
  })
  it('observes recovery once per edit call, not once per receipt/internal retry', () => {
    const r = records()
    r.splice(4, 0, event(4, 'tool/ptc-dispatch-start', { subCallId: 'recovery', rootCallId: 'outer', name: 'edit' }), event(5, 'tool/ptc-dispatch', { subCallId: 'recovery', rootCallId: 'outer', isError: false }))
    r.forEach((r, i) => { r.seq = i })
    const trace = traceSummary(r)
    expect(trace.editCalls).toBe(2)
    expect(trace.recovered).toBe(true)
    expect(trace.retries).toBe('unknown')
  })
  it('checks frozen candidate batches independently from call count and validates retry links', () => {
    const trace = traceSummary(records())
    const batches = [{ callId: 'outer', attempt: 0, final: { correct: false } }]
    expect(candidateSummary(trace, batches, 'first-edit-program').firstCandidateCorrect).toBe(false)
    expect(candidateSummary(trace, batches, 'first-edit-program').retries).toBe(0)
    expect(candidateSummary(trace, [], 'first-edit-program').candidateStatus).toBe('GAP')
    const second = { ...trace.calls[0], id: 'second', startSeq: 9, endSeq: 12 }
    trace.calls.push(second, { ...trace.calls[1], id: 'inner2', rootCallId: 'second', startSeq: 10, endSeq: 11 })
    batches.push({ callId: 'second', attempt: 1, final: { correct: true } })
    expect(candidateSummary(trace, batches, 'first-edit-program').retries).toBe('unknown')
    const linked = [batches[0], { ...batches[1], retryOf: 'outer' }]
    expect(candidateSummary(trace, linked, 'first-edit-program').retries).toBe(1)
    expect(candidateSummary(trace, linked, 'first-edit-program').firstCandidateCorrect).toBe(false)
  })
})

describe('offline execution safeguards', () => {
  it('does not open a host without credentials/provider or without execute', async () => {
    const p = freezeProtocol(protocol())
    const ready = preflight(p, join(tmpdir(), 'nonexistent-eval-profile'), {})
    expect(ready.status).toBe('BLOCKED')
    expect(ready.gaps.join()).toContain('credential')
    const dir = mkdtempSync(join(tmpdir(), 'eval-no-provider-'))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-acceptance' }))
      expect(preflight(p, dir, { EVALUATION_TEST_KEY: 'fixture' }).gaps.join()).toContain('provider package unavailable')
    } finally { rmSync(dir, { recursive: true, force: true }) }
    let calls = 0
    await runEvaluation(p, { profile: 'missing', out: 'unused', hostFactory: () => { calls++ } })
    expect(calls).toBe(0)
    await expect(runEvaluation({ ...p, budget: { ...p.budget, maxModelRequests: 999 } }, { profile: 'missing', out: 'unused' })).rejects.toThrow('DRIFTED')
  })
  it('retains cancelled tasks, creates no fixture or model request after cancellation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-cancel-'))
    const out = join(dir, 'new'), controller = new AbortController()
    controller.abort()
    try {
      const report = await runEvaluation(freezeProtocol(protocol()), { out, execute: true, skipPreflight: true, signal: controller.signal, hostFactory: async () => ({ ctx: { on() {} }, dispose() {}, execute() { throw new Error('must not execute') } }) })
      expect(report.runs).toHaveLength(6)
      expect(report.runs.every((r: { status: string }) => r.status === 'CANCELLED')).toBe(true)
      expect(report.budget.requests).toBe(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('records in-flight cancellation, preserves partial disk state and stops later samples', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-active-cancel-')), controller = new AbortController()
    try {
      const report = await runEvaluation(freezeProtocol(protocol()), { out: join(dir, 'run'), execute: true, skipPreflight: true, signal: controller.signal, hostFactory: async () => ({
        ctx: { on() {} }, dispose() {},
        async execute(_id: string, _arm: string, cwd: string) {
          writeFileSync(join(cwd, 'a.txt'), 'partial')
          controller.abort()
          return { events: records(), receipts: [] }
        },
      }) })
      expect(report.runs[0].status).toBe('CANCELLED')
      expect(report.runs[0].final.changed).toBe(true)
      expect(report.runs[0].partialTask).toBe(true)
      expect(report.runs.slice(1).every((r: { status: string }) => r.status === 'CANCELLED')).toBe(true)
      expect(Object.values(summarizeRuns(report.runs, protocol().comparison)).reduce((n: number, r: unknown) => n + (r as { scheduled: number }).scheduled, 0)).toBe(6)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it.each([true, false])('stops before another request after exhausted/unknown usage (%s)', async known => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-budget-'))
    const p = protocol(); p.budget.maxModelRequests = 1
    let middleware: (options: object, next: () => AsyncGenerator<object>) => AsyncGenerator<object>
    try {
      const report = await runEvaluation(freezeProtocol(p), { out: join(dir, 'run'), execute: true, skipPreflight: true, hostFactory: async () => ({
        ctx: { on(_event: string, listener: typeof middleware) { middleware = listener } }, dispose() {},
        async execute(_id: string, _arm: string, cwd: string) {
          for await (const _chunk of middleware({ provider: 'fixture', model: 'fixture', maxTokens: 10 }, async function* () { if (known) yield { type: 'usage', usage: { totalTokens: 5 } } })) { /* consume fixture */ }
          writeFileSync(join(cwd, 'a.txt'), 'y')
          return { events: records(), receipts: [] }
        },
      }) })
      expect(report.budget.requests).toBe(1)
      expect(report.budget.unknown).toBe(!known)
      expect(report.runs.slice(1).every((r: { status: string }) => r.status === 'BLOCKED')).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('recomputes file evidence and rejects dropped/reused/tampered samples', () => {
    const p = freezeProtocol(protocol()), runs = schedule(p).map((item: object) => ({ ...item, status: 'BLOCKED', finalCorrect: 'unknown' }))
    const report = { protocolHash: p.protocolHash, kind: p.kind, runs }
    expect(checkRunReport(p, report, 'unused')).toEqual([])
    expect(checkRunReport(p, { ...report, runs: runs.slice(1) }, 'unused').join()).toContain('missing')
    const dir = mkdtempSync(join(tmpdir(), 'eval-final-'))
    try {
      mkdirSync(join(dir, 'eval-fixture'))
      writeFileSync(join(dir, 'eval-fixture', 'a.txt'), 'wrong')
      writeFileSync(join(dir, 'eval-fixture.initial.json'), JSON.stringify(verifyTree({}, p.tasks[0].initial, { 'a.txt': Buffer.from('x') })))
      const changed = { ...runs[0], initialHash: protocolHash(p.tasks[0].initial), sessionId: 'eval-fixture', status: 'PASS', finalCorrect: true, final: { correct: true } }
      expect(checkRunReport(p, { ...report, runs: [changed, ...runs.slice(1)] }, dir).join()).toContain('mismatch')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
