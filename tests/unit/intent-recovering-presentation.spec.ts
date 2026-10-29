import { describe, expect, it } from 'vitest'
// @ts-ignore -- plain ESM asset shipped inside the preset (builtin-only imports)
import { FORBIDDEN_WORDS, PRODUCER_KIND, RECOVERING_KIND, RECOVERING_TEXT, RECOVERY_FAILURE_CODES, REPAIR_NOTICE_PREFIX, classifyTurnEnd, deriveRecoveringRow, isRepairNotice, recoveringText } from '../../presets/ptc-hashline/client/presentation.mjs'
// @ts-ignore -- plain ESM asset shipped inside the preset (builtin-only imports)
import { REPAIR_EXHAUSTED_CODE, REPAIR_NOTICE_PREFIX as GATE_REPAIR_PREFIX } from '../../presets/ptc-hashline/intent-gate-watchdog.mjs'

/**
 * P3 route 1: the withheld attempt must present as "the request is being completed", and
 * NOTHING ELSE may. These cases pin both halves — the upgrade, and every refusal to upgrade.
 */
const userMessage = (seq: number, text: string, source: any = { kind: 'user' }) => ({
  type: 'user/message', seq, time: 1000 + seq, data: { role: 'user', source, content: [{ type: 'text', text }] },
})
const repairNotice = (seq: number) => userMessage(seq, GATE_REPAIR_PREFIX + ': no Intent marker.', { kind: PRODUCER_KIND, form: 'notice', summary: 'declaration-repair' })
const continuationNotice = (seq: number) => userMessage(seq, '[intent-gate] Your declaration for this request was accepted: continue.', { kind: PRODUCER_KIND, form: 'notice', summary: 'continuation' })

describe('intent recovering presentation: what may be upgraded', () => {
  it('upgrades only the two declaration failures, and only while the repair is queued', () => {
    const reason = { kind: 'error', error: { message: 'withheld', code: 'INTENT_DECLARATION_MISSING' } }
    const row = deriveRecoveringRow({ turn: 1, reason, following: [repairNotice(4)] })
    expect(row).toEqual({ kind: RECOVERING_KIND, seq: 4, time: 1004, turn: 1, code: 'INTENT_DECLARATION_MISSING' })
  })

  it('classifies each policy code the same way the gate names it', () => {
    expect(classifyTurnEnd({ kind: 'error', error: { code: 'INTENT_DECLARATION_MISSING' } }).kind).toBe('recovering')
    expect(classifyTurnEnd({ kind: 'error', error: { code: 'INTENT_DECLARATION_EMPTY' } }).kind).toBe('recovering')
    // exhausted repairs and the other policy stops are NOT "being completed"
    for (const code of [REPAIR_EXHAUSTED_CODE, 'INTENT_DECLARATION_LIMIT', 'INTENT_DECLARATION_AWAITING_ANSWER', 'INTENT_STALE_ACTION', 'INTENT_DECLARATION_STATE_UNTRUSTED']) {
      expect(classifyTurnEnd({ kind: 'error', error: { code } })).toEqual({ kind: 'failure', code })
    }
    // provider failures and non-error endings are untouched
    expect(classifyTurnEnd({ kind: 'error', error: { code: 'AUTH' } }).kind).toBe('failure')
    expect(classifyTurnEnd({ kind: 'error', error: { message: 'boom' } })).toEqual({ kind: 'failure' })
    expect(classifyTurnEnd({ kind: 'completed' })).toEqual({ kind: 'none' })
    expect(classifyTurnEnd({ kind: 'aborted', reason: { kind: 'user' } })).toEqual({ kind: 'none' })
    expect(classifyTurnEnd(undefined)).toEqual({ kind: 'none' })
  })

  it('accepts the stream-finish failure field too, so a shape change cannot silently disable it', () => {
    expect(classifyTurnEnd({ kind: 'error', failure: { code: 'INTENT_DECLARATION_MISSING' } }).kind).toBe('recovering')
  })

  it('recognises only this producer\'s repair notice, never its continuation or a lookalike', () => {
    expect(isRepairNotice(repairNotice(4))).toBe(true)
    expect(isRepairNotice(continuationNotice(5))).toBe(false)
    expect(isRepairNotice(userMessage(6, GATE_REPAIR_PREFIX + ' (quoted by the user)'))).toBe(false)
    expect(isRepairNotice({ ...repairNotice(7), data: { ...repairNotice(7).data, source: { kind: 'user' } } })).toBe(false)
  })

  it('refuses the upgrade when the request moved on, or the window closed', () => {
    const reason = { kind: 'error', error: { code: 'INTENT_DECLARATION_MISSING' } }
    // the user typed first: the queued repair was dropped, so the failure row stands
    expect(deriveRecoveringRow({ turn: 1, reason, following: [userMessage(4, '继续')] })).toBeNull()
    // the continuation notice is not a repair notice
    expect(deriveRecoveringRow({ turn: 1, reason, following: [continuationNotice(4)] })).toBeNull()
    // a new turn opened first
    expect(deriveRecoveringRow({ turn: 1, reason, following: [{ type: 'turn/start', seq: 4, time: 1004, data: { turn: 2 } }, repairNotice(5)] })).toBeNull()
    // nothing followed
    expect(deriveRecoveringRow({ turn: 1, reason, following: [] })).toBeNull()
    expect(deriveRecoveringRow({ turn: 1, reason })).toBeNull()
    // a non-recoverable failure never yields the row, whatever follows it
    expect(deriveRecoveringRow({ turn: 1, reason: { kind: 'error', error: { code: REPAIR_EXHAUSTED_CODE } }, following: [repairNotice(4)] })).toBeNull()
  })

  it('never presents the recovering state with a failure word', () => {
    for (const [locale, text] of Object.entries(RECOVERING_TEXT as Record<string, string>)) {
      for (const word of FORBIDDEN_WORDS[locale]) expect(text.toLowerCase()).not.toContain(word)
      expect(text.length).toBeGreaterThan(0)
    }
    expect(recoveringText('en-US')).toBe(RECOVERING_TEXT['en-US'])
    expect(recoveringText('ja-JP')).toBe(RECOVERING_TEXT['zh-CN']) // unknown locale falls back, never blank
  })

  it('keeps its notice prefix and code list in step with the gate that emits them', () => {
    expect(REPAIR_NOTICE_PREFIX).toBe(GATE_REPAIR_PREFIX)
    expect(RECOVERY_FAILURE_CODES.length).toBe(2)
    expect(new Set(RECOVERY_FAILURE_CODES).size).toBe(2)
  })
})
