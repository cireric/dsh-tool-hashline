import { describe, expect, it } from 'vitest'
import { buildReadWindow, parseReadArgs, splitFileLines, truncationSuffix } from '../../src/window.ts'

const request = (over: Partial<{ offset: number; limit: number; maxLineLength: number; maxBytes: number }> = {}) => ({
  offset: 1,
  limit: 2000,
  maxLineLength: 2000,
  maxBytes: 51_200,
  ...over,
})

describe('splitFileLines', () => {
  it('does not invent a trailing empty line', () => {
    expect(splitFileLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitFileLines('a\nb')).toEqual(['a', 'b'])
  })

  it('keeps interior empty lines and reports an empty file as zero lines', () => {
    expect(splitFileLines('a\n\nb')).toEqual(['a', '', 'b'])
    expect(splitFileLines('')).toEqual([])
  })
})

describe('buildReadWindow', () => {
  it('returns the whole default window with the end-of-file footer', () => {
    const window = buildReadWindow('one\ntwo\nthree\n', request(), 'a.txt')
    expect(window.totalLines).toBe(3)
    expect(window.lines.map(line => line.text)).toEqual(['one', 'two', 'three'])
    expect(window.truncatedByBytes).toBe(false)
  })

  it('windows by offset and limit and reports the continuation offset', () => {
    const window = buildReadWindow('one\ntwo\nthree\n', request({ offset: 2, limit: 1 }), 'a.txt')
    expect(window.lines).toEqual([{ number: 2, text: 'two', complete: true }])
    expect(window.totalLines).toBe(3)
  })

  it('raises FS_NOT_FOUND for an offset past EOF', () => {
    let error: unknown
    try {
      buildReadWindow('one\ntwo\nthree\n', request({ offset: 99 }), 'a.txt')
    } catch (caught) {
      error = caught
    }
    expect((error as { code?: string }).code).toBe('FS_NOT_FOUND')
    expect((error as Error).message).toBe('offset 99 is out of range for "a.txt" (3 lines)')
  })

  it('accepts offset 1 on an empty file and reports zero lines', () => {
    const window = buildReadWindow('', request(), 'a.txt')
    expect(window).toEqual({ lines: [], totalLines: 0, truncatedByBytes: false })
  })

  it('truncates a long line and marks it incomplete', () => {
    const long = 'x'.repeat(2001)
    const window = buildReadWindow(`${long}\n`, request({ maxLineLength: 2000 }), 'a.txt')
    expect(window.lines).toHaveLength(1)
    expect(window.lines[0]!.complete).toBe(false)
    expect(window.lines[0]!.text).toBe(`${'x'.repeat(2000)}${truncationSuffix(2000)}`)
  })

  it('caps on accumulated bytes and stops the window', () => {
    const line = 'y'.repeat(1000)
    const text = `${Array.from({ length: 60 }, () => line).join('\n')}\n`
    const window = buildReadWindow(text, request(), 'a.txt')
    expect(window.truncatedByBytes).toBe(true)
    expect(window.totalLines).toBe(60)
    // 51 lines of 1000 chars + one newline each = 51_051 bytes, the 52nd would exceed 51_200.
    expect(window.lines).toHaveLength(51)
    expect(window.lines.at(-1)!.number).toBe(51)
  })

  it('returns a zero-line window when the byte cap cannot fit the first line', () => {
    const window = buildReadWindow('abcdefghij\nsecond\n', request({ maxBytes: 5 }), 'a.txt')
    expect(window).toEqual({ lines: [], totalLines: 2, truncatedByBytes: true })
  })

  it('counts UTF-8 bytes, not code units', () => {
    const text = `${'你'.repeat(10)}\n`
    expect(buildReadWindow(text, request({ maxBytes: 30 }), 'a.txt').lines).toHaveLength(1)
    expect(buildReadWindow(text, request({ maxBytes: 29 }), 'a.txt').lines).toHaveLength(0)
  })
})

describe('parseReadArgs', () => {
  it('defaults offset and limit', () => {
    expect(parseReadArgs({ file_path: 'a.txt' }, 2000)).toEqual({ filePath: 'a.txt', offset: 1, limit: 2000 })
  })

  it('rejects an over-limit limit with the host message', () => {
    expect(() => parseReadArgs({ file_path: 'a.txt', limit: 2001 }, 2000)).toThrow('limit must be less than or equal to 2000')
  })

  it('rejects non-positive offsets and limits', () => {
    expect(() => parseReadArgs({ file_path: 'a.txt', offset: 0 }, 2000)).toThrow('offset must be a positive integer')
    expect(() => parseReadArgs({ file_path: 'a.txt', limit: -1 }, 2000)).toThrow('limit must be a positive integer')
    expect(() => parseReadArgs({ file_path: 'a.txt', offset: 1.5 }, 2000)).toThrow('offset must be a positive integer')
  })

  it('rejects an empty file_path', () => {
    expect(() => parseReadArgs({ file_path: '  ' }, 2000)).toThrow('file_path must be a non-empty string')
  })
})
