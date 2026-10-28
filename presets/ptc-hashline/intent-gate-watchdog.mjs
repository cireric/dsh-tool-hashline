/**
 * Request-level intent gate for the ptc-hashline preset (方案 B, tickets 01-02).
 *
 * WHAT CHANGED AND WHY THE FILE KEEPS ITS NAME. This module used to be a per-turn
 * "watchdog": it denied the FIRST behavior tool call whose carrier message lacked a
 * six-bucket Intent: line, i.e. it gated on inner tool names and refused mid-program.
 * That mechanism is replaced (spec 2026-10-27-intent-gate-b-requirements, IG-B-01/02/04/05):
 * the obligation is now attached to a REQUEST, not to a tool name, and it is enforced
 * BEFORE anything is published or dispatched. The file name and the preset row id stay
 * "intent-gate-watchdog" because they are addressed by the packed install, the profile
 * installers, the delivery acceptance and the operations baselines; renaming an asset
 * path is not part of these tickets and would churn baselines they do not touch.
 *
 * THE SEAM. "llm/stream" is an official waterfall (dsh-llm): a listener may call next()
 * and buffer the adapter's chunks, then either replay them verbatim or yield its own
 * chunks. The agent loop builds the durable assistant/message only AFTER the stream ends
 * (agent-loop step()) and only THEN executes the tool calls it carries, so one fully
 * buffered attempt gives exactly the guarantee the spec asks for: the formal reply body
 * is validated before it is published (no agent/assistant-stream frame, no session
 * append) and before any tool program starts (no dispatch, no side effect).
 *
 * WHY TRIGGERING IS REQUEST-SCOPED. A declaration is owed on the FIRST formal reply after
 * a NEW real user input (IG-B-01). The loop's own signal for that is "agent/pre-step":
 * its messages are the messages claimed from the inbox for this step, so a real user
 * message enters the inbox only when the user spoke, and a tool result or an injected
 * notice never does. We latch that per session and consume it at the next model request
 * of that session; a machine-opened step clears the latch, so tool continuations of the
 * same request owe nothing (IG-B-01: 同请求工具续步、进度和收尾不重复).
 *
 * SCOPE. Only depth-0 agents (the preset's managed main agent) are gated: a delegated
 * child re-mounts this preset row into its own scope, and IG-B-13 keeps the gate out of
 * subagents and helper calls. Auxiliary model calls pass through untouched, identified by
 * the two fields that are true of them and false of a loop-built conversation request:
 * the loop stamps 'purpose' on compaction/session-title calls, and a hand-built one-shot
 * passes 'system' text (a loop request always leaves it undefined).
 *
 * BOUNDED REPAIR (ticket 02, IG-B-05/06/07). A rejected attempt is not the end of the
 * request: the gate spends ONE repair per user-opened request. It ends the attempt as a
 * policy failure, and "agent/request-error" — the loop's own recovery hook — appends a
 * correction notice to the SESSION LOG (producer-owned source, form notice) and returns
 * { kind: 'retry' }; the loop then rebuilds the request from session.deriveMessages(), so
 * the correction is part of the official record and the regenerated request is
 * reconstructible from it. Nothing mutates the frozen request, and the notice says
 * explicitly that it grants no new authority (IG-B-07). A second rejection is terminal and
 * reports the single repair as exhausted; normal tool continuations never touch the
 * budget, and a real provider failure is delegated (next()) instead of being repaired —
 * cancellation, network errors, timeouts and truncation therefore cost no repair
 * (IG-B-10), and a generic retry policy cannot turn one declaration miss into two.
 *
 * FAILURE ACCOUNTING (IG-B-11/12). The three outcomes stay distinct and traceable:
 * the provider's own completion, this gate's policy rejection, and a real failure. A
 * rejected attempt keeps its usage chunk so the durable assistant/attempt stream still
 * shows what the generation cost; when the adapter reported no usage the record has none
 * (unknown, never a fabricated zero). Rejected text and tool calls never escape and the
 * rejected replay metadata is never attached to the accepted answer, which keeps its own.
 *
 * INPUT EXCEPTIONS (ticket 03, IG-B-01/03/09). Two inputs do not owe the line, and the
 * exemption is deliberately narrow so it can never hide a goal change: a BARE
 * acknowledgement ("谢谢" / "thanks") and a BARE continuation ("继续" / "continue") — exact
 * forms after normalisation, never a substring or a word inside a sentence. A continuation
 * additionally needs this session to already hold an accepted understanding, and it is
 * suppressed when the previous request ended in a stop (an exhausted repair, a failure or a
 * truncation), because then the user's "继续" is a NEW request that declares again and gets
 * its own repair (IG-B-06's exception). An exemption also never covers a reply that calls a
 * tool: acting without declaring is exactly what this gate exists to prevent (IG-B-09). The
 * semantic short check — goal, deliverable, object, scope, completion criteria — stays with
 * the main agent in its existing generation (IG-B-03); nothing here infers meaning.
 *
 * CLARIFICATION WAITING (ticket 04, IG-B-03/16). The host owns the question surface:
 * ask_user_question (dsh-tool-ask-user) records a durable tool call and, in this preset's
 * blocking mode, does not return until the human answers, so the request is paused by the
 * host rather than by a flag this module invents. What the gate adds is the accounting the
 * host does not do: while a question is open, (a) ticket 03's conversational exemptions are
 * OFF — a bare "继续" while A/B is on the table is not an answer and not a social ping, it
 * owes a declaration like any other request; (b) a reply that would CALL A TOOL is rejected,
 * because acting before the user answered is exactly what "silence is not consent" forbids
 * (IG-B-16/IG-B-09); (c) an answer that arrives as the host's own user-question-reply message
 * is always treated as a real input that owes a declaration — never as an acknowledgement,
 * never as a continuation. All of it is per session, so one session asking a question cannot
 * lock another one, and a new independent request in the same session clears the wait.
 *
 * STEERING BEFORE DISPATCH (ticket 05, IG-B-08/09). The host delivers a user's mid-run input
 * as steering: it waits in agent.inbox.nextStep until the loop claims it at the next step.
 * A reply composed BEFORE that input arrived cannot be trusted to reflect it, so the gate
 * refuses to let its calls run: an accepted attempt that would dispatch while a steer is
 * pending is ended as INTENT_STALE_ACTION (nothing published, nothing dispatched, no repair
 * spent), and an ALREADY RUNNING program is stopped at its next inner dispatch through the
 * official tools/pre-execute waterfall. Calls that already executed stay executed — the gate
 * never claims or performs a rollback — and the loop then consumes the steering input at the
 * next step, where the request re-declares under the new requirement. The judgement of
 * WHETHER an input changes the goal is the persona's, not this module's: a harmless progress
 * ping is paused and re-judged exactly like a real correction, and the persona continues the
 * same plan after saying where it is.
 *
 * BOUNDED RESOURCES (IG-B-15 / IGB-AC-08). Buffering is bounded in characters and in
 * wall-clock time; both caps and the repair budget are declared in the preset row and
 * asserted by scripts/check-preset.mjs so they cannot drift silently. Exceeding either cap
 * does NOT release an unvalidated reply and does NOT spend a repair: it ends the attempt
 * as a policy failure that names the cap. Timing rule used by the acceptance harness: the
 * gate's extra wait is the gap between the provider's own chunk timestamps at the adapter
 * and the first published "agent/assistant-stream" frame; both are observed outside this
 * module.
 *
 * LANGUAGE SPLIT. Text that the USER reads (a stopped request) is Chinese, like the rest of
 * this deployment's user-facing gate copy; text that only the MODEL reads (the correction
 * notice) is English, like the persona it must instruct.
 *
 * Zero @deepseek-ai/* imports on purpose: a preset directory lives under the user home,
 * where Node cannot resolve the harness packages. Node builtins are allowed.
 */

import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

export const name = 'intent-gate-watchdog'

/**
 * Declared bounds (mirrored in preset.patch.yml and asserted by check-preset).
 * maxBufferedChars counts the model-authored characters held in memory for one attempt
 * (text and tool-call argument deltas, which is where the bytes are); maxBufferMs bounds
 * how long one attempt may stay buffered before it is judged; maxRepairs is the spec's
 * fixed "at most one automatic repair per user-opened request" (IG-B-06) — it is declared
 * here so a future edit cannot quietly widen it, not offered as a tuning knob.
 */
export const DEFAULT_LIMITS = Object.freeze({ maxBufferedChars: 262144, maxBufferMs: 120000, maxRepairs: 1 })

/** Leading filler tolerated before the marker: BOM, NBSP, spaces, tabs (never a newline). */
const LEADING_FILLER = /^[\uFEFF\u00A0 \t]+/u

/**
 * The marker: the literal token "Intent:" as the first content of the first line.
 * Case-insensitive and whitespace-tolerant (IG-B-02: 大小写、空格差异不单独构成拒绝);
 * the token itself is never translated, and the six-bucket vocabulary is GONE — what
 * follows the colon is natural language, so nothing about it is validated mechanically.
 */
const MARKER = /^intent[ \t]*:/iu

/**
 * The two conversational incomes that owe no declaration — EXACT forms only. Short lists on
 * purpose: they are the whole mechanical surface of "社交回应/正常继续", they are asserted by
 * the unit test, and anything with extra words ("收到，但把 X 改成 Y") normalises to a longer
 * string and therefore owes a declaration. Meaning is the persona's job (IG-B-03), not this
 * module's.
 */
export const ACKNOWLEDGEMENTS = Object.freeze(['谢谢', '多谢', '谢了', '感谢', '收到', '好的', '好', '嗯', '嗯嗯', '明白', '明白了', 'ok', 'okay', 'thanks', 'thank you', 'thx', '👍', '🆗'])
export const CONTINUATIONS = Object.freeze(['继续', '继续吧', '接着', '接着做', '往下', '往下做', 'go on', 'continue', 'keep going', 'carry on', 'resume'])

/**
 * The host's own surfaces for a clarification, kept as strings because this module may not
 * import host packages: the tool is registered by dsh-tool-ask-user, and the answer message
 * kind is declared by dsh-user-questions (MessageSourceMap augmentation, 'user-question-reply'
 * with { callId, outcome: 'answered' }). A drift here would show up as the acceptance cases
 * failing, not as a silent behaviour change.
 */
export const QUESTION_TOOL = 'ask_user_question'
export const ANSWER_SOURCE_KIND = 'user-question-reply'

/** Trailing punctuation that does not change what the user said. */
const TRAILING_PUNCTUATION = /[\s.!。！~～?？,，、]+$/u

/**
 * Normalise one user input for the exact-form comparison: whitespace collapsed, trailing
 * punctuation dropped, case folded. Nothing else — no stemming, no keyword search.
 * @param text - the raw text of the real user messages in this step.
 */
export function normalizeInput(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim().replace(TRAILING_PUNCTUATION, '').toLowerCase()
}

/**
 * Classify one real user input for the gate.
 * @param text - the raw text of the real user messages in this step.
 * @param state - this session's record: { accepted, lastOutcome }.
 * @returns 'acknowledge' | 'continue' | 'owes' (owes = the declaration is required).
 */
export function classifyInput(text, state) {
  const normalized = normalizeInput(text)
  if (normalized === '') return 'owes'
  // While a question is open nothing is a bare acknowledgement: the words may be an option
  // label, and silence already means nothing (IG-B-16). The answer itself owes a declaration.
  if (state !== undefined && state.awaitingAnswer === true) return 'owes'
  if (ACKNOWLEDGEMENTS.includes(normalized)) return 'acknowledge'
  if (CONTINUATIONS.includes(normalized)) {
    // "承接已有理解" needs an understanding to carry, and a request that ENDED in a stop
    // hands the user a new request, not a continuation (IG-B-06's exhausted-retry exception).
    return state !== undefined && state.accepted > 0 && state.lastOutcome === 'accepted' ? 'continue' : 'owes'
  }
  return 'owes'
}

/** Machine-readable reasons for one attempt's verdict. */
export const REASON = Object.freeze({
  NO_TEXT: 'no-text',
  MISSING: 'missing-marker',
  EMPTY_BODY: 'empty-body',
  LIMIT_CHARS: 'limit-chars',
  LIMIT_TIME: 'limit-time',
  GATE_ERROR: 'gate-error',
  AWAITING_ANSWER: 'awaiting-answer',
  STALE_ACTION: 'stale-action',
  STATE_UNTRUSTED: 'state-untrusted',
})

/**
 * The three declaration misses: reasons a rewrite can fix and a conversational input may be
 * excused for (ticket 03). Ticket 04's awaiting-answer stop is deliberately NOT here — it is
 * a terminal "the request is paused until you answer", not a wording problem to repair.
 */
const DECLARATION_MISSES = new Set([REASON.NO_TEXT, REASON.MISSING, REASON.EMPTY_BODY])

const REASON_TEXT = {
  [REASON.NO_TEXT]: '这条回复没有任何正文（只有工具调用），因此没有意图声明',
  [REASON.MISSING]: '首行没有以字面标记 "Intent:" 开头',
  [REASON.EMPTY_BODY]: '"Intent:" 之后只有空白，没有说明目标与下一步的正文',
  [REASON.LIMIT_CHARS]: '本条回复超过本机制暂存上限（字符），已按上限停止而不是放行未经检查的正文',
  [REASON.LIMIT_TIME]: '本条回复的整段生成超过本机制暂存等待上限（毫秒），已按上限停止而不是放行未经检查的正文',
  [REASON.GATE_ERROR]: '本机制无法完成这次机械检查（内部错误），已停止而不是放行未经检查的正文',
  [REASON.AWAITING_ANSWER]: '本会话已经向你提问、而你还没有得到回答，这次回复却要动手；问题待答期间不执行任何工具',
  [REASON.STALE_ACTION]: '用户在你生成这条回复期间又追加了要求，这条回复里的调用是在那之前形成的；未执行的调用已停下，已执行的动作保留',
  [REASON.STATE_UNTRUSTED]: '本会话的意图门记录缺失、损坏或无法关联，无法可信重建已确认的理解与待答状态；按保守状态暂停这一次请求，请重新说明你的要求',
}

/** The same reasons in the model's language, for the correction notice. */
const REASON_TEXT_FOR_MODEL = {
  [REASON.NO_TEXT]: 'the reply carried no text at all (only a tool call), so it declared nothing',
  [REASON.MISSING]: 'the first line of the reply did not start with the literal marker Intent:',
  [REASON.EMPTY_BODY]: 'the first line started with Intent: but carried no text after it',
  [REASON.AWAITING_ANSWER]: 'the reply wanted to call a tool while your own question to the user is still unanswered',
}

/**
 * Failure codes are policy-owned: they must never read like a provider or transport fact,
 * so a real failure and this gate's decision stay distinguishable in logs and reports.
 */
const FAILURE_CODE = {
  [REASON.NO_TEXT]: 'INTENT_DECLARATION_MISSING',
  [REASON.MISSING]: 'INTENT_DECLARATION_MISSING',
  [REASON.EMPTY_BODY]: 'INTENT_DECLARATION_EMPTY',
  [REASON.LIMIT_CHARS]: 'INTENT_DECLARATION_LIMIT',
  [REASON.LIMIT_TIME]: 'INTENT_DECLARATION_LIMIT',
  [REASON.GATE_ERROR]: 'INTENT_GATE_ERROR',
  [REASON.AWAITING_ANSWER]: 'INTENT_DECLARATION_AWAITING_ANSWER',
  [REASON.STALE_ACTION]: 'INTENT_STALE_ACTION',
  [REASON.STATE_UNTRUSTED]: 'INTENT_STATE_UNTRUSTED',
}

/** Reported when the single automatic repair was already spent for this user request. */
export const REPAIR_EXHAUSTED_CODE = 'INTENT_DECLARATION_REPAIR_EXHAUSTED'

/**
 * The user-facing stop reason. Its reader is the user whose request was stopped, so it
 * says what was wrong, that nothing ran, and the exact shape that satisfies the check.
 * The provider's own outcome is explicitly separated from this policy decision (IG-B-11).
 * @param reason - the verdict's reason.
 * @param extras - { repaired, providerKind }: whether a repair was already spent, and the
 *   provider's own terminal kind when it was not a plain success.
 */
export function stopMessage(reason, extras = {}) {
  const repaired = extras.repaired === true
  return [
    '[intent-gate] 本次请求已停止：' + REASON_TEXT[reason] + '。',
    '正文没有展示，这条回复里的工具调用一个也没有执行（provider 正常生成完成，是意图门的策略拒绝，不是网络或模型故障）。',
    repaired
      ? '本次用户请求已经用过唯一一次自动修复机会，仍不合格，因此不再自动重试；你重新发一次请求即是一次新的声明机会。'
      : '合格形状（首行，"Intent:" 逐字符照抄）：Intent: <用自然语言说明你要交付什么，以及下一步打算怎么做>',
    extras.providerKind === undefined ? '' : '（provider 的原始终态是 ' + String(extras.providerKind) + '，没有被改写成声明问题）',
  ].filter(line => line !== '').join('\n')
}

/**
 * The correction notice: the repair's instruction, written for the MODEL, appended to the
 * session log as its own message so the regenerated request can be rebuilt from the
 * official record (IG-B-07). It restates the constraint boundary on purpose — a repair is
 * not user approval and grants no new scope.
 * @param reason - why the previous attempt was rejected.
 * @param providerKind - the rejected attempt's provider terminal kind.
 * @param repair - 1-based index of this repair.
 */
export function repairNotice(reason, providerKind, repair = 1) {
  return [
    '[intent-gate] Your previous reply for this request was withheld: ' + (REASON_TEXT_FOR_MODEL[reason] ?? String(reason)) + '.',
    'Nothing from it was shown to the user and none of its tool calls were executed; the provider had finished normally (' + String(providerKind) + '), so this is a policy rejection, not a network or model failure. This is mechanical check ' + String(repair) + ' of the shape only — it says nothing about whether you understood the request.',
    'Rewrite the same reply for the same user request: start its first line with the literal marker Intent: (copy it verbatim, do not translate it) followed by, in plain language, what the user will get and what you will do next; then continue with the rest of the answer or the program.',
    'The user request, its constraints and its scope are unchanged. This notice is not the user speaking: it adds no goal, grants no new authority and is not approval of anything. Write the whole reply again — the withheld text is not carried over.',
  ].join('\n')
}

/**
 * A session user message produced by THIS plugin: the shape createUserMessage builds
 * (fresh id, role user, text content, producer-owned source), deep-frozen like the
 * harness's own messages. 'kind' is this producer's own name — session format v4 refuses
 * a shared catch-all kind.
 */
function pluginMessage(text, summary) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: name, form: 'notice', summary: boundSummary(summary) },
  })
}

/** Keep the notice's one-line account inside the harness's 120-character register bound. */
function boundSummary(summary) {
  const text = String(summary)
  return text.length <= 120 ? text : text.slice(0, 117) + '...'
}

/** Deep-freeze a plain value in place (mirrors llm's freezeMessage). */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * The first line of the formal reply body, or null when there is no body at all.
 * @param text - concatenated text blocks of the attempt, in block order.
 */
export function firstLineOf(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const end = text.indexOf('\n')
  const line = end === -1 ? text : text.slice(0, end)
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * The whole mechanical check: first-line marker plus non-empty body. This is the ONLY
 * automated judgement; it does not and cannot tell whether the declaration understands
 * the user (spec "机械检查与语义质量" — that stays with the main agent's self-check and
 * the separate effect evaluation).
 * @param text - concatenated text blocks of the attempt, in block order.
 * @returns the verdict: { ok: true, firstLine } or { ok: false, reason, firstLine }.
 */
export function checkDeclaration(text) {
  const firstLine = firstLineOf(text)
  if (firstLine === null) return { ok: false, reason: REASON.NO_TEXT, firstLine: '' }
  const trimmed = firstLine.replace(LEADING_FILLER, '')
  const marker = MARKER.exec(trimmed)
  if (marker === null) return { ok: false, reason: REASON.MISSING, firstLine }
  if (trimmed.slice(marker[0].length).trim() === '') return { ok: false, reason: REASON.EMPTY_BODY, firstLine }
  return { ok: true, firstLine }
}

/**
 * Mirror of the harness's own block assembly (dsh-llm BlockAssembler), reduced to what
 * the gate needs: the final block per index, in first-appearance order, with a block-end
 * block taking precedence over the deltas that preceded it. Validating the FINAL text is
 * deliberate (IGB-AC-01: 最终文本覆盖不能绕过最终检查) — a delta that looks like a
 * declaration and a final block that does not must not pass.
 * @param chunks - the buffered attempt, in stream order.
 */
export function assembleAttempt(chunks) {
  const partials = new Map()
  const order = []
  let finish
  const ensure = (index, blockType) => {
    let partial = partials.get(index)
    if (partial === undefined) {
      partial = { blockType, text: '', block: undefined }
      partials.set(index, partial)
      order.push(index)
    }
    return partial
  }
  for (const chunk of chunks) {
    switch (chunk?.type) {
      case 'block-start': ensure(chunk.index, chunk.blockType); break
      case 'text-delta': { const partial = ensure(chunk.index, 'text'); if (partial.block === undefined) partial.text += chunk.text; break }
      case 'reasoning-delta': { const partial = ensure(chunk.index, 'reasoning'); if (partial.block === undefined) partial.text += chunk.text; break }
      case 'tool-call-delta': { const partial = ensure(chunk.index, 'tool-call'); if (partial.block === undefined) partial.text += chunk.argumentsDelta; break }
      case 'block-end': { const partial = ensure(chunk.index, chunk.block?.type); if (partial.block === undefined) partial.block = chunk.block; break }
      case 'finish': finish = chunk.reason; break
      default: break // usage and unknown chunks carry no block content
    }
  }
  const blocks = order.map(index => {
    const partial = partials.get(index)
    return partial.block !== undefined ? partial.block : { type: partial.blockType, text: partial.text }
  })
  return { blocks, finish }
}

/** Concatenated text of one attempt's blocks, in block order (spec: 正文 = text blocks only). */
export function bodyText(blocks) {
  let text = ''
  for (const block of blocks) if (block?.type === 'text' && typeof block.text === 'string') text += block.text
  return text
}

/**
 * Resolve the agent's delegation depth the way the harness does; undefined when the
 * runtime option is present but malformed (report and skip instead of guessing).
 */
function resolveDepth(agent) {
  const header = agent?.session?.header?.delegationDepth ?? 0
  const runtime = agent?.options?.subagentDepth
  if (runtime === undefined) return Math.max(header, 0)
  if (!Number.isSafeInteger(runtime) || runtime < 0 || Object.is(runtime, -0)) return undefined
  return Math.max(header, runtime)
}

/**
 * Whether a step's claimed inbox messages carry human input: the user's own message, or the
 * host's answer to a question this session asked (dsh-user-questions steers that as a
 * user-role message with its own source kind). Injected notices and tool results are neither.
 */
function openedByUser(messages) {
  return Array.isArray(messages) && messages.some(message => isHumanInput(message))
}

/** Whether one message is human input rather than an injected notice or a tool result. */
function isHumanInput(message) {
  const kind = message?.source?.kind
  return kind === 'user' || kind === ANSWER_SOURCE_KIND
}

/** The text of the real user messages in one step, joined — the input the classifier reads. */
function userInputText(messages) {
  if (!Array.isArray(messages)) return ''
  let text = ''
  for (const message of messages) {
    if (!isHumanInput(message) || !Array.isArray(message.content)) continue
    for (const block of message.content) if (block?.type === 'text' && typeof block.text === 'string') text += block.text
    text += '\n'
  }
  return text.trim()
}

/**
 * Whether the agent holds a human input that the loop has not claimed yet (steering for the
 * nearest step). This is the host's own queue, read through its public inbox — the gate does
 * not timestamp messages or guess from their text.
 * @param agent - the agent whose inbox to read.
 */
export function pendingSteer(agent) {
  const queue = agent?.inbox?.nextStep
  if (!Array.isArray(queue)) return false
  return queue.some(message => isHumanInput(message))
}

/** Whether an assembled attempt would call a tool — an exemption never excuses that. */
export function callsATool(blocks) {
  return blocks.some(block => block?.type === 'tool-call')
}

/** Declared bounds, with the documented defaults for anything absent or unusable. */
function resolveLimits(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  const positive = (value, fallback) => (Number.isSafeInteger(value) && value > 0 ? value : fallback)
  const repairs = Number.isSafeInteger(raw.maxRepairs) && raw.maxRepairs >= 0 ? raw.maxRepairs : DEFAULT_LIMITS.maxRepairs
  return {
    maxBufferedChars: positive(raw.maxBufferedChars, DEFAULT_LIMITS.maxBufferedChars),
    maxBufferMs: positive(raw.maxBufferMs, DEFAULT_LIMITS.maxBufferMs),
    // Never above the spec's single automatic repair, whatever a config claims.
    maxRepairs: Math.min(repairs, DEFAULT_LIMITS.maxRepairs),
  }
}

/** Conservative character accounting: every model-authored string a buffered attempt holds. */
function chunkChars(chunk) {
  switch (chunk?.type) {
    case 'text-delta':
    case 'reasoning-delta': return typeof chunk.text === 'string' ? chunk.text.length : 0
    case 'tool-call-delta': return typeof chunk.argumentsDelta === 'string' ? chunk.argumentsDelta.length : 0
    case 'block-end': return typeof chunk.block?.text === 'string' ? chunk.block.text.length : (typeof chunk.block?.arguments === 'string' ? chunk.block.arguments.length : 0)
    default: return 0
  }
}

/**
 * Install the gate.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - { maxBufferedChars, maxBufferMs, maxRepairs }; absent or unusable values
 *   fall back to DEFAULT_LIMITS. The gate has no observe/enforce switch: it is the
 *   delivered behaviour, and check:preset plus the host acceptance assert it is in force.
 */
export function apply(ctx, config) {
  const limits = resolveLimits(config)
  const warn = message => ctx.logger?.warn('[' + name + '] ' + message)
  /** sessionId -> { turn, repairs, intake } for the user-opened request currently being answered. */
  const owed = new Map()
  /** sessionId -> { agent, session }: the managed agent seen at the last step boundary. */
  const bound = new Map()
  /** sessionId -> { reason, providerKind } for a rejection whose repair has been spent. */
  const awaitingRepair = new Map()
  /**
   * The gate's per-session state is DERIVED FROM THE FORMAL SESSION LOG, never from a private
   * side-channel (ticket 06, IG-B-14). Resume, reload and compaction replay the same events,
   * so the wait, the spent repair and the latest understanding survive them by construction
   * instead of being re-seeded from memory. The log is the only source: the assistant messages
   * the gate accepted (their first line is re-checked with the same mechanical rule), this
   * plugin's own correction notices (which is how a spent repair stays spent), the question
   * calls and their settles, and every turn's end reason.
   */
  const reportsPending = content => {
    if (!Array.isArray(content)) return false
    return content.some(block => block?.type === 'text' && typeof block.text === 'string' && /"pending"\s*:\s*true/u.test(block.text))
  }

  const emptyState = () => ({
    accepted: 0,
    lastOutcome: 'none',
    awaitingAnswer: false,
    questionCallId: undefined,
    repairsThisRequest: 0,
    trusted: true,
  })

  /** Fold one committed session event into the derived state. */
  const foldEvent = (state, event) => {
    const data = event?.data
    switch (event?.type) {
      case 'user/message': {
        if (isHumanInput(data)) {
          // A new request: its repair budget is its own. The wait is intentionally NOT cleared
          // here — the input that arrives while a question is open still owes a declaration
          // (ticket 04), and the pre-step clears the wait right after classifying it.
          state.repairsThisRequest = 0
          return
        }
        if (data?.source?.kind === name) {
          state.repairsThisRequest += 1
          if (!Array.isArray(data?.content)) state.trusted = false
        }
        return
      }
      case 'assistant/message': {
        const message = data?.message
        if (!Array.isArray(message?.content)) {
          state.trusted = false
          return
        }
        if (checkDeclaration(bodyText(message.content)).ok) state.accepted += 1
        return
      }
      case 'tool/call': {
        if (data?.name !== QUESTION_TOOL) return
        if (typeof data.callId !== 'string') state.trusted = false
        state.awaitingAnswer = true
        state.questionCallId = data.callId
        return
      }
      case 'tool/ptc-dispatch-start': {
        if (data?.name !== QUESTION_TOOL) return
        state.awaitingAnswer = true
        state.questionCallId = data.subCallId
        return
      }
      case 'tool/result': {
        if (data?.name !== QUESTION_TOOL) return
        state.awaitingAnswer = false
        state.questionCallId = undefined
        return
      }
      case 'tool/ptc-dispatch': {
        if (data?.name !== QUESTION_TOOL) return
        const pending = reportsPending(data.content)
        state.awaitingAnswer = pending
        if (!pending) state.questionCallId = undefined
        return
      }
      case 'turn/end': {
        const kind = data?.reason?.kind
        if (typeof kind !== 'string') {
          state.trusted = false
          return
        }
        if (kind === 'completed') state.lastOutcome = 'accepted'
        else if (kind === 'error') state.lastOutcome = state.repairsThisRequest > 0 ? 'exhausted' : 'failed'
        else state.lastOutcome = 'failed'
        return
      }
      default: return
    }
  }

  /** Derived state cache: everything up to seq is already folded into state. */
  const derived = new WeakMap()

  /**
   * Read (and incrementally extend) this session's derived state from its own log. A session
   * whose record cannot be read is UNTRUSTED: nothing may be guessed about a request whose
   * record is unavailable, corrupt or unreadable (IG-B-14).
   */
  const stateOf = session => {
    if (session === undefined || typeof session.snapshotEvents !== 'function') {
      const unreadable = emptyState()
      unreadable.trusted = false
      return unreadable
    }
    const cached = derived.get(session)
    const state = cached === undefined ? emptyState() : cached.state
    const from = cached === undefined ? 0 : cached.seq + 1
    let lastSeq = cached === undefined ? -1 : cached.seq
    try {
      for (const event of session.snapshotEvents(from)) {
        foldEvent(state, event)
        if (typeof event?.seq === 'number') lastSeq = event.seq
      }
    } catch (error) {
      warn('could not read the session log: ' + String(error))
      state.trusted = false
    }
    derived.set(session, { seq: lastSeq, state })
    return state
  }

  /**
   * Sessions whose untrusted record already forced one stop. The report happens once per
   * session per process: the user is told, that request stops, and the next request starts from
   * the conservative defaults instead of being blocked forever by a record it cannot repair.
   */
  const reportedUntrusted = new WeakSet()

  /**
   * Drop what was derived from an untrusted record and continue from the conservative
   * defaults: the corrupt region is not re-read, so the user's next input is handled by the
   * normal entry points instead of being blocked by a record that cannot be repaired.
   */
  const resetDerived = session => {
    try {
      const events = session.snapshotEvents()
      const last = events.length === 0 ? -1 : events[events.length - 1]?.seq
      derived.set(session, { seq: typeof last === 'number' ? last : -1, state: emptyState() })
    } catch (error) {
      warn('could not reset the derived state: ' + String(error))
      derived.delete(session)
    }
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    let decision
    try {
      decision = await next()
    } catch (error) {
      warn('downstream agent/pre-step failed: ' + String(error))
      throw error
    }
    try {
      if (decision?.kind !== 'enter') return decision
      const sessionId = payload?.agent?.session?.id
      if (sessionId === undefined) return decision
      const depth = resolveDepth(payload.agent)
      if (depth === undefined) {
        warn('agent.options.subagentDepth is malformed; skipping instead of guessing the depth')
        return decision
      }
      if (depth !== 0) return decision
      bound.set(sessionId, { agent: payload.agent, session: payload.agent.session })
      if (openedByUser(payload.messages)) {
        // A new real user input opens a new request: its budget is its own, and any
        // half-finished repair state belongs to the request that ended.
        const state = stateOf(payload.agent.session)
        // The user spoke (an answer to the question, or a new request): the wait is over.
        // The ANSWER itself still owes a declaration — classifyInput returns 'owes' for any
        // input while the question was open, including the host's user-question-reply kind.
        owed.set(sessionId, {
          turn: payload.turn,
          agent: payload.agent,
          repairs: 0,
          intake: classifyInput(userInputText(payload.messages), state),
          answeredQuestion: state.awaitingAnswer === true,
        })
        // The user spoke (an answer, or a new independent request): the wait is over for the
        // steps that follow THIS input. The input itself was classified above while the wait
        // was still open, which is what makes an answer owe a declaration.
        state.awaitingAnswer = false
        state.questionCallId = undefined
        awaitingRepair.delete(sessionId)
      } else {
        // A machine-opened step (tool result, notice, steering re-attach) is the same
        // request continuing: the first reply already happened, so nothing is owed.
        owed.delete(sessionId)
      }
      return decision
    } catch (error) {
      warn('could not record the intent-declaration obligation: ' + String(error))
      return decision
    }
  })

  ctx.on('llm/stream', (options, next) => gateStream(options, next))

  /**
   * An already-running program reaches the gate at each inner dispatch. When the user has
   * steered since it started, the next call is refused: what already ran stays run, what has
   * not run does not start, and the model re-judges under the new input (IG-B-08). Scoped to
   * the managed main agent like everything else (IG-B-13).
   */
  ctx.on('tools/pre-execute', async (exec, next) => {
    let decision
    try {
      decision = await next()
    } catch (error) {
      warn('downstream tools/pre-execute failed: ' + String(error))
      throw error
    }
    try {
      if (decision?.kind !== 'allow') return decision
      const agent = exec?.agent
      if (agent === undefined || resolveDepth(agent) !== 0) return decision
      if (!pendingSteer(agent)) return decision
      return {
        kind: 'deny',
        reason: '[intent-gate] 用户在你运行这个程序期间追加了要求，这个调用没有执行（已经执行的部分保留）；先按新要求重新判断并更新意图声明，再继续。',
      }
    } catch (error) {
      warn('could not check for a steering input before dispatch: ' + String(error))
      return decision
    }
  })

  /**
   * The repair hook. A rejection we raised is retried exactly once: the correction notice
   * is appended to the session log first (so the retried request — rebuilt from that log —
   * carries it), then we claim the retry. Every other failure, including our own exhausted
   * stop and any real provider failure, is delegated untouched (IG-B-10).
   */
  ctx.on('agent/request-error', async (payload, next) => {
    let awaiting
    try {
      const sessionId = payload?.agent?.session?.id
      awaiting = sessionId === undefined ? undefined : awaitingRepair.get(sessionId)
      const code = payload?.failure?.code
      // One failure, one repair: this must be the exact rejection that spent the budget.
      // Anything else — an exhausted stop, a real provider failure, another plugin's retry
      // of the same attempt — is delegated unchanged, so a generic retry policy can never
      // turn one declaration miss into two repairs (IG-B-06/IG-B-10).
      if (awaiting === undefined || code !== FAILURE_CODE[awaiting.reason] || payload?.signal?.aborted === true) {
        awaiting = undefined
        return await next()
      }
      const session = payload.agent.session
      const notice = pluginMessage(
        repairNotice(awaiting.reason, awaiting.providerKind),
        'intent gate: declaration repair 1/1 (' + String(awaiting.reason) + ')',
      )
      session.append('user/message', notice, { surfaceOp: 'append' })
      awaitingRepair.delete(sessionId)
      return { kind: 'retry' }
    } catch (error) {
      warn('could not issue the intent-declaration repair: ' + String(error))
      if (awaiting !== undefined) awaitingRepair.delete(payload?.agent?.session?.id)
      return await next()
    }
  })

  /**
   * Buffer one attempt, judge it, then replay it, repair it, or end it as a policy failure.
   * @param options - the request envelope observed at the waterfall.
   * @param next - resolves the adapter stream (may itself be another listener's).
   */
  async function* gateStream(options, next) {
    const sessionId = options?.sessionId
    // A conversation request owns a declaration; an auxiliary model call does not
    // (IG-B-13). Two fields identify the auxiliary case without importing host packages:
    // the loop stamps 'purpose' on compaction/session-title calls, and a hand-built
    // one-shot passes 'system' text, which the loop never does.
    if (options?.purpose !== undefined || options?.system !== undefined) {
      yield* next()
      return
    }
    const binding = sessionId === undefined ? undefined : bound.get(sessionId)
    const record = sessionId === undefined ? undefined : owed.get(sessionId)
    const state = stateOf(binding?.session)
    const awaiting = state.awaitingAnswer === true
    // No declaration is owed outside a user-opened request — but an OPEN QUESTION still
    // forbids acting in the same request's later steps, so those attempts are inspected too
    // (ticket 04). Everything else passes straight through.
    if (record === undefined && !awaiting) {
      yield* next()
      return
    }

    const buffered = []
    let chars = 0
    let overChars = false
    let overTime = false
    const startedAt = performance.now()
    try {
      for await (const chunk of next()) {
        buffered.push(chunk)
        chars += chunkChars(chunk)
        if (chars > limits.maxBufferedChars) overChars = true
        if (performance.now() - startedAt > limits.maxBufferMs) overTime = true
        if (chunk?.type === 'finish') break
      }
    } catch (error) {
      // A real transport/provider failure keeps its own meaning; only the cost already
      // reported upstream is passed on so the failed attempt does not look free.
      for (const chunk of buffered) if (chunk?.type === 'usage') yield chunk
      throw error
    }

    const { blocks, finish } = assembleAttempt(buffered)
    const providerKind = finish?.kind
    const judgeable = providerKind === 'stop' || providerKind === 'tool-calls'
    // Order matters: a provider terminal outcome that is not a plain success (aborted,
    // error, max-tokens) is replayed untouched and is never relabelled as a declaration
    // problem or as one of our caps (IG-B-10). It also means this request did not complete,
    // so a later bare "继续" is a new request rather than a continuation (IG-B-06).
    if (!judgeable) {
      for (const chunk of buffered) yield chunk
        return
    }
    // Ticket 06 (IG-B-14): a record that cannot be rebuilt is never silently passed through.
    // The request is stopped once, with the reason, and the session then continues from the
    // conservative defaults so the user can restate what they want.
    const session = binding?.session
    if (record !== undefined && !state.trusted && session !== undefined && !reportedUntrusted.has(session)) {
      reportedUntrusted.add(session)
      resetDerived(session)
      for (const chunk of buffered) if (chunk?.type === 'usage') yield chunk
      yield { type: 'finish', reason: { kind: 'error', failure: { message: stopMessage(REASON.STATE_UNTRUSTED), code: FAILURE_CODE[REASON.STATE_UNTRUSTED] } } }
      return
    }

    // Ticket 05: a human input arrived while this reply was being generated, so anything it
    // would DO was composed without it. Pausing the call is the point; the loop then consumes
    // that input at the next step and the request re-declares under it.
    if (record !== undefined && callsATool(blocks) && pendingSteer(binding?.agent)) {
      // Withhold the calls, keep the words: the loop then finishes this reply without
      // dispatching anything, the parked steering is claimed at the next turn, and the
      // request re-declares there under the new requirement. Ending the turn as an ERROR
      // here would leave the steering parked with nothing to claim it, which is the one
      // outcome that loses the correction entirely.
        for (const chunk of buffered) {
        if (chunk?.type === 'tool-call-delta') continue
        if (chunk?.type === 'block-start' && chunk.blockType === 'tool-call') continue
        if (chunk?.type === 'block-end' && chunk.block?.type === 'tool-call') continue
        if (chunk?.type === 'finish') continue
        yield chunk
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }

    // Ticket 04: a question this session already asked is still open, so this reply may not
    // act on it — "silence is not consent" (IG-B-16). Asking again, or answering in prose, is
    // fine; calling a tool is not, and this is not a wording problem to repair: the request
    // stays paused until the user answers.
    if (awaiting && callsATool(blocks)) {
      for (const chunk of buffered) if (chunk?.type === 'usage') yield chunk
        yield { type: 'finish', reason: { kind: 'error', failure: { message: stopMessage(REASON.AWAITING_ANSWER), code: FAILURE_CODE[REASON.AWAITING_ANSWER] } } }
      return
    }
    if (record === undefined) {
      // An un-latched attempt while a question is open: nothing else to judge.
      for (const chunk of buffered) yield chunk
      return
    }
    const reason = overChars ? REASON.LIMIT_CHARS
      : overTime ? REASON.LIMIT_TIME
        : declarationReason(blocks)
    if (reason === undefined) {
      for (const chunk of buffered) yield chunk
        return
    }

    // Ticket 03: the two conversational incomes owe no line. The exemption is bounded on
    // purpose — it never covers a mechanism stop (a cap is not a conversational reply) and
    // never covers a reply that would call a tool, so no action can ride an exemption
    // (IG-B-09). A reply with no text at all is still a miss: there is nothing to accept.
    const exempt = record.intake !== 'owes' && DECLARATION_MISSES.has(reason) && !callsATool(blocks) && bodyText(blocks).trim() !== ''
    if (exempt) {
      for (const chunk of buffered) yield chunk
        return
    }

    // Rejection: the spent generation stays traceable (usage), nothing else escapes.
    for (const chunk of buffered) if (chunk?.type === 'usage') yield chunk
    const repairable = DECLARATION_MISSES.has(reason) && record.repairs < limits.maxRepairs
    if (repairable) {
      // Spend the one repair now: the budget is consumed by the DECISION, so a provider
      // failure during the repair attempt cannot hand out a second one (IG-B-06).
      record.repairs += 1
      if (sessionId !== undefined) awaitingRepair.set(sessionId, { reason, providerKind })
    } else if (DECLARATION_MISSES.has(reason)) {
      // Budget exhausted: this is the stop the spec asks to be explicit about.
        yield { type: 'finish', reason: { kind: 'error', failure: { message: stopMessage(reason, { repaired: true }), code: REPAIR_EXHAUSTED_CODE } } }
      return
    }
    yield {
      type: 'finish',
      reason: { kind: 'error', failure: { message: stopMessage(reason, { repaired: false }), code: FAILURE_CODE[reason] } },
    }
  }

  /** The declaration verdict for one assembled attempt, or undefined when it passes. */
  function declarationReason(blocks) {
    let verdict
    try {
      verdict = checkDeclaration(bodyText(blocks))
    } catch (error) {
      warn('could not evaluate the intent declaration: ' + String(error))
      return REASON.GATE_ERROR
    }
    return verdict.ok ? undefined : verdict.reason
  }
}
