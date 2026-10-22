import { describe, expect, it } from 'vitest'
import { InMemorySnapshotStore } from '@dsh-tool-hashline/hashline'

describe('snapshot seen-line sets (FR-7)', () => {
  it('unions the lines of repeated reads of the same text instead of replacing them', () => {
    const store = new InMemorySnapshotStore()
    const hash = store.record('/a.ts', 'one\ntwo\nthree\nfour\nfive\n', [1, 2])
    store.record('/a.ts', 'one\ntwo\nthree\nfour\nfive\n', [5])
    expect(store.head('/a.ts')?.hash).toBe(hash)
    expect([...store.head('/a.ts')?.seenLines ?? []].sort((a, b) => a - b)).toEqual([1, 2, 5])
  })

  it('[0] keeps existing seen lines armed instead of revoking them', () => {
    const store = new InMemorySnapshotStore()
    store.record('/a.ts', 'one\ntwo\nthree\n', [1, 2, 3])
    store.record('/a.ts', 'one\ntwo\nthree\n', [0])
    const seen = [...store.head('/a.ts')?.seenLines ?? []].sort((a, b) => a - b)
    expect(seen).toEqual([0, 1, 2, 3])
  })

  it('records no provenance (guard off) when a fresh version has no seen set', () => {
    const store = new InMemorySnapshotStore()
    store.record('/a.ts', 'one\ntwo\n')
    expect(store.head('/a.ts')?.seenLines).toBeUndefined()
  })

  it('never clears provenance by re-recording the same text without a seen set', () => {
    const store = new InMemorySnapshotStore()
    store.record('/a.ts', 'one\ntwo\n', [0])
    store.record('/a.ts', 'one\ntwo\n')
    expect([...store.head('/a.ts')?.seenLines ?? []]).toEqual([0])
  })
})
