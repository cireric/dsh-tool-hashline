import { describe, expect, it, onTestFinished } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createPtcHarness, readFixture, writeFixture } from './harness.ts'

const q = (value: string) => JSON.stringify(value)
const intent = 'Intent: fix — adjust line 2 of the fixture; I will read then patch it.'

const feedTurn = (harness: Awaited<ReturnType<typeof createPtcHarness>>, text: string) => harness.beginTurn({ text })

const editProgram = (file: string) => `
  const r = await tools.read({ file_path: ${q(file)} })
  const out = await tools.edit({ input: '[' + r.path + '#' + r.tag + ']\\nPUT 2.=2:\\n+TWO' })
  return { out }
`

describe('intent gate over PTC (FR-1/FR-14)', () => {
  it('denies the first behavior action of a turn without the intent line', async () => {
    const harness = await createPtcHarness({ watch: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'gated.txt', 'one\ntwo\nthree\n')
    feedTurn(harness, 'I will edit the file now.')
    const denied = await harness.runCode(editProgram(file), { callId: 'root-1' })
    expect(denied.isError).toBe(true)
    const message = denied.error?.message ?? ''
    expect(message).toContain('Intent')
    expect(await readFixture(file)).toBe('one\ntwo\nthree\n')

    // At most one deny per turn: the same turn's next attempt is not walled in.
    const second = await harness.runCode(editProgram(file), { callId: 'root-1' })
    expect(second.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\nthree\n')
  })

  it('allows the behavior action when the carrier message declares a valid bucket', async () => {
    const harness = await createPtcHarness({ watch: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'allowed.txt', 'one\ntwo\nthree\n')
    feedTurn(harness, intent)
    const result = await harness.runCode(editProgram(file), { callId: 'root-1' })
    expect(result.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\nthree\n')
  })

  it('leaves a read-only program alone without an intent line', async () => {
    const harness = await createPtcHarness({ watch: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'readonly.txt', 'one\ntwo\n')
    feedTurn(harness, 'Just looking.')
    const result = await harness.runCode(`const r = await tools.read({ file_path: ${q(file)} }); return { tag: r.tag }`)
    expect(result.isError).toBe(false)
  })

  it('does not match a renamed edit tool (negative control for name-based gating)', async () => {
    const harness = await createPtcHarness({ watch: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'renamed.txt', 'one\ntwo\n')
    harness.ctx.tools.register(defineTool({
      name: 'edit_hashline',
      description: 'Renamed edit fixture (must bypass the name-based gate).',
      parameters: { file_path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const { writeFile } = await import('node:fs/promises')
        await writeFile(args.file_path, 'one\nRENAMED\n', 'utf8')
        return 'renamed edit applied'
      },
    }))
    feedTurn(harness, 'No gate line here.')
    const result = await harness.runCode(`const out = await tools.edit_hashline({ file_path: ${q(file)} }); return { out }`)
    expect(result.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nRENAMED\n')
  })

  it('keeps the upstream tag guidance inside a denied-then-accepted PTC turn', async () => {
    const harness = await createPtcHarness({ watch: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'tagless.txt', 'one\ntwo\n')
    feedTurn(harness, intent)
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
