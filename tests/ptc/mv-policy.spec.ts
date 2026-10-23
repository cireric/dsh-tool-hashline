/**
 * PTC-layer acceptance for MV under the observation policy (MV fix plan §3.D).
 *
 * The program is executed by the in-process PTC carrier, so every inner
 * `tools.read` / `tools.edit` call travels through the registry's PTC bridge and
 * the real `fs-observation-policy`, exactly like a `run_code` call in a session.
 * These cases exist because the original report's MV failure was only visible at
 * this layer: the same code passed every non-policy fixture.
 */
import { rm } from 'node:fs/promises'
import * as path from 'node:path'
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
