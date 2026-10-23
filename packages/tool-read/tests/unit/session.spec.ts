import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { snapshotKeys } from '../../src/session.ts'

const cwd = process.cwd()

describe('snapshotKeys', () => {
  it('records one key when the input and show paths resolve identically', () => {
    const absolute = path.join(cwd, 'a.ts')
    expect(snapshotKeys(cwd, absolute, absolute)).toEqual([path.resolve(cwd, absolute)])
  })

  it('records both keys when the show path resolves elsewhere', () => {
    const keys = snapshotKeys(cwd, 'src/a.ts', path.join(cwd, 'real', 'a.ts'))
    expect(keys).toEqual([path.resolve(cwd, 'src/a.ts'), path.resolve(cwd, 'real', 'a.ts')])
  })

  it('resolves the authored path against the directory it is given, not the process cwd', () => {
    const sessionDir = path.join(cwd, 'elsewhere')
    expect(snapshotKeys(sessionDir, 'rel.txt', path.join(sessionDir, 'rel.txt')))
      .toEqual([path.resolve(sessionDir, 'rel.txt')])
    expect(snapshotKeys(sessionDir, 'rel.txt', path.join(sessionDir, 'rel.txt'))[0])
      .not.toBe(path.resolve(cwd, 'rel.txt'))
  })
})
