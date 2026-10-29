import { describe, expect, it } from 'vitest'
// @ts-ignore -- plain ESM asset shipped inside the preset (builtin-only imports)
// @ts-ignore -- plain ESM asset shipped inside the preset (builtin-only imports)
import { ACCOUNTING_PHASE, ACKNOWLEDGEMENTS, ANSWER_SOURCE_KIND, CONTINUATIONS, CONTINUATION_NOTICE_PREFIX, DEFAULT_LIMITS, QUESTION_TOOL, REASON, REPAIR_EXHAUSTED_CODE, REPAIR_NOTICE_PREFIX, assembleAttempt, attemptDiagnostic, awaitingAnswer, bodyText, callsATool, checkDeclaration, classifyInput, continuationNotice, declarationStopMessage, firstLineOf, isBareConversational, normalizeInput, pendingSteer, repairNotice, repairStartedMessage, requestAccounting, stopMessage, summarizeAccounting } from '../../presets/ptc-hashline/intent-gate-watchdog.mjs'

/**
 * The mechanical declaration check is the ONLY automated judgement the request-level
 * intent gate makes (spec 2026-10-27-intent-gate-b-requirements, IG-B-02 / IGB-AC-01):
 * first-line marker plus non-empty body, tolerant of case and spacing. This suite pins
 * that rule — including the shapes that must NOT pass — so a later change cannot widen
 * or narrow it by accident.
 */

type Verdict = { ok: boolean; reason?: string }

const check = (text: string): Verdict => checkDeclaration(text) as Verdict

describe('intent declaration marker (IG-B-02)', () => {
  it('accepts the canonical line', () => {
    expect(check('Intent: rewrite the parser to keep the old output; I will read the module first.')).toEqual({
      ok: true,
      firstLine: 'Intent: rewrite the parser to keep the old output; I will read the module first.',
    })
  })

  it('accepts case differences on the marker', () => {
    for (const text of ['intent: lowercase marker', 'INTENT: upper case marker', 'InTeNt: mixed case marker']) {
      expect(check(text).ok, text).toBe(true)
    }
  })

  it('accepts spacing differences around the marker', () => {
    for (const text of ['  Intent: two leading spaces', '\tIntent:\tleading tab', 'Intent : space before the colon', '\uFEFFIntent: byte order mark first', '\u00A0Intent: non-breaking space first']) {
      expect(check(text).ok, JSON.stringify(text)).toBe(true)
    }
  })

  it('rejects a missing or non-literal marker', () => {
    for (const text of [
      'Here is what I understood.',
      'Intent - not the literal marker',
      'intentional: the word merely starts with intent',
      '意图：intent in chinese is not the ascii token',
      'No marker on the first line\nIntent: only on the second line',
    ]) {
      expect(check(text).reason, text).toBe(REASON.MISSING)
    }
  })

  it('rejects a marker with an empty body', () => {
    for (const text of ['Intent:', 'Intent:    ', 'Intent: \t ', 'Intent:   \r']) {
      expect(check(text).reason, JSON.stringify(text)).toBe(REASON.EMPTY_BODY)
    }
  })

  it('rejects a reply with no text body at all', () => {
    for (const text of ['', '   ', '\n', ' \r\n ']) {
      expect(check(text).reason, JSON.stringify(text)).toBe(REASON.NO_TEXT)
    }
  })

  it('reads only the first line, tolerating CRLF', () => {
    expect(check('Intent: first line wins\r\nsecond line').ok).toBe(true)
    expect(firstLineOf('Intent: x\r\nrest')).toBe('Intent: x')
    expect(firstLineOf('   ')).toBe(null)
  })
})

describe('attempt assembly decides on the FINAL text (IGB-AC-01)', () => {
  it('joins text blocks in block order, so a marker split across blocks still counts', () => {
    const chunks = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Intent:' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'block-end', index: 1, block: { type: 'text', text: ' the goal and the next step' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const attempt = assembleAttempt(chunks)
    expect(bodyText(attempt.blocks)).toBe('Intent: the goal and the next step')
    expect(check(bodyText(attempt.blocks)).ok).toBe(true)
  })

  it('joins deltas split across chunks when no block-end arrives', () => {
    const chunks = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Inten' },
      { type: 'text-delta', index: 0, text: 't: split across chunks' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const attempt = assembleAttempt(chunks)
    expect(check(bodyText(attempt.blocks)).ok).toBe(true)
  })

  it('lets the final block override a delta that merely looked like a declaration', () => {
    const chunks = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Intent: temporary delta that will be replaced' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'the final text carries no marker' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const attempt = assembleAttempt(chunks)
    expect(bodyText(attempt.blocks)).toBe('the final text carries no marker')
    expect(check(bodyText(attempt.blocks)).reason).toBe(REASON.MISSING)
  })

  it('ignores reasoning blocks and tool calls: only text blocks are the reply body', () => {
    const reasoningOnly = [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'Intent: this is a thought, not the reply' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const attempt = assembleAttempt(reasoningOnly)
    expect(bodyText(attempt.blocks)).toBe('')
    expect(check(bodyText(attempt.blocks)).reason).toBe(REASON.NO_TEXT)

    const toolOnly = [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'run_code', argumentsDelta: '{"code":"1"}' },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]
    const toolAttempt = assembleAttempt(toolOnly)
    expect(bodyText(toolAttempt.blocks)).toBe('')
    expect(toolAttempt.finish).toEqual({ kind: 'tool-calls' })
    expect(check(bodyText(toolAttempt.blocks)).reason).toBe(REASON.NO_TEXT)
  })

  it('reports the terminal finish it saw, so callers can keep real failure semantics', () => {
    const aborted = [{ type: 'finish', reason: { kind: 'aborted', failure: { message: 'cancelled', code: 'ABORTED' } } }]
    expect(assembleAttempt(aborted).finish.kind).toBe('aborted')
  })
})

/**
 * The repair's copy is part of the contract, not decoration: the notice is the only thing
 * the model sees before it regenerates (ticket 02 / IG-B-07), and the stop message is what
 * the user reads when the single repair is gone (IG-B-06).
 */
describe('bounded repair copy (IG-B-06/07)', () => {
  it('declares the spec-fixed single repair instead of leaving it implicit', () => {
    expect(DEFAULT_LIMITS.maxRepairs).toBe(1)
    expect(REPAIR_EXHAUSTED_CODE).toBe('INTENT_DECLARATION_REPAIR_EXHAUSTED')
  })

  it('tells the model the exact shape, and that the notice grants nothing', () => {
    for (const reason of [REASON.MISSING, REASON.EMPTY_BODY, REASON.NO_TEXT]) {
      const notice = repairNotice(reason, 'stop') as string
      expect(notice).toContain('Intent:')
      expect(notice).toContain('copy it verbatim')
      expect(notice).toMatch(/policy rejection, not a network or model failure/u)
      expect(notice).toMatch(/grants no new authority/u)
      expect(notice).toMatch(/not the user speaking/u)
      expect(notice).toMatch(/Write the whole reply again/u)
    }
  })

  it('names the provider kind it observed, so a rejection is not mistaken for a failure', () => {
    expect(repairNotice(REASON.MISSING, 'tool-calls') as string).toContain('tool-calls')
  })

  it('reports the spent repair to the user instead of repeating the template', () => {
    const stopped = stopMessage(REASON.MISSING, { repaired: true }) as string
    expect(stopped).toContain('[intent-gate]')
    expect(stopped).toMatch(/唯一一次自动修复/u)
    expect(stopped).not.toContain('Intent: <用自然语言说明')
    // the first stop of a request still shows the shape to copy
    expect(stopMessage(REASON.MISSING) as string).toContain('Intent: <用自然语言说明')
  })
})

/**
 * The input exceptions (ticket 03). The gate never infers meaning: it compares the WHOLE
 * input against two closed lists, so the only mechanical claim it can make is "this input is
 * exactly a bare acknowledgement / bare continuation". These tests pin that narrowness —
 * both what it exempts and, more importantly, what it must refuse to exempt.
 */
describe('conversational input exceptions (IG-B-01/03)', () => {
  const understood = { accepted: 1, lastOutcome: 'accepted' }
  const classify = (text: string, state: unknown = understood) => classifyInput(text, state) as string

  it('keeps the two lists short, exact and reviewable', () => {
    expect(ACKNOWLEDGEMENTS.length).toBeLessThan(25)
    expect(CONTINUATIONS.length).toBeLessThan(25)
    expect(ACKNOWLEDGEMENTS).toContain('谢谢')
    expect(CONTINUATIONS).toContain('继续')
  })

  it('normalises only whitespace, trailing punctuation and case', () => {
    expect(normalizeInput('  谢谢！ ')).toBe('谢谢')
    expect(normalizeInput('THANKS.')).toBe('thanks')
    expect(normalizeInput('继续吧～')).toBe('继续吧')
    expect(normalizeInput('收到，但把 X 改成 Y')).toBe('收到，但把 x 改成 y')
  })

  it('exempts a bare acknowledgement, with no understanding required', () => {
    for (const text of ['谢谢', '谢谢！', ' 收到 ', 'Thanks.', 'OK', '👍', '好的']) {
      expect(classify(text, { accepted: 0, lastOutcome: 'none' }), text).toBe('acknowledge')
    }
  })

  it('exempts a bare continuation only when an accepted understanding exists', () => {
    expect(classify('继续')).toBe('continue')
    expect(classify('Continue.')).toBe('continue')
    expect(classify('继续', { accepted: 0, lastOutcome: 'accepted' })).toBe('owes')
    expect(classify('继续', { accepted: 2, lastOutcome: 'exhausted' })).toBe('owes')
    expect(classify('继续', { accepted: 2, lastOutcome: 'failed' })).toBe('owes')
    expect(classify('继续', { accepted: 2, lastOutcome: 'none' })).toBe('owes')
  })

  it('never exempts the same words carrying anything else', () => {
    for (const text of [
      '收到，但把 a.txt 里的第二行改成 B',
      '谢谢，不过请再改一处',
      '继续，同时把 b.txt 删掉',
      '继续吧，然后写测试',
      'good, now also rename the file',
      '',
      '   ',
    ]) {
      expect(classify(text), JSON.stringify(text)).toBe('owes')
    }
  })

  it('treats a reply that would call a tool as acting, exemption or not', () => {
    expect(callsATool([{ type: 'text', text: 'ok' }])).toBe(false)
    expect(callsATool([{ type: 'text', text: 'ok' }, { type: 'tool-call', id: 'c', name: 'run_code', arguments: '{}' }])).toBe(true)
  })
})

/**
 * Clarification waiting (ticket 04). The gate does not guess whether a reply "looks like a
 * question": the host's ask_user_question call opens the wait and its settle closes it. What
 * these tests pin is the accounting that hangs off that state.
 */
describe('clarification waiting (IG-B-16)', () => {
  const understood = { accepted: 3, lastOutcome: 'accepted' }
  const classify = (text: string, state: unknown) => classifyInput(text, state) as string

  it('names the host surfaces it keys on', () => {
    expect(QUESTION_TOOL).toBe('ask_user_question')
    expect(ANSWER_SOURCE_KIND).toBe('user-question-reply')
  })

  it('turns every conversational form into a declaration while a question is open', () => {
    const waiting = { ...understood, awaitingAnswer: true }
    for (const text of ['继续', '谢谢', 'ok', '好的', 'Continue.']) {
      expect(classify(text, waiting), text).toBe('owes')
    }
    // and without a question open the same inputs keep their ticket-03 behaviour
    expect(classify('谢谢', understood)).toBe('acknowledge')
    expect(classify('继续', understood)).toBe('continue')
  })

  it('has its own reason and policy code, distinct from a declaration miss', () => {
    expect(REASON.AWAITING_ANSWER).toBe('awaiting-answer')
    const stopped = stopMessage(REASON.AWAITING_ANSWER) as string
    expect(stopped).toContain('[intent-gate]')
    expect(stopped).toMatch(/待答/u)
    const notice = repairNotice(REASON.AWAITING_ANSWER, 'tool-calls') as string
    expect(notice).toMatch(/still unanswered/u)
  })
})

/**
 * Steering before dispatch (ticket 05). The gate reads the host's own steering queue — it
 * never timestamps messages or guesses from their text — so what it must get right is which
 * queue entries count as a human input.
 */
describe('steering before dispatch (IG-B-08)', () => {
  const agentWith = (nextStep: unknown[]) => ({ inbox: { nextStep } })
  const human = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'also rename it' }] }

  it('sees a human input waiting in the steering queue', () => {
    expect(pendingSteer(agentWith([human]))).toBe(true)
    expect(pendingSteer(agentWith([{ role: 'user', source: { kind: 'user-question-reply' }, content: [{ type: 'text', text: 'A' }] }]))).toBe(true)
  })

  it('ignores injected notices, tool results and an empty queue', () => {
    expect(pendingSteer(agentWith([]))).toBe(false)
    expect(pendingSteer(agentWith([{ role: 'user', source: { kind: 'agent-instructions' }, content: [{ type: 'text', text: 'x' }] }]))).toBe(false)
    expect(pendingSteer(agentWith([{ role: 'tool', source: { kind: 'tool', callId: 'c' }, content: [] }]))).toBe(false)
    expect(pendingSteer(undefined)).toBe(false)
    expect(pendingSteer({})).toBe(false)
  })

  it('has its own terminal stop copy, distinct from a declaration miss', () => {
    expect(REASON.STALE_ACTION).toBe('stale-action')
    const stopped = stopMessage(REASON.STALE_ACTION) as string
    expect(stopped).toContain('[intent-gate]')
    expect(stopped).toMatch(/已执行的动作保留/u)
  })
})

/**
 * The declaration-only repair (2026-10-28 plan). What is pinned here is the copy and the
 * diagnostic shape — the phase mechanics are proven against the real loop seams in
 * tests/integration/intent-gate-request-scope.spec.ts.
 */
describe('declaration-only repair copy (2026-10-28 plan)', () => {
  it('declares a body cap for the declaration, separate from provider generation', () => {
    expect(DEFAULT_LIMITS.maxDeclarationChars).toBe(2000)
    expect(repairNotice(REASON.MISSING, 'stop', 1, 1234) as string).toContain('1234 characters of body')
  })

  it('tells the model the repair is declaration-only and that no tool is offered', () => {
    const notice = repairNotice(REASON.NO_TEXT, 'tool-calls') as string
    expect(notice).toMatch(/DECLARATION-ONLY/u)
    expect(notice).toMatch(/no tool is offered/u)
    expect(notice).toMatch(/do not restate the declaration/iu)
    expect(notice).toMatch(/Do not deliver the answer here/u)
  })

  it('does not present the first miss to the user as a spent repair', () => {
    const copy = repairStartedMessage(REASON.MISSING, { providerKind: 'stop' }) as string
    expect(copy).toContain('[intent-gate]')
    expect(copy).toMatch(/正在自动重新生成声明/u)
    expect(copy).toMatch(/唯一一次自动修复/u)
    expect(copy).not.toMatch(/不再自动重试/u)
    expect(copy).toContain('Intent:')
  })

  it('names the protocol pause instead of claiming the work happened', () => {
    const copy = declarationStopMessage(REASON.TOOLS_IN_DECLARATION) as string
    expect(copy).toMatch(/意图声明未能生成，工作尚未执行/u)
    expect(copy).toMatch(/唯一一次自动修复已经用掉/u)
    expect(copy).toMatch(/没有执行任何工具/u)
    const long = declarationStopMessage(REASON.DECLARATION_LONG, { maxChars: 50 }) as string
    expect(long).toContain('50 字符')
  })

  it('keeps the continuation a different message from the repair', () => {
    const continuation = continuationNotice() as string
    expect(continuation.startsWith(CONTINUATION_NOTICE_PREFIX)).toBe(true)
    expect(continuation.startsWith(REPAIR_NOTICE_PREFIX)).toBe(false)
    expect(REPAIR_NOTICE_PREFIX).not.toBe(CONTINUATION_NOTICE_PREFIX)
    expect(repairNotice(REASON.MISSING, 'stop') as string).toMatch(new RegExp('^' + REPAIR_NOTICE_PREFIX.replace(/[[\]]/gu, '\\$&'), 'u'))
    expect(continuation).toMatch(/Do not repeat or restate the Intent: line/u)
    expect(continuation).toMatch(/not the user speaking/u)
    expect(continuation).toMatch(/nothing new is authorized/u)
  })

  it('records identities and counts only: no rejected body, reasoning or tool arguments', () => {
    const diagnostic = attemptDiagnostic({
      sessionId: 'session-x',
      stage: 'declaration',
      reason: REASON.MISSING,
      providerKind: 'stop',
      blocks: [
        { type: 'text', text: 'a rejected body that must not be logged' },
        { type: 'reasoning', text: 'private chain of thought' },
        { type: 'tool-call', name: 'run_code', arguments: '{"code":"secret"}' },
      ],
      usage: { inputTokens: 1, outputTokens: 2 },
      repairs: 1,
      elapsedMs: 12,
      limits: DEFAULT_LIMITS,
    }) as Record<string, any>
    expect(diagnostic).toMatchObject({
      stage: 'declaration',
      reason: 'missing-marker',
      providerKind: 'stop',
      sessionId: 'session-x',
      blocks: 3,
      textBlocks: 1,
      reasoningBlocks: 1,
      toolCallBlocks: 1,
      bodyEmpty: false,
      repairs: 1,
      usage: { inputTokens: 1, outputTokens: 2 },
      elapsedMs: 12,
    })
    expect(diagnostic.limits.maxDeclarationChars).toBe(2000)
    const serialized = JSON.stringify(diagnostic)
    expect(serialized).not.toContain('rejected body')
    expect(serialized).not.toContain('chain of thought')
    expect(serialized).not.toContain('secret')
    // a tool block is only ever a COUNT: the "no text, but it called a tool" claim needs it
    expect(attemptDiagnostic({ blocks: [{ type: 'tool-call' }] }) as any).toMatchObject({ toolCallBlocks: 1, bodyEmpty: true })
  })
})

describe('question identity and the per-request wait (2026-10-28 P2)', () => {
  it('treats a wait as belonging to the request that asked, not to the session', () => {
    const state = { request: 2, openQuestions: [{ callId: 'q1', request: 1 }] }
    // the older request's question does not block the request the session is in now
    expect(awaitingAnswer(state)).toBe(false)
    state.openQuestions.push({ callId: 'q2', request: 2 })
    expect(awaitingAnswer(state)).toBe(true)
  })

  it('reads a record rebuilt by an older build as still waiting, never as free', () => {
    expect(awaitingAnswer({ awaitingAnswer: true })).toBe(true)
    expect(awaitingAnswer({ awaitingAnswer: false })).toBe(false)
    expect(awaitingAnswer(undefined)).toBe(false)
  })

  it('recognises the two bare conversational forms without reading any state', () => {
    expect(isBareConversational('继续')).toBe(true)
    expect(isBareConversational('  收到。 ')).toBe(true)
    expect(isBareConversational('Continue')).toBe(true)
    expect(isBareConversational('继续，另外把灰度改成 20%')).toBe(false)
    expect(isBareConversational('先别上支付')).toBe(false)
  })

  it('never exempts a bare form while the current request holds an open question', () => {
    const state = { request: 1, openQuestions: [{ callId: 'q1', request: 1 }] }
    expect(classifyInput('继续', state)).toBe('owes')
    expect(classifyInput('收到', state)).toBe('owes')
    // ... and the same words are exempt once that question is settled
    expect(classifyInput('收到', { request: 1, openQuestions: [] })).toBe('acknowledge')
  })
})

describe('per-request accounting from the formal log (P4, IG-B-18)', () => {
  const user = (text: string) => ({ type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } })
  const notice = (text: string) => ({ type: 'user/message', data: { role: 'user', source: { kind: 'intent-gate-watchdog', form: 'notice', summary: 'x' }, content: [{ type: 'text', text }] } })
  const attempt = (usage?: { inputTokens: number; outputTokens: number }) => ({ type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [], ...usage === undefined ? {} : { usage } } })
  const message = (text: string, usage?: { inputTokens: number; outputTokens: number }) => ({ type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] }, stream: [], ...usage === undefined ? {} : { usage } } })
  const turnEnd = (kind: string) => ({ type: 'turn/end', data: { turn: 1, reason: { kind } } })

  it('keeps the three stages apart and never turns a missing cost into zero', () => {
    const ledger = requestAccounting([
      user('do the thing'),
      attempt({ inputTokens: 5, outputTokens: 7 }),
      turnEnd('error'),
      notice(REPAIR_NOTICE_PREFIX + ': the first line of the reply did not start with the literal marker Intent:.'),
      message('Intent: do the thing; I will write the file.', undefined),
      notice(CONTINUATION_NOTICE_PREFIX + ' and published. Continue the same request.'),
      message('done', { inputTokens: 9, outputTokens: 11 }),
      turnEnd('completed'),
    ])
    expect(ledger.requests).toHaveLength(1)
    const request = ledger.requests[0]
    expect(request.repairs).toBe(1)
    expect(request.accepted).toBe(1)
    expect(request.stages[ACCOUNTING_PHASE.FIRST]).toMatchObject({ attempts: 1, published: 0, inputTokens: 5, outputTokens: 7, usageUnknown: 0 })
    expect(request.stages[ACCOUNTING_PHASE.DECLARATION]).toMatchObject({ attempts: 1, published: 1, usageUnknown: 1, inputTokens: 0 })
    expect(request.stages[ACCOUNTING_PHASE.BUSINESS]).toMatchObject({ attempts: 1, published: 1, inputTokens: 9, outputTokens: 11 })
    expect(request.outcomes).toEqual(['error', 'completed'])
    expect(ledger.totals).toMatchObject({ requests: 1, repairs: 1, attempts: 3, inputTokens: 14, outputTokens: 18, usageUnknown: 1, failedTurns: 1 })
  })

  it('gives each substantive request its own budget, and a bare continuation stays in its request', () => {
    const ledger = requestAccounting([
      user('first task'),
      notice(REPAIR_NOTICE_PREFIX + ': withheld'),
      turnEnd('error'),
      user('继续'),
      user('second, different task'),
      notice(REPAIR_NOTICE_PREFIX + ': withheld again'),
      turnEnd('error'),
    ])
    expect(ledger.requests).toHaveLength(2)
    expect(ledger.requests.map((request: any) => request.repairs)).toEqual([1, 1])
    expect(ledger.totals.repairs).toBe(2)
  })

  it('records which questions were settled by their own answer and which were not', () => {
    const ledger = requestAccounting([
      user('ask me'),
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'q1', name: 'ask_user_question', arguments: '{}' } },
      { type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: 'q1', source: { kind: 'tool', callId: 'q1' }, content: [] } } },
      { type: 'tool/ptc-dispatch-start', data: { rootCallId: 'r', parentCallId: 'r', subCallId: 'r:ptc:1', name: 'ask_user_question', arguments: {} } },
      turnEnd('completed'),
    ])
    const request = ledger.requests[0]
    expect(request.questions).toHaveLength(2)
    expect(request.questions.filter((question: any) => question.settled === true)).toHaveLength(1)
    expect(ledger.totals.unsettledQuestions).toBe(1)
  })

  it('summarises without leaking any reply body', () => {
    const summary = summarizeAccounting(requestAccounting([
      user('do the thing'),
      attempt({ inputTokens: 1, outputTokens: 2 }),
      turnEnd('error'),
      notice(REPAIR_NOTICE_PREFIX + ': withheld'),
      message('Intent: do the thing; I will write the file.'),
      turnEnd('completed'),
    ]))
    expect(summary).toContain('request=1')
    expect(summary).toContain('declaration:attempts=1')
    expect(summary).not.toContain('write the file')
    expect(summary).not.toContain('Intent:')
  })

  it('is rebuilt from the same events after a reload, so nothing is reset', () => {
    const events = [
      user('do the thing'),
      attempt({ inputTokens: 3, outputTokens: 4 }),
      turnEnd('error'),
      notice(REPAIR_NOTICE_PREFIX + ': withheld'),
    ]
    const before = requestAccounting(events)
    const after = requestAccounting(JSON.parse(JSON.stringify(events)))
    expect(after.totals).toEqual(before.totals)
    expect(after.requests).toEqual(before.requests)
  })
})
