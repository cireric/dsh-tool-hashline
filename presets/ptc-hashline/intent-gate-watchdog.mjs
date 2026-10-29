/**
 * Live policy: Intent and the six buckets are persona conventions, not stream validation.
 * Only tool dispatch is guarded: unanswered questions, same-program actions after an
 * answer, and unconsumed user steering. No buffering, failure injection or auto followup.
 * Public declaration/accounting helpers below remain for historical artifact readers.
 */
export const name = 'intent-gate-watchdog'

/**
 * Declared bounds (mirrored in preset.patch.yml and asserted by check-preset).
 * maxBufferedChars counts the model-authored characters held in memory for one attempt
 * (text and tool-call argument deltas, which is where the bytes are); maxBufferMs bounds
 * how long one attempt may stay buffered before it is judged; maxRepairs is the spec's
 * fixed "at most one automatic repair per user-opened request" (IG-B-06) — it is declared
 * here so a future edit cannot quietly widen it, not offered as a tuning knob.
 * maxDeclarationChars bounds the BODY of the declaration-only repair request. It is a
 * statement about the declaration, not about provider generation: the repair keeps the
 * route's own output-token limit, so a truncated attempt is still reported as the
 * provider's truncation and never as a badly shaped declaration (2026-10-28 plan, R07).
 */
export const DEFAULT_LIMITS = Object.freeze({ maxBufferedChars: 262144, maxBufferMs: 120000, maxRepairs: 1, maxDeclarationChars: 2000 })

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
  // While a question of the CURRENT request is open nothing is a bare acknowledgement: the
  // words may be an option label, and silence already means nothing (IG-B-16). The answer
  // itself owes a declaration.
  if (awaitingAnswer(state)) return 'owes'
  if (ACKNOWLEDGEMENTS.includes(normalized)) return 'acknowledge'
  if (CONTINUATIONS.includes(normalized)) {
    // "承接已有理解" needs an understanding to carry, and a request that ENDED in a stop
    // hands the user a new request, not a continuation (IG-B-06's exhausted-retry exception).
    return state !== undefined && state.accepted > 0 && state.lastOutcome === 'accepted' ? 'continue' : 'owes'
  }
  return 'owes'
}

/**
 * Whether the request the session is currently in holds an unanswered question, i.e. whether
 * a reply of this request may not act. The wait is per QUESTION and per REQUEST, never a
 * session-wide boolean: an independent request opened later must proceed while the older
 * question stays on the record (IG-B-16/FIX-07), and a question asked by an older request
 * must not be cleared by anything but that question's own settlement.
 * @param state - this session's derived record.
 */
export function awaitingAnswer(state) {
  if (state === undefined || state === null) return false
  if (Array.isArray(state.openQuestions)) return state.openQuestions.some(question => question.request === state.request)
  // A record rebuilt by an older build carries the single session-wide flag; read it so a
  // resumed session is still blocked instead of silently unlocking.
  return state.awaitingAnswer === true
}

/**
 * Whether one input is one of the two bare conversational forms, independent of any waiting
 * state. A bare form never opens a new request: if it arrives while this request's question
 * is open it keeps that question and stays blocked (FIX-05).
 * @param text - the raw text of one real user input.
 */
export function isBareConversational(text) {
  const normalized = normalizeInput(text)
  return ACKNOWLEDGEMENTS.includes(normalized) || CONTINUATIONS.includes(normalized)
}

/**
 * The accounting phases ONE user request can pass through (2026-10-28 plan P4). They are the
 * stages whose cost and outcome must stay separable: the attempt(s) the gate judged first, the
 * single declaration-only repair, and the business step the accepted declaration unlocked.
 */
export const ACCOUNTING_PHASE = Object.freeze({
  FIRST: 'first',
  DECLARATION: 'declaration',
  BUSINESS: 'business',
})

/** One stage's ledger: attempts, publications and the provider's own accounting. */
const emptyStage = () => ({ attempts: 0, published: 0, inputTokens: 0, outputTokens: 0, usageUnknown: 0 })

/**
 * Rebuild the per-request accounting from the SAME formal session log the gate derives its
 * state from — not a second private fact source (IG-B-14/18, P4). It answers, per request:
 * which stages produced an attempt, what each stage cost (unknown stays counted as unknown,
 * never as zero), how many repairs were actually spent, which questions were asked and whether
 * their own answer settled them, and how each turn ended.
 *
 * What it deliberately does NOT do: judge the business result, merge stages together, or
 * invent a total for a stage whose adapter reported nothing.
 * @param events - durable session events, in log order.
 */
export function requestAccounting(events) {
  const requests = []
  let current
  const open = () => {
    current = { index: requests.length + 1, accepted: 0, repairs: 0, questions: [], outcomes: [], stages: { first: emptyStage(), declaration: emptyStage(), business: emptyStage() } }
    requests.push(current)
    return current
  }
  /** The request an event belongs to; created on demand so a log never starts with a blank row. */
  const ensure = () => (current === undefined ? open() : current)
  const settleQuestionIn = (identity) => {
    const question = current.questions.find(item =>
      (identity.callId !== undefined && item.callId === identity.callId)
      || (identity.subCallId !== undefined && item.subCallId === identity.subCallId))
    if (question !== undefined) question.settled = true
  }
  for (const event of Array.isArray(events) ? events : []) {
    const data = event?.data
    if (event?.type === 'user/message' && isHumanInput(data) && data?.source?.kind !== ANSWER_SOURCE_KIND && !isBareConversational(noticeText(data))) {
      // A substantive human input is a request of its own, with its own budget.
      open()
      continue
    }
    ensure()
    switch (event?.type) {
      case 'user/message': {
        if (!isHumanInput(data)) {
          if (data?.source?.kind === name && Array.isArray(data?.content)) {
            const text = noticeText(data)
            if (text.startsWith(REPAIR_NOTICE_PREFIX)) {
              current.repairs += 1
              current.phase = ACCOUNTING_PHASE.DECLARATION
            } else if (text.startsWith(CONTINUATION_NOTICE_PREFIX)) {
              current.phase = ACCOUNTING_PHASE.BUSINESS
            }
          }
          break
        }
        const source = data?.source
        if (source?.kind === ANSWER_SOURCE_KIND && typeof source.callId === 'string') {
          settleQuestionIn({ callId: source.callId })
          break
        }
        break
      }
      case 'assistant/attempt':
      case 'assistant/message': {
        const stage = current.stages[current.phase ?? ACCOUNTING_PHASE.FIRST]
        stage.attempts += 1
        if (event.type === 'assistant/message') stage.published += 1
        const usage = data?.usage
        if (usage === null || typeof usage !== 'object' || typeof usage.inputTokens !== 'number' || typeof usage.outputTokens !== 'number') {
          stage.usageUnknown += 1
        } else {
          stage.inputTokens += usage.inputTokens
          stage.outputTokens += usage.outputTokens
        }
        if (event.type === 'assistant/message' && checkDeclaration(bodyText(data?.message?.content ?? [])).ok) current.accepted += 1
        break
      }
      case 'tool/call': {
        if (data?.name !== QUESTION_TOOL) break
        if (typeof data.callId !== 'string') break
        current.questions.push({ callId: data.callId, settled: false })
        break
      }
      case 'tool/ptc-dispatch-start': {
        if (data?.name !== QUESTION_TOOL || typeof data.subCallId !== 'string') break
        current.questions.push({ subCallId: data.subCallId, settled: false })
        break
      }
      case 'tool/result': {
        const callId = data?.message?.toolCallId
        if (typeof callId === 'string') settleQuestionIn({ callId })
        break
      }
      case 'tool/ptc-dispatch': {
        if (data?.name !== QUESTION_TOOL) break
        if (!reportsPending(data?.content)) settleQuestionIn({ subCallId: data?.subCallId })
        break
      }
      case 'turn/end': {
        const kind = data?.reason?.kind
        current.outcomes.push(typeof kind === 'string' ? kind : 'unknown')
        break
      }
      default: break
    }
  }
  const totals = { requests: requests.length, repairs: 0, attempts: 0, inputTokens: 0, outputTokens: 0, usageUnknown: 0, unsettledQuestions: 0, failedTurns: 0 }
  for (const request of requests) {
    totals.repairs += request.repairs
    totals.unsettledQuestions += request.questions.filter(question => question.settled !== true).length
    totals.failedTurns += request.outcomes.filter(kind => kind !== 'completed').length
    for (const stage of Object.values(request.stages)) {
      totals.attempts += stage.attempts
      totals.inputTokens += stage.inputTokens
      totals.outputTokens += stage.outputTokens
      totals.usageUnknown += stage.usageUnknown
    }
  }
  return { requests, totals }
}

/** A one-line, log-safe account of the ledger (no bodies, no arguments). */
export function summarizeAccounting(accounting) {
  const stage = (request, phase) => {
    const value = request.stages[phase]
    return phase + ':attempts=' + String(value.attempts) + ',published=' + String(value.published) + ',unknown=' + String(value.usageUnknown)
  }
  const lines = accounting.requests.map(request => [
    'request=' + String(request.index),
    'repairs=' + String(request.repairs),
    'accepted=' + String(request.accepted),
    'questions=' + String(request.questions.length) + '(unsettled=' + String(request.questions.filter(question => question.settled !== true).length) + ')',
    stage(request, ACCOUNTING_PHASE.FIRST),
    stage(request, ACCOUNTING_PHASE.DECLARATION),
    stage(request, ACCOUNTING_PHASE.BUSINESS),
    'turns=' + request.outcomes.join('|'),
  ].join(' '))
  lines.push('totals attempts=' + String(accounting.totals.attempts) + ' repairs=' + String(accounting.totals.repairs) + ' inputTokens=' + String(accounting.totals.inputTokens) + ' outputTokens=' + String(accounting.totals.outputTokens) + ' usageUnknown=' + String(accounting.totals.usageUnknown))
  return lines.join('\n')
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
  /** The declaration-only request emitted a tool call although no tool was offered. */
  TOOLS_IN_DECLARATION: 'tools-in-declaration',
  /** The declaration-only request's body is longer than the declared body cap. */
  DECLARATION_LONG: 'declaration-too-long',
})

/**
 * The three declaration misses: reasons a rewrite can fix and a conversational input may be
 * excused for (ticket 03). Ticket 04's awaiting-answer stop is deliberately NOT here — it is
 * a terminal "the request is paused until you answer", not a wording problem to repair.
 */
const DECLARATION_MISSES = new Set([REASON.NO_TEXT, REASON.MISSING, REASON.EMPTY_BODY])

/**
 * The declaration-only phase's verdicts that end the request as a PROTOCOL PAUSE: the single
 * repair is spent, no usable declaration was produced, and nothing ran (2026-10-28 plan
 * requirement 7). They are never repairable, so they never ask for a third generation, and
 * they all share ONE code — a pause, not a second failure kind. Everything outside this set
 * (a cap this gate enforced, or this gate failing to check at all) keeps its own mechanism
 * code so a real limit or an internal error never reads as "the model declared badly"
 * (IG-B-10/15).
 */
const DECLARATION_PAUSES = new Set([...DECLARATION_MISSES, REASON.TOOLS_IN_DECLARATION, REASON.DECLARATION_LONG])

const REASON_TEXT = {
  [REASON.NO_TEXT]: '没有可计入正文的非空文本（reasoning 和工具参数都不算正文）',
  [REASON.MISSING]: '首行没有以字面标记 "Intent:" 开头',
  [REASON.EMPTY_BODY]: '"Intent:" 之后只有空白，没有说明目标与下一步的正文',
  [REASON.LIMIT_CHARS]: '本条回复超过本机制暂存上限（字符），已按上限停止而不是放行未经检查的正文',
  [REASON.LIMIT_TIME]: '本条回复的整段生成超过本机制暂存等待上限（毫秒），已按上限停止而不是放行未经检查的正文',
  [REASON.GATE_ERROR]: '本机制无法完成这次机械检查（内部错误），已停止而不是放行未经检查的正文',
  [REASON.AWAITING_ANSWER]: '本会话已经向你提问、而你还没有得到回答，这次回复却要动手；问题待答期间不执行任何工具',
  [REASON.STALE_ACTION]: '用户在你生成这条回复期间又追加了要求，这条回复里的调用是在那之前形成的；未执行的调用已停下，已执行的动作保留',
  [REASON.STATE_UNTRUSTED]: '本会话的意图门记录缺失、损坏或无法关联，无法可信重建已确认的理解与待答状态；按保守状态暂停这一次请求，请重新说明你的要求',
  [REASON.TOOLS_IN_DECLARATION]: '声明专用阶段不提供任何工具，这条回复却仍然带着工具调用',
  [REASON.DECLARATION_LONG]: '声明专用阶段的正文超过了约定的字符上限',
}

/** The same reasons in the model's language, for the correction notice. */
const REASON_TEXT_FOR_MODEL = {
  [REASON.NO_TEXT]: 'the reply carried no text at all (only a tool call), so it declared nothing',
  [REASON.MISSING]: 'the first line of the reply did not start with the literal marker Intent:',
  [REASON.EMPTY_BODY]: 'the first line started with Intent: but carried no text after it',
  [REASON.AWAITING_ANSWER]: 'the reply wanted to call a tool while your own question to the user is still unanswered',
  [REASON.TOOLS_IN_DECLARATION]: 'the reply carried a tool call, but the declaration repair offers no tools at all',
  [REASON.DECLARATION_LONG]: 'the reply was longer than the declaration body cap',
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
 * The first line of every notice this plugin writes. The repair and the continuation are
 * two DIFFERENT messages from the same producer, and the derived state must count only the
 * repair as a spent budget (2026-10-28 plan §3): one notice per phase would otherwise spend
 * a repair every time the gate speaks. The prefix is content, not a schema field, so logs
 * written before this change keep counting exactly as they did.
 */
export const REPAIR_NOTICE_PREFIX = '[intent-gate] Your previous reply for this request was withheld'
export const CONTINUATION_NOTICE_PREFIX = '[intent-gate] Your declaration for this request was accepted'

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
 * What the user reads when the first reply of the request failed the shape check and the
 * declaration repair is being started. It is NOT a stop: the request continues in the
 * declaration-only step, so the copy must not claim the repair was used up.
 * @param reason - why the attempt was withheld.
 * @param extras - { providerKind }: the withheld attempt's provider terminal kind.
 */
export function repairStartedMessage(reason, extras = {}) {
  return [
    '[intent-gate] 这条回复没有通过声明检查：' + REASON_TEXT[reason] + '。',
    '正文没有展示，这条回复里的工具调用一个也没有执行（provider 正常生成完成，是意图门的策略拒绝，不是网络或模型故障）。',
    '正在自动重新生成声明：这是本次请求唯一一次自动修复（1/1），下一条回复只写 ' + 'Intent:' + ' 开头的声明、不提供工具；声明合格后同一请求的工作会自动继续，你不需要再发一次请求。',
    extras.providerKind === undefined ? '' : '（provider 的原始终态是 ' + String(extras.providerKind) + '，没有被改写成声明问题）',
  ].filter(line => line !== '').join('\n')
}

/**
 * What the user reads when the declaration-only repair did not produce a usable
 * declaration: a PROTOCOL PAUSE, not a business failure and not a provider failure. The
 * budget stays spent and no third generation is attempted (2026-10-28 plan requirement 7).
 * @param reason - the declaration-phase verdict.
 * @param extras - { providerKind, maxChars }.
 */
export function declarationStopMessage(reason, extras = {}) {
  const detail = reason === REASON.DECLARATION_LONG && extras.maxChars !== undefined
    ? REASON_TEXT[reason] + '（' + String(extras.maxChars) + ' 字符）'
    : REASON_TEXT[reason]
  return [
    '[intent-gate] 意图声明未能生成，工作尚未执行：' + detail + '。',
    '声明专用阶段没有展示任何正文、没有执行任何工具（provider 正常生成完成，是意图门的策略拒绝，不是网络或模型故障）。',
    '本次请求的唯一一次自动修复已经用掉，不会再有第三次自动生成；你重新发一次请求即是一次新的声明机会。',
    extras.providerKind === undefined ? '' : '（provider 的原始终态是 ' + String(extras.providerKind) + '，没有被改写成声明问题）',
  ].filter(line => line !== '').join('\n')
}

/**
 * The continuation notice: written for the MODEL, queued for the next step of the SAME
 * request once the declaration has been accepted and published. It grants nothing — the
 * declaration is on the record, and the work it names is the work the user asked for.
 */
export function continuationNotice() {
  return [
    CONTINUATION_NOTICE_PREFIX + ' and published. Continue the same request.',
    'Do not repeat or restate the Intent: line — it is already in the record. Do the work you declared, starting with the next step you named, and use your tools normally.',
    'The user request, its constraints and its scope are unchanged, and nothing new is authorized: this notice is not the user speaking. If the work needs a choice only the user can make, stop and ask through tools.ask_user_question instead of guessing.',
  ].join('\n')
}

/**
 * One structured diagnostic per judged attempt. It carries only identities, counts, the
 * failure class and the effective caps: never the rejected body, the reasoning text or the
 * tool arguments (2026-10-28 plan, P2), and it is never presented as an accepted answer.
 * @param attempt - { sessionId, stage, reason, providerKind, blocks, usage, repairs,
 *   elapsedMs, limits }.
 */
export function attemptDiagnostic(attempt) {
  const blocks = Array.isArray(attempt?.blocks) ? attempt.blocks : []
  const countOf = type => blocks.filter(block => block?.type === type).length
  const body = bodyText(blocks)
  const limits = attempt?.limits ?? DEFAULT_LIMITS
  return {
    kind: 'intent-gate-diagnostic',
    stage: attempt?.stage ?? 'unknown',
    reason: attempt?.reason ?? 'accepted',
    providerKind: attempt?.providerKind ?? null,
    sessionId: attempt?.sessionId ?? null,
    blocks: blocks.length,
    textBlocks: countOf('text'),
    reasoningBlocks: countOf('reasoning'),
    toolCallBlocks: countOf('tool-call'),
    bodyEmpty: body.trim() === '',
    bodyChars: body.length,
    repairs: attempt?.repairs ?? 0,
    usage: attempt?.usage ?? null,
    elapsedMs: attempt?.elapsedMs ?? null,
    limits: {
      maxBufferedChars: limits.maxBufferedChars,
      maxBufferMs: limits.maxBufferMs,
      maxRepairs: limits.maxRepairs,
      maxDeclarationChars: limits.maxDeclarationChars,
    },
  }
}

/**
 * The correction notice: the repair's instruction, written for the MODEL, appended to the
 * session log as its own message so the regenerated request can be rebuilt from the
 * official record (IG-B-07). It restates the constraint boundary on purpose — a repair is
 * not user approval and grants no new scope.
 * @param reason - why the previous attempt was rejected.
 * @param providerKind - the rejected attempt's provider terminal kind.
 * @param repair - 1-based index of this repair.
 * @param maxChars - the declaration body cap this repair is held to.
 */
export function repairNotice(reason, providerKind, repair = 1, maxChars = DEFAULT_LIMITS.maxDeclarationChars) {
  return [
    REPAIR_NOTICE_PREFIX + ': ' + (REASON_TEXT_FOR_MODEL[reason] ?? String(reason)) + '.',
    'Nothing from it was shown to the user and none of its tool calls were executed; the provider had finished normally (' + String(providerKind) + '), so this is a policy rejection, not a network or model failure.',
    'This is the ONE automatic declaration repair for this request (' + String(repair) + '/' + String(DEFAULT_LIMITS.maxRepairs) + '), and it is a DECLARATION-ONLY reply: no tool is offered, so you cannot act in it and must not try to.',
    'Output one thing only: a first line starting with the literal marker Intent: (copy it verbatim, do not translate it), followed on that same line by, in plain language, what the user will get and what you will do next — at most ' + String(maxChars) + ' characters of body in total.',
    'Do not deliver the answer here, do not write a program or code, do not echo the user\'s own words back, and do not describe internal bookkeeping. Once the line is accepted the request continues automatically in a new step where your tools are available again — do not restate the declaration there.',
    'The user request, its constraints and its scope are unchanged. This notice is not the user speaking: it adds no goal, grants no new authority and is not approval of anything. Write the whole reply again in that shape — the withheld text is not carried over.',
  ].join('\n')
}

/**
 * A session user message produced by THIS plugin: the shape createUserMessage builds
 * (fresh id, role user, text content, producer-owned source), deep-frozen like the
 * harness's own messages. 'kind' is this producer's own name — session format v4 refuses
 * a shared catch-all kind.
 */
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
/** Whether one message is human input rather than an injected notice or a tool result. */
function isHumanInput(message) {
  const kind = message?.source?.kind
  return kind === 'user' || kind === ANSWER_SOURCE_KIND
}

/** The text of the real user messages in one step, joined — the input the classifier reads. */
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

/** The text a message carries, joined in block order (empty when it carries none). */
function noticeText(message) {
  if (!Array.isArray(message?.content)) return ''
  let text = ''
  for (const block of message.content) if (block?.type === 'text' && typeof block.text === 'string') text += block.text
  return text
}

/** Whether an assembled attempt would call a tool — an exemption never excuses that. */
export function callsATool(blocks) {
  return blocks.some(block => block?.type === 'tool-call')
}

/** Declared bounds, with the documented defaults for anything absent or unusable. */
/** Install only execution guards; never inspect or rewrite the model's reply. */
export function apply(ctx) {
  const warn = message => ctx.logger?.warn('[' + name + '] ' + message)
  // Derive only question state from durable events so reloads cannot unlock pending work.
  const stateOf = session => {
    const state = { request: 0, openQuestions: [], answeredInProgram: [], trusted: true }
    const settle = identity => {
      const index = state.openQuestions.findIndex(question =>
        (identity.callId !== undefined && question.callId === identity.callId)
        || (identity.subCallId !== undefined && question.subCallId === identity.subCallId))
      if (index < 0) return false
      state.openQuestions.splice(index, 1)
      return true
    }
    try {
      if (typeof session?.snapshotEvents !== 'function') throw new Error('session log unavailable')
      for (const event of session.snapshotEvents()) {
        const data = event?.data
        if (event.type === 'user/message' && isHumanInput(data)) {
          if (data.source.kind === ANSWER_SOURCE_KIND) {
            if (typeof data.source.callId === 'string') settle({ callId: data.source.callId })
          } else if (!isBareConversational(noticeText(data))) state.request += 1
        } else if (event.type === 'tool/call' && data?.name === QUESTION_TOOL) {
          if (typeof data.callId !== 'string') throw new Error('question callId unavailable')
          state.openQuestions.push({ callId: data.callId, request: state.request })
        } else if (event.type === 'tool/ptc-dispatch-start' && data?.name === QUESTION_TOOL) {
          if (typeof data.subCallId !== 'string') throw new Error('question subCallId unavailable')
          state.openQuestions.push({ subCallId: data.subCallId, request: state.request })
        } else if (event.type === 'tool/result') {
          settle({ callId: data?.message?.toolCallId })
        } else if (event.type === 'tool/ptc-dispatch' && data?.name === QUESTION_TOOL) {
          const pending = data.content?.some(block => block?.type === 'text' && /"pending"\s*:\s*true/u.test(block.text))
          if (pending) continue
          const settled = settle({ subCallId: data.subCallId })
          const root = data.rootCallId ?? data.parentCallId
          if (settled && typeof root === 'string' && !state.answeredInProgram.includes(root)) {
            state.answeredInProgram.push(root)
            if (state.answeredInProgram.length > 64) state.answeredInProgram.shift()
          }
        }
      }
    } catch (error) {
      warn('could not read question state: ' + String(error))
      state.trusted = false
    }
    return state
  }

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
      const state = stateOf(agent?.session)
      if (!state.trusted) return { kind: 'deny', reason: '[intent-gate] 无法读取会话记录，不能确认问题是否已回答；请恢复会话记录后再执行工具。' }
      if (exec?.name !== QUESTION_TOOL && awaitingAnswer(state)) {
        return { kind: 'deny', reason: '[intent-gate] 当前请求的问题尚未回答；请等待用户澄清后再执行依赖答案的工作。' }
      }
      // IG-B-19: the program that asked the question may not go on to the work that depends on
      // the answer. The marker is the question's own settled sub-dispatch, keyed by the root
      // call that owns this execution tree, so only that program is stopped — a later program
      // generated after the model read the answer is a different root call and runs normally.
      if (exec?.name !== QUESTION_TOOL) {
        const rootCallId = exec?.rootCallId
        if (typeof rootCallId === 'string' && Array.isArray(state.answeredInProgram) && state.answeredInProgram.includes(rootCallId)) {
          return {
            kind: 'deny',
            reason: '[intent-gate] 这次调用属于「提问的那个程序」的后续动作：问题已经拿到答案，但依赖答案的工作必须由处理答案之后的新生成发起，不能在同一程序里直接继续。已经执行的部分保留。',
          }
        }
      }
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

}
