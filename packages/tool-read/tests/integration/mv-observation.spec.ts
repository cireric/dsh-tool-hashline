/**
 * MV and REM with the production observation policy mounted (MV fix plan §3.A/§3.D).
 *
 * The fixture is the real Session stack: real `WorkingDirectory`, real
 * `fs-observation-policy`, real local provider, real upstream `edit`. The policy
 * owns the `fs/edit-intent` and `fs/write-intent` slots, so these cases are the
 * only ones that can see the write-intent contract a deployment enforces —
 * a fixture without it reports green for an MV a real profile rejects.
 *
 * Failure injection is a deterministic wrapper on `ctx.fs.writeText` (the
 * provider seam), never a timing race: each wrapper performs exactly one
 * documented side effect and delegates to the real provider.
 */
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { FsError } from '@deepseek-ai/dsh-fs'
import { computeFileHash, getSessionSnapshotStore, normalizeToLF, stripBom } from '@dsh-tool-hashline/hashline'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { ReadValue } from '../../src/index.ts'
import { createRealSessionHarness, keyIn, readIn, writeIn } from './working-directory-harness.ts'
import type { RealSessionHarness } from './working-directory-harness.ts'

const header = (value: ReadValue) => '[' + value.path + '#' + value.tag + ']'

const failure = (result: { error?: { message?: string } }) => result.error?.message ?? 'no error message'

const valueOf = <T>(result: { isError: boolean; value?: unknown; error?: { message: string } }): T => {
  if (result.isError) throw new Error('expected success, got error: ' + result.error?.message)
  return result.value as T
}

/** Read a fixture and return the tagged value (the model's first move). */
async function readTag(harness: RealSessionHarness, name: string): Promise<ReadValue> {
  return valueOf<ReadValue>(await harness.read({ file_path: name }))
}

describe('MV under the production observation policy', () => {
  it('mounts the policy by default and leaves the edit-intent slot to it', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    expect(harness.policy).toBe(true)
    const target = await harness.ctx.fs.resolve('policy-probe.txt', { cwd: harness.root })
    await expect(harness.ctx.waterfall('fs/edit-intent', target, { agent: harness.agent }, () => undefined))
      .rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })

    // Contrast: without the policy the bare provider's unconditional edit stands.
    const bare = await createRealSessionHarness({ policy: false })
    onTestFinished(() => bare.dispose())
    expect(bare.policy).toBe(false)
    const bareTarget = await bare.ctx.fs.resolve('policy-probe.txt', { cwd: bare.root })
    // No listener on the slot: the waterfall falls through to `next()` synchronously.
    expect(await bare.ctx.waterfall('fs/edit-intent', bareTarget, { agent: bare.agent }, () => undefined))
      .toBeUndefined()
  })

  it('moves to a target this session never observed', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const source = await writeIn(harness.root, 'mv-new.txt', 'a\nb\n')
    const value = await readTag(harness, 'mv-new.txt')

    const result = await harness.edit({ input: header(value) + '\nMV mv-new-dest.txt' })

    expect(result.isError, failure(result)).toBe(false)
    expect(await readIn(keyIn(harness.root, 'mv-new-dest.txt'))).toBe('a\nb\n')
    await expect(readIn(source)).rejects.toThrow()
  })

  it('moves to a target already observed as absent', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const source = await writeIn(harness.root, 'mv-absent-src.txt', 'a\nb\n')
    // The report's second attempt: observe the missing target first.
    const missing = await harness.read({ file_path: 'mv-absent-dest.txt' })
    expect(missing.isError).toBe(true)
    expect(missing.error?.info?.code).toBe('FS_NOT_FOUND')

    const value = await readTag(harness, 'mv-absent-src.txt')
    const result = await harness.edit({ input: header(value) + '\nMV mv-absent-dest.txt' })

    expect(result.isError, failure(result)).toBe(false)
    expect(await readIn(keyIn(harness.root, 'mv-absent-dest.txt'))).toBe('a\nb\n')
    await expect(readIn(source)).rejects.toThrow()
  })

  it('refuses to overwrite an existing target that was never read', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const source = await writeIn(harness.root, 'mv-taken-src.txt', 'a\nb\n')
    await writeIn(harness.root, 'mv-taken.txt', 'keep\n')
    const value = await readTag(harness, 'mv-taken-src.txt')

    const result = await harness.edit({ input: header(value) + '\nMV mv-taken.txt' })

    expect(result.isError).toBe(true)
    expect(failure(result)).toContain('destination already exists')
    expect(await readIn(keyIn(harness.root, 'mv-taken.txt'))).toBe('keep\n')
    expect(await readIn(source)).toBe('a\nb\n')
  })

  it('refuses to overwrite an existing target that was read (observed present)', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const source = await writeIn(harness.root, 'mv-taken2-src.txt', 'a\nb\n')
    await writeIn(harness.root, 'mv-taken2.txt', 'keep\n')
    // A present observation must not be turned into a replace intent by the move.
    await readTag(harness, 'mv-taken2.txt')
    const value = await readTag(harness, 'mv-taken2-src.txt')

    const result = await harness.edit({ input: header(value) + '\nMV mv-taken2.txt' })

    expect(result.isError).toBe(true)
    expect(failure(result)).toContain('destination already exists')
    expect(await readIn(keyIn(harness.root, 'mv-taken2.txt'))).toBe('keep\n')
    expect(await readIn(source)).toBe('a\nb\n')
  })

  it('applies a line edit and a move in the same section', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    await writeIn(harness.root, 'mv-combo.txt', 'a\nb\nc\n')
    const value = await readTag(harness, 'mv-combo.txt')

    const result = await harness.edit({ input: header(value) + '\nPUT 2.=2:\n+BETA\nMV mv-combo-dest.txt' })

    expect(result.isError, failure(result)).toBe(false)
    expect(await readIn(keyIn(harness.root, 'mv-combo-dest.txt'))).toBe('a\nBETA\nc\n')
    await expect(readIn(keyIn(harness.root, 'mv-combo.txt'))).rejects.toThrow()
  })

  it('refuses a target that appears between the stat and the guarded create', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const source = await writeIn(harness.root, 'mv-race-src.txt', 'a\nb\n')
    const destination = keyIn(harness.root, 'mv-race-dest.txt')
    const original = harness.ctx.fs.writeText.bind(harness.ctx.fs)
    let injected = false
    harness.ctx.fs.writeText = async (...args) => {
      const [target, , expected] = args
      if (!injected && expected?.kind === 'createIfAbsent' && target.displayPath === destination) {
        injected = true
        // A concurrent creator wins after our stat and before our create.
        await writeFile(destination, 'concurrent\n', 'utf8')
      }
      return original(...args)
    }
    const value = await readTag(harness, 'mv-race-src.txt')

    const result = await harness.edit({ input: header(value) + '\nMV mv-race-dest.txt' })

    expect(injected).toBe(true)
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_NOT_OBSERVED')
    expect(await readIn(destination)).toBe('concurrent\n')
    expect(await readIn(source)).toBe('a\nb\n')
  })

  it('reports a partial success when the call is cancelled after the target was created', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const source = await writeIn(harness.root, 'mv-cancel-src.txt', 'a\nb\n')
    const destination = keyIn(harness.root, 'mv-cancel-dest.txt')
    const controller = new AbortController()
    const original = harness.ctx.fs.writeText.bind(harness.ctx.fs)
    harness.ctx.fs.writeText = async (...args) => {
      const outcome = await original(...args)
      if (args[0].displayPath === destination) controller.abort()
      return outcome
    }
    const value = await readTag(harness, 'mv-cancel-src.txt')

    const result = await harness.edit({ input: header(value) + '\nMV mv-cancel-dest.txt' }, undefined, controller.signal)

    expect(result.isError).toBe(true)
    // The target landed; nothing else may claim a plain success or a no-op.
    expect(await readIn(destination)).toBe('a\nb\n')
    expect(failure(result)).toContain(destination)
    expect(failure(result)).toContain(source)
    expect(failure(result)).toMatch(/target.*created|created.*target/iu)
    expect(failure(result)).toMatch(/source|src|源/iu)
    // The source is still there: no blind rollback, no silent delete.
    expect(await readIn(source)).toBe('a\nb\n')
  })

  it('reports a partial success when the source delete fails after the target was created', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const source = await writeIn(harness.root, 'mv-undel-src.txt', 'a\nb\n')
    const destination = keyIn(harness.root, 'mv-undel-dest.txt')
    const original = harness.ctx.fs.writeText.bind(harness.ctx.fs)
    harness.ctx.fs.writeText = async (...args) => {
      const outcome = await original(...args)
      // The source disappears behind the tool's back after the target landed, so
      // the tool's own delete has to fail. (§1.1: no version-conditioned delete.)
      if (args[0].displayPath === destination) await rm(source)
      return outcome
    }
    const value = await readTag(harness, 'mv-undel-src.txt')

    const result = await harness.edit({ input: header(value) + '\nMV mv-undel-dest.txt' })

    expect(result.isError).toBe(true)
    expect(await readIn(destination)).toBe('a\nb\n')
    expect(failure(result)).toContain(destination)
    expect(failure(result)).toContain(source)
    expect(failure(result)).toMatch(/target.*created|created.*target/iu)
  })

  it('reports a cancel that happens before the create, with source and target untouched', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const source = await writeIn(harness.root, 'mv-precreate-src.txt', 'a\nb\n')
    const destination = keyIn(harness.root, 'mv-precreate-dest.txt')
    const controller = new AbortController()
    const originalStat = harness.ctx.fs.stat.bind(harness.ctx.fs)
    harness.ctx.fs.stat = async (...args) => {
      const info = await originalStat(...args)
      // Cancel while the destination stat (the create's authorization) is in flight.
      if (args[0].displayPath === destination) controller.abort()
      return info
    }
    const value = await readTag(harness, 'mv-precreate-src.txt')

    const result = await harness.edit({ input: header(value) + '\nMV mv-precreate-dest.txt' }, undefined, controller.signal)

    expect(result.isError).toBe(true)
    expect(failure(result)).toContain(destination)
    expect(failure(result)).toContain(source)
    expect(await readIn(source)).toBe('a\nb\n')
    await expect(readIn(destination)).rejects.toThrow()
  })

  it('marks an unknown create outcome as unverified instead of retrying or deleting', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const source = await writeIn(harness.root, 'mv-unknown-src.txt', 'a\nb\n')
    const destination = keyIn(harness.root, 'mv-unknown-dest.txt')
    const original = harness.ctx.fs.writeText.bind(harness.ctx.fs)
    let attempts = 0
    harness.ctx.fs.writeText = async (...args) => {
      const [target, content] = args
      if (target.displayPath === destination) {
        attempts += 1
        // A provider that publishes and then fails: the tool cannot know whether
        // the content landed, so it must report the state, not guess.
        await writeFile(destination, content, 'utf8')
        throw new Error('provider exploded after publish')
      }
      return original(...args)
    }
    const value = await readTag(harness, 'mv-unknown-src.txt')

    const result = await harness.edit({ input: header(value) + '\nMV mv-unknown-dest.txt' })

    expect(result.isError).toBe(true)
    expect(attempts).toBe(1)
    expect(failure(result)).toContain(destination)
    expect(failure(result)).toContain(source)
    expect(failure(result)).toMatch(/unverified|could not be probed/iu)
    expect(await readIn(source)).toBe('a\nb\n')
    expect(await readIn(destination)).toBe('a\nb\n')
  })

  it('reports a provider error that happens before the target is published', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const source = await writeIn(harness.root, 'mv-prepublish-src.txt', 'a\nb\n')
    const destination = keyIn(harness.root, 'mv-prepublish-dest.txt')
    const original = harness.ctx.fs.writeText.bind(harness.ctx.fs)
    harness.ctx.fs.writeText = async (...args) => {
      if (args[0].displayPath === destination) throw new Error('provider refused before publish')
      return original(...args)
    }
    const value = await readTag(harness, 'mv-prepublish-src.txt')

    const result = await harness.edit({ input: header(value) + '\nMV mv-prepublish-dest.txt' })

    expect(result.isError).toBe(true)
    expect(failure(result)).toContain('provider refused before publish')
    expect(failure(result)).toContain(destination)
    expect(failure(result)).toContain(source)
    // The provider never published, and the tool says so instead of guessing.
    expect(failure(result)).toContain('the target does not exist')
    expect(await readIn(source)).toBe('a\nb\n')
    await expect(readIn(destination)).rejects.toThrow()
  })

  it('keeps a provider sandbox denial visible with its own code', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const source = await writeIn(harness.root, 'mv-denied-src.txt', 'a\nb\n')
    const destination = keyIn(harness.root, 'mv-denied-dest.txt')
    const original = harness.ctx.fs.writeText.bind(harness.ctx.fs)
    harness.ctx.fs.writeText = async (...args) => {
      // A provider-level refusal of exactly the kind a sandboxing backend raises.
      // This fixture has no sandbox backend, so the denial is injected, not driven end to end.
      if (args[0].displayPath === destination) throw new FsError('sandbox denied the create', 'FS_SANDBOX_DENIED')
      return original(...args)
    }
    const value = await readTag(harness, 'mv-denied-src.txt')

    const result = await harness.edit({ input: header(value) + '\nMV mv-denied-dest.txt' })

    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_SANDBOX_DENIED')
    expect(failure(result)).toContain('sandbox denied the create')
    expect(failure(result)).toContain('the target does not exist')
    expect(await readIn(source)).toBe('a\nb\n')
    await expect(readIn(destination)).rejects.toThrow()
  })

  it('still moves with no policy mounted and passes an explicit createIfAbsent', async () => {
    const harness = await createRealSessionHarness({ policy: false })
    onTestFinished(() => harness.dispose())
    await writeIn(harness.root, 'mv-bare-src.txt', 'a\nb\n')
    const destination = keyIn(harness.root, 'mv-bare-dest.txt')
    const calls: { kind?: string; signal?: unknown; sandbox?: unknown }[] = []
    const original = harness.ctx.fs.writeText.bind(harness.ctx.fs)
    harness.ctx.fs.writeText = async (...args) => {
      if (args[0].displayPath === destination) calls.push({ kind: args[2]?.kind, signal: args[3], sandbox: args[4] })
      return original(...args)
    }
    const value = await readTag(harness, 'mv-bare-src.txt')

    const result = await harness.edit({ input: header(value) + '\nMV mv-bare-dest.txt' })

    expect(result.isError, failure(result)).toBe(false)
    // The write condition, the call's signal and the resolved sandbox policy all reach the provider.
    expect(calls).toHaveLength(1)
    expect(calls[0]?.kind).toBe('createIfAbsent')
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal)
    // This fixture mounts no sandboxing backend, so the resolved policy is undefined.
    expect(calls[0]?.sandbox).toBeUndefined()
    expect(await readIn(destination)).toBe('a\nb\n')
  })

  it('deletes with REM without any prior MV', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const file = await writeIn(harness.root, 'rem-independent.txt', 'a\nb\n')
    const value = await readTag(harness, 'rem-independent.txt')

    const result = await harness.edit({ input: header(value) + '\nREM' })

    expect(result.isError, failure(result)).toBe(false)
    await expect(readIn(file)).rejects.toThrow()
  })

  it('completes MV, a read of the moved target, and REM in one session', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    await writeIn(harness.root, 'mv-rem.txt', 'a\nb\n')
    const value = await readTag(harness, 'mv-rem.txt')
    expect((await harness.edit({ input: header(value) + '\nMV mv-rem-dest.txt' })).isError).toBe(false)

    const moved = await readTag(harness, 'mv-rem-dest.txt')
    const removed = await harness.edit({ input: header(moved) + '\nREM' })

    expect(removed.isError, failure(removed)).toBe(false)
    await expect(readIn(keyIn(harness.root, 'mv-rem-dest.txt'))).rejects.toThrow()
    await expect(readIn(keyIn(harness.root, 'mv-rem.txt'))).rejects.toThrow()
  })

  it('keeps editing the moved file and sees the source as absent', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    await writeIn(harness.root, 'mv-chain.txt', 'a\nb\n')
    const value = await readTag(harness, 'mv-chain.txt')
    expect((await harness.edit({ input: header(value) + '\nMV mv-chain-dest.txt' })).isError).toBe(false)

    const moved = await readTag(harness, 'mv-chain-dest.txt')
    expect(moved.path).toBe(keyIn(harness.root, 'mv-chain-dest.txt'))
    const edited = await harness.edit({ input: header(moved) + '\nPUT 2.=2:\n+B' })
    expect(edited.isError, failure(edited)).toBe(false)
    expect(await readIn(keyIn(harness.root, 'mv-chain-dest.txt'))).toBe('a\nB\n')

    const gone = await harness.read({ file_path: 'mv-chain.txt' })
    expect(gone.isError).toBe(true)
    expect(gone.error?.info?.code).toBe('FS_NOT_FOUND')
  })
})

/** Rendered text of an edit receipt (an MV's canonical value is that same string). */
const textOf = (result: { content?: { type: string; text?: string }[] }): string =>
  (result.content ?? []).map(block => (block.type === 'text' ? block.text ?? '' : '')).join('')

const bytesIn = (...parts: string[]): Promise<Buffer> => readFile(path.join(...parts))

/**
 * PATH-R1 / PATH-R2: destination resolution and real overwrite protection for a
 * source that does NOT sit at the session root.
 *
 * The pre-existing matrix wrote every source at the harness root and used a bare
 * DEST, where "relative to the session directory" and "relative to the source's
 * directory" coincide, so it could not tell the two apart. The accepted contract
 * (spec section 3.1, ADR-0003) is: the section PATH *and* the MV DEST both resolve
 * against the session's effective directory, never against the source's parent.
 * PATH-R1 is therefore the positive contract case - it must NOT assert a refusal
 * or a fallback into the source directory.
 */
describe('MV destination resolution (PATH-R1)', () => {
  it('resolves a bare DEST against the session directory, not the source directory', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    await mkdir(path.join(harness.root, 'sub'), { recursive: true })
    const sourceBytes = Buffer.from('nested source\n', 'utf8')
    await writeFile(path.join(harness.root, 'sub', 'source.txt'), sourceBytes)
    // A KEEP file at the path "relative to the source" would have picked - it must survive.
    await writeFile(path.join(harness.root, 'sub', 'moved.txt'), Buffer.from('KEEP\n', 'utf8'))
    await expect(readFile(path.join(harness.root, 'moved.txt'))).rejects.toThrow()
    const value = await readTag(harness, 'sub/source.txt')

    const result = await harness.edit({ input: '[sub/source.txt#' + value.tag + ']\nMV moved.txt' })

    expect(result.isError, failure(result)).toBe(false)
    expect((await bytesIn(harness.root, 'moved.txt')).equals(sourceBytes)).toBe(true)
    expect(await readIn(path.join(harness.root, 'sub', 'moved.txt'))).toBe('KEEP\n')
    await expect(readIn(path.join(harness.root, 'sub', 'source.txt'))).rejects.toThrow()
    // The receipt keeps the authored DEST verbatim (accepted wording, spec section 3.1):
    // a relative receipt is not by itself evidence of a wrong path.
    const text = textOf(result)
    expect(text).toMatch(/\[moved\.txt#[0-9A-F]{4}\]/u)
    expect(text).toContain('Moved to moved.txt')
  })
})

describe('MV nested target matrix (PATH-R2)', () => {
  it('PATH-R2.1 creates an explicit nested DEST that neither exists nor was observed', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    await mkdir(path.join(harness.root, 'sub'), { recursive: true })
    const sourceBytes = Buffer.from('alpha\nbeta\n', 'utf8')
    await writeFile(path.join(harness.root, 'sub', 'source.txt'), sourceBytes)
    const value = await readTag(harness, 'sub/source.txt')

    const result = await harness.edit({ input: '[sub/source.txt#' + value.tag + ']\nMV sub/moved.txt' })

    expect(result.isError, failure(result)).toBe(false)
    const target = path.join(harness.root, 'sub', 'moved.txt')
    expect((await readFile(target)).equals(sourceBytes)).toBe(true)
    // No surprise artifact at the session root.
    await expect(readFile(path.join(harness.root, 'moved.txt'))).rejects.toThrow()
    await expect(readFile(path.join(harness.root, 'sub', 'source.txt'))).rejects.toThrow()
    // Success receipt, the target's show path and the disk file name the same file.
    expect(textOf(result)).toContain('Moved to sub/moved.txt')
    const moved = await readTag(harness, 'sub/moved.txt')
    expect(moved.path).toBe(await realpath(target))
    expect(await readIn(moved.path)).toBe('alpha\nbeta\n')
  })

  it('PATH-R2.2 refuses an existing nested DEST that was never observed', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    await mkdir(path.join(harness.root, 'sub'), { recursive: true })
    await writeFile(path.join(harness.root, 'sub', 'source.txt'), Buffer.from('alpha\nbeta\n', 'utf8'))
    await writeFile(path.join(harness.root, 'sub', 'moved.txt'), Buffer.from('KEEP\n', 'utf8'))
    const value = await readTag(harness, 'sub/source.txt')

    const result = await harness.edit({ input: '[sub/source.txt#' + value.tag + ']\nMV sub/moved.txt' })

    expect(result.isError).toBe(true)
    expect(failure(result)).toContain('destination already exists')
    expect(await readIn(path.join(harness.root, 'sub', 'moved.txt'))).toBe('KEEP\n')
    expect(await readIn(path.join(harness.root, 'sub', 'source.txt'))).toBe('alpha\nbeta\n')
  })

  it('PATH-R2.3 still refuses an existing nested DEST that was read', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    await mkdir(path.join(harness.root, 'sub'), { recursive: true })
    await writeFile(path.join(harness.root, 'sub', 'source.txt'), Buffer.from('alpha\nbeta\n', 'utf8'))
    await writeFile(path.join(harness.root, 'sub', 'moved.txt'), Buffer.from('KEEP\n', 'utf8'))
    // Watching the target must not turn into permission to overwrite it.
    await readTag(harness, 'sub/moved.txt')
    const value = await readTag(harness, 'sub/source.txt')

    const result = await harness.edit({ input: '[sub/source.txt#' + value.tag + ']\nMV sub/moved.txt' })

    expect(result.isError).toBe(true)
    expect(failure(result)).toContain('destination already exists')
    expect(await readIn(path.join(harness.root, 'sub', 'moved.txt'))).toBe('KEEP\n')
    expect(await readIn(path.join(harness.root, 'sub', 'source.txt'))).toBe('alpha\nbeta\n')
  })
})

const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const crlfFixture = (): Buffer => Buffer.concat([BOM, Buffer.from('alpha\r\nbeta\r\ngamma\r\n', 'utf8')])

/** Byte-level diagnostic so a red byte assertion carries its own evidence. */
const showBytes = (buffer: Buffer): string => JSON.stringify(buffer.toString('utf8'))
const byteReport = (target: Buffer, expected: Buffer): string =>
  'target=' + showBytes(target) + ' expected=' + showBytes(expected) +
  ' crlf=' + (target.toString('utf8').match(/\r\n/gu) ?? []).length + '/' + (expected.toString('utf8').match(/\r\n/gu) ?? []).length +
  ' bom=' + target.subarray(0, 3).equals(BOM) + '/' + expected.subarray(0, 3).equals(BOM)

/**
 * BYTES-R1: byte-level fidelity across MV and PUT. The tag is checked against the
 * engine's own normalization (normalizeToLF(stripBom(text))), never against
 * read.totalLines.
 *
 * ATTRIBUTION (measured 2026-10-23, evidence 07-bytes-bom-attribution.log): the
 * BOM was lost on BOTH paths - a pure PUT with no MV dropped it exactly the same
 * way - so it was never an MV regression. The mechanism sat below the edit tool:
 * the hashline adapter defines no `readBinary`, so `Patcher` could not recover the
 * BOM from disk, and the local provider's `readText` decodes with
 * `new TextDecoder('utf-8', { fatal: true })`, whose default `ignoreBOM: false`
 * consumes the marker before the engine ever sees it.
 *
 * Fix (BOM-01..14, plan section 4): the tool-edit adapter reads through a
 * dedicated `readTextPreservingBom` entry that re-attaches the marker from the
 * raw three-byte prefix. The expected bytes below are unchanged from the red
 * baseline - the fix moved the code, not the assertion.
 *
 * Matrix IDs: BYTES-R1a and BOM-01 are the same pure-MV scene at different depths
 * (session root vs a subdirectory); BYTES-R1b carries BOM-02. The remaining
 * BOM-03..14 cases live in the dedicated suite below, so every ID in the plan's
 * table has exactly one owning test.
 */
describe('byte fidelity across MV (BYTES-R1)', () => {
  it('BYTES-R1a keeps the BOM, the CRLFs and the trailing newline through a pure MV', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    await mkdir(path.join(harness.root, 'sub'), { recursive: true })
    const raw = crlfFixture()
    await writeFile(path.join(harness.root, 'sub', 'source.txt'), raw)
    const value = await readTag(harness, 'sub/source.txt')
    expect(value.totalLines).toBe(3)
    expect(value.tag).toBe(computeFileHash(normalizeToLF(stripBom(raw.toString('utf8')).text)))

    const result = await harness.edit({ input: '[sub/source.txt#' + value.tag + ']\nMV sub/moved.txt' })

    expect(result.isError, failure(result)).toBe(false)
    const target = await readFile(path.join(harness.root, 'sub', 'moved.txt'))
    expect(target.equals(raw), byteReport(target, raw)).toBe(true)
    const moved = await readTag(harness, 'sub/moved.txt')
    expect(moved.tag).toBe(computeFileHash(normalizeToLF(stripBom(target.toString('utf8')).text)))
  })

  // BOM-02 in the plan's matrix, under its original red-test name: a red test that
  // already asserts exactly this scenario keeps its name (its evidence trail in
  // 20261023-1453 refers to it) and gains the matrix ID instead of being duplicated.
  it('BYTES-R1b (BOM-02) replaces only the second line and keeps the BOM, CRLFs and trailing newline', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    await mkdir(path.join(harness.root, 'sub'), { recursive: true })
    const raw = crlfFixture()
    await writeFile(path.join(harness.root, 'sub', 'source.txt'), raw)
    const expected = Buffer.concat([BOM, Buffer.from('alpha\r\nBETA\r\ngamma\r\n', 'utf8')])
    const value = await readTag(harness, 'sub/source.txt')
    expect(value.totalLines).toBe(3)

    const result = await harness.edit({
      input: '[sub/source.txt#' + value.tag + ']\nPUT 2.=2:\n+BETA\nMV sub/moved.txt',
    })

    expect(result.isError, failure(result)).toBe(false)
    const target = await readFile(path.join(harness.root, 'sub', 'moved.txt'))
    expect(target.equals(expected), byteReport(target, expected)).toBe(true)
    // Independent per-part evidence instead of a line count.
    expect(target.subarray(0, 3).equals(BOM)).toBe(true)
    expect(target.toString('utf8').startsWith('\uFEFFalpha\r\nBETA\r\ngamma\r\n')).toBe(true)
    expect((target.toString('utf8').match(/\r\n/gu) ?? []).length).toBe(3)
    const moved = await readTag(harness, 'sub/moved.txt')
    expect(moved.tag).toBe(computeFileHash(normalizeToLF(stripBom(target.toString('utf8')).text)))
  })
})

// ── BOM matrix (plan section 4.4) ────────────────────────────────────────────

/** Text a BOM file decodes to under a provider that consumes the marker. */
const withoutBom = (raw: Buffer): string => stripBom(raw.toString('utf8')).text

/**
 * The installed tool-edit package's own `createEditSession`, loaded from its
 * public package.json — not a re-implementation. The BOM-preserving reader is an
 * adapter capability with no model-facing surface, so the only honest way to test
 * a short/empty prefix is to build the real session the tool builds and call it.
 */
async function realEditSession(harness: RealSessionHarness, signal?: AbortSignal) {
  const pkg = createRequire(import.meta.url).resolve('@hy-sde-org/dsh-tool-edit/package.json')
  const sessionModule = await import(pathToFileURL(path.join(path.dirname(pkg), 'dist', 'session.js')).href) as {
    createEditSession(args: Record<string, unknown>): { reader: { readTextPreservingBom(target: unknown, signal?: AbortSignal): Promise<string> } }
  }
  const exec = { signal, agent: harness.agent } as never
  return sessionModule.createEditSession({
    ctx: harness.ctx,
    fs: harness.ctx.fs,
    provider: undefined,
    exec,
    config: {
      mode: 'hashline', fuzzyMatch: true, fuzzyThreshold: 0.95, enforceSeenLines: true,
      formatOnWrite: false, diagnosticsOnEdit: false, diagnosticsDeduplicate: true, lspCommand: 'tsc',
    },
  })
}

/**
 * Replace `ctx.fs.readByteRange` for one case.
 *
 * Unlike the process-global `node:fs/promises` seam, no restore is needed here:
 * the patched object is the `ctx.fs` of a harness this test created itself, and
 * `onTestFinished(() => harness.dispose())` destroys that context and its
 * provider afterwards. Every caller creates a fresh harness first, so the patch
 * can never reach another test. Stated here because the missing `restore()` next
 * to `refuseSourceDelete`'s would otherwise read as an oversight.
 */
function seamByteRange(
  harness: RealSessionHarness,
  replace: (original: (...args: never[]) => Promise<Uint8Array>, ...args: never[]) => Promise<Uint8Array>,
): void {
  const fs = harness.ctx.fs as unknown as { readByteRange: (...args: never[]) => Promise<Uint8Array> }
  const original = fs.readByteRange.bind(harness.ctx.fs) as (...args: never[]) => Promise<Uint8Array>
  fs.readByteRange = ((...args: never[]) => replace(original, ...args)) as typeof fs.readByteRange
}

describe('BOM preservation on the hashline write path (BOM-01..14)', () => {
  it('BOM-01 keeps the raw bytes of a BOM + CRLF file through a pure MV', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const raw = crlfFixture()
    await writeFile(path.join(harness.root, 'bom01.txt'), raw)
    const value = await readTag(harness, 'bom01.txt')

    const result = await harness.edit({ input: header(value) + '\nMV bom01-moved.txt' })

    expect(result.isError, failure(result)).toBe(false)
    const target = await readFile(path.join(harness.root, 'bom01-moved.txt'))
    expect(target.equals(raw), byteReport(target, raw)).toBe(true)
    await expect(readIn(path.join(harness.root, 'bom01.txt'))).rejects.toThrow()
  })

  it('BOM-03 keeps the BOM through a pure PUT, so the fix is not MV-only', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const raw = crlfFixture()
    const file = path.join(harness.root, 'bom03.txt')
    await writeFile(file, raw)
    const value = await readTag(harness, 'bom03.txt')
    const expected = Buffer.concat([BOM, Buffer.from('alpha\r\nBETA\r\ngamma\r\n', 'utf8')])

    const result = await harness.edit({ input: header(value) + '\nPUT 2.=2:\n+BETA' })

    expect(result.isError, failure(result)).toBe(false)
    const target = await readFile(file)
    expect(target.equals(expected), byteReport(target, expected)).toBe(true)
    // Nothing else moved: no phantom file, no extra trailing newline.
    expect((target.toString('utf8').match(/\r\n/gu) ?? []).length).toBe(3)
  })

  it('BOM-04 never invents a BOM: PUT and MV on a plain file change only what the op says', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const plain = Buffer.from('alpha\r\nbeta\r\ngamma\r\n', 'utf8')
    const putFile = path.join(harness.root, 'plain-put.txt')
    const mvFile = path.join(harness.root, 'plain-mv.txt')
    await writeFile(putFile, plain)
    await writeFile(mvFile, plain)

    const putTag = await readTag(harness, 'plain-put.txt')
    const put = await harness.edit({ input: header(putTag) + '\nPUT 2.=2:\n+BETA' })
    expect(put.isError, failure(put)).toBe(false)
    const putExpected = Buffer.from('alpha\r\nBETA\r\ngamma\r\n', 'utf8')
    const putTarget = await readFile(putFile)
    expect(putTarget.equals(putExpected), byteReport(putTarget, putExpected)).toBe(true)
    expect(putTarget.subarray(0, 3).equals(BOM)).toBe(false)

    const mvTag = await readTag(harness, 'plain-mv.txt')
    const mv = await harness.edit({ input: header(mvTag) + '\nMV plain-mv-dest.txt' })
    expect(mv.isError, failure(mv)).toBe(false)
    const mvTarget = await readFile(path.join(harness.root, 'plain-mv-dest.txt'))
    expect(mvTarget.equals(plain), byteReport(mvTarget, plain)).toBe(true)
    expect(mvTarget.subarray(0, 3).equals(BOM)).toBe(false)
  })

  it('BOM-05 keeps a single BOM, LF endings and multibyte text without re-encoding', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const raw = Buffer.concat([BOM, Buffer.from('第一行\n第二行\n第三行\n', 'utf8')])
    const file = path.join(harness.root, 'bom05.txt')
    await writeFile(file, raw)
    const value = await readTag(harness, 'bom05.txt')
    expect(value.totalLines).toBe(3)
    expect(value.tag).toBe(computeFileHash(withoutBom(raw)))
    expect(value.lines[1]?.text).toBe('第二行')

    const result = await harness.edit({ input: header(value) + '\nPUT 2.=2:\n+第二行改' })

    expect(result.isError, failure(result)).toBe(false)
    const expected = Buffer.concat([BOM, Buffer.from('第一行\n第二行改\n第三行\n', 'utf8')])
    const target = await readFile(file)
    expect(target.equals(expected), byteReport(target, expected)).toBe(true)
    expect((target.toString('utf8').match(/\r\n/gu) ?? []).length).toBe(0)
  })

  it('BOM-06 handles short and empty prefixes without out-of-range reads or invented BOMs', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const session = await realEditSession(harness)

    // 1- and 2-byte files: the three-byte window is simply short.
    for (const [name, bytes] of [['one.txt', Buffer.from('A', 'utf8')], ['two.txt', Buffer.from('AB', 'utf8')]] as const) {
      await writeFile(path.join(harness.root, name), bytes)
      const target = await harness.ctx.fs.resolve(name, { cwd: harness.root })
      const text = await session.reader.readTextPreservingBom(target)
      expect(text).toBe(bytes.toString('utf8'))
      // ...and the real toolchain edits them without fabricating a marker.
      const value = await readTag(harness, name)
      const edited = await harness.edit({ input: header(value) + '\nPUT 1.=1:\n+' + bytes.toString('utf8') + '-x' })
      expect(edited.isError, failure(edited)).toBe(false)
      const after = await readFile(path.join(harness.root, name))
      expect(after.equals(Buffer.from(bytes.toString('utf8') + '-x', 'utf8')), byteReport(after, bytes)).toBe(true)
    }

    // Empty file and BOM-only file: no mint (unchanged rule), and the dedicated
    // reader reports what is actually there instead of inventing text.
    const emptyPath = path.join(harness.root, 'empty.txt')
    await writeFile(emptyPath, Buffer.alloc(0))
    const empty = await harness.read({ file_path: 'empty.txt' })
    expect(empty.isError).toBe(false)
    expect(empty.value).toMatchObject({ tagged: false, tag: null })
    const emptyTarget = await harness.ctx.fs.resolve('empty.txt', { cwd: harness.root })
    expect(await session.reader.readTextPreservingBom(emptyTarget)).toBe('')

    const bomOnlyPath = path.join(harness.root, 'bom-only.txt')
    await writeFile(bomOnlyPath, BOM)
    const bomOnly = await harness.read({ file_path: 'bom-only.txt' })
    expect(bomOnly.isError).toBe(false)
    expect(bomOnly.value).toMatchObject({ tagged: false, tag: null })
    const bomOnlyTarget = await harness.ctx.fs.resolve('bom-only.txt', { cwd: harness.root })
    // The provider consumed the only marker, so the faithful text is exactly one BOM.
    expect(await session.reader.readTextPreservingBom(bomOnlyTarget)).toBe('\uFEFF')
    expect((await readFile(bomOnlyPath)).equals(BOM)).toBe(true)
  })

  it('BOM-07 propagates a failing prefix read, with no write, no delete and no snapshot migration', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const raw = crlfFixture()
    const source = path.join(harness.root, 'bom07.txt')
    await writeFile(source, raw)
    const value = await readTag(harness, 'bom07.txt')
    const store = getSessionSnapshotStore(harness.session)
    const sourceKey = keyIn(harness.root, 'bom07.txt')
    const destKey = keyIn(harness.root, 'bom07-moved.txt')
    const before = store.head(sourceKey)?.text
    seamByteRange(harness, async () => {
      throw new FsError('injected prefix read refusal', 'FS_PERMISSION_DENIED')
    })

    const result = await harness.edit({ input: header(value) + '\nPUT 2.=2:\n+BETA\nMV bom07-moved.txt' })

    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_PERMISSION_DENIED')
    expect(failure(result)).toContain('injected prefix read refusal')
    // Disk: untouched on both endpoints.
    expect((await readFile(source)).equals(raw)).toBe(true)
    await expect(readFile(path.join(harness.root, 'bom07-moved.txt'))).rejects.toThrow()
    // Snapshots: the pre-read snapshot is intact and no destination record appeared.
    expect(store.head(sourceKey)?.text).toBe(before)
    expect(store.head(destKey)).toBeNull()
  })

  it('BOM-07b propagates a cancellation during the prefix read, leaving both endpoints untouched', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const raw = crlfFixture()
    const source = path.join(harness.root, 'bom07b.txt')
    await writeFile(source, raw)
    const value = await readTag(harness, 'bom07b.txt')
    const controller = new AbortController()
    seamByteRange(harness, async (original, ...args) => {
      controller.abort()
      return original(...args)
    })

    const result = await harness.edit({ input: header(value) + '\nPUT 2.=2:\n+BETA' }, undefined, controller.signal)

    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_ABORTED')
    expect((await readFile(source)).equals(raw)).toBe(true)
  })

  it('BOM-08 refuses a version change between the text read and the prefix probe, before any write', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const raw = crlfFixture()
    const source = path.join(harness.root, 'bom08.txt')
    await writeFile(source, raw)
    const value = await readTag(harness, 'bom08.txt')
    // A concurrent writer changes the file between the text read and the prefix read:
    // splicing that prefix onto the stale text would publish a mixture.
    const drifted = Buffer.concat([BOM, Buffer.from('alpha\r\nBETA\r\ngamma\r\n', 'utf8')])
    let mutated = false
    seamByteRange(harness, async (original, ...args) => {
      if (!mutated) {
        mutated = true
        await writeFile(source, drifted)
      }
      return original(...args)
    })

    const result = await harness.edit({ input: header(value) + '\nPUT 2.=2:\n+BETA' })

    expect(mutated).toBe(true)
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_STALE_VERSION')
    expect(failure(result)).toMatch(/changed during the read/iu)
    // The concurrent content is what stays on disk; nothing was spliced or rewritten.
    expect((await readFile(source)).equals(drifted)).toBe(true)
  })

  it('BOM-09 pins the provider contract this fix relies on: one BOM consumed, raw prefix readable', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const raw = crlfFixture()
    await writeFile(path.join(harness.root, 'bom09.txt'), raw)

    const target = await harness.ctx.fs.resolve('bom09.txt', { cwd: harness.root })
    const text = await harness.ctx.fs.readText(target)
    const prefix = await harness.ctx.fs.readByteRange(target, { offset: 0, length: 3 })
    const info = await harness.ctx.fs.stat(target)

    // The Local provider decodes with TextDecoder({fatal:true}), ignoreBOM:false —
    // it consumes exactly one leading marker and does not tell the caller.
    expect(text.startsWith('\uFEFF')).toBe(false)
    expect(text).toBe('alpha\r\nbeta\r\ngamma\r\n')
    // ...and the raw prefix is available at the host seam, which is what the
    // adapter's dedicated read entry uses instead of a second whole-file read.
    expect(Buffer.from(prefix).equals(BOM)).toBe(true)
    expect(info?.version).toBeDefined()
  })

  it('BOM-10 keeps read→edit→read tags and line numbers consistent with one BOM', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const raw = crlfFixture()
    const file = path.join(harness.root, 'bom10.txt')
    await writeFile(file, raw)
    const first = await readTag(harness, 'bom10.txt')
    expect(first.tag).toBe(computeFileHash(withoutBom(raw)))

    expect((await harness.edit({ input: header(first) + '\nPUT 3.=3:\n+GAMMA' })).isError).toBe(false)

    const after = await readFile(file)
    const second = await readTag(harness, 'bom10.txt')
    expect(second.tag).toBe(computeFileHash(withoutBom(after)))
    expect(second.tag).not.toBe(first.tag)
    expect(second.totalLines).toBe(3)
    expect(second.lines[2]?.text).toBe('GAMMA')
    // The BOM did not become a phantom first line.
    expect(second.lines[0]?.text).toBe('alpha')
  })

  it('BOM-11 refuses consecutive leading BOMs before writing, without entering recovery', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const raw = Buffer.concat([BOM, BOM, Buffer.from('alpha\nbeta\n', 'utf8')])
    const file = path.join(harness.root, 'bom11.txt')
    await writeFile(file, raw)
    const value = await readTag(harness, 'bom11.txt')
    // The read tool normalizes with a single stripBom, so its tag stays usable for
    // the parse; the refusal has to come from the adapter, before any write.
    expect(value.tag).toBe(computeFileHash('alpha\nbeta\n'))

    const result = await harness.edit({ input: header(value) + '\nPUT 2.=2:\n+beta2\nMV bom11-moved.txt' })

    expect(result.isError).toBe(true)
    expect(failure(result)).toMatch(/consecutive UTF-8 byte-order marks/iu)
    expect(failure(result)).toMatch(/not modified/iu)
    // Not a mismatch/recovery rewrite, not a write, not a move.
    expect(failure(result)).not.toMatch(/Recovered from a stale file hash/iu)
    expect(failure(result)).not.toMatch(/MismatchError|changed between read and edit/iu)
    expect((await readFile(file)).equals(raw)).toBe(true)
    await expect(readFile(path.join(harness.root, 'bom11-moved.txt'))).rejects.toThrow()
  })

  it('BOM-12 removes BOM and plain files independently, with no MV first', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    for (const [name, bytes] of [
      ['bom12-bom.txt', Buffer.concat([BOM, Buffer.from('a\nb\n', 'utf8')])],
      ['bom12-plain.txt', Buffer.from('a\nb\n', 'utf8')],
    ] as const) {
      await writeFile(path.join(harness.root, name), bytes)
      const value = await readTag(harness, name)
      const result = await harness.edit({ input: header(value) + '\nREM' })
      expect(result.isError, failure(result)).toBe(false)
      await expect(readFile(path.join(harness.root, name))).rejects.toThrow()
      expect(getSessionSnapshotStore(harness.session).head(keyIn(harness.root, name))).toBeNull()
    }
  })

  it('BOM-13 surfaces a failed prefix read on REM and leaves the file in place with its snapshot', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const raw = Buffer.concat([BOM, Buffer.from('a\nb\n', 'utf8')])
    const file = path.join(harness.root, 'bom13.txt')
    await writeFile(file, raw)
    const value = await readTag(harness, 'bom13.txt')
    const store = getSessionSnapshotStore(harness.session)
    const key = keyIn(harness.root, 'bom13.txt')
    const before = store.head(key)?.text
    seamByteRange(harness, async () => {
      throw new FsError('injected prefix read refusal on REM', 'FS_PERMISSION_DENIED')
    })

    const result = await harness.edit({ input: header(value) + '\nREM' })

    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_PERMISSION_DENIED')
    expect(failure(result)).toContain('injected prefix read refusal on REM')
    expect((await readFile(file)).equals(raw)).toBe(true)
    expect(store.head(key)?.text).toBe(before)
  })

  it('BOM-14 keeps noop, recovery and preflight behavior for a single-BOM file', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    await mkdir(path.join(harness.root, 'sub'), { recursive: true })
    const raw = Buffer.concat([BOM, Buffer.from('alpha\nbeta\n', 'utf8')])
    const file = path.join(harness.root, 'sub', 'bom14.txt')
    await writeFile(file, raw)
    const value = await readTag(harness, 'sub/bom14.txt')

    // noop: identical body text is not a change, and it must not rewrite the bytes.
    const noop = await harness.edit({ input: header(value) + '\nPUT 2.=2:\n+beta' })
    expect(noop.isError, failure(noop)).toBe(false)
    expect((await readFile(file)).equals(raw)).toBe(true)

    // path recovery: a bare filename whose tag matches the file read this session
    // rebinds to it, reads it through the BOM-preserving entry and stays inside cwd.
    const recovered = await harness.edit({ input: '[bom14.txt#' + value.tag + ']\nPUT 1.=1:\n+ALPHA' })
    expect(recovered.isError, failure(recovered)).toBe(false)
    // The recovery is the tag+filename rebind, and it names a path inside the cwd.
    expect(textOf(recovered)).toMatch(/matched its filename and snapshot tag/iu)
    expect(textOf(recovered)).toContain(file)
    expect(textOf(recovered)).toMatch(/\[.*#\w{4}\]/u)
    const expected = Buffer.concat([BOM, Buffer.from('ALPHA\nbeta\n', 'utf8')])
    const after = await readFile(file)
    expect(after.equals(expected), byteReport(after, expected)).toBe(true)

    // preflight: the upstream adapter's own preflightWrite hook is a documented
    // no-op in this port, so the guarded step that actually runs before a write is
    // the writer's cwd containment. Exercised on the recovered path, it still
    // refuses a target outside the session directory.
    const current = await readTag(harness, 'sub/bom14.txt')
    const outside = await harness.edit({ input: header(current) + '\nMV ../bom14-escape.txt' })
    expect(outside.isError).toBe(true)
    expect(failure(outside)).toMatch(/outside the working directory/iu)
    expect((await readFile(file)).equals(expected)).toBe(true)
    await expect(readFile(path.join(harness.root, 'bom14-escape.txt'))).rejects.toThrow()
  })
})


/**
 * PART-R1: the source DELETE is refused (not "the source vanished first").
 *
 * The existing partial-success cases make the source disappear behind the tool's
 * back, which exercises "the delete could not land on a file that is gone". This
 * one keeps the source present and refuses the delete itself at the Node seam, so
 * the reported state - both endpoints still there - has to be truthful.
 *
 * The seam is the builtin node:fs/promises module that the upstream edit package
 * imported. It is patched for this file only, restored in onTestFinished, and it
 * refuses exactly one target: the source of this case. No timers, no ACL edits.
 */
const PART_SOURCE = 'part-src.txt'
const PART_DEST = 'part-dest.txt'

const refuseSourceDelete = (sourcePath: string) => {
  const fsp = requireCjs('node:fs/promises') as typeof import('node:fs/promises')
  const original = fsp.rm
  const refused: string[] = []
  // Match the ONE source this case owns, by resolved path: a basename match would
  // also fire for any other file of the same name created by a concurrent suite
  // in this worker's process (the seam is process-global, not per-test).
  const targetKey = path.resolve(sourcePath).toLowerCase()
  fsp.rm = (async (target: Parameters<typeof fsp.rm>[0], options?: Parameters<typeof fsp.rm>[1]) => {
    if (typeof target === 'string' && path.resolve(target).toLowerCase() === targetKey) {
      refused.push(target)
      throw Object.assign(new Error('injected source delete refusal'), { code: 'EPERM' })
    }
    return original(target, options)
  }) as typeof fsp.rm
  syncBuiltinESMExports()
  return {
    refused,
    restore() {
      fsp.rm = original
      syncBuiltinESMExports()
    },
  }
}


const requireCjs = createRequire(import.meta.url)

describe('PART-R1: a refused source delete keeps both endpoints (integration)', () => {
  it('reports isError with both paths, the partial success and the untouched source', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const sourceText = 'alpha\nbeta\n'
    const sourceBytes = Buffer.from(sourceText, 'utf8')
    const source = await writeIn(harness.root, PART_SOURCE, sourceText)
    const seam = refuseSourceDelete(source)
    // Registered after dispose(), so it runs BEFORE it: cleanup still has a real rm.
    onTestFinished(() => seam.restore())
    const store = getSessionSnapshotStore(harness.session)
    const sourceKey = keyIn(harness.root, PART_SOURCE)
    const destKey = keyIn(harness.root, PART_DEST)
    try {
      const value = await readTag(harness, PART_SOURCE)
      // Baseline: the source snapshot exists before the commit.
      expect(store.head(sourceKey)?.text).toBe(sourceText)

      const result = await harness.edit({ input: '[' + PART_SOURCE + '#' + value.tag + ']\nMV ' + PART_DEST })

        const message = failure(result)
      // The refusal really happened, and it hit the source delete.
      expect(seam.refused).toHaveLength(1)
      expect(seam.refused[0]).toContain(PART_SOURCE)
      // Both endpoints survive with their bytes: no rollback, no fake success.
      expect(result.isError, message).toBe(true)
      expect(await readIn(source)).toBe(sourceText)
      expect((await bytesIn(harness.root, PART_DEST)).equals(sourceBytes)).toBe(true)
      // The error names both endpoints, the partial success, the original refusal, the remedy.
      expect(message).toContain(source)
      expect(message).toContain(destKey)
      expect(message).toMatch(/partly completed/iu)
      expect(message).toContain('injected source delete refusal')
      expect(message).toMatch(/verify both paths/iu)
      // Snapshots: the source was not migrated away, and the target was not
      // recorded as if the move had committed.
      expect(store.head(sourceKey)?.text).toBe(sourceText)
      expect(store.head(destKey)).toBeNull()
    } finally {
      seam.restore()
    }
  })
})


/**
 * D3: the registered edit tool's own description and prompt section — the text a
 * model actually receives — not a scan of the patch file.
 *
 * The two product statements under test: (1) an MV DEST resolves against the
 * session working directory with an explicit nested example and no silent
 * overwrite; (2) committing is not claimed to be atomic for the whole call.
 * PATH-R1/R2 above keep the behavior side of (1) pinned.
 */
describe('D3: the edit tool text matches the shipped contract', () => {
  it('describes the cwd-relative DEST rule with a nested example and the overwrite refusal', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const definition = (harness.ctx.get('tools') as unknown as {
      get(name: string): { name: string; description: string } | undefined
    }).get('edit')
    expect(definition?.name).toBe('edit')
    const description = definition?.description ?? ''

    // The DEST basis is stated, not left to be guessed.
    expect(description).toMatch(/MV DEST[^.]*working directory/isu)
    expect(description).toMatch(/NOT against the section file's own directory/iu)
    // Both halves of the distinguishing example, so a reader can tell them apart.
    expect(description).toContain('MV moved.txt')
    expect(description).toContain('MV sub/moved.txt')
    expect(description).toContain('<root>/sub/moved.txt')
    // The overwrite protection is stated next to the path rule.
    expect(description).toMatch(/existing DEST is never overwritten/iu)
  })

  it('replaces the unconditional atomicity claim with the real commit semantics', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const assembly = await harness.ctx.systemPrompt.assemble()
    const section = assembly.sections.find(entry => entry.name === 'tool:edit')
    expect(section, 'the tool:edit prompt section must be registered').toBeDefined()
    const text = section?.text ?? ''

    // The old promise is gone: no unconditional "applies atomically". (The word
    // "atomic" is allowed only inside the explicit denial of whole-call atomicity,
    // which the assertions below require.)
    expect(text).not.toMatch(/applies atomically/iu)
    expect(text).not.toMatch(/atomically/iu)
    // What replaces it: commit after verification, MV is two steps, sections commit
    // one by one, and a failure can leave earlier work done.
    expect(text).toMatch(/only then commits/iu)
    expect(text).toMatch(/not one atomic step for the whole call/iu)
    expect(text).toMatch(/two-step move/iu)
    expect(text).toMatch(/section by section/iu)
    expect(text).toMatch(/leave earlier work done/iu)
    expect(text).toMatch(/verify both endpoints/iu)
  })
})


/**
 * SNAP-R3: the SnapshotCommitError has to survive the tool wrapper.
 *
 * PART-R1 injects a failing DELETE, which never reaches the snapshot commit at all.
 * This case injects a failing `record` on the destination key of the REAL
 * per-session store the edit tool uses, after `relocate` is allowed to run, so the
 * engine's own post-move failure path is what the tool has to report.
 *
 * The seam is one method on one store instance (not a prototype), armed after the
 * prepare, disarmed and restored in `finally`. `tools.read` is never called on the
 * destination before the state is captured — a read would re-record the snapshot
 * and hide the very state under test.
 */
describe('SNAP-R3: a destination record failure reaches the tool result (integration)', () => {
  it('reports the disk move, the incomplete bookkeeping and the original cause', async () => {
    const harness = await createRealSessionHarness()
    onTestFinished(() => harness.dispose())
    const sourceText = 'alpha\nbeta\n'
    const source = await writeIn(harness.root, 'snap3-src.txt', sourceText)
    const destKey = keyIn(harness.root, 'snap3-dst.txt')
    const sourceKey = keyIn(harness.root, 'snap3-src.txt')
    const store = getSessionSnapshotStore(harness.session) as unknown as {
      record(path: string, fullText: string, seenLines?: Iterable<number>): string
      head(path: string): { text: string; hash: string; seenLines?: Set<number> } | null
    }
    const originalRecord = store.record.bind(store)
    let armed = false
    let injected = 0
    store.record = (target, fullText, seenLines) => {
      if (armed && target === destKey) {
        armed = false
        injected += 1
        throw new Error('injected destination record failure (SNAP-R3)')
      }
      return originalRecord(target, fullText, seenLines)
    }
    try {
      const value = await readTag(harness, 'snap3-src.txt')
      // The destination has no snapshot before the commit, so a hit on its record
      // can only come from this move's post-relocate step.
      expect(store.head(destKey)).toBeNull()
      expect(store.head(sourceKey)?.text).toBe(sourceText)
      armed = true

      const result = await harness.edit({ input: header(value) + '\nPUT 2.=2:\n+BETA\nMV snap3-dst.txt' })

      const message = failure(result)
      expect(injected).toBe(1)
      // Tool result: an error, not a success string.
      expect(result.isError, message).toBe(true)
      // Disk: the move landed with the edit applied, and the source is gone.
      expect((await bytesIn(harness.root, 'snap3-dst.txt')).toString('utf8')).toBe('alpha\nBETA\n')
      await expect(readFile(source)).rejects.toThrow()
      // Snapshot: relocate ran, so the destination holds the pre-edit version and the
      // source is empty. The message must not deny that.
      expect(store.head(sourceKey)).toBeNull()
      expect(store.head(destKey)?.text).toBe(sourceText)
      // Message: the four true facts plus the original cause, in tool-visible text.
      expect(message).toMatch(/moved on disk from/iu)
      expect(message).toContain('injected destination record failure (SNAP-R3)')
      expect(message).toMatch(/bookkeeping did not complete/iu)
      expect(message).toMatch(/may be partially updated/iu)
      expect(message).toMatch(/re-read the destination/iu)
      expect(message).not.toMatch(/source snapshot (was|is) (not migrated|gone|discarded)/iu)
      // No reverse move and no blind cleanup of the destination.
      expect((await bytesIn(harness.root, 'snap3-dst.txt')).toString('utf8')).toBe('alpha\nBETA\n')
    } finally {
      store.record = originalRecord
    }
  })
})

