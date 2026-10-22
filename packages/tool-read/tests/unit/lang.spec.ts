import { describe, expect, it } from 'vitest'
import { CODE_HIGHLIGHT_EXTENSIONS, readLangHintForPath } from '@deepseek-ai/dsh-util-code-language'
import { readLangHint } from '../../src/lang.ts'

describe('readLangHint mirror', () => {
  it('matches the host table for every recognized extension', () => {
    for (const extension of CODE_HIGHLIGHT_EXTENSIONS) {
      expect(readLangHint('x.' + extension), extension).toBe(readLangHintForPath('x.' + extension))
    }
  })

  it('handles separators, case, dotfiles and unknown suffixes', () => {
    expect(readLangHint('C:\\dir\\MAIN.PS1')).toBe('ps1')
    expect(readLangHint('/repo/src/app.TSX')).toBe('tsx')
    expect(readLangHint('.env')).toBe('env')
    expect(readLangHint('Makefile')).toBeUndefined()
    expect(readLangHint('a.bin')).toBeUndefined()
    expect(readLangHint('a.constructor')).toBeUndefined()
  })
})
