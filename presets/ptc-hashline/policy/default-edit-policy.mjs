/**
 * Default edit policy for the managed `edit` registration.
 *
 * Authority: docs/specs/2026-10-24-hashline-default-editing.md (SRS 1.1).
 * This module ships inside the bundle (`presets/ptc-hashline/policy/`) and is
 * loaded by the patched editor only when the target preset configures
 * `contentPolicyModule`. A registration without it keeps the upstream behavior
 * byte for byte.
 *
 * Contract with the editor (plain data only; this module imports nothing, so a
 * packed install runs it with nothing beside Node itself):
 *
 *   createPolicy({ ctx, config }) -> {
 *     version,
 *     preflight(request),      // rejects before any write
 *     beforeMutation(request), // re-checks one target right before its side effect
 *     settle(outcome),         // records the known result
 *     dispose(),
 *   }
 *
 * Read evidence arrives through the read tool's `tool-read/read-fact` event and
 * is promoted ONLY by a successful `tools/result` for the same call: a failed,
 * cancelled or output-invalid read is never evidence. Nothing here trusts a
 * model-authored byte count, tag or version.
 * @module dsh-tool-hashline/presets/ptc-hashline/policy/default-edit-policy
 */

/** Receipt/format version, reported in every policy error and receipt. */
export const POLICY_VERSION = '1'

/** The three degradation reasons SRS FR-03 allows, and nothing else. */
export const POLICY_REASONS = ['snapshot-limit', 'window-limit', 'user-override']

/** The non-Hashline payload modes this policy governs. */
export const POLICY_MODES = ['replace', 'patch', 'apply_patch']

/** The read tool's provisional-fact event (see its `facts` module). */
const READ_FACT_EVENT = 'tool-read/read-fact'

/** How many promoted read facts one registration keeps before evicting the oldest. */
const FACT_CAPACITY = 64
/** The payload groups that make a replace/patch/apply_patch request. */
const PAYLOAD_GROUPS = {
  replace: ['old_string', 'new_string', 'replace_all'],
  patch: ['edits'],
  apply_patch: ['input'],
}

/** A policy refusal. `code` is stable; the message carries the concrete gap. */
export class EditPolicyError extends Error {
  /**
   * @param {string} code stable policy error category
   * @param {string} message model-facing explanation with the gap and the remedy
   */
  constructor(code, message) {
    super('[' + code + '] ' + message)
    this.name = 'EditPolicyError'
    this.code = code
  }
}

const reasonList = () => POLICY_REASONS.join(', ')
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Which payload groups a raw argument object carries.
 *
 * Field PRESENCE decides, not the value: `replace_all: false` still belongs to
 * the replace group, and an invalid type in one group must not hide a conflict
 * with another (SRS FR-06.2 / POLICY-18).
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
 * Shape only: whether the declared facts are TRUE is decided by the reason
 * checks below, never by this function.
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
    throw new EditPolicyError('EDIT_POLICY_FALLBACK_REASON', at + '.reason must be one of ' + reasonList() + '; arbitrary reasons are not accepted.')
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
 * The target paths one request intends to update, in authored form.
 *
 * Only the shapes the three governed modes actually accept: the path argument
 * (with its documented aliases) for replace/patch, and the envelope markers for
 * apply_patch. It does NOT guess: a request whose targets cannot be named is
 * refused with a gap instead of being treated as one target.
 * @param {string} mode the dispatched mode
 * @param {object} args raw call arguments
 * @returns {string[]} authored target paths (may repeat)
 */
export function requestTargets(mode, args) {
  if (mode === 'replace' || mode === 'patch') {
    for (const key of ['path', 'file_path', 'filePath']) {
      const value = args?.[key]
      if (typeof value === 'string' && value.trim() !== '') return [value]
    }
    return []
  }
  if (mode === 'apply_patch') {
    const input = typeof args?.input === 'string' ? args.input : ''
    const targets = []
    for (const line of input.split('\n')) {
      const match = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/u.exec(line.trim())
      if (match !== null && match[1] !== undefined) targets.push(match[1].trim())
    }
    return targets
  }
  return []
}
/**
 * Build one policy instance for one mounted registration.
 *
 * State belongs to this instance and to Session objects, never to a process
 * global: two sessions must not share evidence, and unloading the registration
 * must drop everything (including the read facts, which is why a remount or a
 * config change invalidates every outstanding citation).
 * @param {{ctx: object, config: object}} options mount context and resolved editor config
 * @returns {object} the policy instance
 */
export function createPolicy({ ctx, config }) {
  void config
  /** Promoted read facts by callId, oldest first (insertion order). */
  const facts = new Map()
  /** Facts published but not yet confirmed by a successful result. */
  const provisional = new Map()
  /** Targets this call verified, re-checked right before each side effect. */
  let verified = new Map()
  /** The known outcome of each recent call, for the receipt layer. */
  const receipts = new Map()

  /** Promote only a read whose registry outcome was a success. */
  ctx.on('tools/result', (exec, result) => {
    if (exec?.name !== 'read') return
    const fact = provisional.get(exec.callId)
    if (fact === undefined) return
    provisional.delete(exec.callId)
    if (result?.isError === true) return
    facts.set(exec.callId, fact)
    while (facts.size > FACT_CAPACITY) facts.delete(facts.keys().next().value)
  })

  /** Keep the newest provisional fact per call, replacing a retried id. */
  ctx.on(READ_FACT_EVENT, fact => {
    if (!isObject(fact) || typeof fact.callId !== 'string') return
    provisional.set(fact.callId, fact)
    while (provisional.size > FACT_CAPACITY) provisional.delete(provisional.keys().next().value)
  })

  /**
   * Resolve and probe one target, the way the editor will.
   * @param {string} path authored path
   * @param {string} cwd effective working directory
   * @param {AbortSignal | undefined} signal caller cancellation
   * @returns {Promise<{target: object, info: object | undefined}>} the resolved target and its metadata
   */
  const probe = async (path, cwd, signal) => {
    const target = await ctx.fs.resolve(path, signal === undefined ? { cwd } : { cwd, signal })
    const info = await ctx.fs.stat(target, signal)
    return { target, info }
  }
  /**
   * Verify a `snapshot-limit` fallback against the read it cites.
   *
   * Every clause is a fact this process measured; none of them comes from the
   * model's message. A citation that cannot be re-confirmed is refused, never
   * repaired: the model must read again.
   * @param {{session: object, cwd: string, fallback: object, targetPath: string, signal: AbortSignal | undefined}} context verification context
   * @returns {Promise<void>} resolves when the reason is true for this target
   */
  const verifySnapshotLimit = async context => {
    const { session, cwd, fallback, targetPath, signal } = context
    const fact = facts.get(fallback.readCallId)
    if (fact === undefined) {
      throw new EditPolicyError(
        'EDIT_POLICY_READ_UNKNOWN',
        'the citation readCallId "' + fallback.readCallId + '" does not name a successful read of this registration. Only a read whose result settled successfully can support a degradation, and a remount (including a config change) drops earlier citations. Read the target again and use the citation printed in its nextAction.',
      )
    }
    if (fact.session !== session) {
      throw new EditPolicyError(
        'EDIT_POLICY_READ_CROSS_SESSION',
        'the cited read belongs to another session. Read evidence is per session and cannot be borrowed, forwarded or replayed; read the target in this session.',
      )
    }
    if (fact.cwd !== cwd) {
      throw new EditPolicyError(
        'EDIT_POLICY_READ_CWD',
        'the cited read resolved against ' + fact.cwd + ', but this call runs in ' + cwd + '. A working-directory change invalidates the citation; read the target again.',
      )
    }
    if (fact.tagged) {
      throw new EditPolicyError(
        'EDIT_POLICY_REASON_FALSE',
        'the cited read DID mint a tag, so this target is editable with Hashline; "snapshot-limit" is not true for it. Use the tag from that read.',
      )
    }
    if (fact.empty) throw new EditPolicyError('EDIT_POLICY_REASON_FALSE', 'the cited read found an empty file, which is a creation case, not a snapshot limit.')
    if (fact.bytes < fact.caps.snapshotMaxBytes) {
      throw new EditPolicyError(
        'EDIT_POLICY_REASON_FALSE',
        'the cited read measured ' + fact.bytes + ' normalized bytes, below the ' + fact.caps.snapshotMaxBytes + '-byte snapshot ceiling, so "snapshot-limit" is not true for it.',
      )
    }
    const { target, info } = await probe(targetPath, cwd, signal)
    if (info === undefined) {
      throw new EditPolicyError('EDIT_POLICY_TARGET_MISSING', 'the declared target "' + targetPath + '" does not exist, so this is a creation case rather than a degraded update.')
    }
    if (target.targetKey !== fact.targetKey || target.displayPath !== fact.displayPath) {
      throw new EditPolicyError(
        'EDIT_POLICY_READ_TARGET',
        'the cited read resolved "' + fallback.path + '" to ' + fact.displayPath + ', but this request updates ' + target.displayPath + '. A citation only supports the target it read.',
      )
    }
    if (info.version !== fact.version) {
      throw new EditPolicyError(
        'EDIT_POLICY_EVIDENCE_STALE',
        'the target changed since the cited read (' + fact.version + ' -> ' + info.version + '). The evidence no longer describes what would be overwritten; read the target again.',
      )
    }
    verified.set(target.targetKey, { fact, version: info.version })
  }

  /**
   * Verify a `window-limit` fallback against the read it cites.
   *
   * The declared ranges must overlap content the cited read could NOT deliver as
   * complete text: a column-truncated line, or a line the byte cap omitted. A
   * range that only covers fully returned lines is not a window limit — the model
   * could edit it with Hashline and is asking to skip that.
   * @param {object} context verification context
   * @returns {Promise<void>} resolves when the reason is true for these ranges
   */
  const verifyWindowLimit = async context => {
    const { session, cwd, fallback, targetPath, signal } = context
    const fact = facts.get(fallback.readCallId)
    if (fact === undefined) {
      throw new EditPolicyError(
        'EDIT_POLICY_READ_UNKNOWN',
        'the citation readCallId "' + fallback.readCallId + '" does not name a successful read of this registration. Read the target again and use the citation printed in its nextAction.',
      )
    }
    if (fact.session !== session) {
      throw new EditPolicyError('EDIT_POLICY_READ_CROSS_SESSION', 'the cited read belongs to another session. Read evidence is per session and cannot be borrowed, forwarded or replayed; read the target in this session.')
    }
    if (fact.cwd !== cwd) {
      throw new EditPolicyError('EDIT_POLICY_READ_CWD', 'the cited read resolved against ' + fact.cwd + ', but this call runs in ' + cwd + '. A working-directory change invalidates the citation; read the target again.')
    }
    const limited = new Set([...fact.window.truncatedLineNumbers, ...fact.window.omittedLineNumbers])
    if (limited.size === 0) {
      throw new EditPolicyError(
        'EDIT_POLICY_REASON_FALSE',
        'the cited read returned every requested line as complete text (a plain offset/limit page is not a window limit), so "window-limit" is not true for it. Use Hashline, or page to the content you need.',
      )
    }
    const outside = []
    for (const range of fallback.ranges) {
      let touches = false
      for (let line = range.startLine; line <= range.endLine; line += 1) {
        if (limited.has(line)) touches = true
      }
      if (!touches) outside.push(range.startLine + '..' + range.endLine)
    }
    if (outside.length > 0) {
      throw new EditPolicyError(
        'EDIT_POLICY_REASON_FALSE',
        'declared range(s) ' + outside.join(', ') + ' cover only lines the cited read returned in full; the limited lines are ' + [...limited].sort((a, b) => a - b).join(', ') + '. A window limit only supports the lines it actually withheld — everything else must be edited with Hashline.',
      )
    }
    const { target, info } = await probe(targetPath, cwd, signal)
    if (info === undefined) {
      throw new EditPolicyError('EDIT_POLICY_TARGET_MISSING', 'the declared target "' + targetPath + '" does not exist, so this is a creation case rather than a degraded update.')
    }
    if (target.targetKey !== fact.targetKey || target.displayPath !== fact.displayPath) {
      throw new EditPolicyError('EDIT_POLICY_READ_TARGET', 'the cited read resolved "' + fallback.path + '" to ' + fact.displayPath + ', but this request updates ' + target.displayPath + '. A citation only supports the target it read.')
    }
    if (info.version !== fact.version) {
      throw new EditPolicyError('EDIT_POLICY_EVIDENCE_STALE', 'the target changed since the cited read (' + fact.version + ' -> ' + info.version + '). The evidence no longer describes what would be overwritten; read the target again.')
    }
    verified.set(target.targetKey, { fact, version: info.version })
  }

  /** Verify one declared reason against measured facts. */
  const verifyReason = async context => {
    const { fallback } = context
    if (fallback.reason === 'snapshot-limit') return verifySnapshotLimit(context)
    if (fallback.reason === 'window-limit') return verifyWindowLimit(context)
    throw new EditPolicyError(
      'EDIT_POLICY_REASON_UNAVAILABLE',
      'fallback reason "' + fallback.reason + '" for "' + fallback.path + '" is a legal reason but its verification is not available in this build, so the request cannot be authorized. Use Hashline, or wait for the reason check. Nothing was written.',
    )
  }
  return {
    version: POLICY_VERSION,
    /**
     * Decide whether this call may start writing.
     * @param {{exec: object, args: object, mode: string, resolved: object, cwd: string}} request the call as the editor sees it
     * @returns {Promise<void>} resolves when allowed; throws {@link EditPolicyError} otherwise
     */
    async preflight(request) {
      const { exec, args, mode, cwd } = request
      verified = new Map()
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
      const targets = requestTargets(mode, args)
      if (targets.length === 0) {
        throw new EditPolicyError(
          'EDIT_POLICY_TARGET_UNKNOWN',
          'this ' + mode + ' request does not name a target this policy can resolve, so no fallback can be matched to it. Name the file with `path`, or use a Hashline program. Nothing was written.',
        )
      }
      if (targets.length > 1) {
        throw new EditPolicyError(
          'EDIT_POLICY_TARGET_UNKNOWN',
          'this request names ' + targets.length + ' targets (' + targets.join(', ') + '); a degraded update is verified one target at a time and mixed requests are not supported by this build yet. Use Hashline for the batch, or split the degraded target out. Nothing was written.',
        )
      }
      const targetPath = targets[0]
      // The declared fallback must cover the target this call actually updates.
      const matching = fallbacks.filter(fallback => fallback.path === targetPath)
      if (matching.length !== 1) {
        throw new EditPolicyError(
          'EDIT_POLICY_FALLBACK_UNUSED',
          'the request updates "' + targetPath + '" but declares ' + matching.length + ' fallback(s) for it. Declare exactly one fallback per updated target, and none for targets the call does not touch. Nothing was written.',
        )
      }
      await verifyReason({ session, cwd, fallback: matching[0], targetPath, signal: exec.signal })
    },
    /**
     * Re-check one target right before its side effect.
     *
     * The version the preflight verified must still hold: a change landing
     * between verification and the write makes the evidence describe a file
     * that no longer exists.
     * @param {{exec: object, cwd: string, target: object}} request the target about to change
     * @returns {Promise<void>} resolves when the target is unchanged
     */
    async beforeMutation(request) {
      const { exec, target } = request
      const entry = verified.get(target?.targetKey)
      if (entry === undefined) return
      const info = await ctx.fs.stat(target, exec?.signal)
      if (info === undefined || info.version !== entry.version) {
        throw new EditPolicyError(
          'EDIT_POLICY_EVIDENCE_STALE',
          'the target changed between the policy check and the write (' + entry.version + ' -> ' + (info === undefined ? 'missing' : info.version) + '). Nothing was written by this call; re-read the target and re-declare the degradation.',
        )
      }
    },
    /**
     * Record the known outcome of this call.
     * @param {{exec: object, mode: string, result: string, code?: string}} outcome settled outcome
     */
    settle(outcome) {
      verified = new Map()
      const key = outcome?.exec?.callId
      if (typeof key !== 'string') return
      receipts.set(key, { version: POLICY_VERSION, ...outcome })
      while (receipts.size > 32) receipts.delete(receipts.keys().next().value)
    },
    /** Drop every record owned by this mount. */
    dispose() {
      facts.clear()
      provisional.clear()
      verified = new Map()
      receipts.clear()
    },
  }
}
