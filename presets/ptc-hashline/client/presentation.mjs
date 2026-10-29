/**
 * Presentation rule for the withheld first attempt (intent gate IG-B-05 / IG-B-20, P3 route 1).
 *
 * WHY THIS IS A PRESET ASSET AND NOT A PACKAGE YET: the browser half needs the host's client
 * packages (`@deepseek-ai/dsh-client-ui-conversation`, `-ui-chat`, `-locale`) and a tsdown build.
 * Neither can be installed or built in the current sandbox, so the *rule* — the part that must be
 * right — lives here as a dependency-free module that the browser half will import verbatim.
 * The wiring itself is written down in
 * `docs/plans/2026-10-28-p3-route1-client-presentation-design.md` §7.1 and is BLOCKED until that
 * environment exists.
 *
 * The rule is deliberately narrow. It upgrades EXACTLY ONE pair of facts — "this turn ended with
 * a policy-owned declaration failure" plus "the very next thing in the log is this producer's
 * repair notice" — into "the request is being completed". Every other failure keeps the stock
 * failure row, because renaming a real failure is the one thing this feature must never do.
 * @module dsh-tool-hashline/presets/ptc-hashline/client/presentation
 */

/** The producer name the gate stamps on its own messages (session format v4 forbids reuse). */
export const PRODUCER_KIND = 'intent-gate-watchdog'

/**
 * First words of the repair notice. Duplicated from the gate because the browser bundle cannot
 * import a preset module at build time; `tests/unit/intent-recovering-presentation.spec.ts`
 * asserts the two constants stay equal.
 */
export const REPAIR_NOTICE_PREFIX = '[intent-gate] Your previous reply for this request was withheld'

/** Failure codes whose ONLY meaning is "the declaration was missing/empty, and it is being completed". */
export const RECOVERY_FAILURE_CODES = Object.freeze([
  'INTENT_DECLARATION_MISSING',
  'INTENT_DECLARATION_EMPTY',
])

/** Node kind the client half contributes; must not collide with a stock `ui-chat` kind. */
export const RECOVERING_KIND = 'intent-recovering'

/** User-visible wording. No locale may contain a failure word: this row is not a failure. */
export const RECOVERING_TEXT = Object.freeze({
  'zh-CN': '正在补全意图声明…',
  'en-US': 'Completing the intent declaration…',
})

/** The failure word each locale must NOT contain, checked by the tests and by review. */
export const FORBIDDEN_WORDS = Object.freeze({ 'zh-CN': ['失败', '错误'], 'en-US': ['failed', 'error'] })

/**
 * Classify one `turn/end` reason.
 * @param reason - the recorded `turn/end` reason (session format v4).
 * @returns `{ kind: 'none' }`, `{ kind: 'failure', code }` or `{ kind: 'recovering', code }`.
 */
export function classifyTurnEnd(reason) {
  if (reason === null || typeof reason !== 'object') return { kind: 'none' }
  if (reason.kind !== 'error') return { kind: 'none' }
  const failure = reason.error ?? reason.failure
  const code = typeof failure?.code === 'string' ? failure.code : undefined
  if (code !== undefined && RECOVERY_FAILURE_CODES.includes(code)) return { kind: 'recovering', code }
  return { kind: 'failure', ...(code === undefined ? {} : { code }) }
}

/** The text of one user message, in the shape the session log stores. */
export function messageText(event) {
  const content = event?.data?.content
  if (!Array.isArray(content)) return ''
  return content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('')
}

/**
 * Whether one event is this producer's repair notice.
 * @param event - a session event.
 * @returns true only for a notice from the gate whose text starts with the repair prefix.
 */
export function isRepairNotice(event) {
  if (event?.type !== 'user/message') return false
  const source = event.data?.source
  if (source?.kind !== PRODUCER_KIND || source.form !== 'notice') return false
  return messageText(event).startsWith(REPAIR_NOTICE_PREFIX)
}

/** Machine-readable outcomes of {@link explainRecovering}, stable enough to log. */
export const RECOVERING_REASON = Object.freeze({
  UPGRADED: 'upgraded',
  NOT_REQUESTED: 'no-recovery-code',
  NO_FOLLOWING: 'nothing-followed',
  NOT_A_REPAIR: 'first-message-is-not-a-repair-notice',
  BOUNDARY: 'turn-boundary-closed-the-window',
})

/**
 * Decide whether a finished turn should present as "being completed" instead of failed, and say
 * why — the reason is what a report needs when the honest answer is "we did not upgrade".
 *
 * The repair notice is the FIRST thing after the turn ends, in the same request. If anything the
 * user wrote arrives first, the request has moved on (the gate drops a repair it can no longer
 * queue), so this returns null and the stock failure row stands: a stale upgrade is worse than a
 * visible pause.
 * @param input - { turn, reason, following } where following are the events after this turn's end.
 * @returns the recovering row, or null when the stock failure presentation must stay.
 */
export function explainRecovering(input) {
  const { turn, reason, following } = input ?? {}
  const classified = classifyTurnEnd(reason)
  if (classified.kind !== 'recovering') return { row: null, reason: RECOVERING_REASON.NOT_REQUESTED }
  if (!Array.isArray(following)) return { row: null, reason: RECOVERING_REASON.NO_FOLLOWING }
  for (const event of following) {
    if (event?.type === 'user/message') {
      if (!isRepairNotice(event)) return { row: null, reason: RECOVERING_REASON.NOT_A_REPAIR }
      return {
        row: {
          kind: RECOVERING_KIND,
          seq: event.seq,
          time: event.time,
          turn: typeof turn === 'number' ? turn : null,
          code: classified.code,
        },
        reason: RECOVERING_REASON.UPGRADED,
      }
    }
    // A turn boundary closes the window: the repair can no longer land in this request.
    if (event?.type === 'turn/start' || event?.type === 'turn/end') return { row: null, reason: RECOVERING_REASON.BOUNDARY }
  }
  return { row: null, reason: RECOVERING_REASON.NO_FOLLOWING }
}

/**
 * The row only, for callers that do not care why it was refused.
 * @param input - same shape as {@link explainRecovering}.
 * @returns the recovering row, or null when the stock failure presentation must stay.
 */
export function deriveRecoveringRow(input) {
  return explainRecovering(input).row
}

/**
 * The row text for one locale, falling back to zh-CN.
 * @param locale - a BCP-47 tag such as `zh-CN`.
 * @returns the user-visible sentence.
 */
export function recoveringText(locale) {
  return RECOVERING_TEXT[locale] ?? RECOVERING_TEXT['zh-CN']
}
