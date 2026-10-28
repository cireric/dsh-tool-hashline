import { describe, expect, it } from 'vitest'
// @ts-ignore -- plain ESM asset shipped inside the preset (builtin-only imports)
// @ts-ignore -- plain ESM asset shipped inside the preset (builtin-only imports)
import { ACKNOWLEDGEMENTS, ANSWER_SOURCE_KIND, CONTINUATIONS, DEFAULT_LIMITS, QUESTION_TOOL, REASON, REPAIR_EXHAUSTED_CODE, assembleAttempt, bodyText, callsATool, checkDeclaration, classifyInput, firstLineOf, normalizeInput, pendingSteer, repairNotice, stopMessage } from '../../presets/ptc-hashline/intent-gate-watchdog.mjs'

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
