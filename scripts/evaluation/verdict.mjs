/** Frozen absolute conditions, with unknowns retained in the scheduled denominator. */
import { COST_FIELDS, adoption } from './counting.mjs'

export const CONDITION_SEMANTICS = 'per-arm-count-and-per-run-tokens-v1'
const numeric = n => typeof n === 'number' && Number.isFinite(n) && n >= 0
const combine = statuses => statuses.includes('FAIL') ? 'FAIL' : statuses.includes('GAP') ? 'GAP' : 'PASS'

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
  const base = { version: 1, scope: 'frozen-absolute-conditions-only' }
  if (protocol.passConditions?.semantics !== CONDITION_SEMANTICS) return { ...base, status: 'GAP', reason: protocol.passConditions?.semantics === undefined ? 'semantics-not-frozen' : 'unsupported-semantics', arms: {} }
  const keys = new Set(protocol.tasks.flatMap(t => Array.from({ length: protocol.samples.repetitions }, (_, repeat) => t.id + ':' + repeat)))
  if (runs.length !== keys.size * protocol.comparison.length || runs.some(r => !protocol.comparison.includes(r.arm)) || protocol.comparison.some(arm => {
    const group = runs.filter(r => r.arm === arm), actual = new Set(group.map(r => r.taskId + ':' + r.repeat))
    return group.length !== keys.size || actual.size !== keys.size || [...actual].some(key => !keys.has(key))
  })) return { ...base, status: 'GAP', reason: 'schedule-mismatch', arms: {} }
  const coverage = summarizeCoverage(runs, protocol.comparison), arms = {}
  for (const arm of protocol.comparison) {
    const group = runs.filter(r => r.arm === arm), measured = coverage.arms[arm]
    const count = measured.firstCandidateCorrect, minRequired = protocol.passConditions.minFirstCandidateCorrect
    const firstStatus = count.correct + count.unknown < minRequired ? 'FAIL' : count.unknown ? 'GAP' : count.correct >= minRequired ? 'PASS' : 'FAIL'
    const maxAllowed = protocol.passConditions.maxTotalTokensPerTask
    const violations = group.filter(r => numeric(r.trace?.costs?.totalTokens) && r.trace.costs.totalTokens > maxAllowed).map(r => ({ taskId: r.taskId, repeat: r.repeat, totalTokens: r.trace.costs.totalTokens }))
    const tokenStatus = violations.length ? 'FAIL' : measured.costs.totalTokens.unknown ? 'GAP' : 'PASS'
    arms[arm] = {
      status: combine([firstStatus, tokenStatus]),
      firstCandidateCorrect: { status: firstStatus, minRequired, ...count },
      totalTokens: { status: tokenStatus, maxAllowed, ...measured.costs.totalTokens, violations },
    }
  }
  return { ...base, status: combine(Object.values(arms).map(a => a.status)), arms }
}
