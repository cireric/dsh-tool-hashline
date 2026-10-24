/**
 * Ticket 02 over the PTC bridge: the visible citation -> SDK/parameter validation
 * -> policy verification -> disk path, in ONE program.
 *
 * Traces POLICY-05 (snapshot leg through PTC), POLICY-12 (input contract) and
 * the I/O cost the plan asks to record (plan D7).
 * @module dsh-tool-hashline/tests/ptc/default-edit-policy-snapshot
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createPtcHarness, readFixture, writeFixture } from './harness.ts'

const POLICY_MODULE = fileURLToPath(new URL('../../presets/ptc-hashline/policy/default-edit-policy.mjs', import.meta.url))
const q = (value: string) => JSON.stringify(value)
const CEILING = 16
const textOfBytes = (bytes: number): string => 'x'.repeat(Math.max(0, bytes - 1)) + '\n'

describe('PTC: a snapshot-limit degradation from the program', () => {
  it('reads the citation out of nextAction, declares it, and lands the update', async () => {
    const harness = await createPtcHarness({ policyModule: POLICY_MODULE, read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'ptc-big.txt', textOfBytes(CEILING))

    const result = await harness.runCode(`
      const r = await tools.read({ file_path: ${q(file)} })
      const citation = /readCallId: (\\S+?)\\)/.exec(r.nextAction ?? '')?.[1]
      let outcome
      try {
        const out = await tools.edit({
          path: ${q(file)},
          old_string: 'x'.repeat(8),
          new_string: 'Y'.repeat(8),
          fallbacks: [{ path: ${q(file)}, reason: 'snapshot-limit', readCallId: citation }],
        })
        outcome = { ok: true, out }
      } catch (error) {
        outcome = { ok: false, message: String(error && error.message) }
      }
      return { tagged: r.tagged, citation, outcome }
    `)

    expect(result.isError).toBe(false)
    const value = (result.value as unknown as { result: { tagged: boolean; citation: string; outcome: { ok: boolean; message?: string } } }).result
    expect(value.tagged).toBe(false)
    expect(value.citation).toBeTypeOf('string')
    expect(value.outcome.ok, value.outcome.message).toBe(true)
    expect(await readFixture(file)).toBe('Y'.repeat(8) + 'x'.repeat(CEILING - 9) + '\n')
  })

  it('rejects a fabricated citation inside the program, and writes nothing', async () => {
    const harness = await createPtcHarness({ policyModule: POLICY_MODULE, read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const source = textOfBytes(CEILING)
    const file = await writeFixture(harness.dir, 'ptc-fabricated.txt', source)

    const result = await harness.runCode(`
      await tools.read({ file_path: ${q(file)} })
      let outcome
      try {
        await tools.edit({
          path: ${q(file)},
          old_string: 'x'.repeat(8),
          new_string: 'Y'.repeat(8),
          fallbacks: [{ path: ${q(file)}, reason: 'snapshot-limit', readCallId: 'read-999' }],
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
    expect(value.outcome.message).toContain('EDIT_POLICY_READ_UNKNOWN')
    expect(await readFixture(file)).toBe(source)
  })

  it('keeps the read schema unchanged: no fact fields leak into the canonical value', async () => {
    const harness = await createPtcHarness({ policyModule: POLICY_MODULE, read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'ptc-schema.txt', textOfBytes(CEILING))

    const result = await harness.runCode(`
      const r = await tools.read({ file_path: ${q(file)} })
      return { keys: Object.keys(r).sort() }
    `)

    expect(result.isError).toBe(false)
    const value = (result.value as unknown as { result: { keys: string[] } }).result
    expect(value.keys).toEqual(['lines', 'nextAction', 'offset', 'path', 'tag', 'tagged', 'totalLines'])
  })
})
