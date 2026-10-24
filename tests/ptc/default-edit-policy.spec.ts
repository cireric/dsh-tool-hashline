/**
 * Default-edit policy over the real PTC bridge (ticket 01): the program must see
 * the refusal as a thrown inner error, the fallbacks field in the generated SDK,
 * and a Hashline edit that still works beside it.
 *
 * Traces POLICY-11/POLICY-18/POLICY-20 (PTC leg) and POLICY-01's SDK statement.
 * @module dsh-tool-hashline/tests/ptc/default-edit-policy
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createPtcHarness, readFixture, writeFixture } from './harness.ts'

const POLICY_MODULE = fileURLToPath(new URL('../../presets/ptc-hashline/policy/default-edit-policy.mjs', import.meta.url))
const q = (value: string) => JSON.stringify(value)

describe('PTC: the default-edit policy reaches the program', () => {
  it('throws the policy refusal into the program and leaves the file untouched', async () => {
    const harness = await createPtcHarness({ policyModule: POLICY_MODULE })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'ptc-refused.txt', 'one\ntwo\n')

    const result = await harness.runCode(`
      let refused
      try {
        await tools.edit({ path: ${q(file)}, old_string: 'two', new_string: 'TWO' })
        refused = { threw: false }
      } catch (error) {
        refused = { threw: true, message: String(error && error.message) }
      }
      return { refused }
    `)

    expect(result.isError).toBe(false)
    const value = (result.value as unknown as { result: { refused: { threw: boolean; message?: string } } }).result
    expect(value.refused.threw).toBe(true)
    expect(value.refused.message).toContain('EDIT_POLICY_FALLBACK_REQUIRED')
    // The program ran to completion and the disk never changed.
    expect(await readFixture(file)).toBe('one\ntwo\n')
  })

  it('still edits through Hashline in the same program, after a refusal', async () => {
    const harness = await createPtcHarness({ policyModule: POLICY_MODULE })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'ptc-allowed.txt', 'one\ntwo\nthree\n')

    const result = await harness.runCode(`
      let refused = false
      try { await tools.edit({ path: ${q(file)}, old_string: 'two', new_string: 'TWO' }) }
      catch { refused = true }
      const r = await tools.read({ file_path: ${q(file)} })
      const out = await tools.edit({ input: '[' + r.path + '#' + r.tag + ']\\nPUT 2.=2:\\n+TWO' })
      return { refused, tagged: r.tagged, out }
    `)

    expect(result.isError).toBe(false)
    const value = (result.value as unknown as { result: { refused: boolean; tagged: boolean } }).result
    expect(value.refused).toBe(true)
    expect(value.tagged).toBe(true)
    expect(await readFixture(file)).toBe('one\nTWO\nthree\n')
  })

  it('declares the fallbacks field in the generated SDK, with the closed reason set', async () => {
    const harness = await createPtcHarness({ policyModule: POLICY_MODULE })
    onTestFinished(() => harness.cleanup())
    const sdk = (await harness.ctx.systemPrompt.assemble())
      .sections.find(section => section.name === 'tools:sdk')?.text ?? ''

    expect(sdk).toContain('fallbacks')
    expect(sdk).toContain('snapshot-limit')
    expect(sdk).toContain('window-limit')
    expect(sdk).toContain('user-override')
    // The policy's own instructions ship beside the tool description, not inside it.
    expect(sdk).not.toContain('Default edit policy:')
    const prompt = (await harness.ctx.systemPrompt.assemble())
      .sections.find(section => section.name === 'tool:edit-policy')?.text ?? ''
    expect(prompt).toContain('Default edit policy')
    expect(prompt).toContain('snapshot-limit')
  })

  it('omits both the field and the policy section when no policy is mounted', async () => {
    const harness = await createPtcHarness()
    onTestFinished(() => harness.cleanup())
    const assembly = await harness.ctx.systemPrompt.assemble()
    const sdk = assembly.sections.find(section => section.name === 'tools:sdk')?.text ?? ''
    expect(sdk).not.toContain('fallbacks')
    expect(assembly.sections.find(section => section.name === 'tool:edit-policy')).toBeUndefined()
  })
})
