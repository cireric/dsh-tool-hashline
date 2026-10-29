import { describe, expect, it } from 'vitest'
import { extractSession } from '../../scripts/extract-runtime-evidence.mjs'

/**
 * The browser-free half of P3 route 1: given a real session artifact, the report says what each
 * finished turn SHOULD look like in the web client — "being completed" or the stock failure row —
 * and, when the upgrade was refused, which structural fact refused it.
 *
 * It is derived from formal events only. It never claims a browser painted anything.
 */
const HEADER = { type: 'session', version: 4, id: 's-presentation', cwd: '.', agentPreset: 'ptc-hashline' }
const record = (type: string, seq: number, data: unknown) => ({ type, seq, time: 1000 + seq, data })
const userMessage = (seq: number, text: string, source: any = { kind: 'user' }) =>
  record('user/message', seq, { role: 'user', source, content: [{ type: 'text', text }] })
const repairNotice = (seq: number) => userMessage(
  seq,
  '[intent-gate] Your previous reply for this request was withheld: no Intent marker.',
  { kind: 'intent-gate-watchdog', form: 'notice', summary: 'declaration-repair' },
)
const turnEnd = (seq: number, turn: number, code: string) => record('turn/end', seq, { turn, reason: { kind: 'error', error: { message: 'withheld', code } } })

/** extractSession takes already-read text, so the artifact is built in memory (same as the tool-path spec). */
function extract(records: unknown[]) {
  const text = [JSON.stringify(HEADER), ...records.map(entry => JSON.stringify(entry))].join('\n') + '\n'
  return extractSession({
    sourcePath: 'fixture.jsonl',
    sessionId: 's-presentation',
    extractedAt: '2026-10-28T00:00:00.000Z',
    bytes: Buffer.byteLength(text, 'utf8'),
    buffer: Buffer.from(text, 'utf8'),
    text,
    format: 'jsonl.v4',
    frames: 0,
  })
}

describe('extractor: what each turn should have looked like', () => {
  it('reports the upgraded row for a withheld attempt whose repair is queued right after', async () => {
    const report = extract([userMessage(1, '发布吧。'), turnEnd(2, 1, 'INTENT_DECLARATION_MISSING'), repairNotice(3)])
    expect(report.presentation.rule.recoveryCodes).toEqual(['INTENT_DECLARATION_MISSING', 'INTENT_DECLARATION_EMPTY'])
    expect(report.presentation.totals).toEqual({ turns: 1, recovering: 1, failure: 0 })
    expect(report.presentation.turns[0]).toEqual({
      turn: 1, seq: 2, code: 'INTENT_DECLARATION_MISSING', presentedAs: 'recovering', reason: 'upgraded', announcedAtSeq: 3,
    })
  })

  it('keeps the failure row when the user got there first, and says why', async () => {
    const report = extract([userMessage(1, '发布吧。'), turnEnd(2, 1, 'INTENT_DECLARATION_EMPTY'), userMessage(3, '继续')])
    expect(report.presentation.totals).toEqual({ turns: 1, recovering: 0, failure: 1 })
    expect(report.presentation.turns[0]).toMatchObject({ presentedAs: 'failure', reason: 'first-message-is-not-a-repair-notice' })
    expect(report.presentation.turns[0]).not.toHaveProperty('announcedAtSeq')
  })

  it('lists every policy stop, so a deliberate failure is not hidden by omission', async () => {
    const report = extract([
      turnEnd(1, 1, 'INTENT_DECLARATION_REPAIR_EXHAUSTED'),
      turnEnd(2, 2, 'INTENT_DECLARATION_AWAITING_ANSWER'),
      turnEnd(3, 3, 'INTENT_STALE_ACTION'),
      repairNotice(4),
    ])
    expect(report.presentation.totals).toEqual({ turns: 3, recovering: 0, failure: 3 })
    for (const entry of report.presentation.turns) {
      expect(entry.presentedAs).toBe('failure')
      expect(entry.reason).toBe('no-recovery-code')
    }
  })

  it('says nothing about provider failures, cancellations or ordinary turns', async () => {
    const report = extract([
      turnEnd(1, 1, 'AUTH'),
      record('turn/end', 2, { turn: 2, reason: { kind: 'error', error: { message: 'boom' } } }),
      record('turn/end', 3, { turn: 3, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
      record('turn/end', 4, { turn: 4, reason: { kind: 'completed' } }),
    ])
    expect(report.presentation.totals).toEqual({ turns: 0, recovering: 0, failure: 0 })
    expect(report.presentation.note).toContain('not a claim that a browser painted it')
  })
})
