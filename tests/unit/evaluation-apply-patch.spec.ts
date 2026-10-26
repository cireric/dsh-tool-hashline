import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
// @ts-expect-error plain ESM module
import { captureParsedPlan } from '../../scripts/evaluation/apply-patch-targets.mjs'
// @ts-expect-error plain ESM module
import { requestFiles, targetSummary, unavailableTargets } from '../../scripts/evaluation/targets.mjs'
// @ts-expect-error plain ESM module
import { treeTraceSummary, writeSessionEvidence } from '../../scripts/evaluation/session-tree.mjs'
// @ts-expect-error plain ESM module
import { analyzeEvidence } from '../../scripts/evaluation/analysis.mjs'
// @ts-expect-error plain ESM module
import { checkRunReport } from '../../scripts/evaluation/report.mjs'
// @ts-expect-error plain ESM module
import { verifyTree } from '../../scripts/evaluation/evidence.mjs'
// @ts-expect-error plain ESM module
import { protocolHash } from '../../scripts/evaluation/protocol.mjs'
// @ts-expect-error plain ESM module
import { sha256 } from '../../scripts/evaluation/stimuli.mjs'

const engine = createRequire(import.meta.url).resolve('@hy-sde-org/dsh-hashline')
const { Patch } = createRequire(import.meta.url)(engine)
const cwd = join(tmpdir(), 'eval-apply-plan')
const input = '*** Begin Patch\n*** Update File: a.txt\n@@\n-x\n+y\n*** Update File: b.txt\n@@\n-x\n+z\n*** End Patch'
const receipt = () => ({ callId: 'edit', mode: 'apply_patch', result: 'completed', parsedPlan: captureParsedPlan({ version: '1', mode: 'apply_patch', decision: { mode: 'apply_patch', callId: 'edit', rootCallId: 'program', targets: [{ path: 'a.txt', op: 'update' }, { path: 'b.txt', op: 'update' }] } }) })
const call = () => ({ id: 'edit', rootCallId: 'program', requestedMode: 'apply_patch', selectedMode: 'apply_patch', receipts: [receipt()] })
const task = () => ({ id: 'task', batchBoundary: 'task-end', initial: { 'a.txt': 'x', 'b.txt': 'x' }, expected: { 'a.txt': 'y', 'b.txt': 'z' }, targets: ['a.txt', 'b.txt'].map(path => ({ id: path, path, goal: 'match independent bytes', class: 'known-applicable' })) })
const fixture = (root = cwd, isError = false) => {
  const events = [
    { type: 'turn/start', data: {} },
    { type: 'tool/call', data: { callId: 'program', name: 'run_code', arguments: '{}' } },
    { type: 'tool/ptc-dispatch-start', data: { subCallId: 'edit', rootCallId: 'program', name: 'edit', arguments: { input } } },
    { type: 'tool/ptc-dispatch', data: { subCallId: 'edit', rootCallId: 'program', name: 'edit', isError } },
    { type: 'tool/result', data: { message: { toolCallId: 'program', isError: false } } },
    { type: 'assistant/message', data: { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  ].map((event, seq) => ({ ...event, seq }))
  const source = { id: 'eval-root', parentId: null, createdAt: 1, inherited: 0, cwd: root, events, receipts: [{ ...receipt(), result: isError ? 'failed' : 'completed' }] }
  return { sources: [source], graph: { rootId: source.id, order: events.map(e => ({ sessionId: source.id, seq: e.seq })) } }
}

describe('apply_patch parsed decision evidence', () => {
  it('captures only plan metadata and leaves malformed or unrelated decisions unusable', () => {
    expect(captureParsedPlan({ mode: 'hashline', decision: { mode: 'hashline' } })).toBeUndefined()
    const raw = { version: '1', mode: 'apply_patch', decision: { mode: 'apply_patch', callId: 'edit', rootCallId: 'program', targets: [{ path: 'a.txt', op: 'update', body: 'private bytes' }] } }
    expect(captureParsedPlan(raw).targets).toEqual([{ path: 'a.txt', op: 'update' }])
    expect(captureParsedPlan({ ...raw, decision: { ...raw.decision, targets: {} } }).targets).toBeUndefined()
  })
  it('maps all parsed files, including calls from a changed directory and absolute headers', () => {
    expect(requestFiles('edit', { input }, cwd, cwd, Patch, call())).toEqual(['a.txt', 'b.txt'])
    expect(requestFiles('edit', { input }, join(cwd, 'nested'), cwd, Patch, call())).toEqual(['nested/a.txt', 'nested/b.txt'])
    const absolute = input.replace('a.txt', join(cwd, 'a.txt')).replace('b.txt', join(cwd, 'b.txt'))
    expect(requestFiles('edit', { input: absolute }, cwd, cwd, Patch, call())).toEqual(['a.txt', 'b.txt'])
  })
  it.each(['missing', 'call', 'root', 'version', 'plan-mode', 'receipt-mode', 'selected-mode', 'requested-mode', 'path-set', 'operation', 'empty', 'retry-plan'])('keeps %s plan evidence unknown', kind => {
    const c = call(), plan = c.receipts[0]!.parsedPlan
    if (kind === 'missing') delete c.receipts[0]!.parsedPlan
    if (kind === 'call') plan.callId = 'other'
    if (kind === 'root') plan.rootCallId = 'other'
    if (kind === 'version') plan.version = 'future'
    if (kind === 'plan-mode') plan.mode = 'hashline'
    if (kind === 'receipt-mode') c.receipts[0]!.mode = 'patch'
    if (kind === 'selected-mode') c.selectedMode = 'hashline'
    if (kind === 'requested-mode') c.requestedMode = 'hashline'
    if (kind === 'path-set') plan.targets.pop()
    if (kind === 'operation') plan.targets[0].op = 'unknown'
    if (kind === 'empty') plan.targets = []
    if (kind === 'retry-plan') c.receipts.push({ ...receipt(), parsedPlan: undefined })
    expect(requestFiles('edit', { input }, cwd, cwd, Patch, c)).toBe('unknown')
  })
  it('refuses move destinations, escaping paths, mixed payloads and header-only guesses', () => {
    expect(requestFiles('edit', { input: input.replace('@@', '*** Move to: moved.txt\n@@') }, cwd, cwd, Patch, call())).toBe('unknown')
    const c = call(), escaped = input.replace('a.txt', '../outside')
    c.receipts[0]!.parsedPlan.targets[0].path = '../outside'
    expect(requestFiles('edit', { input: escaped }, cwd, cwd, Patch, c)).toBe('unknown')
    expect(requestFiles('edit', { input, old_string: 'x' }, cwd, cwd, Patch, call())).toBe('unknown')
    expect(requestFiles('edit', { input }, cwd, cwd, Patch)).toBe('unknown')
  })
  it('attributes a partial failed call to every planned target without claiming successful mode or final correctness', () => {
    const { sources, graph } = fixture(cwd, true), trace = treeTraceSummary(graph, sources)
    const result = targetSummary(task(), trace, sources, graph, { files: [{ name: 'a.txt', correct: true, changed: true }, { name: 'b.txt', correct: false, changed: false }] }, Patch)
    expect(result.unassigned).toEqual([])
    expect(result.targets.map((t: { observedFailures: number }) => t.observedFailures)).toEqual([1, 1])
    expect(result.targets.map((t: { firstAttempt: string }) => t.firstAttempt)).toEqual(['non-hashline', 'non-hashline'])
    expect(result.targets.map((t: { mode: string }) => t.mode)).toEqual(['unknown', 'unknown'])
    expect(result.targets.map((t: { finalCorrect: boolean }) => t.finalCorrect)).toEqual([true, false])
    expect(JSON.stringify(trace)).not.toContain('parsedPlan')
  })
  it('does not borrow a same-id receipt from another session', () => {
    const { sources, graph } = fixture(), trace = treeTraceSummary(graph, sources)
    const foreign = { ...sources[0]!, id: 'foreign', events: [], receipts: sources[0]!.receipts }
    sources[0]!.receipts = []
    const result = targetSummary(task(), trace, [...sources, foreign], graph, { files: [] }, Patch)
    expect(result.status).toBe('GAP')
    expect(result.unassigned).toHaveLength(1)
  })
  it('independently recomputes the raw plan and rejects a withheld or altered receipt', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eval-plan-report-')), root = join(directory, 'eval-root')
    try {
      mkdirSync(root)
      const t = task(), { sources, graph } = fixture(root)
      writeSessionEvidence(directory, { sessions: new Map(sources.map(s => [s.id, s])), order: graph.order }, 'eval-root', [])
      writeFileSync(join(directory, 'eval-root.stimuli.json'), '[]')
      writeFileSync(join(directory, 'eval-root.initial.json'), JSON.stringify(verifyTree({}, t.initial, { 'a.txt': Buffer.from('x'), 'b.txt': Buffer.from('x') })))
      writeFileSync(join(root, 'a.txt'), 'y'); writeFileSync(join(root, 'b.txt'), 'z')
      const final = verifyTree(t.initial, t.expected, { 'a.txt': Buffer.from('y'), 'b.txt': Buffer.from('z') })
      const protocol = { protocolHash: 'fixture', kind: 'probe', tasks: [t], samples: { repetitions: 1, seed: 1 }, comparison: ['stock-edit', 'hashline-fallback'], dependencies: { packages: { '@hy-sde-org/dsh-hashline': { entry: engine, entryHash: sha256(readFileSync(engine)) } } } }
      const analysis = analyzeEvidence(t, { sources, graph, batches: [], stimuli: [] }, 'hashline-fallback', final, protocol, true)
      analysis.trace.costs.wallMs = 0
      const run = { taskId: 'task', repeat: 0, arm: 'hashline-fallback', graphVersion: 1, status: 'PASS', sessionId: 'eval-root', initialHash: protocolHash(t.initial), final, finalCorrect: true, ...analysis }
      const report = { protocolHash: 'fixture', kind: 'probe', runs: [run, { taskId: 'task', repeat: 0, arm: 'stock-edit', status: 'BLOCKED', finalCorrect: 'unknown', targetEvaluation: unavailableTargets(t) }] }
      expect(checkRunReport(protocol, report, directory)).toEqual([])
      sources[0]!.receipts[0]!.parsedPlan.targets[0].path = 'forged.txt'
      writeFileSync(join(directory, 'eval-root.receipts.json'), JSON.stringify(sources[0]!.receipts))
      expect(checkRunReport(protocol, report, directory).join()).toContain('recomputation mismatch')
      delete sources[0]!.receipts[0]!.parsedPlan
      writeFileSync(join(directory, 'eval-root.receipts.json'), JSON.stringify(sources[0]!.receipts))
      expect(checkRunReport(protocol, report, directory).join()).toContain('unsupported target/stimulus PASS')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
