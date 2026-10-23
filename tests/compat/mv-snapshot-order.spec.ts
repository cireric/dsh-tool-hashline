import { describe, expect, it } from 'vitest'
import {
  InMemoryFilesystem,
  InMemorySnapshotStore,
  Patch,
  Patcher,
  computeFileHash,
} from '@dsh-tool-hashline/hashline'
import type { SnapshotStore } from '@dsh-tool-hashline/hashline'

/**
 * MV commit ordering at the engine seam (MV fix plan §3.A / §3.C).
 *
 * The patcher used to relocate the source snapshot BEFORE asking the filesystem
 * to move the file, so a rejected or failing move left the store describing a
 * move that never happened. These cases pin the commit contract without a host:
 * the filesystem is the upstream in-memory backend, the store is the upstream
 * in-memory store, and the failure is injected deterministically.
 */

/** In-memory filesystem whose `move` always fails, recording the attempt. */
class RejectingMoveFilesystem extends InMemoryFilesystem {
  readonly log: string[]

  constructor(initial: Iterable<readonly [string, string]>, log: string[]) {
    super(initial)
    this.log = log
  }

  override async move(from: string, to: string, content?: string): Promise<void> {
    this.log.push('move:' + from + '->' + to + (content === undefined ? '' : ':content'))
    throw new Error('injected move failure: ' + from + ' -> ' + to)
  }
}

/** In-memory filesystem that performs the move and records its place in the log. */
class RecordingMoveFilesystem extends InMemoryFilesystem {
  readonly log: string[]

  constructor(initial: Iterable<readonly [string, string]>, log: string[]) {
    super(initial)
    this.log = log
  }

  override async move(from: string, to: string, content?: string): Promise<void> {
    this.log.push('move')
    await super.move(from, to, content)
  }
}

/** Upstream store with `relocate`/`record` appended to the shared order log. */
class RecordingSnapshots extends InMemorySnapshotStore {
  readonly log: string[]

  constructor(log: string[]) {
    super()
    this.log = log
  }

  override relocate(from: string, to: string): void {
    this.log.push('relocate')
    super.relocate(from, to)
  }

  override record(path: string, fullText: string, seenLines?: Iterable<number>): string {
    this.log.push('record:' + path)
    return super.record(path, fullText, seenLines)
  }
}

/** Upstream store whose `relocate` fails, simulating a snapshot-commit fault after the move. */
class FailingRelocateSnapshots extends RecordingSnapshots {
  override relocate(_from: string, _to: string): void {
    this.log.push('relocate:failed')
    throw new Error('injected snapshot commit failure')
  }
}

/** The semantic fields a failed commit must leave untouched (recordedAt/LRU excluded). */
function stateOf(store: SnapshotStore, path: string): { text: string; hash: string; seen: number[] } | null {
  const snapshot = store.head(path)
  if (snapshot === null) return null
  return {
    text: snapshot.text,
    hash: snapshot.hash,
    seen: [...snapshot.seenLines ?? []].sort((a, b) => a - b),
  }
}

const SOURCE = 'src.txt'
const DEST = 'dst.txt'
const SOURCE_TEXT = 'alpha\nbeta\ngamma\n'

describe('MV snapshot commit order (engine seam)', () => {
  it('keeps the source snapshot and leaves the destination alone when the move fails', async () => {
    const tag = computeFileHash(SOURCE_TEXT)
    const log: string[] = []
    const store = new InMemorySnapshotStore()
    store.record(SOURCE, SOURCE_TEXT, [1, 2])
    const before = stateOf(store, SOURCE)
    const fs = new RejectingMoveFilesystem([[SOURCE, SOURCE_TEXT]], log)
    const patcher = new Patcher({ fs, snapshots: store })
    const section = Patch.parseSingle('[' + SOURCE + '#' + tag + ']\nMV ' + DEST)

    const prepared = await patcher.prepare(section)
    // Prepare is read-only for a clean (no-drift) move: this is the comparison point.
    expect(stateOf(store, SOURCE)).toEqual(before)
    expect(stateOf(store, DEST)).toBeNull()

    await expect(patcher.commit(prepared)).rejects.toThrow(/injected move failure/u)

    // A rejected move must not migrate the snapshot: the source keeps every
    // semantic field it had before the commit and no destination snapshot appears.
    expect(stateOf(store, SOURCE)).toEqual(before)
    expect(stateOf(store, DEST)).toBeNull()
    // The disk did not move either.
    expect(fs.get(SOURCE)).toBe(SOURCE_TEXT)
    expect(fs.get(DEST)).toBeUndefined()
  })

  it('moves the snapshot only after the filesystem move succeeded', async () => {
    const tag = computeFileHash(SOURCE_TEXT)
    const log: string[] = []
    const store = new RecordingSnapshots(log)
    store.log.length = 0
    store.record(SOURCE, SOURCE_TEXT, [1, 2])
    log.length = 0
    const fs = new RecordingMoveFilesystem([[SOURCE, SOURCE_TEXT]], log)
    const patcher = new Patcher({ fs, snapshots: store })

    const result = await patcher.commit(await patcher.prepare(Patch.parseSingle('[' + SOURCE + '#' + tag + ']\nMV ' + DEST)))

    expect(result.path).toBe(DEST)
    expect(fs.get(DEST)).toBe(SOURCE_TEXT)
    expect(fs.get(SOURCE)).toBeUndefined()
    // Order, not just presence: the disk move is what authorizes the relocation.
    expect(log[0]).toBe('move')
    expect(log.indexOf('relocate')).toBeGreaterThan(0)
    expect(log.lastIndexOf('record:' + DEST)).toBeGreaterThan(log.indexOf('relocate'))
    expect(stateOf(store, SOURCE)).toBeNull()
    expect(stateOf(store, DEST)).toEqual({ text: SOURCE_TEXT, hash: tag, seen: [1, 2] })
  })

  it('reports a disk move whose snapshot commit failed, without undoing the move', async () => {
    const tag = computeFileHash(SOURCE_TEXT)
    const log: string[] = []
    const store = new FailingRelocateSnapshots(log)
    store.record(SOURCE, SOURCE_TEXT, [1, 2])
    log.length = 0
    const fs = new RecordingMoveFilesystem([[SOURCE, SOURCE_TEXT]], log)
    const patcher = new Patcher({ fs, snapshots: store })

    let failure: unknown
    try {
      await patcher.commit(await patcher.prepare(Patch.parseSingle('[' + SOURCE + '#' + tag + ']\nMV ' + DEST)))
    } catch (error) {
      failure = error
    }

    const message = failure instanceof Error ? failure.message : String(failure)
    expect(message).toContain('File moved on disk from')
    expect(message).toContain('was not committed')
    expect(message).toContain('must not be used in its place')
    expect((failure as Error).name).toBe('SnapshotCommitError')
    // Order proves the failure happened after the move, not instead of it.
    expect(log).toEqual(['move', 'relocate:failed'])
    // The disk moved and was NOT moved back; the snapshot was not migrated.
    expect(fs.get(DEST)).toBe(SOURCE_TEXT)
    expect(fs.get(SOURCE)).toBeUndefined()
    expect(stateOf(store, SOURCE)).toEqual({ text: SOURCE_TEXT, hash: tag, seen: [1, 2] })
    expect(stateOf(store, DEST)).toBeNull()
  })
})
