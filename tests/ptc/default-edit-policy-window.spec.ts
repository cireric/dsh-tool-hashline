/**
 * Ticket 03 over the PTC bridge: the window citation is consumable and the
 * limited lines are the only thing it unlocks.
 * @module dsh-tool-hashline/tests/ptc/default-edit-policy-window
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createPtcHarness, readFixture, writeFixture } from './harness.ts'

const POLICY_MODULE = fileURLToPath(new URL('../../presets/ptc-hashline/policy/default-edit-policy.mjs', import.meta.url))
const q = (value: string) => JSON.stringify(value)

describe('PTC: a window-limit degradation from the program', () => {
  it('reads a truncated window, declares the limited range, and updates that line', async () => {
    const harness = await createPtcHarness({ policyModule: POLICY_MODULE, read: { maxLineLength: 8 } })
    onTestFinished(() => harness.cleanup())
    const source = 'short\n' + 'x'.repeat(40) + '\n'
    const file = await writeFixture(harness.dir, 'ptc-window.txt', source)

    const result = await harness.runCode(`
      const r = await tools.read({ file_path: ${q(file)} })
      const citation = /readCallId: (\\S+?)\\)/.exec(r.nextAction ?? '')?.[1]
      const out = await tools.edit({
        path: ${q(file)},
        old_string: 'x'.repeat(40),
        new_string: 'y'.repeat(40),
        fallbacks: [{ path: ${q(file)}, reason: 'window-limit', readCallId: citation, ranges: [{ startLine: 2, endLine: 2 }] }],
      })
      return { citation, out }
    `)

    expect(result.isError).toBe(false)
    expect(await readFixture(file)).toBe('short\n' + 'y'.repeat(40) + '\n')
  })

  it('refuses a range the read returned in full, inside the program', async () => {
    const harness = await createPtcHarness({ policyModule: POLICY_MODULE, read: { maxLineLength: 8 } })
    onTestFinished(() => harness.cleanup())
    const source = 'short\n' + 'x'.repeat(40) + '\n'
    const file = await writeFixture(harness.dir, 'ptc-window-refused.txt', source)

    const result = await harness.runCode(`
      const r = await tools.read({ file_path: ${q(file)} })
      const citation = /readCallId: (\\S+?)\\)/.exec(r.nextAction ?? '')?.[1]
      let outcome
      try {
        await tools.edit({
          path: ${q(file)},
          old_string: 'short',
          new_string: 'SHORT',
          fallbacks: [{ path: ${q(file)}, reason: 'window-limit', readCallId: citation, ranges: [{ startLine: 1, endLine: 1 }] }],
        })
        outcome = { ok: true }
      } catch (error) {
        outcome = { ok: false, message: String(error && error.message) }
      }
      return { outcome }
    `)

    expect(result.isError).toBe(false)
    const value = (result.value as unknown as { result: { outcome: { ok: boolean; message?: string } } }).result
    expect(value.outcome.ok).toBe(false)
    expect(value.outcome.message).toContain('EDIT_POLICY_REASON_FALSE')
    expect(await readFixture(file)).toBe(source)
  })
})
