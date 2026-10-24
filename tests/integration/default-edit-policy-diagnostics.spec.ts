/**
 * Ticket 08: the decision a call reached is reconstructable from the record,
 * and the record carries no user text or file body.
 *
 * The record is read the way a maintainer would: from the policy instance that
 * served the call, plus the session log the harness already keeps. Nothing here
 * re-derives a decision from the disk after the fact.
 * @module dsh-tool-hashline/tests/integration/default-edit-policy-diagnostics
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { createPolicyHarness, readFixture, writeFixture } from './edit-policy-harness.ts'

const POLICY_MODULE = fileURLToPath(new URL('../../presets/ptc-hashline/policy/default-edit-policy.mjs', import.meta.url))
const errorText = (result: ToolExecutionResult): string => result.isError ? result.error.message : ''
const CEILING = 16
const textOfBytes = (bytes: number): string => 'x'.repeat(Math.max(0, bytes - 1)) + '\n'
const citationOf = (nextAction: string | null): string | undefined => /readCallId: (\S+?)\)/u.exec(nextAction ?? '')?.[1]

const managed = (options: Parameters<typeof createPolicyHarness>[0] = {}) =>
  createPolicyHarness({ ...options, policyModule: POLICY_MODULE })

/** The record shape this ticket reconstructs a decision from. */
interface Receipt {
  version: string
  mode: string
  result: string
  code?: string
  decision?: {
    payload: string
    targets: { path: string; op: string; kind: string }[]
    constrained: string[]
    fallbacks: { path: string; reason: string }[]
    retry: number
  }
}

describe('POLICY-17: the receipt reconstructs the decision', () => {
  it('records the target, payload class, mode and verified reason of an allowed call', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'diagnosed.txt', textOfBytes(CEILING))
    const read = await harness.read('diagnosed.txt')
    const citation = citationOf((read as unknown as { value: { nextAction: string | null } }).value.nextAction)

    const result = await harness.callTool('edit', {
      path: 'diagnosed.txt',
      old_string: 'x'.repeat(8),
      new_string: 'Y'.repeat(8),
      fallbacks: [{ path: 'diagnosed.txt', reason: 'snapshot-limit', readCallId: citation }],
    })
    expect(result.isError, errorText(result)).toBe(false)

    const receipts = harness.policyReceipts() as unknown as Receipt[]
    const receipt = receipts[receipts.length - 1]!
    expect(receipt).toBeDefined()
    expect(receipt.version).toBe('1')
    expect(receipt.mode).toBe('replace')
    expect(receipt.result).toBe('completed')
    expect(receipt.decision?.payload).toBe('replace')
    expect(receipt.decision?.targets).toEqual([{ path: 'diagnosed.txt', op: 'update', kind: 'content' }])
    expect(receipt.decision?.constrained).toEqual(['diagnosed.txt'])
    expect(receipt.decision?.fallbacks).toEqual([{ path: 'diagnosed.txt', reason: 'snapshot-limit' }])
    expect(receipt.decision?.retry).toBe(0)
    // It never copies the file body or the model's payload. (The receipt carries the
    // Cordis execution object, so it is inspected field by field, not serialized.)
    const decisionText = JSON.stringify(receipt.decision)
    expect(decisionText).not.toContain('x'.repeat(8))
    expect(decisionText).not.toContain('Y'.repeat(8))
  })

  it('records a refusal as refused, with the code and the decision it refused', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'refused-record.txt', 'content\n')

    const result = await harness.callTool('edit', { path: 'refused-record.txt', old_string: 'content', new_string: 'CONTENT' })
    expect(result.isError).toBe(true)

    const receipts = harness.policyReceipts() as unknown as Receipt[]
    const receipt = receipts[receipts.length - 1]!
    expect(receipt).toBeDefined()
    expect(receipt.result).toBe('refused')
    expect(receipt.code).toBe('EDIT_POLICY_FALLBACK_REQUIRED')
    // The record keeps the decision the call was refused ON: which targets were
    // constrained and that nothing was declared, so a reader sees the gap itself.
    expect(receipt.decision?.constrained).toEqual(['refused-record.txt'])
    expect(receipt.decision?.fallbacks).toEqual([])
  })

  it('records a Hashline call with no fallbacks and no constrained target', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'hashline-record.txt', 'one\ntwo\n')
    const read = await harness.read('hashline-record.txt')
    const value = (read as unknown as { value: { path: string; tag: string } }).value
    const result = await harness.edit('[' + value.path + '#' + value.tag + ']\nPUT 2.=2:\n+TWO')
    expect(result.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\n')

    const receipts = harness.policyReceipts() as unknown as Receipt[]
    const receipt = receipts[receipts.length - 1]!
    expect(receipt.mode).toBe('hashline')
    expect(receipt.result).toBe('completed')
  })

  it('does not record an engine failure as a policy refusal', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'engine-fail.txt', 'one\ntwo\n')
    harness.appendUserMessage('use replace on engine-fail.txt')

    const result = await harness.callTool('edit', {
      path: 'engine-fail.txt',
      old_string: 'not-there',
      new_string: 'X',
      fallbacks: [{ path: 'engine-fail.txt', reason: 'user-override', userSource: { quote: 'use replace on engine-fail.txt' }, modes: ['replace'] }],
    })
    expect(result.isError).toBe(true)

    const receipts = harness.policyReceipts() as unknown as Receipt[]
    const receipt = receipts[receipts.length - 1]!
    expect(receipt.result).toBe('failed')
    expect(receipt.code).toBeUndefined()

    // The decision IS recorded: the policy allowed the call and the engine failed.
    expect(receipt.decision?.fallbacks).toEqual([{ path: 'engine-fail.txt', reason: 'user-override' }])
  })
})
