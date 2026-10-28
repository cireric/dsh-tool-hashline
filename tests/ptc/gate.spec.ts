import { describe, expect, it, onTestFinished } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createPtcHarness, readFixture, writeFixture } from './harness.ts'

/**
 * The retired tool-name gate has to STAY retired. Until 2026-10-27 this file asserted the
 * opposite: a program whose carrier message lacked a six-bucket line was denied on its
 * first `write`/`edit`/`bash` dispatch, mid-program, with the whole program dying with it.
 * The request-level gate (spec 2026-10-27-intent-gate-b-requirements) moved the obligation
 * to the model stream, so with the gate mounted there must be NO refusal at dispatch time —
 * including for the very calls the old mechanism denied. Keeping this as the negative
 * control is what stops the old rule from quietly reappearing beside the new one.
 */

const q = (value: string) => JSON.stringify(value)

const editProgram = (file: string) => `
  const r = await tools.read({ file_path: ${q(file)} })
  const out = await tools.edit({ input: '[' + r.path + '#' + r.tag + ']\\nPUT 2.=2:\\n+TWO' })
  return { out }
`

describe('intent gate is no longer decided on tool names (IG-B-01/02 replacement)', () => {
  it('executes an edit program whose reply carried no declaration line at all', async () => {
    const harness = await createPtcHarness({ gate: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'ungated.txt', 'one\ntwo\nthree\n')
    await harness.beginTurn({ text: 'I will edit the file now.' })
    const result = await harness.runCode(editProgram(file), { callId: 'root-1' })
    expect(result.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\nthree\n')
  })

  it('does not wall a program in after its first behavior call', async () => {
    const harness = await createPtcHarness({ gate: true })
    onTestFinished(() => harness.cleanup())
    const first = await writeFixture(harness.dir, 'first.txt', 'a\nb\n')
    const second = await writeFixture(harness.dir, 'second.txt', 'c\nd\n')
    await harness.beginTurn({ text: 'Two edits, no declaration line.' })
    const result = await harness.runCode(`
      for (const name of ['first.txt', 'second.txt']) {
        const r = await tools.read({ file_path: name })
        await tools.edit({ input: '[' + r.path + '#' + r.tag + ']\\nPUT 2.=2:\\n+CHANGED' })
      }
      return { done: true }
    `, { callId: 'root-1' })
    expect(result.isError).toBe(false)
    expect(await readFixture(first)).toBe('a\nCHANGED\n')
    expect(await readFixture(second)).toBe('c\nCHANGED\n')
  })

  it('leaves a read-only program alone', async () => {
    const harness = await createPtcHarness({ gate: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'readonly.txt', 'one\ntwo\n')
    await harness.beginTurn({ text: 'Just looking.' })
    const result = await harness.runCode(`const r = await tools.read({ file_path: ${q(file)} }); return { tag: r.tag }`)
    expect(result.isError).toBe(false)
  })

  it('does not match a renamed edit tool either (nothing here keys on names)', async () => {
    const harness = await createPtcHarness({ gate: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'renamed.txt', 'one\ntwo\n')
    harness.ctx.tools.register(defineTool({
      name: 'edit_hashline',
      description: 'Renamed edit fixture.',
      parameters: { file_path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const { writeFile } = await import('node:fs/promises')
        await writeFile(args.file_path, 'one\nRENAMED\n', 'utf8')
        return 'renamed edit applied'
      },
    }))
    await harness.beginTurn({ text: 'No gate line here.' })
    const result = await harness.runCode(`const out = await tools.edit_hashline({ file_path: ${q(file)} }); return { out }`)
    expect(result.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nRENAMED\n')
  })

  it('keeps the upstream tag guidance inside a PTC program', async () => {
    const harness = await createPtcHarness({ gate: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'tagless.txt', 'one\ntwo\n')
    const result = await harness.runCode(`
      const r = await tools.read({ file_path: ${q(file)} })
      const wrong = r.tag === '0000' ? '1111' : '0000'
      let message = ''
      try {
        await tools.edit({ input: '[' + r.path + '#' + wrong + ']\\nPUT 1.=1:\\n+x' })
      } catch (error) {
        message = String(error && error.message ? error.message : error)
      }
      return { message, tag: r.tag }
    `, { callId: 'root-1' })
    expect(result.isError).toBe(false)
    const value = (result.value as { result: { message: string; tag: string } }).result
    expect(value.message).toContain('#' + value.tag)
    expect(value.message).toMatch(/re-read|read the file/u)
  })
})
