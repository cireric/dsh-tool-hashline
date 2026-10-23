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
    // Positive semantics, not a fixed sentence: the disk move is a fact, the
    // bookkeeping did not complete, the store may be partial, and the remedy is a
    // re-read of the destination. This failure point (relocate throws before it
    // touches the store) leaves the source snapshot intact, so the message must
    // also not claim the store definitely changed.
    expect(message).toMatch(/moved on disk from/iu)
    expect(message).toContain(SOURCE)
    expect(message).toContain(DEST)
    expect(message).toMatch(/bookkeeping did not complete/iu)
    expect(message).toMatch(/may be partially updated/iu)
    expect(message).toMatch(/re-read the destination/iu)
    expect(message).toMatch(/not undone/iu)
    expect(message).toContain('injected snapshot commit failure')
    expect(message).not.toMatch(/source snapshot (was|is) (not migrated|gone|discarded)/iu)
    expect((failure as Error).name).toBe('SnapshotCommitError')
    expect((failure as Error).cause).toBeInstanceOf(Error)
    // Order proves the failure happened after the move, not instead of it.
    expect(log).toEqual(['move', 'relocate:failed'])
    // The disk moved and was NOT moved back; this failure point did not migrate
    // the snapshot, and the message does not pretend otherwise.
    expect(fs.get(DEST)).toBe(SOURCE_TEXT)
    expect(fs.get(SOURCE)).toBeUndefined()
    expect(stateOf(store, SOURCE)).toEqual({ text: SOURCE_TEXT, hash: tag, seen: [1, 2] })
    expect(stateOf(store, DEST)).toBeNull()
  })
})


/** A one-shot resolve/release pair: no timers, no randomness. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let settle!: () => void
  const promise = new Promise<void>(resolve => {
    settle = resolve
  })
  return { promise, resolve: settle }
}

/**
 * In-memory filesystem whose move parks on a barrier until the test releases it.
 *
 * "Did the commit wait for the move?" then becomes an observable state instead of
 * a sleep: while the barrier is closed the move has been entered but has not
 * returned, which is exactly the window in which a premature relocate/record
 * would be visible.
 */
class GatedMoveFilesystem extends InMemoryFilesystem {
  readonly log: string[]
  readonly entered = deferred()
  readonly gate = deferred()

  constructor(initial: Iterable<readonly [string, string]>, log: string[]) {
    super(initial)
    this.log = log
  }

  override async move(from: string, to: string, content?: string): Promise<void> {
    this.log.push('move:start')
    this.entered.resolve()
    await this.gate.promise
    this.log.push('move:finish')
    await super.move(from, to, content)
  }

  release(): void {
    this.gate.resolve()
  }
}

/**
 * Store that lets a REAL relocate happen and then fails one controlled record of
 * the destination. Arming happens after prepare, so neither initialization nor
 * prepare can fail early.
 */
class FailingRecordSnapshots extends RecordingSnapshots {
  armed = false
  failFor: string | null = null

  override record(path: string, fullText: string, seenLines?: Iterable<number>): string {
    if (this.armed && this.failFor !== null && path === this.failFor) {
      this.armed = false
      this.log.push('record:failed')
      throw new Error('injected snapshot record failure after the move')
    }
    return super.record(path, fullText, seenLines)
  }
}

const GATE_TEXT = 'alpha\nbeta\n'
const RECORD_SOURCE = 'record-src.txt'
const RECORD_DEST = 'record-dst.txt'

/**
 * SNAP-R2 scene: prepare a line edit plus a MV on a two-line file whose snapshot
 * has seen lines 1 and 2, then let the disk move and the relocate succeed while
 * only the destination record fails.
 */
async function snapshotRecordFault(): Promise<{
  failure: unknown
  fs: RecordingMoveFilesystem
  store: FailingRecordSnapshots
  tag: string
  log: string[]
}> {
  const tag = computeFileHash(GATE_TEXT)
  const log: string[] = []
  const store = new FailingRecordSnapshots(log)
  store.record(RECORD_SOURCE, GATE_TEXT, [1, 2])
  log.length = 0
  const fs = new RecordingMoveFilesystem([[RECORD_SOURCE, GATE_TEXT]], log)
  const patcher = new Patcher({ fs, snapshots: store })
  const section = Patch.parseSingle(
    '[' + RECORD_SOURCE + '#' + tag + ']\nPUT 2.=2:\n+BETA\nMV ' + RECORD_DEST,
  )
  const prepared = await patcher.prepare(section)
  // Only now: the fault must not affect record during initialization or prepare.
  log.length = 0
  store.failFor = RECORD_DEST
  store.armed = true
  let failure: unknown
  try {
    await patcher.commit(prepared)
  } catch (error) {
    failure = error
  }
  return { failure, fs, store, tag, log }
}

describe('MV commit waits for the disk move (SNAP-R1)', () => {
  it('relocates and records only after the move returns, and never while it is in flight', async () => {
    const tag = computeFileHash(SOURCE_TEXT)
    const log: string[] = []
    const store = new RecordingSnapshots(log)
    store.record(SOURCE, SOURCE_TEXT, [1, 2])
    const before = stateOf(store, SOURCE)
    const fs = new GatedMoveFilesystem([[SOURCE, SOURCE_TEXT]], log)
    const patcher = new Patcher({ fs, snapshots: store })
    const prepared = await patcher.prepare(Patch.parseSingle('[' + SOURCE + '#' + tag + ']\nMV ' + DEST))
    // Prepare is read-only for a clean move: this is the comparison point.
    log.length = 0
    expect(stateOf(store, SOURCE)).toEqual(before)

    let settled = false
    // Keep the ORIGINAL promise: only an observer flag is added, so a rejection is
    // still the promise's own outcome (the old chain swallowed it into "settled").
    const commit = patcher.commit(prepared)
    const observed = commit.then(
      () => { settled = true },
      () => { settled = true },
    )
    try {
      // The move is in flight; the barrier is closed.
      await fs.entered.promise
      await Promise.resolve()

      expect(log).toEqual(['move:start'])
      expect(settled).toBe(false)
      expect(stateOf(store, SOURCE)).toEqual(before)
      expect(stateOf(store, DEST)).toBeNull()
      expect(fs.get(SOURCE)).toBe(SOURCE_TEXT)
      expect(fs.get(DEST)).toBeUndefined()
    } finally {
      // Releasing in finally: a failed assertion above must not leave the commit
      // parked on the barrier for the rest of the run.
      fs.release()
    }
    await observed
    // The released commit must really resolve, not merely settle.
    await expect(commit).resolves.toMatchObject({ path: DEST, moveDest: DEST })

    expect(settled).toBe(true)
    expect(log).toEqual(['move:start', 'move:finish', 'relocate', 'record:' + DEST])
    expect(stateOf(store, SOURCE)).toBeNull()
    expect(stateOf(store, DEST)).toEqual({ text: SOURCE_TEXT, hash: tag, seen: [1, 2] })
  })
})

describe('relocate succeeds and the destination record fails (SNAP-R2)', () => {
  it('lands the disk move, migrates the source snapshot and keeps the old destination version', async () => {
    const scene = await snapshotRecordFault()

    // Disk: the move landed with the section edit applied.
    expect(scene.fs.get(RECORD_SOURCE)).toBeUndefined()
    expect(scene.fs.get(RECORD_DEST)).toBe('alpha\nBETA\n')
    // Snapshots: the source snapshot is GONE (relocate moved it), and the
    // destination holds the pre-edit version the relocate carried over.
    expect(stateOf(scene.store, RECORD_SOURCE)).toBeNull()
    expect(stateOf(scene.store, RECORD_DEST)).toEqual({ text: GATE_TEXT, hash: scene.tag, seen: [1, 2] })
    // The order proves the failure happened at record, after the real relocate.
    expect(scene.log).toEqual(['move', 'relocate', 'record:failed'])

    // Error identity: named, cause preserved, re-read guidance, no reverse move.
    const error = scene.failure as Error & { cause?: unknown }
    expect(error.name).toBe('SnapshotCommitError')
    expect(error.cause).toBeInstanceOf(Error)
    expect((error.cause as Error).message).toContain('injected snapshot record failure after the move')
    expect(error.message).toMatch(/re-read the destination before the next anchored edit/iu)
    expect(scene.fs.get(RECORD_DEST)).toBe('alpha\nBETA\n')
  })

  it('states the four true facts and claims nothing the store does not prove', async () => {
    const scene = await snapshotRecordFault()
    const error = scene.failure as Error
    const message = error.message

    // Facts this case establishes first, so the wording assertions below are not
    // assertions about an ambiguous state.
    expect(scene.fs.get(RECORD_DEST)).toBe('alpha\nBETA\n')
    expect(scene.fs.get(RECORD_SOURCE)).toBeUndefined()
    expect(stateOf(scene.store, RECORD_SOURCE)).toBeNull()

    // Positive semantics, asserted by meaning rather than by one fixed sentence:
    // the disk move happened, the bookkeeping did not complete, the store may be
    // partial, the original cause is quoted, and the remedy is a re-read.
    expect(message).toMatch(/moved on disk from/iu)
    expect(message).toContain(RECORD_SOURCE)
    expect(message).toContain(RECORD_DEST)
    expect(message).toMatch(/bookkeeping did not complete/iu)
    expect(message).toMatch(/may be partially updated/iu)
    expect(message).toMatch(/re-read the destination/iu)
    expect(message).toMatch(/not undone/iu)
    expect(message).toContain('injected snapshot record failure after the move')
    expect(error.name).toBe('SnapshotCommitError')
    expect(error.cause).toBeInstanceOf(Error)

    // Claims that are false in this state (relocate landed, then record threw) and
    // false in the other one (relocate threw first): none of them may appear.
    expect(message).not.toMatch(/disk was not moved/iu)
    expect(message).not.toMatch(/source snapshot (was|is) (not migrated|gone|discarded)/iu)
    expect(message).not.toMatch(/no destination snapshot/iu)
    expect(message).not.toMatch(/was not committed/iu)
  })
})

