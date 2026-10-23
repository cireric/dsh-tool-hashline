/**
 * PTC-layer acceptance for MV under the observation policy (MV fix plan §3.D).
 *
 * The program is executed by the in-process PTC carrier, so every inner
 * `tools.read` / `tools.edit` call travels through the registry's PTC bridge and
 * the real `fs-observation-policy`, exactly like a `run_code` call in a session.
 * These cases exist because the original report's MV failure was only visible at
 * this layer: the same code passed every non-policy fixture.
 */
import { mkdir, rm } from 'node:fs/promises'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import * as path from 'node:path'
import { getSessionSnapshotStore } from '@dsh-tool-hashline/hashline'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createPtcHarness, readFixture, writeFixture } from './harness.ts'

describe('PTC: MV with the production observation policy', () => {
  it('moves a file from inside a run_code program and reads the target back', async () => {
    const harness = await createPtcHarness()
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'ptc-mv.txt', 'a\nb\n')

    const result = await harness.runCode(`
      const r = await tools.read({ file_path: 'ptc-mv.txt' })
      await tools.edit({ input: '[' + r.path + '#' + r.tag + ']\\nMV ptc-mv-dest.txt' })
      const back = await tools.read({ file_path: 'ptc-mv-dest.txt' })
      return { tag: back.tag, lines: back.lines.length, total: back.totalLines }
    `)

    expect(result.isError).toBe(false)
    const value = (result.value as { result: { tag: string; lines: number; total: number } }).result
    expect(value.tag).toMatch(/^[0-9A-F]{4}$/u)
    expect(value.lines).toBe(2)
    expect(value.total).toBe(2)
    expect(await readFixture(path.join(harness.dir, 'ptc-mv-dest.txt'))).toBe('a\nb\n')
    await expect(readFixture(path.join(harness.dir, 'ptc-mv.txt'))).rejects.toThrow()
  })

  it('completes MV, a read of the moved file, and REM in one program', async () => {
    const harness = await createPtcHarness()
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'ptc-chain.txt', 'a\nb\n')

    const result = await harness.runCode(`
      const r = await tools.read({ file_path: 'ptc-chain.txt' })
      await tools.edit({ input: '[' + r.path + '#' + r.tag + ']\\nMV ptc-chain-dest.txt' })
      const moved = await tools.read({ file_path: 'ptc-chain-dest.txt' })
      await tools.edit({ input: '[' + moved.path + '#' + moved.tag + ']\\nREM' })
      return { tag: moved.tag }
    `)

    expect(result.isError).toBe(false)
    await expect(readFixture(path.join(harness.dir, 'ptc-chain.txt'))).rejects.toThrow()
    await expect(readFixture(path.join(harness.dir, 'ptc-chain-dest.txt'))).rejects.toThrow()
  })

  it('keeps the already-written section and the partial MV state in one error', async () => {
    const harness = await createPtcHarness()
    onTestFinished(() => harness.cleanup())
    const first = await writeFixture(harness.dir, 'batch-first.txt', 'one\ntwo\n')
    const second = await writeFixture(harness.dir, 'batch-second.txt', 'alpha\nbeta\n')
    const destination = path.join(harness.dir, 'batch-moved.txt')
    const original = harness.ctx.fs.writeText.bind(harness.ctx.fs)
    harness.ctx.fs.writeText = async (...args) => {
      const outcome = await original(...args)
      // The source vanishes after the MV target landed, so its delete fails while
      // the first section is already on disk.
      if (args[0].displayPath === destination) await rm(second)
      return outcome
    }

    const result = await harness.runCode(`
      const a = await tools.read({ file_path: 'batch-first.txt' })
      const b = await tools.read({ file_path: 'batch-second.txt' })
      const input = '[' + a.path + '#' + a.tag + ']\\nPUT 1.=1:\\n+ONE\\n\\n[' + b.path + '#' + b.tag + ']\\nMV batch-moved.txt'
      let message = ''
      try {
        await tools.edit({ input })
      } catch (error) {
        message = String(error && error.message ? error.message : error)
      }
      return { message }
    `)

    expect(result.isError).toBe(false)
    const message = (result.value as { result: { message: string } }).result.message
    // The outer engine wrapper must keep both halves: what landed and what did not.
    expect(message).toContain('Sections already written')
    expect(message).toContain('batch-first.txt')
    expect(message).toContain(destination)
    expect(message).toContain(second)
    expect(message).toMatch(/partly completed/iu)
    expect(await readFixture(first)).toBe('ONE\ntwo\n')
    expect(await readFixture(destination)).toBe('alpha\nbeta\n')
  })

  it('surfaces a partial move to the program with both paths and the outcome', async () => {
    const harness = await createPtcHarness()
    onTestFinished(() => harness.cleanup())
    const source = await writeFixture(harness.dir, 'ptc-part-src.txt', 'a\nb\n')
    const destination = path.join(harness.dir, 'ptc-part-dest.txt')
    const original = harness.ctx.fs.writeText.bind(harness.ctx.fs)
    harness.ctx.fs.writeText = async (...args) => {
      const outcome = await original(...args)
      // The source vanishes behind the tool's back after the target landed, so the
      // tool's own delete fails and the call must report a partial move.
      if (args[0].displayPath === destination) await rm(source)
      return outcome
    }

    const result = await harness.runCode(`
      const r = await tools.read({ file_path: 'ptc-part-src.txt' })
      let message = ''
      try {
        await tools.edit({ input: '[' + r.path + '#' + r.tag + ']\\nMV ptc-part-dest.txt' })
      } catch (error) {
        message = String(error && error.message ? error.message : error)
      }
      return { message }
    `)

    expect(result.isError).toBe(false)
    const message = (result.value as { result: { message: string } }).result.message
    expect(message).toContain(destination)
    expect(message).toContain(source)
    expect(message).toMatch(/partly completed/iu)
    // The target keeps the intended content; nothing pretends the move was undone.
    expect(await readFixture(destination)).toBe('a\nb\n')
  })
})


/**
 * PTC-R1: a nested MV, the read that mints the moved file's tag, then REM - one
 * program, every step through the same bridge. The bare-name artifact check at the
 * session root is part of the assertion: a nested DEST must not slip out of the
 * sub directory.
 */
describe('PTC: nested MV, read of the target, then REM (PTC-R1)', () => {
  it('finishes the whole chain inside the nested directory and leaves no artifact', async () => {
    const harness = await createPtcHarness()
    onTestFinished(() => harness.cleanup())
    await mkdir(path.join(harness.dir, 'sub'), { recursive: true })
    const source = await writeFixture(harness.dir, path.join('sub', 'source.txt'), 'a\nb\n')

    const program = [
      'const steps = []',
      "const r = await tools.read({ file_path: 'sub/source.txt' })",
      "steps.push('read=' + r.tag)",
      "await tools.edit({ input: '[' + r.path + '#' + r.tag + ']\\nMV sub/moved.txt' })",
      "steps.push('moved')",
      "const moved = await tools.read({ file_path: 'sub/moved.txt' })",
      "steps.push('moved-read=' + moved.tag)",
      "await tools.edit({ input: '[' + moved.path + '#' + moved.tag + ']\\nREM' })",
      "steps.push('removed')",
      'return { steps }',
    ].join('\n')
    const result = await harness.runCode(program)

    expect(result.isError).toBe(false)
    const steps = (result.value as { result: { steps: string[] } }).result.steps
    expect(steps).toHaveLength(4)
    expect(steps[0]).toMatch(/^read=[0-9A-F]{4}$/u)
    expect(steps[1]).toBe('moved')
    expect(steps[2]).toMatch(/^moved-read=[0-9A-F]{4}$/u)
    expect(steps[3]).toBe('removed')

    await expect(readFixture(source)).rejects.toThrow()
    await expect(readFixture(path.join(harness.dir, 'sub', 'moved.txt'))).rejects.toThrow()
    // No bare-name artifact at the session root.
    await expect(readFixture(path.join(harness.dir, 'moved.txt'))).rejects.toThrow()
  })
})


const requireCjs = createRequire(import.meta.url)

const refuseSourceDelete = (sourcePath: string) => {
  const fsp = requireCjs('node:fs/promises') as typeof import('node:fs/promises')
  const original = fsp.rm
  // Exact resolved path, not basename: this seam is process-global and must not
  // fire for a same-named file another suite created in the same worker.
  const targetKey = path.resolve(sourcePath).toLowerCase()
  fsp.rm = (async (target: Parameters<typeof fsp.rm>[0], options?: Parameters<typeof fsp.rm>[1]) => {
    if (typeof target === 'string' && path.resolve(target).toLowerCase() === targetKey) {
      throw Object.assign(new Error('injected source delete refusal'), { code: 'EPERM' })
    }
    return original(target, options)
  }) as typeof fsp.rm
  syncBuiltinESMExports()
  let restored = false
  return () => {
    if (restored) return
    restored = true
    fsp.rm = original
    syncBuiltinESMExports()
  }
}

/**
 * PART-R1 at the PTC layer: the same refused source delete must reach the program
 * as a thrown error carrying both endpoints and the partial success - not as a
 * success value and not as a bare "failed".
 */
describe('PTC: a refused source delete surfaces to the program (PART-R1)', () => {
  it('throws with both paths and the partial success instead of returning a success value', async () => {
    const harness = await createPtcHarness()
    onTestFinished(() => harness.cleanup())
    const source = await writeFixture(harness.dir, 'ptc-part-refused-src.txt', 'a\nb\n')
    const destination = path.join(harness.dir, 'ptc-part-refused-dest.txt')
    const restore = refuseSourceDelete(source)
    onTestFinished(() => restore())
    try {
      const result = await harness.runCode([
        "const r = await tools.read({ file_path: 'ptc-part-refused-src.txt' })",
        "let message = ''",
        'try {',
        "  await tools.edit({ input: '[' + r.path + '#' + r.tag + ']\\nMV ptc-part-refused-dest.txt' })",
        '} catch (error) {',
        "  message = String(error && error.message ? error.message : error)",
        '}',
        'return { message }',
      ].join('\n'))

      expect(result.isError).toBe(false)
      const message = (result.value as { result: { message: string } }).result.message
      expect(message).toContain(source)
      expect(message).toContain(destination)
      expect(message).toMatch(/partly completed/iu)
      expect(message).toContain('injected source delete refusal')
      // Both endpoints really are still on disk with their content.
      expect(await readFixture(source)).toBe('a\nb\n')
      expect(await readFixture(destination)).toBe('a\nb\n')
    } finally {
      restore()
    }
  })
})


/**
 * SNAP-R3 at the PTC layer: a destination `record` failure after a successful
 * relocate must reach the program's catch block as a SnapshotCommitError message
 * that states the disk move, the incomplete bookkeeping, the possible partial
 * state and the original cause - and the disk/snapshot facts are re-checked
 * OUTSIDE the program, where the failure injection cannot influence them.
 */
describe('PTC: a destination record failure surfaces to the program (SNAP-R3)', () => {
  it('carries the disk move, the incomplete bookkeeping and the cause into the program', async () => {
    const harness = await createPtcHarness()
    onTestFinished(() => harness.cleanup())
    const source = await writeFixture(harness.dir, 'ptc-snap3-src.txt', 'alpha\nbeta\n')
    const destKey = path.resolve(harness.dir, 'ptc-snap3-dst.txt')
    const sourceKey = path.resolve(harness.dir, 'ptc-snap3-src.txt')
    const store = getSessionSnapshotStore(harness.session) as unknown as {
      record(path: string, fullText: string, seenLines?: Iterable<number>): string
      head(path: string): { text: string } | null
    }
    const originalRecord = store.record.bind(store)
    let armed = false
    let injected = 0
    store.record = (target, fullText, seenLines) => {
      if (armed && target === destKey) {
        armed = false
        injected += 1
        throw new Error('injected destination record failure (PTC SNAP-R3)')
      }
      return originalRecord(target, fullText, seenLines)
    }
    try {
      // Armed before the program runs but keyed to the DESTINATION store key only:
      // the program's read records the source key, and the destination has no
      // snapshot at all, so a hit can only be this move's post-relocate record.
      expect(store.head(destKey)).toBeNull()
      armed = true
      const result = await harness.runCode([
        "const r = await tools.read({ file_path: 'ptc-snap3-src.txt' })",
        "let message = ''",
        "let failed = false",
        'try {',
        "  await tools.edit({ input: '[' + r.path + '#' + r.tag + ']\\nPUT 2.=2:\\n+BETA\\nMV ptc-snap3-dst.txt' })",
        '} catch (error) {',
        '  failed = true',
        "  message = String(error && error.message ? error.message : error)",
        '}',
        'return { failed, message }',
      ].join('\n'))

      expect(result.isError).toBe(false)
      const value = (result.value as { result: { failed: boolean; message: string } }).result
      expect(injected, 'the fault must land on the destination record').toBe(1)
      expect(value.failed).toBe(true)
      expect(value.message).toMatch(/moved on disk from/iu)
      expect(value.message).toContain('injected destination record failure (PTC SNAP-R3)')
      expect(value.message).toMatch(/bookkeeping did not complete/iu)
      expect(value.message).toMatch(/may be partially updated/iu)
      expect(value.message).toMatch(/re-read the destination/iu)
      // Re-checked outside the program, after the injection is disarmed.
      expect(await readFixture(path.join(harness.dir, 'ptc-snap3-dst.txt'))).toBe('alpha\nBETA\n')
      await expect(readFixture(source)).rejects.toThrow()
      expect(store.head(sourceKey)).toBeNull()
      expect(store.head(destKey)?.text).toBe('alpha\nbeta\n')
    } finally {
      store.record = originalRecord
    }
  })
})

