import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
// @ts-expect-error plain ESM module
import { treeTraceSummary, writeSessionEvidence, collectSessions } from '../../scripts/evaluation/session-tree.mjs'
// @ts-expect-error plain ESM module
import { requestFiles, targetSummary, unavailableTargets } from '../../scripts/evaluation/targets.mjs'
// @ts-expect-error plain ESM module
import { createStimulusController, stimulusSummary, taskEvaluationGaps, sha256, safeTaskPath } from '../../scripts/evaluation/stimuli.mjs'
// @ts-expect-error plain ESM module
import { candidateSummary, verifyTree, treeState } from '../../scripts/evaluation/evidence.mjs'
// @ts-expect-error plain ESM module
import { summarizeRuns } from '../../scripts/evaluation/counting.mjs'
// @ts-expect-error plain ESM module
import { analyzeEvidence } from '../../scripts/evaluation/analysis.mjs'
// @ts-expect-error plain ESM module
import { checkRunReport } from '../../scripts/evaluation/report.mjs'
// @ts-expect-error plain ESM module
import { protocolHash } from '../../scripts/evaluation/protocol.mjs'
// @ts-expect-error plain ESM module
import { requestAccounting } from '../../scripts/evaluation/accounting.mjs'

const { Patch } = createRequire(import.meta.url)('@hy-sde-org/dsh-hashline')
const cwd = join(tmpdir(), 'evaluation-tree-fixture')
const event = (type: string, data: object = {}) => ({ type, data })
const seq = (events: Array<{ type: string; data: object }>) => events.map((e, i) => ({ ...e, seq: i }))
const fixture = () => {
  const root = { id: 'root', parentId: null, createdAt: 1, inherited: 0, cwd, receipts: [], events: seq([
    event('turn/start'), event('tool/call', { callId: 'same', name: 'run_code', arguments: '{}' }),
    event('tool/ptc-dispatch-start', { subCallId: 'delegate', rootCallId: 'same', name: 'subagent', arguments: '{}' }),
    event('subagent/catalog', { childId: 'child', childCreatedAt: 2 }),
    event('tool/ptc-dispatch', { subCallId: 'delegate', rootCallId: 'same', name: 'subagent', isError: false }),
    event('tool/result', { message: { toolCallId: 'same', isError: false } }),
    event('assistant/message', { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }),
    event('turn/end', { reason: { kind: 'completed' } }),
  ]) }
  const child = { id: 'child', parentId: 'root', createdAt: 2, inherited: 0, cwd, receipts: [{ callId: 'edit', mode: 'hashline', result: 'completed' }], events: seq([
    event('subagent/descriptor'), event('turn/start'), event('tool/call', { callId: 'same', name: 'run_code', arguments: '{}' }),
    event('tool/ptc-dispatch-start', { subCallId: 'edit', rootCallId: 'same', name: 'edit', arguments: { input: '[a.txt#ABCD]\nPUT 1:\n+y' } }),
    event('tool/ptc-dispatch', { subCallId: 'edit', rootCallId: 'same', name: 'edit', isError: false }),
    event('tool/result', { message: { toolCallId: 'same', isError: false } }),
    event('assistant/message', { usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } }),
    event('turn/end', { reason: { kind: 'completed' } }),
  ]) }
  const refs = (source: typeof root | typeof child, begin = 0, end = source.events.length) => source.events.slice(begin, end).map(e => ({ sessionId: source.id, seq: e.seq }))
  return { sources: [root, child], graph: { rootId: 'root', order: [...refs(root, 0, 4), ...refs(child), ...refs(root, 4)] } }
}
const task = () => ({ initial: { 'a.txt': 'x', 'b.txt': 'x' }, expected: { 'a.txt': 'y', 'b.txt': 'y' }, targets: [
  { id: 'a-goal', path: 'a.txt', goal: 'change x to y', class: 'known-applicable' },
  { id: 'b-goal', path: 'b.txt', goal: 'change x to y', class: 'known-applicable' },
] })

describe('session tree identity and costs', () => {
  it('passes frozen payload semantics through child sessions without claiming rejected execution', () => {
    const { sources, graph } = fixture()
    sources[1].events[3] = { ...sources[1].events[3], data: { subCallId: 'edit', rootCallId: 'same', name: 'edit', arguments: { input: 'a.txt#ABCD\nPUT 1:\n+y' } } }
    sources[1].events[4] = { ...sources[1].events[4], data: { subCallId: 'edit', rootCallId: 'same', name: 'edit', isError: true } }
    sources[1].receipts = [{ callId: 'edit', mode: 'hashline', result: 'refused' }]
    const taskWithoutTargets = { initial: {}, expected: {} }
    const v2 = analyzeEvidence(taskWithoutTargets, { sources, graph }, 'hashline-default', {}, { editPayloadVersion: 2 }, true)
    const edit = v2.trace.calls.find((c: { name: string }) => c.name === 'edit')
    expect(edit.requestedMode).toBe('unknown')
    expect(edit.selectedMode).toBe('hashline')
    expect(edit.actualMode).toBe('unknown')
    expect(treeTraceSummary(graph, sources).calls.find((c: { name: string }) => c.name === 'edit').requestedMode).toBe('apply_patch')
  })
  it('joins child activation cleanup before admitting the final parent idle boundary', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    let joined = false, parentWaits = 0, noticeConsumed = false
    const root = { id: 'root', status: 'idle', session: { id: 'root', header: { cwd, createdAt: 1 }, snapshotEvents: () => [] }, async whenIdle() { parentWaits++; if (joined) { noticeConsumed = true; root.status = 'idle' } } }
    const ctx = {
      on(name: string, listener: (...args: unknown[]) => void) { listeners.set(name, listener); return () => listeners.delete(name) },
      get() { return { async waitForChildren(agent: typeof root) { expect(agent).toBe(root); if (!joined) { joined = true; root.status = 'running'; return true } return false } } },
    }
    const collector = collectSessions(ctx, 'root')
    listeners.get('agent/created')!({ agent: root })
    await collector.idle()
    expect(parentWaits).toBeGreaterThanOrEqual(2)
    expect(noticeConsumed).toBe(true)
    collector.dispose()
  })
  it('cancels a child published after cancellation was requested', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const ctx = { on(name: string, listener: (...args: unknown[]) => void) { listeners.set(name, listener); return () => listeners.delete(name) } }
    const controller = new AbortController(), collector = collectSessions(ctx, 'root', controller.signal)
    const session = (id: string, parentSession?: string) => ({ id, header: { parentSession, cwd, createdAt: 1 }, snapshotEvents: () => [] })
    collector.watch(session('root'))
    controller.abort()
    let cancelled = false
    listeners.get('agent/created')!({ agent: { id: 'child', session: session('child', 'root'), cancel() { cancelled = true } } })
    expect(cancelled).toBe(true)
    expect(collector.sessions.has('child')).toBe(true)
    collector.dispose()
  })
  it('keeps identical call IDs in two sessions separate, sums usage, and pairs the child candidate only', () => {
    const { sources, graph } = fixture(), trace = treeTraceSummary(graph, sources)
    expect(trace.status).toBe('PASS')
    expect(trace.calls).toHaveLength(4)
    expect(trace.costs.inputTokens).toBe(4)
    expect(trace.costs.outputTokens).toBe(3)
    expect(trace.costs.modelRequests).toBe(2)
    expect(candidateSummary(trace, [{ sessionId: 'child', callId: 'same', attempt: 0, final: { correct: true } }], 'first-edit-program').candidateStatus).toBe('PASS')
  })
  it.each(['missing-child', 'missing-catalog', 'foreign-order', 'missing-position', 'cycle'])('marks incomplete %s tree GAP', kind => {
    const { sources, graph } = fixture()
    if (kind === 'missing-child') sources.pop()
    if (kind === 'missing-catalog') sources[0]!.events[3] = { ...sources[0]!.events[3]!, type: 'unrelated' }
    if (kind === 'foreign-order') graph.order.push({ sessionId: 'foreign', seq: 0 })
    if (kind === 'missing-position') graph.order.splice(4, 1)
    if (kind === 'cycle') sources[1]!.parentId = 'child'
    expect(treeTraceSummary(graph, sources).status).toBe('GAP')
    expect(treeTraceSummary(graph, sources).costs.modelRequests).toBe('unknown')
  })
  it('does not bill fork-inherited model messages or calls a second time', () => {
    const { sources } = fixture(), root = sources[0]!, child = sources[1]!
    const prefix = root.events.slice(0, 7)
    child.inherited = prefix.length
    child.events = [...prefix, ...child.events.map(e => ({ ...e, seq: e.seq + prefix.length }))]
    const graph = { rootId: 'root', order: sources.flatMap(s => s.events.map(e => ({ sessionId: s.id, seq: e.seq }))) }
    const trace = treeTraceSummary(graph, sources)
    expect(trace.status).toBe('PASS')
    expect(trace.costs.modelRequests).toBe(2)
    expect(trace.calls).toHaveLength(4)
  })
  it('requires every catalog child, even when another child was captured successfully', () => {
    const { sources } = fixture()
    sources[0]!.events.splice(4, 0, { ...event('subagent/catalog', { childId: 'missing-child', childCreatedAt: 3 }), seq: 4 })
    sources[0]!.events.forEach((e, i) => { e.seq = i })
    const graph = { rootId: 'root', order: sources.flatMap(s => s.events.map(e => ({ sessionId: s.id, seq: e.seq }))) }
    expect(treeTraceSummary(graph, sources).gaps.join()).toContain('catalog child not captured')
  })
  it('does not replace missing child usage with zero', () => {
    const { sources, graph } = fixture()
    sources[1]!.events[6]!.data = {}
    const trace = treeTraceSummary(graph, sources)
    expect(trace.status).toBe('PASS')
    expect(trace.costs.inputTokens).toBe('unknown')
    expect(trace.costs.modelRequests).toBe(2)
  })
  it('splits a caught failure and repair inside one program into two independently checked candidates', () => {
    const { sources } = fixture(), child = sources[1]!
    child.events[4]!.data = { subCallId: 'edit', rootCallId: 'same', name: 'edit', isError: true }
    child.events.splice(5, 0,
      { ...event('tool/ptc-dispatch-start', { subCallId: 'edit2', rootCallId: 'same', name: 'edit' }), seq: 5 },
      { ...event('tool/ptc-dispatch', { subCallId: 'edit2', rootCallId: 'same', name: 'edit', isError: false }), seq: 6 })
    child.events.forEach((e, i) => { e.seq = i })
    const graph = { rootId: 'root', order: sources.flatMap(s => s.events.map(e => ({ sessionId: s.id, seq: e.seq }))) }
    const trace = treeTraceSummary(graph, sources)
    const first = { id: 'child:same:0', sessionId: 'child', callId: 'same', boundary: 'edit-failure', boundaryCallId: 'edit', attempt: 0, final: { correct: false } }
    const second = { id: 'child:same:1', sessionId: 'child', callId: 'same', boundary: 'program-end', boundaryCallId: 'same', attempt: 1, retryOf: first.id, final: { correct: true } }
    expect(candidateSummary(trace, [first, second], 'first-edit-program')).toMatchObject({ candidateStatus: 'PASS', firstCandidateCorrect: false, retries: 1 })
    expect(candidateSummary(trace, [second], 'first-edit-program').candidateStatus).toBe('GAP')
    expect(candidateSummary(trace, [{ sessionId: 'child', callId: 'same', attempt: 0, final: { correct: true } }], 'first-edit-program').firstCandidateCorrect).toBe('unknown')
  })
})

describe('stream-to-session request accounting', () => {
  it('does not accept a PASS when a late parent request was omitted from captured session events', () => {
    const run = { sessionId: 'root', trace: { sessions: [{ id: 'root', costs: { modelRequests: 2 } }, { id: 'child', costs: { modelRequests: 2 } }] } }
    const requests = [{ sessionId: 'root' }, { sessionId: 'root' }, { sessionId: 'child' }, { sessionId: 'child' }]
    expect(requestAccounting({ runs: [run], requests }).status).toBe('PASS')
    expect(requestAccounting({ runs: [run], requests: [...requests, { sessionId: 'root' }] })).toMatchObject({ status: 'GAP', capturedRequests: 4, streamRequests: 5 })
    expect(requestAccounting({ runs: [run], requests, requestRefusals: [{ sessionId: 'orphan' }] }).status).toBe('GAP')
    expect(requestAccounting({ runs: [run], requests: [...requests, { sessionId: 'uncaptured' }] }).status).toBe('GAP')
  })
})

describe('per-file goal facts', () => {
  it('maps actual child edits to declared targets, retaining unattempted applicable targets in the denominator', () => {
    const { sources, graph } = fixture(), trace = treeTraceSummary(graph, sources)
    const result = targetSummary(task(), trace, sources, graph, { files: [{ name: 'a.txt', correct: true, changed: true }, { name: 'b.txt', correct: false, changed: false }] }, Patch)
    expect(result.status).toBe('PASS')
    expect(result.rates.knownApplicable).toBe(2)
    expect(result.rates.adoptionRate).toBe(0.5)
    expect(result.targets[0].observedCalls).toEqual([{ sessionId: 'child', callId: 'edit' }])
    expect(result.targets[1].firstAttempt).toBe('not-attempted')
    const summary = summarizeRuns([{ arm: 'hashline-default', status: 'BLOCKED', targetEvaluation: unavailableTargets(task()) }], ['hashline-default'])
    expect(summary['hashline-default'].perTargetAdoption.knownApplicable).toBe(2)
    expect(summary['hashline-default'].perTargetAdoption.byMode.unknown).toBe(2)
  })
  it('uses the real engine parser for hashline move endpoints and keeps unsupported payloads unknown', () => {
    expect(requestFiles('edit', { input: '[a.txt#ABCD]\nMV nested/b.txt' }, cwd, cwd, Patch)).toEqual(['a.txt', 'nested/b.txt'])
    expect(requestFiles('edit', { file_path: 'a.txt', old_string: 'x', new_string: 'y' }, cwd, cwd, Patch)).toEqual(['a.txt'])
    expect(requestFiles('edit', { input: '*** Begin Patch\n*** End Patch' }, cwd, cwd, Patch)).toBe('unknown')
    expect(requestFiles('edit', { input: '[a.txt#ABCD]\nPUT 1:\n+y', old_string: 'x' }, cwd, cwd, Patch)).toBe('unknown')
    expect(requestFiles('read', { file_path: '../escape' }, cwd, cwd, Patch)).toBe('unknown')
  })
  it('does not claim no attempt when a file changed without a mapped editing call', () => {
    const { sources, graph } = fixture(), trace = treeTraceSummary(graph, sources)
    const result = targetSummary(task(), trace, sources, graph, { files: [{ name: 'a.txt', correct: true, changed: true }, { name: 'b.txt', correct: true, changed: true }] }, Patch)
    expect(result.status).toBe('GAP')
    expect(result.targets[1].firstAttempt).toBe('unknown')
    expect(result.rates.knownApplicable).toBe(2)
  })
  it('rejects ambiguous multiple goals for the same file and unfrozen paths', () => {
    const t = task()
    expect(taskEvaluationGaps(t)).toEqual([])
    expect(taskEvaluationGaps({ ...t, targets: [t.targets[0], { ...t.targets[1], path: 'a.txt' }] }).join()).toContain('one goal per file')
    expect(taskEvaluationGaps({ ...t, targets: [{ ...t.targets[0], path: '../escape' }] }).join()).toContain('safe')
    expect(taskEvaluationGaps({ ...t, targets: [t.targets[0]] }).join()).toContain('every expected file change')
    for (const file of ['CON', 'nested/NUL.txt', 'a.txt ', 'a?.txt']) expect(safeTaskPath(file)).toBe(false)
  })
})

describe('independent graph/target report verification', () => {
  it('verifies filenames that collide with JavaScript object prototype names', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eval-special-filenames-'))
    try {
      writeFileSync(join(directory, '__proto__'), 'unexpected')
      writeFileSync(join(directory, 'constructor'), 'unexpected')
      const state = treeState(directory)
      expect(Object.keys(state).sort()).toEqual(['__proto__', 'constructor'])
      expect(verifyTree({}, {}, state).correct).toBe(false)
      expect(verifyTree({}, JSON.parse('{"__proto__":"unexpected","constructor":"unexpected"}'), state).correct).toBe(true)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  it('recomputes goals and refuses a forged denominator or missing child source', () => {
    const directory = mkdtempSync(join(tmpdir(), 'eval-graph-report-')), rootId = 'eval-root', root = join(directory, rootId)
    try {
      mkdirSync(root)
      const t = { ...task(), id: 'task', batchBoundary: 'task-end' }
      const fixtureTree = fixture(), rootSource = fixtureTree.sources[0]!, childSource = fixtureTree.sources[1]!
      rootSource.id = rootId; childSource.parentId = rootId
      for (const source of fixtureTree.sources) source.cwd = root
      const order = fixtureTree.graph.order.map(item => ({ ...item, sessionId: item.sessionId === 'root' ? rootId : item.sessionId }))
      const evidence = writeSessionEvidence(directory, { sessions: new Map(fixtureTree.sources.map(s => [s.id, s])), order }, rootId, [])
      writeFileSync(join(directory, rootId + '.stimuli.json'), '[]')
      const initialBytes = { 'a.txt': Buffer.from('x'), 'b.txt': Buffer.from('x') }
      writeFileSync(join(directory, rootId + '.initial.json'), JSON.stringify(verifyTree({}, t.initial, initialBytes)))
      writeFileSync(join(root, 'a.txt'), 'y'); writeFileSync(join(root, 'b.txt'), 'x')
      const final = verifyTree(t.initial, t.expected, { 'a.txt': Buffer.from('y'), 'b.txt': Buffer.from('x') })
      const engine = createRequire(import.meta.url).resolve('@hy-sde-org/dsh-hashline')
      const protocol = { protocolHash: 'fixture', kind: 'probe', tasks: [t], samples: { repetitions: 1, seed: 1 }, comparison: ['stock-edit', 'hashline-default'], dependencies: { packages: { '@hy-sde-org/dsh-hashline': { entry: engine, entryHash: sha256(readFileSync(engine)) } } } }
      const analysis = analyzeEvidence(t, { ...evidence, batches: [], stimuli: [] }, 'hashline-default', final, protocol, true)
      analysis.trace.costs.wallMs = 0
      const run = { taskId: 'task', repeat: 0, arm: 'hashline-default', graphVersion: 1, status: 'FAIL', sessionId: rootId, initialHash: protocolHash(t.initial), final, finalCorrect: false, ...analysis }
      const report = { protocolHash: 'fixture', kind: 'probe', runs: [run, { taskId: 'task', repeat: 0, arm: 'stock-edit', status: 'BLOCKED', finalCorrect: 'unknown', targetEvaluation: unavailableTargets(t) }] }
      expect(checkRunReport(protocol, report, directory)).toEqual([])
      run.targetEvaluation.rates.knownApplicable = 1
      expect(checkRunReport(protocol, report, directory).join()).toContain('recomputation mismatch')
      run.targetEvaluation.rates.knownApplicable = 2
      evidence.graph.sources[1].artifact += '-withheld'
      writeFileSync(join(directory, rootId + '.graph.json'), JSON.stringify(evidence.graph))
      expect(checkRunReport(protocol, report, directory).join()).toContain('missing/unreadable')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})

describe('frozen external mutation controller', () => {
  const spec = () => ({ initial: { 'a.txt': 'x' }, stimuli: [{ id: 'race', path: 'a.txt', afterRead: 2, before: 'x', after: 'external' }] })
  it('applies once at the declared successful read count and retains independent bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-stimulus-')), root = join(dir, 'workspace')
    try {
      const t = spec(); mkdirSync(root)
      writeFileSync(join(root, 'a.txt'), 'x')
      const controller = createStimulusController(t, root, join(dir, 'evidence'))
      controller.read('a.txt', { sessionId: 'root', callId: 'r1' })
      expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('x')
      controller.read('a.txt', { sessionId: 'root', callId: 'r2' })
      controller.read('a.txt', { sessionId: 'root', callId: 'r3' })
      expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('external')
      expect(controller.records).toHaveLength(1)
      expect(readFileSync(join(dir, 'evidence/race.before'), 'utf8')).toBe('x')
      expect(stimulusSummary(t, controller.records).status).toBe('PASS')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('does not overwrite a mismatched precondition or claim a missing trigger was exercised', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-stimulus-guard-'))
    try {
      const t = spec(); t.stimuli[0]!.afterRead = 1
      writeFileSync(join(dir, 'a.txt'), 'user-content')
      const controller = createStimulusController(t, dir, join(dir, 'evidence'))
      expect(stimulusSummary(t, controller.records).status).toBe('GAP')
      controller.read('a.txt', { sessionId: 'root', callId: 'r1' })
      expect(controller.records[0].status).toBe('condition-mismatch')
      expect(stimulusSummary(t, controller.records).status).toBe('GAP')
      expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('user-content')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('rejects a claimed stimulus trigger that is not an observed successful read', () => {
    const { sources, graph } = fixture(), t = { ...task(), batchBoundary: 'task-end', stimuli: [{ id: 'race', path: 'a.txt', afterRead: 1, before: 'x', after: 'external' }] }
    const engine = createRequire(import.meta.url).resolve('@hy-sde-org/dsh-hashline')
    const protocol = { dependencies: { packages: { '@hy-sde-org/dsh-hashline': { entry: engine, entryHash: sha256(readFileSync(engine)) } } } }
    const record = { id: 'race', path: 'a.txt', status: 'applied', beforeHash: sha256(Buffer.from('x')), afterHash: sha256(Buffer.from('external')), trigger: { sessionId: 'child', callId: 'edit', readNumber: 1 } }
    expect(stimulusSummary(t, [record]).status).toBe('PASS')
    expect(analyzeEvidence(t, { sources, graph, batches: [], stimuli: [record] }, 'hashline-default', { files: [] }, protocol, true).stimuli.status).toBe('GAP')
  })
})
