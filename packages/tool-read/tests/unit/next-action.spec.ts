import { describe, expect, it } from 'vitest'
import { nextActionFor, type NextActionInput } from '../../src/next-action.ts'

const base: NextActionInput = {
  hasSession: true,
  empty: false,
  exceedsSnapshotLimit: false,
  truncatedLines: false,
  byteCapped: false,
  zeroLines: false,
  snapshotMaxBytes: 4_194_304,
  maxLineLength: 2000,
  maxBytes: 51_200,
  readCallId: 'call-7',
}

describe('nextActionFor', () => {
  it('is null for a complete tagged window', () => {
    expect(nextActionFor(base)).toBeNull()
  })

  it('explains the missing session before anything else', () => {
    expect(nextActionFor({ ...base, hasSession: false, empty: true })).toContain('no agent session')
  })

  it('points an empty file at write', () => {
    expect(nextActionFor({ ...base, empty: true })).toContain('write tool')
  })

  it('points an over-limit file at replace or patch', () => {
    const text = nextActionFor({ ...base, exceedsSnapshotLimit: true })
    expect(text).toContain('4194304')
    expect(text).toContain('replace or patch')
  })

  it('names maxLineLength (and maxBytes when byte-capped) and forbids a same-config retry claim', () => {
    const text = nextActionFor({ ...base, truncatedLines: true, byteCapped: true, zeroLines: true })
    expect(text).toContain('maxLineLength')
    expect(text).toContain('maxBytes')
    expect(text).toContain('will not reveal the rest')
  })

  it('names the byte cap for a zero-line window', () => {
    const text = nextActionFor({ ...base, byteCapped: true, zeroLines: true })
    expect(text).toContain('51200')
    expect(text).toContain('same offset')
  })

  it('prints the read citation a program can hand back, and only where a reason needs one', () => {
    const snapshot = nextActionFor({ ...base, exceedsSnapshotLimit: true })
    expect(snapshot).toContain('snapshot-limit')
    expect(snapshot).toContain('readCallId: call-7')
    const window = nextActionFor({ ...base, truncatedLines: true })
    expect(window).toContain('window-limit')
    expect(window).toContain('readCallId: call-7')
    // Nothing to cite: no citation is printed at all.
    const empty = nextActionFor({ ...base, empty: true })
    expect(empty).not.toContain('readCallId')
    const sessionless = nextActionFor({ ...base, hasSession: false, readCallId: null })
    expect(sessionless).not.toContain('readCallId')
    // A complete window has no guidance at all.
    expect(nextActionFor({ ...base, readCallId: null })).toBeNull()
  })

  it('leaves a byte-capped window with complete lines to the footer', () => {
    expect(nextActionFor({ ...base, byteCapped: true, zeroLines: false })).toBeNull()
  })
})
