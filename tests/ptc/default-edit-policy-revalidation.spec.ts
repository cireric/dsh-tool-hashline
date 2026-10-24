/**
 * Ticket 07 over the PTC bridge: an inner refusal and an outer program that
 * catches it are separate facts, and the retry is a new decision.
 * @module dsh-tool-hashline/tests/ptc/default-edit-policy-revalidation
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createPtcHarness, readFixture, writeFixture } from './harness.ts'

const POLICY_MODULE = fileURLToPath(new URL('../../presets/ptc-hashline/policy/default-edit-policy.mjs', import.meta.url))
const q = (value: string) => JSON.stringify(value)
const CEILING = 16
const textOfBytes = (bytes: number): string => 'x'.repeat(Math.max(0, bytes - 1)) + '\n'

describe('PTC: an inner refusal does not become an outer failure', () => {
  it('keeps the policy error catchable inside the program and reports the disk', async () => {
    const harness = await createPtcHarness({ policyModule: POLICY_MODULE })
    onTestFinished(() => harness.cleanup())
    const source = 'one\ntwo\n'
    const file = await writeFixture(harness.dir, 'ptc-inner.txt', source)

    const result = await harness.runCode(`
      let refusal
      try {
        await tools.edit({ path: ${q(file)}, old_string: 'two', new_string: 'TWO' })
        refusal = null
      } catch (error) {
        refusal = String(error && error.message)
      }
      // The program continues after the refusal: an inner error is data for it.
      const after = await tools.read({ file_path: ${q(file)} })
      return { refusal, tagged: after.tagged }
    `)

    expect(result.isError).toBe(false)
    const value = (result.value as unknown as { result: { refusal: string | null; tagged: boolean } }).result
    expect(value.refusal).toContain('EDIT_POLICY_FALLBACK_REQUIRED')
    expect(value.tagged).toBe(true)
    expect(await readFixture(file)).toBe(source)
  })

  it('re-decides after a stale-version retry instead of reusing the first allow', async () => {
    const harness = await createPtcHarness({ policyModule: POLICY_MODULE, read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'ptc-retry.txt', textOfBytes(CEILING))

    // The first read justifies the degradation; the file is then rewritten BELOW
    // the ceiling, so a later call with the same citation must be refused.
    const first = await harness.runCode(`
      const r = await tools.read({ file_path: ${q(file)} })
      const citation = /readCallId: (\\S+?)\\)/.exec(r.nextAction ?? '')?.[1]
      return { citation }
    `)
    expect(first.isError).toBe(false)
    const citation = (first.value as unknown as { result: { citation: string } }).result.citation

    await writeFixture(harness.dir, 'ptc-retry.txt', 'now-small\n')
    const second = await harness.runCode(`
      let outcome
      try {
        await tools.edit({
          path: ${q(file)},
          old_string: 'now-small',
          new_string: 'NOW-SMALL',
          fallbacks: [{ path: ${q(file)}, reason: 'snapshot-limit', readCallId: ${q(citation)} }],
        })
        outcome = { ok: true }
      } catch (error) {
        outcome = { ok: false, message: String(error && error.message) }
      }
      return { outcome }
    `)

    expect(second.isError).toBe(false)
    const outcome = (second.value as unknown as { result: { outcome: { ok: boolean; message?: string } } }).result.outcome
    expect(outcome.ok).toBe(false)
    expect(outcome.message).toContain('EDIT_POLICY_EVIDENCE_STALE')
    expect(await readFixture(file)).toBe('now-small\n')
  })
})
