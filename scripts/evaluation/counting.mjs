/**
 * Evaluation counting: the denominators, batches and cost fields SRS §7.2 fixes.
 *
 * These are the rules a report must obey, implemented once so a report cannot
 * quietly change a denominator or fold a repair into a first attempt. It imports
 * only Node builtins.
 * @module dsh-tool-hashline/scripts/evaluation/counting
 */

/** The four mutually exclusive classes of every target (SRS §7.2). */
export const TARGET_CLASSES = ['known-applicable', 'declared-exception', 'no-change-needed', 'applicability-unknown']

/** The ways a first edit attempt can go (SRS §7.2). */
export const FIRST_ATTEMPT_MODES = ['hashline', 'non-hashline', 'mixed', 'not-attempted', 'unknown']

/** The outcome buckets a report must keep separate. */
export const OUTCOMES = ['first-correct', 'eventually-correct', 'tool-accepted', 'changed-on-disk']

/** The cost fields a report must carry (SRS §7.2). */
export const COST_FIELDS = ['inputTokens', 'outputTokens', 'wallMs', 'modelRequests', 'runCodeCalls', 'innerToolCalls', 'reads', 'verifications']

/** A report that violates a counting rule. */
export class CountingError extends Error {
  /**
   * @param {string} code stable category
   * @param {string} message the violated rule
   */
  constructor(code, message) {
    super('[' + code + '] ' + message)
    this.name = 'CountingError'
    this.code = code
  }
}

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const isCount = value => Number.isInteger(value) && value >= 0

/**
 * Compute the adoption rate over the KNOWN-APPLICABLE denominator.
 *
 * Every other class is reported separately and never removed from the numerator's
 * bookkeeping: a non-Hashline first attempt stays visible, and an unknown
 * applicability is counted, not silently dropped.
 * @param {object[]} targets one entry per "file + modification goal"
 * @returns {object} the rates and the raw classes
 */
export function adoption(targets) {
  if (!Array.isArray(targets)) throw new CountingError('EVAL_COUNTING_SHAPE', 'targets must be an array')
  const byClass = Object.fromEntries(TARGET_CLASSES.map(name => [name, 0]))
  const byMode = Object.fromEntries(FIRST_ATTEMPT_MODES.map(name => [name, 0]))
  for (const target of targets) {
    if (!isObject(target)) throw new CountingError('EVAL_COUNTING_SHAPE', 'every target must be an object')
    if (!TARGET_CLASSES.includes(target.class)) {
      throw new CountingError('EVAL_COUNTING_CLASS', 'target "' + String(target.id) + '" has class "' + String(target.class) + '"; allowed: ' + TARGET_CLASSES.join(', '))
    }
    if (!FIRST_ATTEMPT_MODES.includes(target.firstAttempt)) {
      throw new CountingError('EVAL_COUNTING_MODE', 'target "' + String(target.id) + '" has firstAttempt "' + String(target.firstAttempt) + '"; allowed: ' + FIRST_ATTEMPT_MODES.join(', '))
    }
    byClass[target.class] += 1
    byMode[target.firstAttempt] += 1
  }
  const applicable = byClass['known-applicable']
  const hashlineFirst = targets.filter(target => target.class === 'known-applicable' && target.firstAttempt === 'hashline').length
  return {
    targets: targets.length,
    byClass,
    byMode,
    knownApplicable: applicable,
    hashlineFirst,
    // A zero denominator is reported as "not applicable", never as 100% or 0%.
    adoptionRate: applicable === 0 ? null : hashlineFirst / applicable,
    adoptionRateNote: applicable === 0 ? 'no known-applicable target; the rate is not applicable' : 'first-attempt Hashline over known-applicable targets',
  }
}

/**
 * Validate one first-candidate batch.
 *
 * A batch is the PRE-DECLARED group of tool calls that counts as one first
 * attempt. A repair after a failure is a RETRY and must be recorded as such; this
 * check refuses a batch whose retry flag contradicts its own attempt number.
 * @param {object} batch one attempt
 * @returns {void}
 * @throws {CountingError} when the batch is malformed or mislabeled
 */
export function validateBatch(batch) {
  if (!isObject(batch)) throw new CountingError('EVAL_COUNTING_SHAPE', 'a batch must be an object')
  if (typeof batch.targetId !== 'string' || batch.targetId.trim() === '') throw new CountingError('EVAL_COUNTING_SHAPE', 'a batch must name its targetId')
  if (!isCount(batch.attempt)) throw new CountingError('EVAL_COUNTING_SHAPE', 'batch attempt must be a non-negative integer')
  if (!Array.isArray(batch.calls) || batch.calls.length === 0) throw new CountingError('EVAL_COUNTING_SHAPE', 'batch "' + batch.targetId + '" must record at least one call')
  if (batch.attempt === 0 && batch.retryOf !== undefined) {
    throw new CountingError('EVAL_COUNTING_RETRY', 'a first attempt (attempt 0) cannot claim to be a retry')
  }
  if (batch.attempt > 0 && typeof batch.retryOf !== 'string') {
    throw new CountingError('EVAL_COUNTING_RETRY', 'attempt ' + batch.attempt + ' of "' + batch.targetId + '" must name the attempt it retries')
  }
  if (batch.attempt > 0 && batch.outcome === 'first-correct') throw new CountingError('EVAL_COUNTING_RETRY', 'a retry cannot be first-correct')
  if (!OUTCOMES.includes(batch.outcome)) {
    throw new CountingError('EVAL_COUNTING_OUTCOME', 'batch outcome "' + String(batch.outcome) + '" is not one of ' + OUTCOMES.join(', '))
  }
}

/**
 * Validate a cost record.
 *
 * An unmeasured field must be the string "unknown": inventing a zero would make a
 * cost look better than it is, and SRS §7.2 forbids that.
 * @param {object} cost the measured cost
 * @returns {void}
 * @throws {CountingError} when a field is missing or a fake zero
 */
export function validateCost(cost) {
  if (!isObject(cost)) throw new CountingError('EVAL_COUNTING_SHAPE', 'a cost record must be an object')
  for (const field of COST_FIELDS) {
    const value = cost[field]
    if (value === undefined) throw new CountingError('EVAL_COUNTING_COST', 'cost field ' + field + ' is missing; use "unknown" when it cannot be measured')
    if (value !== 'unknown' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new CountingError('EVAL_COUNTING_COST', 'cost field ' + field + ' must be finite and non-negative or "unknown"')
  }
}

/**
 * Build the report skeleton every run must fill, with its denominators fixed.
 * @param {object[]} targets the run's targets
 * @returns {object} the report skeleton
 */
export function reportSkeleton(targets) {
  const rates = adoption(targets)
  return {
    rates,
    // Kept as separate series so "the first edit was Hashline" never stands in for
    // "the whole task was Hashline".
    series: {
      hashline: targets.filter(target => target.mode === 'hashline').length,
      nonHashline: targets.filter(target => target.mode === 'non-hashline').length,
      mixed: targets.filter(target => target.mode === 'mixed').length,
      notAttempted: targets.filter(target => target.mode === 'not-attempted').length,
      unknown: targets.filter(target => target.mode === 'unknown').length,
    },
    batches: [],
    costs: Object.fromEntries(COST_FIELDS.map(field => [field, 'unknown'])),
  }
}

/** Task-level outcome counts; per-file adoption needs a separate target annotation. */
export function summarizeRuns(runs, arms) {
  return Object.fromEntries(arms.map(arm => {
    const group = runs.filter(run => run.arm === arm)
    const sum = field => group.length && group.every(r => Number.isFinite(r.trace?.costs?.[field])) ? group.reduce((n, r) => n + r.trace.costs[field], 0) : 'unknown'
    return [arm, {
      scheduled: group.length,
      statuses: Object.fromEntries(['PASS', 'FAIL', 'GAP', 'BLOCKED', 'CANCELLED'].map(s => [s, group.filter(r => r.status === s).length])),
      finalCorrect: group.filter(r => r.finalCorrect === true).length,
      finalUnknown: group.filter(r => r.finalCorrect === 'unknown').length,
      observedEditFailures: group.reduce((n, r) => n + (r.trace?.failures ?? 0), 0),
      observedRefusals: group.reduce((n, r) => n + (r.trace?.calls?.filter(c => c.name === 'edit' && c.execution === 'refused').length ?? 0), 0),
      observedToolAccepted: group.reduce((n, r) => n + (r.trace?.calls?.filter(c => c.name === 'edit' && c.isError === false).length ?? 0), 0),
      changedOnDisk: group.filter(r => r.final?.changed === true).length,
      observedRecoveries: group.filter(r => r.trace?.recovered).length,
      partialTasks: group.filter(r => r.partialTask).length,
      firstCandidateCorrect: group.every(r => typeof r.trace?.firstCandidateCorrect === 'boolean') ? group.filter(r => r.trace.firstCandidateCorrect).length : 'unknown',
      candidateRetries: group.every(r => Number.isSafeInteger(r.trace?.retries)) ? group.reduce((n, r) => n + r.trace.retries, 0) : 'unknown',
      perTargetAdoption: 'unknown',
      costs: Object.fromEntries(COST_FIELDS.map(f => [f, sum(f)])),
    }]
  }))
}
