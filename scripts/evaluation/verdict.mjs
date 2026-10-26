/** Frozen absolute conditions, with unknowns retained in the scheduled denominator. */
import { COST_FIELDS, adoption } from './counting.mjs'

export const CONDITION_SEMANTICS = 'per-arm-count-and-per-run-tokens-v1'
export const COHORT_CONDITION_SEMANTICS = 'per-arm-cohort-count-and-per-run-tokens-v2'
export const SUPPORTED_CONDITION_SEMANTICS = [CONDITION_SEMANTICS, COHORT_CONDITION_SEMANTICS]
const numeric = n => typeof n === 'number' && Number.isFinite(n) && n >= 0
const combine = statuses => statuses.includes('FAIL') ? 'FAIL' : statuses.includes('GAP') ? 'GAP' : 'PASS'

/** Validate an authored metric cohort, not inferred model intent or tool choice. */
export function firstCandidateScopeGaps(protocol) {
  const conditions = protocol.passConditions, scope = conditions?.firstCandidateScope
  if (conditions?.semantics !== COHORT_CONDITION_SEMANTICS) return scope === undefined ? [] : ['firstCandidateScope requires v2 semantics']
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) || !Array.isArray(scope.include) || !Array.isArray(scope.exclude)) return ['v2 firstCandidateScope requires include/exclude arrays']
  const gaps = []
  if (Object.keys(scope).some(k => !['include', 'exclude'].includes(k))) gaps.push('unsupported firstCandidateScope field')
  const taskIds = new Set((Array.isArray(protocol.tasks) ? protocol.tasks : []).map(t => t?.id).filter(id => typeof id === 'string'))
  for (const id of scope.include) if (typeof id !== 'string' || !taskIds.has(id)) gaps.push('unknown included task')
  for (const entry of scope.exclude) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(k => !['taskId', 'reason'].includes(k))) { gaps.push('exclusion must contain taskId/reason'); continue }
    if (!taskIds.has(entry.taskId)) gaps.push('unknown excluded task')
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) gaps.push('exclusion reason is required')
  }
  const listed = [...scope.include, ...scope.exclude.map(e => e?.taskId)]
  if (new Set(listed).size !== listed.length) gaps.push('duplicate or overlapping cohort task')
  for (const id of taskIds) if (!listed.includes(id)) gaps.push('firstCandidateScope must cover every task')
  if (!scope.include.length && conditions.minFirstCandidateCorrect !== 0) gaps.push('empty cohort requires minimum zero')
  if (protocol.kind === 'formal' && !scope.include.length) gaps.push('formal requires a nonempty first-candidate cohort')
  if (Number.isSafeInteger(protocol.samples?.repetitions) && Number.isSafeInteger(conditions.minFirstCandidateCorrect) && conditions.minFirstCandidateCorrect > scope.include.length * protocol.samples.repetitions) gaps.push('first-candidate minimum exceeds cohort samples per arm')
  return gaps
}

function correctness(values) {
  const denominator = values.length, correct = values.filter(v => v === true).length, incorrect = values.filter(v => v === false).length
  const measured = correct + incorrect, unknown = denominator - measured
  return { correct, incorrect, measured, unknown, denominator, rateOnMeasured: measured ? correct / measured : null,
    rateBounds: { lower: denominator ? correct / denominator : null, upper: denominator ? (correct + unknown) / denominator : null } }
}

function amounts(values) {
  const known = values.filter(numeric)
  return { knownSum: known.reduce((n, v) => n + v, 0), measured: known.length, unknown: values.length - known.length, denominator: values.length }
}

export function summarizeCoverage(runs, arms) {
  return { version: 1, arms: Object.fromEntries(arms.map(arm => {
    const group = runs.filter(r => r.arm === arm)
    const annotated = group.filter(r => Array.isArray(r.targetEvaluation?.targets) && r.targetEvaluation.status !== 'not-declared')
    return [arm, {
      firstCandidateCorrect: correctness(group.map(r => r.trace?.firstCandidateCorrect)),
      finalCorrect: correctness(group.map(r => r.finalCorrect)),
      candidateRetries: amounts(group.map(r => r.trace?.retries)),
      costs: Object.fromEntries([...COST_FIELDS, 'totalTokens', 'uncachedInputTokens'].map(f => [f, amounts(group.map(r => r.trace?.costs?.[f]))])),
      targetAdoption: { scheduledSamples: group.length, declaredSamples: annotated.length, unknownSamples: group.length - annotated.length, observed: adoption(annotated.flatMap(r => r.targetEvaluation.targets)) },
    }]
  })) }
}

export function evaluateConditions(protocol, runs) {
  const scoped = protocol.passConditions?.semantics === COHORT_CONDITION_SEMANTICS
  const base = { version: scoped ? 2 : 1, scope: 'frozen-absolute-conditions-only' }
  if (!SUPPORTED_CONDITION_SEMANTICS.includes(protocol.passConditions?.semantics)) return { ...base, status: 'GAP', reason: protocol.passConditions?.semantics === undefined ? 'semantics-not-frozen' : 'unsupported-semantics', arms: {} }
  const scopeGaps = firstCandidateScopeGaps(protocol)
  if (scopeGaps.length) return { ...base, status: 'GAP', reason: 'invalid-first-candidate-scope', gaps: scopeGaps, arms: {} }
  const keys = new Set(protocol.tasks.flatMap(t => Array.from({ length: protocol.samples.repetitions }, (_, repeat) => t.id + ':' + repeat)))
  if (runs.length !== keys.size * protocol.comparison.length || runs.some(r => !protocol.comparison.includes(r.arm)) || protocol.comparison.some(arm => {
    const group = runs.filter(r => r.arm === arm), actual = new Set(group.map(r => r.taskId + ':' + r.repeat))
    return group.length !== keys.size || actual.size !== keys.size || [...actual].some(key => !keys.has(key))
  })) return { ...base, status: 'GAP', reason: 'schedule-mismatch', arms: {} }
  const coverage = summarizeCoverage(runs, protocol.comparison), arms = {}
  for (const arm of protocol.comparison) {
    const group = runs.filter(r => r.arm === arm), measured = coverage.arms[arm]
    const scope = protocol.passConditions.firstCandidateScope
    const eligible = scoped ? group.filter(r => scope.include.includes(r.taskId)) : group
    const count = scoped ? correctness(eligible.map(r => r.trace?.firstCandidateCorrect)) : measured.firstCandidateCorrect, minRequired = protocol.passConditions.minFirstCandidateCorrect
    const firstStatus = scoped && !eligible.length ? 'NOT_APPLICABLE' : count.correct + count.unknown < minRequired ? 'FAIL' : count.unknown ? 'GAP' : count.correct >= minRequired ? 'PASS' : 'FAIL'
    const maxAllowed = protocol.passConditions.maxTotalTokensPerTask
    const violations = group.filter(r => numeric(r.trace?.costs?.totalTokens) && r.trace.costs.totalTokens > maxAllowed).map(r => ({ taskId: r.taskId, repeat: r.repeat, totalTokens: r.trace.costs.totalTokens }))
    const tokenStatus = violations.length ? 'FAIL' : measured.costs.totalTokens.unknown ? 'GAP' : 'PASS'
    arms[arm] = {
      status: combine([firstStatus, tokenStatus]),
      firstCandidateCorrect: { status: firstStatus, minRequired, ...count, ...(scoped ? { cohort: { include: scope.include, exclude: scope.exclude, excludedSamples: group.length - eligible.length } } : {}) },
      totalTokens: { status: tokenStatus, maxAllowed, ...measured.costs.totalTokens, violations },
    }
  }
  return { ...base, status: combine(Object.values(arms).map(a => a.status)), arms }
}
