/**
 * Evaluation protocol: the frozen conditions one real-model comparison runs under.
 *
 * SRS §7.1 requires the protocol to be published and FROZEN before any run, and
 * forbids inventing the missing values (model, repetitions, budget, thresholds)
 * after seeing results. This module is the enforcement point: a protocol with a
 * missing required field cannot be frozen, and a run cannot start without a
 * frozen protocol whose hash still matches its own content.
 *
 * It imports only Node builtins: the driver must run from a plain checkout.
 * @module dsh-tool-hashline/scripts/evaluation/protocol
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { taskEvaluationGaps, safeTaskPath } from './stimuli.mjs'
import { CONDITION_SEMANTICS } from './verdict.mjs'

/** Fields a protocol MUST declare before a run may start (SRS §7.1). */
export const REQUIRED_FIELDS = [
  'id',
  'kind',
  'tools',
  'createdAt',
  'comparison',
  'model',
  'dependencies',
  'samples',
  'order',
  'budget',
  'passConditions',
  'tasks',
]

/** Task families the SRS requires the comparison to cover (§7.3). */
export const REQUIRED_TASK_FAMILIES = [
  'single-point',
  'repeated-fragment',
  'multi-site',
  'consecutive-edits',
  'external-change',
  'unrelated-long-line',
  'target-long-line',
  'restricted-degradation',
  'large-rewrite',
  'already-satisfied',
  'creation',
  'user-override',
  'special-tool',
]

/** A protocol that cannot be frozen, or a frozen one that drifted. */
export class ProtocolError extends Error {
  /**
   * @param {string} code stable category
   * @param {string} message what is missing or changed
   */
  constructor(code, message) {
    super('[' + code + '] ' + message)
    this.name = 'ProtocolError'
    this.code = code
  }
}

/** The stable digest of a protocol body (the freeze identity). */
export const protocolHash = protocol => createHash('sha256').update(canonicalJson(protocol), 'utf8').digest('hex')

/**
 * Canonical JSON: keys sorted, no whitespace.
 *
 * The hash must not depend on key order or formatting, or two people freezing the
 * same conditions would get different identities.
 * @param {unknown} value any lossless JSON value
 * @returns {string} the canonical encoding
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const keys = Object.keys(value).filter(key => !['undefined', 'function', 'symbol'].includes(typeof value[key])).sort()
  return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
}

/** Whether a value is a plain object. */
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Every reason this protocol may not be frozen.
 *
 * An empty list is the only state in which a run may start. The checks are about
 * COMPLETENESS and internal consistency, never about the values being "good":
 * choosing them is the maintainer's job.
 * @param {object} protocol the authored protocol
 * @returns {string[]} human-readable gaps
 */
export function protocolGaps(protocol) {
  const gaps = []
  if (!isObject(protocol)) return ['the protocol must be an object']
  if (!['probe', 'formal'].includes(protocol.kind)) gaps.push('kind must be probe or formal')
  if (protocol.kind === 'probe' && (!Array.isArray(protocol.limits) || protocol.limits.length === 0 || protocol.limits.some(x => typeof x !== 'string' || !x.trim()))) gaps.push('probe requires non-empty limits; no promotion claim')
  for (const field of ['model', 'samples', 'budget', 'passConditions', 'dependencies', 'tools']) {
    if (!isObject(protocol[field])) gaps.push(field + ' must be an object')
  }
  if (isObject(protocol.dependencies) && !isObject(protocol.dependencies.packages)) gaps.push('dependencies must carry captured packages/patches/resources/environment identity')
  if (isObject(protocol.dependencies)) {
    for (const field of ['packages', 'patches', 'resources', 'inputs', 'profileInputs', 'driverInputs', 'environment']) {
      if (!isObject(protocol.dependencies[field])) gaps.push('dependencies.' + field + ' must be a captured object')
    }
    for (const field of ['readEngine', 'editEngine']) if (typeof protocol.dependencies[field] !== 'string' || !protocol.dependencies[field]) gaps.push('dependencies.' + field + ' must be a resolved path')
  }
  if (isObject(protocol.tools)) {
    for (const field of ['presetHash', 'providerPlugin', 'providerConfig', 'credentialEnv', 'arms']) {
      if (protocol.tools[field] === undefined) gaps.push('tools.' + field + ' is required')
    }
    if (!isObject(protocol.tools.arms) || (Array.isArray(protocol.comparison) && protocol.comparison.some(arm => !protocol.tools.arms[arm]))) gaps.push('tools.arms must freeze each comparison configuration hash')
    if (!isObject(protocol.tools.providerConfig)) gaps.push('tools.providerConfig must be an object')
    const secrets = value => Array.isArray(value) ? value.some(secrets) : isObject(value) && Object.entries(value).some(([key, v]) => ((/key|token|secret|password|authorization/iu.test(key) && !/Env$/u.test(key)) || secrets(v)))
    if (secrets(protocol.tools.providerConfig)) gaps.push('literal credentials forbidden; use credential env references')
    if (typeof protocol.tools.credentialEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(protocol.tools.credentialEnv)) gaps.push('tools.credentialEnv must name an environment variable')
  }
  for (const field of REQUIRED_FIELDS) {
    const value = protocol[field]
    if (value === undefined || value === null) gaps.push('missing required field: ' + field)
    else if (typeof value === 'string' && value.trim() === '') gaps.push('field ' + field + ' is empty')
  }
  if (isObject(protocol.model)) {
    for (const field of ['provider', 'model', 'parameters']) {
      if (protocol.model[field] === undefined) gaps.push('model.' + field + ' is required')
    }
    if (!isObject(protocol.model.parameters)) gaps.push('model.parameters must be an object')
    for (const field of ['provider', 'model']) if (typeof protocol.model[field] !== 'string' || !protocol.model[field].trim()) gaps.push('model.' + field + ' must be non-empty')
    if (protocol.model.parameters?.maxTokens !== undefined && (!Number.isSafeInteger(protocol.model.parameters.maxTokens) || protocol.model.parameters.maxTokens < 1)) gaps.push('model.parameters.maxTokens must be positive')
  }
  if (isObject(protocol.samples)) {
    for (const field of ['repetitions', 'seed']) {
      if (!Number.isInteger(protocol.samples[field]) || protocol.samples[field] < 1) gaps.push('samples.' + field + ' must be a positive integer')
    }
  }
  if (isObject(protocol.budget)) {
    for (const field of ['maxModelRequests', 'maxTotalTokens']) {
      if (!Number.isInteger(protocol.budget[field]) || protocol.budget[field] < 1) gaps.push('budget.' + field + ' must be a positive integer')
    }
  }
  if (isObject(protocol.passConditions)) {
    if (protocol.passConditions.semantics !== undefined && protocol.passConditions.semantics !== CONDITION_SEMANTICS) gaps.push('unsupported passConditions.semantics')
    for (const field of ['minFirstCandidateCorrect', 'maxTotalTokensPerTask']) {
      if (typeof protocol.passConditions[field] !== 'number' || !Number.isFinite(protocol.passConditions[field]) || protocol.passConditions[field] < 0) gaps.push('passConditions.' + field + ' must be a finite non-negative number')
      if (protocol.passConditions.semantics === CONDITION_SEMANTICS && !Number.isSafeInteger(protocol.passConditions[field])) gaps.push('v1 passConditions.' + field + ' must be an integer')
    }
  }
  if (!Array.isArray(protocol.tasks) || protocol.tasks.length === 0) {
    gaps.push('tasks must be a non-empty array')
  } else {
    const families = new Set()
    protocol.tasks.forEach((task, index) => {
      const at = 'tasks[' + index + ']'
      if (!isObject(task)) { gaps.push(at + ' must be an object'); return }
      gaps.push(...taskEvaluationGaps(task).map(gap => at + ': ' + gap))
      for (const field of ['id', 'family', 'prompt']) {
        if (typeof task[field] !== 'string' || task[field].trim() === '') gaps.push(at + '.' + field + ' must be a non-empty string')
      }
      for (const field of ['initial', 'expected']) {
        if (!isObject(task[field]) || Object.values(task[field]).some(value => typeof value !== 'string' && !(field === 'expected' && value === null))) gaps.push(at + '.' + field + ' must map relative filenames to UTF-8 strings (expected null = absent)')
        else for (const name of Object.keys(task[field])) {
          if (!safeTaskPath(name)) gaps.push(at + ': unsafe task filename ' + name)
        }
      }
      if (!['known-applicable', 'declared-exception', 'no-change-needed', 'applicability-unknown'].includes(task.class)) gaps.push(at + '.class is required')
      if (!['task-end', 'first-edit-program'].includes(task.batchBoundary)) gaps.push(at + '.batchBoundary must be task-end or first-edit-program')
      if (typeof task.family === 'string') families.add(task.family)
    })
    if (new Set(protocol.tasks.map(t => t?.id)).size !== protocol.tasks.length) gaps.push('duplicate task ids')
    for (const family of protocol.kind === 'formal' ? REQUIRED_TASK_FAMILIES : []) {
      if (!families.has(family)) gaps.push('tasks must cover the family "' + family + '" (SRS §7.3)')
    }
  }
  if (!Array.isArray(protocol.comparison) || protocol.comparison.length < 2) {
    gaps.push('comparison must name at least two arms (the current auto and the policy)')
  }
  if (Array.isArray(protocol.comparison) && (new Set(protocol.comparison).size !== protocol.comparison.length || protocol.comparison.some(arm => !['stock-edit', 'hashline-default', 'hashline-fallback'].includes(arm)))) gaps.push('comparison must contain distinct supported arms')
  if (protocol.order !== 'interleaved') gaps.push('order must be interleaved (seeded rotation)')
  if (!Number.isSafeInteger(protocol.budget?.timeoutMs) || protocol.budget.timeoutMs < 1) gaps.push('budget.timeoutMs must be positive')
  if (isObject(protocol.model?.parameters) && Object.keys(protocol.model.parameters).some(k => !['reasoningEffort', 'maxTokens'].includes(k))) gaps.push('unsupported model parameter; this AgentOptions contract supports reasoningEffort/maxTokens only')
  return gaps
}

/**
 * Freeze one protocol: validate it, then attach its own hash.
 * @param {object} protocol the authored protocol
 * @returns {object} the frozen protocol
 * @throws {ProtocolError} when anything required is missing
 */
export function freezeProtocol(protocol) {
  const gaps = protocolGaps(protocol)
  if (gaps.length > 0) {
    throw new ProtocolError('EVAL_PROTOCOL_INCOMPLETE', 'the protocol cannot be frozen: ' + gaps.join('; '))
  }
  if ('protocolHash' in protocol || 'frozenAt' in protocol) throw new ProtocolError('EVAL_PROTOCOL_ALREADY_FROZEN', 'author a new protocol without freeze metadata')
  const body = JSON.parse(JSON.stringify(protocol))
  return { ...body, frozenAt: new Date().toISOString(), protocolHash: protocolHash(body) }
}

export function assertFrozenProtocol(parsed) {
  if (typeof parsed?.protocolHash !== 'string' || typeof parsed?.frozenAt !== 'string') throw new ProtocolError('EVAL_PROTOCOL_NOT_FROZEN', 'freeze the protocol before running')
  const { protocolHash: recorded, frozenAt, ...body } = parsed
  if (protocolHash(body) !== recorded) throw new ProtocolError('EVAL_PROTOCOL_DRIFTED', 'protocol changed after freeze')
  const gaps = protocolGaps(body)
  if (gaps.length) throw new ProtocolError('EVAL_PROTOCOL_INCOMPLETE', gaps.join('; '))
  return parsed
}

/**
 * Load a frozen protocol and prove it still matches its own hash.
 *
 * A drifted protocol is not "almost frozen": the run must stop, because the
 * conditions it claims to hold no longer do.
 * @param {string} path protocol JSON path
 * @returns {object} the frozen protocol
 * @throws {ProtocolError} when it is incomplete or drifted
 */
export function loadFrozenProtocol(path) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new ProtocolError('EVAL_PROTOCOL_UNREADABLE', 'cannot read the protocol at ' + path + ': ' + (error instanceof Error ? error.message : String(error)))
  }
  return assertFrozenProtocol(parsed)
}
