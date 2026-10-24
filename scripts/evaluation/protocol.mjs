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

/** Fields a protocol MUST declare before a run may start (SRS §7.1). */
export const REQUIRED_FIELDS = [
  'id',
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
  const keys = Object.keys(value).sort()
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
  for (const field of REQUIRED_FIELDS) {
    const value = protocol[field]
    if (value === undefined || value === null) gaps.push('missing required field: ' + field)
    else if (typeof value === 'string' && value.trim() === '') gaps.push('field ' + field + ' is empty')
  }
  if (isObject(protocol.model)) {
    for (const field of ['provider', 'model', 'parameters']) {
      if (protocol.model[field] === undefined) gaps.push('model.' + field + ' is required')
    }
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
    for (const field of ['minFirstCandidateCorrect', 'maxTotalTokensPerTask']) {
      if (typeof protocol.passConditions[field] !== 'number') gaps.push('passConditions.' + field + ' must be a number')
    }
  }
  if (!Array.isArray(protocol.tasks) || protocol.tasks.length === 0) {
    gaps.push('tasks must be a non-empty array')
  } else {
    const families = new Set()
    protocol.tasks.forEach((task, index) => {
      const at = 'tasks[' + index + ']'
      if (!isObject(task)) { gaps.push(at + ' must be an object'); return }
      for (const field of ['id', 'family', 'initial', 'prompt', 'expected']) {
        if (typeof task[field] !== 'string' || task[field].trim() === '') gaps.push(at + '.' + field + ' must be a non-empty string')
      }
      if (typeof task.family === 'string') families.add(task.family)
    })
    for (const family of REQUIRED_TASK_FAMILIES) {
      if (!families.has(family)) gaps.push('tasks must cover the family "' + family + '" (SRS §7.3)')
    }
  }
  if (!Array.isArray(protocol.comparison) || protocol.comparison.length < 2) {
    gaps.push('comparison must name at least two arms (the current auto and the policy)')
  }
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
  const frozen = { ...protocol, frozenAt: new Date().toISOString() }
  return { ...frozen, protocolHash: protocolHash(protocol) }
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
  if (typeof parsed?.protocolHash !== 'string') {
    throw new ProtocolError('EVAL_PROTOCOL_NOT_FROZEN', 'the protocol at ' + path + ' carries no protocolHash; freeze it before running')
  }
  const { protocolHash: recorded, frozenAt, ...body } = parsed
  if (protocolHash(body) !== recorded) {
    throw new ProtocolError('EVAL_PROTOCOL_DRIFTED', 'the protocol at ' + path + ' changed after it was frozen; re-freeze and re-approve the run')
  }
  const gaps = protocolGaps(body)
  if (gaps.length > 0) throw new ProtocolError('EVAL_PROTOCOL_INCOMPLETE', gaps.join('; '))
  return parsed
}
