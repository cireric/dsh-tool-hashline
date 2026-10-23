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
import { rm, writeFile } from 'node:fs/promises'
import { FsError } from '@deepseek-ai/dsh-fs'
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
