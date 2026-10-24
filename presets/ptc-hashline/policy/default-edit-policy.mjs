/**
 * Default edit policy for the managed `edit` registration.
 *
 * Authority: docs/specs/2026-10-24-hashline-default-editing.md (SRS 1.1).
 * This module is shipped inside the bundle (`presets/ptc-hashline/policy/`) and
 * is loaded by the patched editor only when the target preset configures
 * `contentPolicyModule`. A registration without it keeps the upstream behavior
 * byte for byte.
 *
 * Contract with the editor (all fields are plain data; this module imports only
 * Node builtins):
 *
 *   createPolicy({ ctx, config }) -> {
 *     version,
 *     preflight(request): Promise<void>        // rejects before any write
 *     beforeMutation(request): Promise<void>   // re-check right before a side effect
 *     settle(outcome): void                    // record the known result
 *     dispose(): void
 *   }
 *
 * `preflight` runs before the editor dispatches the real mode, so a rejection
 * there means the request never reached a writer. It is the ONLY place a policy
 * may refuse a request; `beforeMutation` can only invalidate what preflight
 * allowed.
 *
 * @module dsh-tool-hashline/presets/ptc-hashline/policy/default-edit-policy
 */

/** Receipt/format version, reported in every policy error and receipt. */
export const POLICY_VERSION = '1'

/** The three degradation reasons SRS FR-03 allows, and nothing else. */
export const POLICY_REASONS = ['snapshot-limit', 'window-limit', 'user-override']

/** The non-Hashline payload modes this policy governs. */
export const POLICY_MODES = ['replace', 'patch', 'apply_patch']

/** The two payload groups that make a replace/patch request. */
const PAYLOAD_GROUPS = {
  replace: ['old_string', 'new_string', 'replace_all'],
  patch: ['edits'],
  apply_patch: ['input'],
}

/** A policy refusal. `code` is stable; the message carries the gap. */
export class EditPolicyError extends Error {
  /**
   * @param {string} code stable policy error category
   * @param {string} message model-facing explanation with the concrete gap
   */
  constructor(code, message) {
    super('[' + code + '] ' + message)
    this.name = 'EditPolicyError'
    this.code = code
  }
}

/** Render the allowed-reason list for a model-facing message. */
const reasonList = () => POLICY_REASONS.join(', ')

/** Whether a value is a plain object. */
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Which payload groups a raw argument object carries.
 *
 * Field PRESENCE decides, not the value: `replace_all: false` still belongs to
 * the replace group, and an invalid type in one group must not hide the
 * conflict with another (SRS FR-06.2 / POLICY-18).
 * @param {object} args raw call arguments
 * @returns {string[]} the group names present
 */
export function payloadGroups(args) {
  return Object.keys(PAYLOAD_GROUPS).filter(group =>
    PAYLOAD_GROUPS[group].some(field => args !== null && typeof args === 'object' && Object.hasOwn(args, field)),
  )
}

/**
 * Validate one `fallbacks` entry's declared shape.
 *
 * The shape is checked here (the tool parameter root is an open object, so the
 * host schema cannot reject an undeclared field); whether the declared facts are
 * true is decided by the reason checks, never by this function.
 * @param {unknown} entry one declared fallback
 * @param {number} index position in the array, for the message
 * @returns {object} the declared fallback
 */
export function validateFallback(entry, index) {
  const at = 'fallbacks[' + index + ']'
  if (!isObject(entry)) throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', at + ' must be an object.')
  const unknown = Object.keys(entry).filter(key => !['path', 'reason', 'readCallId', 'ranges', 'userSource', 'modes'].includes(key))
  if (unknown.length > 0) throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', at + ' declares unsupported field(s): ' + unknown.join(', ') + '.')
  if (typeof entry.path !== 'string' || entry.path.trim() === '') {
    throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', at + '.path must be a non-empty string naming the target.')
  }
  if (typeof entry.reason !== 'string' || !POLICY_REASONS.includes(entry.reason)) {
    throw new EditPolicyError(
      'EDIT_POLICY_FALLBACK_REASON',
      at + '.reason must be one of ' + reasonList() + '; arbitrary reasons are not accepted.',
    )
  }
  if (entry.reason === 'snapshot-limit' || entry.reason === 'window-limit') {
    if (typeof entry.readCallId !== 'string' || entry.readCallId.trim() === '') {
      throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', at + '.readCallId is required for reason "' + entry.reason + '".')
    }
  }
  if (entry.reason === 'window-limit') {
    if (!Array.isArray(entry.ranges) || entry.ranges.length === 0) {
      throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', at + '.ranges must be a non-empty array of {startLine, endLine} for reason "window-limit".')
    }
    entry.ranges.forEach((range, position) => {
      const where = at + '.ranges[' + position + ']'
      if (!isObject(range)) throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', where + ' must be an object.')
      for (const key of ['startLine', 'endLine']) {
        const value = range[key]
        if (!Number.isInteger(value) || value < 1) throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', where + '.' + key + ' must be a positive integer line number.')
      }
      if (range.startLine > range.endLine) throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', where + ' has startLine after endLine.')
    })
  }
  if (entry.reason === 'user-override') {
    const source = entry.userSource
    if (!isObject(source)) throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', at + '.userSource is required for reason "user-override".')
    if (typeof source.sessionId !== 'string' || source.sessionId.trim() === '') {
      throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', at + '.userSource.sessionId must name the session that holds the user message.')
    }
    if (!Number.isInteger(source.eventSeq) || source.eventSeq < 0) {
      throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', at + '.userSource.eventSeq must be the non-negative seq of that message.')
    }
    for (const key of ['start', 'end']) {
      if (!Number.isInteger(source[key]) || source[key] < 0) {
        throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', at + '.userSource.' + key + ' must be a non-negative character offset.')
      }
    }
    if (source.start >= source.end) throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', at + '.userSource range is empty (start must be before end).')
    if (!Array.isArray(entry.modes) || entry.modes.length === 0) {
      throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', at + '.modes must be a non-empty array for reason "user-override".')
    }
    for (const mode of entry.modes) {
      if (!POLICY_MODES.includes(mode)) throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', at + '.modes contains "' + String(mode) + '"; allowed: ' + POLICY_MODES.join(', ') + '.')
    }
  }
  return entry
}

/** Validate the whole `fallbacks` field of one call. */
export function validateFallbacks(value) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', 'fallbacks must be an array when present.')
  if (value.length === 0) throw new EditPolicyError('EDIT_POLICY_FALLBACK_SHAPE', 'fallbacks must not be empty when present; omit it for a plain Hashline edit.')
  return value.map((entry, index) => validateFallback(entry, index))
}

/**
 * Build one policy instance for one mounted registration.
 *
 * State belongs to this instance and to Session objects, never to a process
 * global: two sessions mounting the preset must not share an unlock, and
 * unloading the registration must drop everything.
 * @param {{ctx: object, config: object}} options mount context and resolved editor config
 * @returns {object} the policy instance
 */
export function createPolicy({ ctx, config }) {
  void ctx
  void config
  const receipts = new Map()
  return {
    version: POLICY_VERSION,
    /**
     * Decide whether this call may start writing.
     * @param {{exec: object, args: object, mode: string, resolved: object, cwd: string}} request the call as the editor sees it
     * @returns {Promise<void>} resolves when allowed; throws {@link EditPolicyError} otherwise
     */
    async preflight(request) {
      const { exec, args, mode } = request
      const session = exec?.agent?.session
      if (session === undefined) {
        throw new EditPolicyError(
          'EDIT_POLICY_CONTEXT',
          'this edit runs under the default-edit policy but has no agent session, so its read evidence and target identity cannot be verified. Run it from a session of this preset; a context-less call is not a degradation reason.',
        )
      }
      const groups = payloadGroups(args)
      if (groups.length > 1) {
        throw new EditPolicyError(
          'EDIT_POLICY_PAYLOAD_CONFLICT',
          'the request carries more than one edit payload group (' + groups.join(' + ') + '), so the real branch would be decided by field priority. Send exactly one of: replace (path + old_string + new_string), patch (path + edits), or apply_patch / hashline (input). Nothing was written.',
        )
      }
      const fallbacks = validateFallbacks(args?.fallbacks)
      if (mode === 'hashline') {
        if (fallbacks.length > 0) {
          throw new EditPolicyError(
            'EDIT_POLICY_FALLBACK_UNUSED',
            'a Hashline edit does not need fallbacks; declaring one would unlock a mode this call does not use. Remove the field.',
          )
        }
        return
      }
      if (fallbacks.length === 0) {
        throw new EditPolicyError(
          'EDIT_POLICY_FALLBACK_REQUIRED',
          'this request is an ordinary ' + mode + ' content update, which the default edit policy does not allow without a declared degradation. Use Hashline (input with [path#tag] from your latest read) instead; if the target genuinely cannot be edited with Hashline, declare fallbacks with one of ' + reasonList() + ' and its evidence. Nothing was written.',
        )
      }
      // The reason vocabulary is closed and validated; the checks that make a
      // reason TRUE arrive with the reason tickets, so an unimplemented (but
      // legal) reason must surface as a concrete gap instead of silently passing.
      for (const fallback of fallbacks) {
        throw new EditPolicyError(
          'EDIT_POLICY_REASON_UNAVAILABLE',
          'fallback reason "' + fallback.reason + '" for "' + fallback.path + '" is a legal reason but its verification is not available in this build, so the request cannot be authorized. Use Hashline, or wait for the reason check. Nothing was written.',
        )
      }
    },
    /** Re-check one target immediately before its side effect. */
    async beforeMutation(request) {
      void request
    },
    /** Record the known outcome of this call. */
    settle(outcome) {
      const key = outcome?.exec?.callId
      if (typeof key !== 'string') return
      receipts.set(key, { version: POLICY_VERSION, ...outcome })
      while (receipts.size > 32) receipts.delete(receipts.keys().next().value)
    },
    /** Drop every record owned by this mount. */
    dispose() {
      receipts.clear()
    },
  }
}
