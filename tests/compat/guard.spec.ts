import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { symlink, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { computeFileHash, getSessionSnapshotStore, normalizeToLF, stripBom } from '@dsh-tool-hashline/hashline'
import type { ReadValue } from '../../packages/tool-read/src/index.ts'
import { createHarness, readFixture, valueOf, writeFixture } from '../../packages/tool-read/tests/integration/harness.ts'

/** Whether this platform lets us create a file symlink (Windows needs privilege). */
const symlinkSupported = (() => {
  try {
    const dir = mkdtempSync(`${os.tmpdir()}/dsh-symlink-probe-`)
    try {
      symlinkSync('target', `${dir}/link`, 'file')
      return true
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    return false
  }
})()

const header = (value: ReadValue) => '[' + value.path + '#' + value.tag + ']'
const textOf = (result: { content: { type: string; text?: string }[] }) =>
  result.content.map(block => block.type === 'text' ? block.text ?? '' : '').join('')

describe('seen union across windows (FR-7)', () => {
  it('lets anchors from two separate windows be edited', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const lines = Array.from({ length: 500 }, (_, index) => 'line-' + (index + 1))
    const file = await writeFixture(harness.dir, 'union.txt', lines.join('\n') + '\n')
    const first = valueOf<ReadValue>(await harness.callRead({ file_path: file, offset: 1, limit: 50 }))
    const second = valueOf<ReadValue>(await harness.callRead({ file_path: file, offset: 400, limit: 51 }))
    expect(first.tag).toBe(second.tag)
    const key = path.resolve(harness.dir, file)
    const seen = [...getSessionSnapshotStore(harness.session).head(key)?.seenLines ?? []].sort((a, b) => a - b)
    expect(seen).toHaveLength(101)
    expect(seen[0]).toBe(1)
    expect(seen.at(-1)).toBe(450)

    expect((await harness.callEdit({ input: header(first) + '\nPUT 3.=3:\n+line-3' })).isError).toBe(false)
    expect((await harness.callEdit({ input: header(second) + '\nPUT 420.=420:\n+line-420' })).isError).toBe(false)
    const disk = (await readFixture(file)).split('\n')
    expect(disk[2]).toBe('line-3')
    expect(disk[419]).toBe('line-420')
  })
})

describe('continuous editing (FR-7/FR-13)', () => {
  it('uses the tag returned by the edit response for the next change', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'chain.txt', 'one\ntwo\nthree\n')
    const first = valueOf<ReadValue>(await harness.callRead({ file_path: file }))
    const edited = await harness.callEdit({ input: header(first) + '\nPUT 2.=2:\n+TWO' })
    expect(edited.isError).toBe(false)
    const newHeader = String(edited.value).split('\n')[0] ?? ''
    expect(newHeader).toMatch(/^\[[^\]]+#[0-9A-F]{4}\]$/u)
    const tag = /#([0-9A-F]{4})\]/u.exec(newHeader)?.[1]
    expect(tag).toBe(computeFileHash('one\nTWO\nthree\n'))
    const next = await harness.callEdit({ input: '[' + first.path + '#' + tag + ']\nPUT 3.=3:\n+THREE' })
    expect(next.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\nTHREE\n')
  })
})

describe('store keys (FR-7)', () => {
  it('records the input key and the show-path key and edits through the show path', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'rel.txt', 'one\ntwo\nthree\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: 'rel.txt' }))
    expect(path.isAbsolute(value.path)).toBe(true)
    const store = getSessionSnapshotStore(harness.session)
    expect(store.head(path.resolve(harness.dir, 'rel.txt'))?.hash).toBe(value.tag)
    expect(store.head(path.resolve(harness.dir, value.path))?.hash).toBe(value.tag)
    expect(harness.counts.readText).toBe(1)
    const edited = await harness.callEdit({ input: header(value) + '\nPUT 1.=1:\n+ONE' })
    expect(edited.isError, edited.error?.message).toBe(false)
    expect(await readFixture(path.join(harness.dir, 'rel.txt'))).toBe('ONE\ntwo\nthree\n')
  })

  it('edits through a relative path read and an absolute path read alike', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const absolute = await writeFixture(harness.dir, 'abs.txt', 'one\ntwo\n')
    const relValue = valueOf<ReadValue>(await harness.callRead({ file_path: 'abs.txt' }))
    const relEdit = await harness.callEdit({ input: header(relValue) + '\nPUT 1.=1:\n+ONE' })
    expect(relEdit.isError, relEdit.error?.message).toBe(false)
    const absValue = valueOf<ReadValue>(await harness.callRead({ file_path: absolute }))
    const absEdit = await harness.callEdit({ input: header(absValue) + '\nPUT 2.=2:\n+TWO' })
    expect(absEdit.isError, absEdit.error?.message).toBe(false)
    expect(await readFixture(absolute)).toBe('ONE\nTWO\n')
  })

  it.skipIf(!symlinkSupported)('records both keys for a symlinked alias', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const target = await writeFixture(harness.dir, 'real.txt', 'one\ntwo\n')
    const alias = path.join(harness.dir, 'alias.txt')
    await symlink(target, alias, 'file')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: 'alias.txt' }))
    const store = getSessionSnapshotStore(harness.session)
    expect(store.head(path.resolve(harness.dir, 'alias.txt'))?.hash).toBe(value.tag)
    expect(store.head(path.resolve(harness.dir, value.path))?.hash).toBe(value.tag)
    expect(path.resolve(harness.dir, 'alias.txt')).not.toBe(path.resolve(harness.dir, value.path))
    expect((await harness.callEdit({ input: header(value) + '\nPUT 2.=2:\n+TWO' })).isError).toBe(false)
    expect(await readFixture(target)).toBe('one\nTWO\n')
  })
})

describe('recovery from this session\'s own snapshots (FR-9)', () => {
  it('applies an edit that carries the pre-edit tag by recovering to the newer snapshot', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'recover.txt', 'one\ntwo\nthree\n')
    const first = valueOf<ReadValue>(await harness.callRead({ file_path: file }))
    expect((await harness.callEdit({ input: header(first) + '\nPUT 2.=2:\n+TWO' })).isError).toBe(false)
    const stale = await harness.callEdit({ input: header(first) + '\nPUT 3.=3:\n+THREE' })
    expect(stale.isError).toBe(false)
    expect(textOf(stale as never)).toContain('Recovered from a stale file hash')
    expect(await readFixture(file)).toBe('one\nTWO\nTHREE\n')
  })
})

describe('recovery bypasses the seen check (FR-7)', () => {
  it('applies a never-displayed anchor through recovery to a newer snapshot', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'recover-unseen.txt', Array.from({ length: 10 }, (_, index) => 'l' + (index + 1)).join('\n') + '\n')
    const first = valueOf<ReadValue>(await harness.callRead({ file_path: file, offset: 1, limit: 1 }))
    expect((await harness.callEdit({ input: header(first) + '\nPUT 1.=1:\n+l1-edited' })).isError).toBe(false)
    // Line 9 was never displayed in any window; the stale tag recovers to the
    // post-edit snapshot, whose provenance is absent, so the guard is skipped.
    const unseen = await harness.callEdit({ input: header(first) + '\nPUT 9.=9:\n+l9-edited' })
    expect(unseen.isError).toBe(false)
    expect(textOf(unseen as never)).toContain('Recovered from a stale file hash')
    expect((await readFixture(file)).split('\n')[8]).toBe('l9-edited')
  })
})

describe('external drift (FR-9)', () => {
  it('rejects an anchor-level edit after external change and names the current tag with read guidance', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'drift.txt', 'one\ntwo\nthree\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file }))
    const drifted = 'one\nXX\nthree\n'
    await writeFile(file, drifted)
    const currentTag = computeFileHash(drifted)
    expect(currentTag).not.toBe(value.tag)
    const rejected = await harness.callEdit({ input: header(value) + '\nPUT 2.=2:\n+Y' })
    expect(rejected.isError).toBe(true)
    expect(rejected.error?.message).toContain('#' + String(currentTag))
    expect(rejected.error?.message).toMatch(/re-read|read the file/u)
    expect(rejected.error?.message).toContain('changed between read and edit')
  })

  it('accepts the current tag reported by the mismatch error on retry (no seen recorded)', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'mismatch-retry.txt', 'one\ntwo\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file }))
    const drifted = 'one\nXX\n'
    await writeFile(file, drifted)
    const rejected = await harness.callEdit({ input: header(value) + '\nPUT 2.=2:\n+Y' })
    expect(rejected.isError).toBe(true)
    const currentTag = computeFileHash(drifted)
    expect(rejected.error?.message).toContain('#' + String(currentTag))
    // The mismatch records the current content without seen provenance, so the
    // revealed tag applies and the guard is skipped for that snapshot.
    const retried = await harness.callEdit({ input: '[' + value.path + '#' + currentTag + ']\nPUT 2.=2:\n+Y' })
    expect(retried.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nY\n')
  })

  it('applies a head/tail edit with the drift warning instead of rejecting', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'tail.txt', 'one\ntwo\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file }))
    await writeFile(file, 'head\none\ntwo\n')
    const result = await harness.callEdit({ input: header(value) + '\nPUT >$:\n+tail' })
    expect(result.isError).toBe(false)
    expect(textOf(result as never)).toContain('despite a stale snapshot tag')
    expect(await readFixture(file)).toBe('head\none\ntwo\ntail\n')
  })
})

describe('bounded unseen-line guard (FR-7/FR-13)', () => {
  it('reveals up to 40 unseen lines, so the same edit is accepted on retry', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const lines = Array.from({ length: 80 }, (_, index) => 'l' + (index + 1))
    const file = await writeFixture(harness.dir, 'reveal.txt', lines.join('\n') + '\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file, offset: 1, limit: 1 }))
    const input = header(value) + '\nPUT 2.=10:\n+x'
    const rejected = await harness.callEdit({ input })
    expect(rejected.isError).toBe(true)
    expect(rejected.error?.message).toContain('never displayed')
    const retried = await harness.callEdit({ input })
    expect(retried.isError).toBe(false)
  })

  it('truncates a wider reveal, so retrying the same edit is still rejected', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const lines = Array.from({ length: 120 }, (_, index) => 'l' + (index + 1))
    const file = await writeFixture(harness.dir, 'wide-reveal.txt', lines.join('\n') + '\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file, offset: 1, limit: 1 }))
    const input = header(value) + '\nPUT 2.=70:\n+x'
    const rejected = await harness.callEdit({ input })
    expect(rejected.isError).toBe(true)
    const retried = await harness.callEdit({ input })
    expect(retried.isError).toBe(true)
  })
})

describe('cross-session and eviction are known permissive paths (R-7)', () => {
  it('lets another session edit with a tag minted here (silent guard skip)', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'xsession.txt', 'one\ntwo\nthree\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file }))
    const otherAgent = { session: { cwd: harness.dir, header: { cwd: harness.dir } } }
    const edited = await harness.callTool('edit', { input: header(value) + '\nPUT 2.=2:\n+TWO' }, { agent: otherAgent as never })
    expect(edited.isError, edited.error?.message).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\nthree\n')
  })

  it('loses the guard after the path is evicted from the bounded store', async () => {
    const harness = await createHarness({ snapshotStore: { maxPaths: 1 } })
    onTestFinished(() => harness.cleanup())
    const first = await writeFixture(harness.dir, 'first.txt', 'one\ntwo\nthree\n')
    const firstValue = valueOf<ReadValue>(await harness.callRead({ file_path: first }))
    await harness.callRead({ file_path: await writeFixture(harness.dir, 'second.txt', 'x\ny\n') })
    const store = getSessionSnapshotStore(harness.session)
    expect(store.head(path.resolve(harness.dir, first))).toBeNull()
    const edited = await harness.callEdit({ input: header(firstValue) + '\nPUT 3.=3:\n+THREE' })
    expect(edited.isError).toBe(false)
    expect(await readFixture(first)).toBe('one\ntwo\nTHREE\n')
  })
})

describe('REM has no line anchor (FR-7)', () => {
  it('deletes the file without consuming the seen guard', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'rem.txt', 'a\nb\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file, offset: 1, limit: 1 }))
    const result = await harness.callEdit({ input: header(value) + '\nREM' })
    expect(result.isError).toBe(false)
    await expect(readFixture(file)).rejects.toThrow()
  })
})