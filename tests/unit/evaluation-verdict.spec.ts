import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
// @ts-expect-error plain ESM module
import { CONDITION_SEMANTICS, COHORT_CONDITION_SEMANTICS, summarizeCoverage, evaluateConditions } from '../../scripts/evaluation/verdict.mjs'
// @ts-expect-error plain ESM module
import { freezeProtocol, protocolGaps, protocolHash } from '../../scripts/evaluation/protocol.mjs'
// @ts-expect-error plain ESM module
import { writeSessionEvidence } from '../../scripts/evaluation/session-tree.mjs'
// @ts-expect-error plain ESM module
import { analyzeEvidence } from '../../scripts/evaluation/analysis.mjs'
// @ts-expect-error plain ESM module
import { verifyTree } from '../../scripts/evaluation/evidence.mjs'
// @ts-expect-error plain ESM module
import { checkRunReport } from '../../scripts/evaluation/report.mjs'
// @ts-expect-error plain ESM module
import { requestAccounting } from '../../scripts/evaluation/accounting.mjs'
// @ts-expect-error plain ESM module
import { summarizeRuns } from '../../scripts/evaluation/counting.mjs'

const arms = ['stock-edit', 'hashline-default']
const rules = () => ({ tasks: [{ id: 'a' }], samples: { repetitions: 3 }, comparison: arms, passConditions: { semantics: CONDITION_SEMANTICS, minFirstCandidateCorrect: 1, maxTotalTokensPerTask: 4 } })
const samples = (first: Array<boolean | string> = [true, false, 'unknown'], tokens: Array<number | string> = [4, 2, 'unknown']) => arms.flatMap(arm => first.map((value, repeat) => ({ taskId: 'a', repeat, arm, status: value === 'unknown' ? 'BLOCKED' : 'PASS', finalCorrect: value === 'unknown' ? 'unknown' : true, trace: { firstCandidateCorrect: value, retries: repeat === 0 ? 1 : 'unknown', costs: { totalTokens: tokens[repeat] } }, targetEvaluation: { status: 'GAP', targets: [{ id: 'goal', class: 'known-applicable', firstAttempt: value === 'unknown' ? 'unknown' : 'hashline' }] } })))

describe('coverage and frozen absolute conditions', () => {
  it('retains known facts, all scheduled denominators and bounds without pretending a partial sum is complete', () => {
    const result = summarizeCoverage(samples(), arms).arms['stock-edit']
    expect(result.firstCandidateCorrect).toEqual({ correct: 1, incorrect: 1, measured: 2, unknown: 1, denominator: 3, rateOnMeasured: 0.5, rateBounds: { lower: 1 / 3, upper: 2 / 3 } })
    expect(result.costs.totalTokens).toEqual({ knownSum: 6, measured: 2, unknown: 1, denominator: 3 })
    expect(result.costs.verifications).toEqual({ knownSum: 0, measured: 0, unknown: 3, denominator: 3 })
    expect(result.candidateRetries).toEqual({ knownSum: 1, measured: 1, unknown: 2, denominator: 3 })
    expect(result.targetAdoption.observed.knownApplicable).toBe(3)
    expect(result.targetAdoption.observed.byMode.unknown).toBe(1)
  })
  it('keeps available target facts when another sample has no annotations', () => {
    const runs = samples(); runs[0]!.targetEvaluation = { status: 'not-declared', targets: [] }
    const result = summarizeCoverage(runs, arms).arms['stock-edit'].targetAdoption
    expect(result).toMatchObject({ scheduledSamples: 3, declaredSamples: 2, unknownSamples: 1 })
    expect(result.observed.targets).toBe(2)
    expect(summarizeCoverage([], arms).arms['stock-edit'].firstCandidateCorrect.rateBounds.lower).toBeNull()
  })
  it('passes exact boundaries using a per-run token maximum rather than an arm total', () => {
    const result = evaluateConditions(rules(), samples([true, false, false], [4, 4, 4]))
    expect(result.status).toBe('PASS')
    expect(result.arms['stock-edit'].totalTokens.knownSum).toBe(12)
    expect(result.arms['stock-edit'].totalTokens.maxAllowed).toBe(4)
  })
  it('does not pass on the measured subset even if the known correct count already meets the minimum', () => {
    const result = evaluateConditions(rules(), samples())
    expect(result.status).toBe('GAP')
    expect(result.arms['stock-edit'].firstCandidateCorrect.status).toBe('GAP')
  })
  it('fails an impossible first-correct threshold despite other unknown outcomes', () => {
    const p = rules(); p.passConditions.minFirstCandidateCorrect = 2
    expect(evaluateConditions(p, samples([false, false, 'unknown'], [4, 4, 4])).status).toBe('FAIL')
  })
  it('does not let unknown tokens hide a known violation', () => {
    const result = evaluateConditions(rules(), samples([true, true, true], [5, 'unknown', 0]))
    expect(result.status).toBe('FAIL')
    expect(result.arms['stock-edit'].totalTokens.violations).toEqual([{ taskId: 'a', repeat: 0, totalTokens: 5 }])
  })
  it('requires every arm to meet its own first-correct minimum', () => {
    const runs = samples([true, false, false], [1, 1, 1]); runs[0]!.trace.firstCandidateCorrect = false
    const result = evaluateConditions(rules(), runs)
    expect(result.arms['stock-edit'].status).toBe('FAIL')
    expect(result.arms['hashline-default'].status).toBe('PASS')
    expect(result.status).toBe('FAIL')
  })
  it.each(['missing', 'duplicate', 'foreign'])('rejects %s schedule evidence rather than shrinking the denominator', kind => {
    const runs = samples([true, true, true], [1, 1, 1])
    if (kind === 'missing') runs.pop()
    if (kind === 'duplicate') runs[1]!.repeat = 0
    if (kind === 'foreign') runs[0]!.arm = 'foreign'
    expect(evaluateConditions(rules(), runs)).toMatchObject({ status: 'GAP', reason: 'schedule-mismatch' })
  })
  it('leaves legacy semantics unjudged and does not invent zero-denominator rates', () => {
    expect(evaluateConditions({ passConditions: {} }, [])).toMatchObject({ status: 'GAP', reason: 'semantics-not-frozen' })
    expect(evaluateConditions({ passConditions: { semantics: 'future' } }, [])).toMatchObject({ status: 'GAP', reason: 'unsupported-semantics' })
    expect(summarizeCoverage([], arms).arms['stock-edit'].finalCorrect.rateOnMeasured).toBeNull()
  })
})

function independentReport(directory: string) {
  const { provider, ...template } = JSON.parse(readFileSync(new URL('../../scripts/evaluation/experiment.example.json', import.meta.url), 'utf8'))
  // This historical fixture contains no request payloads; keep its original contract.
  delete template.requestEvidence
  delete template.editPayloadVersion
  const t = { id: 'a', family: 'single-point', class: 'known-applicable', batchBoundary: 'first-edit-program', initial: { 'a.txt': 'x' }, expected: { 'a.txt': 'y' }, prompt: 'change x to y' }
  const body = { ...template, createdAt: '2026-10-26', tasks: [t], comparison: arms, samples: { repetitions: 1, seed: 2 }, model: { provider: 'fixture', model: 'fixture', parameters: {} }, budget: { maxModelRequests: 10, maxTotalTokens: 100, timeoutMs: 1000 }, passConditions: { semantics: CONDITION_SEMANTICS, minFirstCandidateCorrect: 1, maxTotalTokensPerTask: 2 }, tools: { arms: Object.fromEntries(arms.map(a => [a, 'fixture'])), presetHash: 'fixture', providerPlugin: provider.plugin, providerConfig: {}, credentialEnv: provider.credentialEnv }, dependencies: { packages: {}, patches: {}, resources: {}, inputs: {}, profileInputs: {}, driverInputs: {}, environment: {}, readEngine: 'fixture', editEngine: 'fixture' } }
  const p = freezeProtocol(body)
  const runs = arms.map((arm, index) => {
    const id = 'eval-' + index, root = join(directory, id)
    mkdirSync(root); writeFileSync(join(root, 'a.txt'), 'y')
    const events = [
      { type: 'turn/start', data: {} },
      { type: 'tool/call', data: { name: 'run_code', callId: 'program', arguments: '{}' } },
      { type: 'tool/ptc-dispatch-start', data: { name: 'edit', subCallId: 'edit', rootCallId: 'program', arguments: arm === 'stock-edit' ? { file_path: 'a.txt', old_string: 'x', new_string: 'y' } : { input: '[a.txt#ABCD]\nPUT 1:\n+y' } } },
      { type: 'tool/ptc-dispatch', data: { name: 'edit', subCallId: 'edit', rootCallId: 'program', isError: false } },
      { type: 'tool/result', data: { message: { toolCallId: 'program', isError: false } } },
      { type: 'assistant/message', data: { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } },
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ].map((e, seq) => ({ ...e, seq }))
    const source = { id, parentId: null, createdAt: 1, cwd: root, inherited: 0, events, receipts: arm === 'stock-edit' ? [] : [{ callId: 'edit', mode: 'hashline', result: 'completed' }] }
    const final = verifyTree(t.initial, t.expected, { 'a.txt': Buffer.from('y') })
    const batches = [{ callId: 'program', sessionId: id, attempt: 0, final }]
    mkdirSync(join(directory, id + '.checkpoint-0')); writeFileSync(join(directory, id + '.checkpoint-0/a.txt'), 'y')
    const evidence = writeSessionEvidence(directory, { sessions: new Map([[id, source]]), order: events.map(e => ({ sessionId: id, seq: e.seq })) }, id, batches)
    writeFileSync(join(directory, id + '.initial.json'), JSON.stringify(verifyTree({}, t.initial, { 'a.txt': Buffer.from('x') })))
    writeFileSync(join(directory, id + '.stimuli.json'), '[]')
    const analysis = analyzeEvidence(t, { ...evidence, batches, stimuli: [] }, arm, final, p, true)
    analysis.trace.costs.wallMs = 1
    return { taskId: 'a', repeat: 0, arm, status: 'PASS', graphVersion: 1, sessionId: id, initialHash: protocolHash(t.initial), final, finalCorrect: true, ...analysis }
  })
  const report = { evaluationVersion: 1, protocolHash: p.protocolHash, kind: p.kind, status: 'PASS', runs, requests: runs.map(r => ({ sessionId: r.sessionId })), requestRefusals: [], budget: { requests: 2 }, summary: summarizeRuns(runs, arms), coverage: summarizeCoverage(runs, arms), conditions: evaluateConditions(p, runs), accounting: {} }
  report.accounting = requestAccounting(report)
  return { p, body, report }
}

describe('condition protocol, independent checker and CLI', () => {
  it('checks v1 units and refuses unknown semantics while leaving legacy protocols valid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-condition-schema-'))
    try {
      const { body } = independentReport(dir)
      expect(protocolGaps(body)).toEqual([])
      expect(protocolGaps({ ...body, passConditions: { ...body.passConditions, semantics: 'future' } }).join()).toContain('unsupported')
      expect(protocolGaps({ ...body, passConditions: { ...body.passConditions, minFirstCandidateCorrect: 0.5 } }).join()).toContain('integer')
      expect(protocolGaps({ ...body, passConditions: { minFirstCandidateCorrect: 0.5, maxTotalTokensPerTask: 2 } })).toEqual([])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('distinguishes evidence acceptance from condition PASS, FAIL and legacy GAP in the real CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-condition-cli-')), driver = fileURLToPath(new URL('../../scripts/evaluation/driver.mjs', import.meta.url))
    try {
      const { body, report } = independentReport(dir)
      for (const [name, conditions, status, exit] of [
        ['pass', body.passConditions, 'PASS', 0],
        ['fail', { ...body.passConditions, maxTotalTokensPerTask: 0 }, 'FAIL', 2],
        ['legacy', { minFirstCandidateCorrect: 1, maxTotalTokensPerTask: 2 }, 'GAP', 2],
      ] as const) {
        const p = freezeProtocol({ ...body, passConditions: conditions }), r = { ...report, protocolHash: p.protocolHash, conditions: evaluateConditions(p, report.runs) }
        writeFileSync(join(dir, name + '.protocol.json'), JSON.stringify(p)); writeFileSync(join(dir, name + '.report.json'), JSON.stringify(r))
        const check = spawnSync(process.execPath, [driver, 'check', join(dir, name + '.protocol.json'), join(dir, name + '.report.json')], { encoding: 'utf8' })
        expect(check.status, check.stderr).toBe(0)
        const judged = spawnSync(process.execPath, [driver, 'judge', join(dir, name + '.protocol.json'), join(dir, name + '.report.json')], { encoding: 'utf8' })
        expect(judged.status, judged.stderr).toBe(exit)
        expect(JSON.parse(judged.stdout).status).toBe(status)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it.each(['v1', 'v2-excluded'])('does not let %s condition PASS override an independently wrong final file', version => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-condition-final-failure-')), driver = fileURLToPath(new URL('../../scripts/evaluation/driver.mjs', import.meta.url))
    try {
      const { p: original, body, report } = independentReport(dir)
      const p = version === 'v1' ? original : freezeProtocol({ ...body, passConditions: { ...body.passConditions, semantics: COHORT_CONDITION_SEMANTICS, minFirstCandidateCorrect: 0, firstCandidateScope: { include: [], exclude: [{ taskId: 'a', reason: 'Not measured in this probe.' }] } } })
      report.protocolHash = p.protocolHash; report.conditions = evaluateConditions(p, report.runs)
      const run = report.runs[0]!, task = p.tasks[0]
      writeFileSync(join(dir, run.sessionId, 'a.txt'), 'x')
      run.final = verifyTree(task.initial, task.expected, { 'a.txt': Buffer.from('x') }); run.finalCorrect = false; run.status = 'FAIL'; report.status = 'FAIL'
      report.summary = summarizeRuns(report.runs, arms); report.coverage = summarizeCoverage(report.runs, arms)
      expect(report.conditions.status).toBe('PASS')
      expect(checkRunReport(p, report, dir)).toEqual([])
      writeFileSync(join(dir, 'p.json'), JSON.stringify(p)); writeFileSync(join(dir, 'r.json'), JSON.stringify(report))
      const result = spawnSync(process.execPath, [driver, 'judge', join(dir, 'p.json'), join(dir, 'r.json')], { encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(2)
      expect(JSON.parse(result.stdout)).toMatchObject({ status: 'FAIL', conditions: { status: 'PASS' } })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('recomputes the v2 cohort instead of trusting stored scope annotations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-condition-cohort-forgery-'))
    try {
      const { body, report } = independentReport(dir)
      const p = freezeProtocol({ ...body, passConditions: { ...body.passConditions, semantics: COHORT_CONDITION_SEMANTICS, firstCandidateScope: { include: ['a'], exclude: [] } } })
      report.protocolHash = p.protocolHash; report.conditions = evaluateConditions(p, report.runs)
      expect(checkRunReport(p, report, dir)).toEqual([])
      report.conditions.arms['stock-edit'].firstCandidateCorrect.cohort.include = []
      expect(checkRunReport(p, report, dir).join()).toContain('conditions recomputation mismatch')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it.each(['coverage', 'conditions', 'missing-fields', 'status', 'version', 'raw-first', 'unexecuted-trace'])('rejects forged %s even when a report claims PASS', field => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-condition-forgery-'))
    try {
      const { p, report } = independentReport(dir)
      expect(checkRunReport(p, report, dir)).toEqual([])
      if (field === 'coverage') report.coverage.arms['stock-edit'].firstCandidateCorrect.unknown = 1
      if (field === 'conditions') report.conditions.arms['stock-edit'].totalTokens.maxAllowed = 99
      if (field === 'missing-fields') { delete report.coverage; delete report.conditions }
      if (field === 'status') report.status = 'FAIL'
      if (field === 'version') report.evaluationVersion = 0
      if (field === 'raw-first') { report.runs[0]!.trace.firstCandidateCorrect = false; report.conditions = evaluateConditions(p, report.runs); report.coverage = summarizeCoverage(report.runs, arms) }
      if (field === 'unexecuted-trace') {
        const id = report.runs[0]!.sessionId
        Object.assign(report.runs[0]!, { sessionId: undefined, status: 'BLOCKED', finalCorrect: 'unknown' }); report.status = 'GAP'
        report.requests = report.requests.filter(r => r.sessionId !== id); report.budget.requests = 1; report.accounting = requestAccounting(report)
        report.summary = summarizeRuns(report.runs, arms); report.coverage = summarizeCoverage(report.runs, arms); report.conditions = evaluateConditions(p, report.runs)
      }
      expect(checkRunReport(p, report, dir).length).toBeGreaterThan(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
