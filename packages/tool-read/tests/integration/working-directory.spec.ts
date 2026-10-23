import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { getSessionSnapshotStore } from '@dsh-tool-hashline/hashline'
import type { ReadValue } from '../../src/index.ts'
import { createRealSessionHarness, keyIn, readIn, writeIn } from './working-directory-harness.ts'

const header = (value: ReadValue) => '[' + value.path + '#' + value.tag + ']'

const failure = (result: { error?: { message?: string } }) => result.error?.message ?? 'no error message'

const valueOf = <T>(result: { isError: boolean; value?: unknown; error?: { message: string } }): T => {
  if (result.isError) throw new Error('expected success, got error: ' + result.error?.message)
  return result.value as T
}

/** Whether this platform lets us create a file symlink (Windows needs privilege). */
const symlinkSupported = (() => {
  try {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-hashline-symlink-probe-'))
    try {
      symlinkSync('target', path.join(dir, 'link'), 'file')
      return true
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    return false
  }
})()

describe('D1 — real Session working directory (FR-7)', () => {
  it('keeps the real Session shape and edits a relative header in the session directory', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    await writeIn(harness.root, 'rel.txt', 'one\ntwo\n')
    // A production Session has no `cwd` property; only the header keeps the origin.
    expect(Object.prototype.hasOwnProperty.call(harness.session, 'cwd')).toBe(false)
    expect(path.resolve(harness.root)).not.toBe(path.resolve(process.cwd()))

    const value = valueOf<ReadValue>(await harness.read({ file_path: 'rel.txt' }))
    expect(value.path).toBe(keyIn(harness.root, 'rel.txt'))
    const store = getSessionSnapshotStore(harness.session)
    expect(store.head(keyIn(harness.root, 'rel.txt'))?.hash).toBe(value.tag)

    const edited = await harness.edit({ input: '[rel.txt#' + value.tag + ']\nPUT 1.=1:\n+ONE' })
    expect(edited.isError, failure(edited)).toBe(false)
    expect(await readIn(keyIn(harness.root, 'rel.txt'))).toBe('ONE\ntwo\n')
  })

  it('resolves replace and patch mode relative paths in the session directory', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    await writeIn(harness.root, 'replace.txt', 'one\ntwo\n')
    await writeIn(harness.root, 'patch.txt', 'one\ntwo\n')

    const replaced = await harness.edit({ path: 'replace.txt', old_string: 'one', new_string: 'ONE' })
    expect(replaced.isError, failure(replaced)).toBe(false)
    expect(await readIn(keyIn(harness.root, 'replace.txt'))).toBe('ONE\ntwo\n')

    const patchApplied = await harness.edit({
      path: 'patch.txt',
      edits: [{ diff: '--- a/patch.txt\n+++ b/patch.txt\n@@ -1 +1 @@\n-one\n+ONE' }],
    })
    expect(patchApplied.isError, failure(patchApplied)).toBe(false)
    expect(await readIn(keyIn(harness.root, 'patch.txt'))).toBe('ONE\ntwo\n')
  })

  it('edits an absolute show path returned by read', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const file = await writeIn(harness.root, 'abs.txt', 'one\ntwo\n')
    const value = valueOf<ReadValue>(await harness.read({ file_path: file }))
    expect(value.path).toBe(file)
    const edited = await harness.edit({ input: '[abs.txt#' + value.tag + ']\nPUT 2.=2:\n+TWO' })
    expect(edited.isError, failure(edited)).toBe(false)
    expect(await readIn(file)).toBe('one\nTWO\n')
  })

  it('deletes a file inside the session directory with REM', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const file = await writeIn(harness.root, 'rem.txt', 'a\nb\n')
    const value = valueOf<ReadValue>(await harness.read({ file_path: 'rem.txt' }))
    const result = await harness.edit({ input: '[rem.txt#' + value.tag + ']\nREM' })
    expect(result.isError, failure(result)).toBe(false)
    await expect(readIn(file)).rejects.toThrow()
  })

  it('moves a file inside the session directory with MV and checks both endpoints', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const file = await writeIn(harness.root, 'mv-src.txt', 'a\nb\n')
    const value = valueOf<ReadValue>(await harness.read({ file_path: 'mv-src.txt' }))
    const result = await harness.edit({ input: '[mv-src.txt#' + value.tag + ']\nMV mv-dest.txt' })
    expect(result.isError, failure(result)).toBe(false)
    expect(await readIn(keyIn(harness.root, 'mv-dest.txt'))).toBe('a\nb\n')
    await expect(readIn(file)).rejects.toThrow()
  })

  it('still rejects REM and MV outside the session directory', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const sibling = await mkdtemp(path.join(os.tmpdir(), 'dsh-hashline-outside-'))
    onTestFinished(() => rm(sibling, { recursive: true, force: true }))
    const outside = path.join(sibling, 'outside.txt')
    await writeFile(outside, 'x\ny\n', 'utf8')
    const outsideValue = valueOf<ReadValue>(await harness.read({ file_path: outside }))
    const removed = await harness.edit({ input: '[' + outside + '#' + outsideValue.tag + ']\nREM' })
    expect(removed.isError).toBe(true)
    expect(failure(removed)).toContain('outside the working directory')
    expect(await readIn(outside)).toBe('x\ny\n')

    await writeIn(harness.root, 'keep.txt', 'a\nb\n')
    const keep = valueOf<ReadValue>(await harness.read({ file_path: 'keep.txt' }))
    const escapeDir = path.join(sibling, 'escape.txt')
    const moved = await harness.edit({ input: '[keep.txt#' + keep.tag + ']\nMV ' + escapeDir })
    expect(moved.isError).toBe(true)
    expect(failure(moved)).toContain('outside the working directory')
    expect(await readIn(keyIn(harness.root, 'keep.txt'))).toBe('a\nb\n')
  })

  it('follows a runtime working-directory change instead of the header origin', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const next = path.join(harness.root, 'next')
    await mkdir(next)
    await writeIn(next, 'moved.txt', 'one\ntwo\n')
    await expect(harness.ctx.workingDirectory.set(harness.agent, next)).resolves.toBe(next)

    const value = valueOf<ReadValue>(await harness.read({ file_path: 'moved.txt' }))
    expect(value.path).toBe(keyIn(next, 'moved.txt'))
    const edited = await harness.edit({ input: '[moved.txt#' + value.tag + ']\nPUT 2.=2:\n+TWO' })
    expect(edited.isError, failure(edited)).toBe(false)
    expect(await readIn(path.join(next, 'moved.txt'))).toBe('one\nTWO\n')
    await expect(readIn(path.join(harness.root, 'moved.txt'))).rejects.toThrow()
  })

  it('keeps two Sessions with different directories and snapshots independent', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const otherDir = path.join(harness.root, 'other')
    const other = await harness.createAgent('cwd-other', otherDir)
    await writeIn(harness.root, 'same.txt', 'one\ntwo\n')
    await writeIn(otherDir, 'same.txt', 'alpha\nbeta\n')

    const first = valueOf<ReadValue>(await harness.read({ file_path: 'same.txt' }, harness.agent))
    const second = valueOf<ReadValue>(await harness.read({ file_path: 'same.txt' }, other))
    expect(first.path).toBe(keyIn(harness.root, 'same.txt'))
    expect(second.path).toBe(keyIn(otherDir, 'same.txt'))
    expect(first.tag).not.toBe(second.tag)

    const firstStore = getSessionSnapshotStore(harness.session)
    const secondStore = getSessionSnapshotStore(other.session)
    expect(firstStore.head(keyIn(harness.root, 'same.txt'))?.hash).toBe(first.tag)
    expect(secondStore.head(keyIn(otherDir, 'same.txt'))?.hash).toBe(second.tag)

    expect((await harness.edit({ input: '[same.txt#' + first.tag + ']\nPUT 1.=1:\n+ONE' }, harness.agent)).isError).toBe(false)
    expect((await harness.edit({ input: '[same.txt#' + second.tag + ']\nPUT 2.=2:\n+BETA' }, other)).isError).toBe(false)
    expect(await readIn(keyIn(harness.root, 'same.txt'))).toBe('ONE\ntwo\n')
    expect(await readIn(keyIn(otherDir, 'same.txt'))).toBe('alpha\nBETA\n')
  })

  it('keeps the bounded seen guard and the zero-line sentinel', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const lines = Array.from({ length: 10 }, (_, index) => 'l' + (index + 1))
    await writeIn(harness.root, 'guard.txt', lines.join('\n') + '\n')
    const value = valueOf<ReadValue>(await harness.read({ file_path: 'guard.txt', offset: 1, limit: 1 }))
    const store = getSessionSnapshotStore(harness.session)
    expect([...store.head(keyIn(harness.root, 'guard.txt'))?.seenLines ?? []]).toEqual([1])

    const rejected = await harness.edit({ input: '[guard.txt#' + value.tag + ']\nPUT 8.=8:\n+x' })
    expect(rejected.isError).toBe(true)
    const retried = await harness.edit({ input: '[guard.txt#' + value.tag + ']\nPUT 8.=8:\n+x' })
    expect(retried.isError).toBe(false)

    const clipped = await createRealSessionHarness({ read: { maxLineLength: 5 } })
    onTestFinished(() => clipped.dispose())
    await writeIn(clipped.root, 'clipped.txt', 'abcdefghij\nsecond\n')
    const short = valueOf<ReadValue>(await clipped.read({ file_path: 'clipped.txt' }))
    const clippedStore = getSessionSnapshotStore(clipped.session)
    expect([...clippedStore.head(keyIn(clipped.root, 'clipped.txt'))?.seenLines ?? []]).toEqual([0])
    const denied = await clipped.edit({ input: '[clipped.txt#' + short.tag + ']\nPUT 1.=1:\n+x' })
    expect(denied.isError).toBe(true)
  })

  it.skipIf(!symlinkSupported)('records both the alias and the show path for a symlinked alias', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const target = await writeIn(harness.root, 'real.txt', 'one\ntwo\n')
    try {
      await symlink(target, keyIn(harness.root, 'alias.txt'), 'file')
    } catch {
      return
    }
    const value = valueOf<ReadValue>(await harness.read({ file_path: 'alias.txt' }))
    const store = getSessionSnapshotStore(harness.session)
    expect(store.head(keyIn(harness.root, 'alias.txt'))?.hash).toBe(value.tag)
    expect(store.head(keyIn(harness.root, value.path))?.hash).toBe(value.tag)
    expect((await harness.edit({ input: '[alias.txt#' + value.tag + ']\nPUT 2.=2:\n+TWO' })).isError).toBe(false)
    expect(await readIn(target)).toBe('one\nTWO\n')
  })
})
