import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { computeFileHash } from '@dsh-tool-hashline/hashline'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { ReadValue } from '../../src/index.ts'
import { createHarness, readFixture, valueOf, writeFixture } from './harness.ts'

const textOf = (result: { content: { type: string; text?: string }[] }) =>
  result.content.map(block => block.type === 'text' ? block.text ?? '' : '').join('')

describe('normalization parity (ticket 03)', () => {
  it('strips the BOM and normalizes CRLF before hashing, and renders no phantom line', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'bom.ts', '\uFEFFone\r\ntwo\r\n')
    const result = await harness.callRead({ file_path: file })
    const value = valueOf<ReadValue>(result)
    expect(value.lines.map(line => line.text)).toEqual(['one', 'two'])
    expect(value.totalLines).toBe(2)
    expect(value.tag).toBe(computeFileHash('one\ntwo\n'))
    expect(textOf(result as never)).not.toContain('\r')
  })

  it('keeps blank interior lines and the trailing-newline line count', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'blank.txt', 'a\n\nb\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file }))
    expect(value.totalLines).toBe(3)
    expect(value.lines.map(line => line.number)).toEqual([1, 2, 3])
    expect(value.tag).toBe(computeFileHash('a\n\nb\n'))
  })
})

describe('empty file', () => {
  it('returns an empty untagged window that points at write', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'empty.txt', '')
    const result = await harness.callRead({ file_path: file })
    const value = valueOf<ReadValue>(result)
    expect(value).toMatchObject({ tagged: false, tag: null, offset: 1, lines: [], totalLines: 0 })
    expect(value.nextAction).toContain('write tool')
    const text = textOf(result as never)
    expect(text).toContain('<content>\n(End of file - total 0 lines)')
    expect(text).not.toMatch(/\[[^\]]+#[0-9A-F]{4}\]/u)
  })
})

describe('agentless reads', () => {
  it('never mints without a session and explains the replace/patch path', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'solo.txt', 'one\ntwo\n')
    const value = valueOf<ReadValue>(await harness.callTool('read', { file_path: file }, { agent: null }))
    expect(value.tagged).toBe(false)
    expect(value.tag).toBeNull()
    expect(value.nextAction).toContain('no agent session')
    expect(value.lines).toHaveLength(2)
  })
})

describe('snapshotMaxBytes gate', () => {
  it('mints at N-1 and refuses at N and N+1 normalized UTF-8 bytes', async () => {
    const harness = await createHarness({ read: { snapshotMaxBytes: 10 } })
    onTestFinished(() => harness.cleanup())
    const ok = valueOf<ReadValue>(await harness.callRead({ file_path: await writeFixture(harness.dir, 'n-1.txt', 'abcdefghi') }))
    expect(ok.tagged).toBe(true)
    const at = valueOf<ReadValue>(await harness.callRead({ file_path: await writeFixture(harness.dir, 'n.txt', 'abcdefghij') }))
    expect(at).toMatchObject({ tagged: false, tag: null })
    expect(at.nextAction).toContain('10 bytes or more')
    const over = valueOf<ReadValue>(await harness.callRead({ file_path: await writeFixture(harness.dir, 'n+1.txt', 'abcdefghijk') }))
    expect(over.tagged).toBe(false)
    expect(over.lines).toEqual([{ number: 1, text: 'abcdefghijk' }])
  })

  it('counts UTF-8 bytes of multibyte text', async () => {
    const harness = await createHarness({ read: { snapshotMaxBytes: 10 } })
    onTestFinished(() => harness.cleanup())
    const fits = valueOf<ReadValue>(await harness.callRead({ file_path: await writeFixture(harness.dir, 'mb-1.txt', '\u4f60\u597d\u4f60') }))
    expect(fits.tagged).toBe(true)
    const tooBig = valueOf<ReadValue>(await harness.callRead({ file_path: await writeFixture(harness.dir, 'mb-2.txt', '\u4f60\u597d\u4f60\u597d') }))
    expect(tooBig.tagged).toBe(false)
  })

  it('reads a large file with one stat and one whole-text read, minting nothing', async () => {
    const harness = await createHarness({ read: { snapshotMaxBytes: 1000 } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'big.txt', 'z'.repeat(1024 * 1024))
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file }))
    expect(value.tagged).toBe(false)
    expect(value.nextAction).toContain('replace or patch')
    expect(harness.counts).toEqual({ stat: 1, readText: 1, resolve: 1 })
  })

  it('decides from normalized text bytes, not stat.size (BOM/CRLF and unknown size)', async () => {
    const harness = await createHarness({ read: { snapshotMaxBytes: 10 } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'bom-limit.txt', '\uFEFFabcdefgh\r\n')
    const minted = valueOf<ReadValue>(await harness.callRead({ file_path: file }))
    expect(minted.tagged).toBe(true)
    expect(minted.tag).toBe(computeFileHash('abcdefgh\n'))

    const fs = harness.ctx.fs as unknown as { stat: (target: unknown, signal?: AbortSignal) => Promise<Record<string, unknown> | undefined> }
    const stat = fs.stat.bind(harness.ctx.fs)
    fs.stat = async (target, signal) => {
      const info = await stat(target, signal)
      if (info === undefined) return undefined
      const { size: _size, ...rest } = info
      return rest
    }
    const big = valueOf<ReadValue>(await harness.callRead({ file_path: await writeFixture(harness.dir, 'unknown-size.txt', 'abcdefghij') }))
    expect(big.tagged).toBe(false)
    expect(big.nextAction).toContain('10 bytes or more')
  })
})

describe('read failures', () => {
  it('observes absence and raises FS_NOT_FOUND for a missing file', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const missing = path.join(harness.dir, 'nope.txt')
    const result = await harness.callRead({ file_path: missing })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_NOT_FOUND')
    expect(result.error?.message).toBe('cannot read "' + missing + '": not found')
    expect(harness.observations.at(-1)?.kind).toBe('absent')
  })

  it('raises FS_NOT_REGULAR_FILE for a directory without minting', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const directory = path.join(harness.dir, 'sub')
    await mkdir(directory)
    const result = await harness.callRead({ file_path: directory })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_NOT_REGULAR_FILE')
    expect(result.error?.message).toBe('cannot read "' + directory + '": not a regular file')
  })

  it('raises FS_NOT_TEXT for invalid UTF-8 and does not mint', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = path.join(harness.dir, 'binary.bin')
    await writeFile(file, Buffer.from([0xff, 0xfe, 0x00, 0x01]))
    const result = await harness.callRead({ file_path: file })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_NOT_TEXT')
  })

  it('passes provider errors through with their code and message', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'denied.txt', 'secret\n')
    const fs = harness.ctx.fs as unknown as { readText: (target: unknown, signal?: AbortSignal) => Promise<string> }
    fs.readText = async () => {
      throw new FsError('cannot read "denied.txt": permission denied', 'FS_PERMISSION_DENIED')
    }
    const result = await harness.callRead({ file_path: file })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_PERMISSION_DENIED')
    expect(result.error?.message).toBe('cannot read "denied.txt": permission denied')
    expect(harness.observations.length).toBe(0)
  })

  it('surfaces cancellation as an error, never as absence', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'cancel.txt', 'one\n')
    const controller = new AbortController()
    controller.abort()
    const result = await harness.callTool('read', { file_path: file }, { signal: controller.signal })
    expect(result.isError).toBe(true)
    // The registry refuses a pre-aborted call before dispatch; either way the
    // cancellation is an error and no absent observation is fabricated.
    expect(result.error?.info?.code).toBe('ABORTED_BEFORE_DISPATCH')
    expect(harness.observations).toEqual([])
  })

  it('keeps a provider FS_ABORTED code when the read is cancelled mid-flight', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'cancel-mid.txt', 'one\n')
    const fs = harness.ctx.fs as unknown as { readText: (target: unknown, signal?: AbortSignal) => Promise<string> }
    fs.readText = async () => {
      throw new FsError('read aborted', 'FS_ABORTED')
    }
    const result = await harness.callRead({ file_path: file })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_ABORTED')
    expect(result.error?.message).toBe('read aborted')
  })
})

describe('untagged degradation through the real edit tool', () => {
  it('edits an over-limit file with replace and patch mode without a tag', async () => {
    const harness = await createHarness({ read: { snapshotMaxBytes: 5 } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'degrade.txt', 'one\ntwo\nthree\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file }))
    expect(value.tagged).toBe(false)
    expect(value.nextAction).toContain('replace or patch')

    const replaced = await harness.callEdit({ path: value.path, old_string: 'two', new_string: 'TWO' })
    expect(replaced.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\nthree\n')

    const patched = await harness.callEdit({
      path: value.path,
      edits: [{ op: 'update', diff: '@@ -3,1 +3,1 @@\n-three\n+THREE\n' }],
    })
    expect(patched.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\nTHREE\n')
  })
})