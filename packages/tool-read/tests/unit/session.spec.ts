import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { snapshotKeys, toolCwd } from '../../src/session.ts'

const cwd = process.cwd()

describe('toolCwd', () => {
  it('falls back to the process cwd without a session (matching the edit tool)', () => {
    expect(toolCwd({})).toBe(process.cwd())
    expect(toolCwd({ agent: { session: {} } })).toBe(process.cwd())
  })

  it('uses session.cwd when the runtime exposes it', () => {
    expect(toolCwd({ agent: { session: { cwd: 'D:\\other' } } })).toBe('D:\\other')
  })
})

describe('snapshotKeys', () => {
  it('records one key when the input and show paths resolve identically', () => {
    const absolute = path.join(cwd, 'a.ts')
    expect(snapshotKeys(cwd, absolute, absolute)).toEqual([path.resolve(cwd, absolute)])
  })

  it('records both keys when the show path resolves elsewhere', () => {
    const keys = snapshotKeys(cwd, 'src/a.ts', path.join(cwd, 'real', 'a.ts'))
    expect(keys).toEqual([path.resolve(cwd, 'src/a.ts'), path.resolve(cwd, 'real', 'a.ts')])
  })
})
