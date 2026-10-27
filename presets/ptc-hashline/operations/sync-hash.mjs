/**
 * Content identities shared by the check and its comparators.
 *
 * A separate module on purpose: sync.mjs and sync-ptc.mjs both need it, and
 * importing it from sync.mjs would make the two modules cyclic.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/sync-hash
 */
import { createHash } from 'node:crypto'

/**
 * A stable JSON rendering: keys sorted at every level.
 *
 * Digests are compared across runs and across machines, so an object that only
 * re-serialised its keys differently must not read as a content change.
 * @param {unknown} value any JSON value
 * @returns {string} the canonical text
 */
export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']'
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}'
}

/**
 * The hex SHA-256 of one value's canonical rendering.
 * @param {unknown} value any JSON value
 * @returns {string} the digest
 */
export function hashOf(value) {
  return sha256Of(stableJson(value))
}

/**
 * The hex SHA-256 of one text.
 * @param {string} text the text
 * @returns {string} the digest
 */
export function sha256Of(text) {
  return createHash('sha256').update(text).digest('hex')
}
