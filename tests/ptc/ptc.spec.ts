import { describe, expect, it, onTestFinished } from 'vitest'
import { createPtcHarness, readFixture, writeFixture } from './harness.ts'

const q = (value: string) => JSON.stringify(value)

describe('PTC bridge (FR-2/FR-3)', () => {
  it('denies a model-direct read as UNKNOWN_TOOL and serves it inside the program', async () => {
    const harness = await createPtcHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'a.txt', 'one\ntwo\n')

    const direct = await harness.direct('read', { file_path: file })
    expect(direct.isError).toBe(true)
    expect(direct.error?.info?.code).toBe('UNKNOWN_TOOL')

    const result = await harness.runCode(`
      const r = await tools.read({ file_path: ${q(file)} })
      return { tag: r.tag, tagged: r.tagged, nextAction: r.nextAction, lines: r.lines.length }
    `)
    expect(result.isError).toBe(false)
    const value = (result.value as { result: { tag: string; tagged: boolean; nextAction: string | null; lines: number } }).result
    expect(value.tagged).toBe(true)
    expect(value.tag).toMatch(/^[0-9A-F]{4}$/u)
    expect(value.nextAction).toBeNull()
    expect(value.lines).toBe(2)
  })

  it('lets the program read a tag and edit on the first attempt', async () => {
    const harness = await createPtcHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'b.txt', 'one\ntwo\nthree\n')
    const result = await harness.runCode(`
      const r = await tools.read({ file_path: ${q(file)} })
      const out = await tools.edit({ input: '[' + r.path + '#' + r.tag + ']\\nPUT 2.=2:\\n+TWO' })
      return { tag: r.tag, out }
    `)
    expect(result.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\nthree\n')
  })

  it('declares tag/nextAction as string | null in the generated SDK', async () => {
    const harness = await createPtcHarness()
    onTestFinished(() => harness.cleanup())
    const assembly = await harness.ctx.systemPrompt.assemble()
    const sdk = assembly.sections.find(section => section.name === 'tools:sdk')?.text ?? ''
    expect(sdk).toContain('tag: string | null')
    expect(sdk).toContain('nextAction: string | null')
    expect(sdk).not.toMatch(/tag:\s*unknown/u)
  })

  it('exposes every non-mint reason to the program', async () => {
    const harness = await createPtcHarness({ read: { snapshotMaxBytes: 5 } })
    onTestFinished(() => harness.cleanup())
    const empty = await writeFixture(harness.dir, 'empty.txt', '')
    const big = await writeFixture(harness.dir, 'big.txt', 'abcdefgh')
    const result = await harness.runCode(`
      const a = await tools.read({ file_path: ${q(empty)} })
      const b = await tools.read({ file_path: ${q(big)} })
      const c = await tools.read({ file_path: ${q(big)}, limit: 1 })
      return {
        empty: { tagged: a.tagged, tag: a.tag, next: a.nextAction },
        big: { tagged: b.tagged, tag: b.tag, next: b.nextAction },
        window: c.lines.length,
      }
    `)
    expect(result.isError).toBe(false)
    const value = (result.value as { result: { empty: { tagged: boolean; tag: unknown; next: string }, big: { tagged: boolean; tag: unknown; next: string }, window: number } }).result
    expect(value.empty).toMatchObject({ tagged: false, tag: null })
    expect(value.empty.next).toContain('write tool')
    expect(value.big).toMatchObject({ tagged: false, tag: null })
    expect(value.big.next).toContain('replace or patch')
    expect(value.window).toBe(1)
  })
})
