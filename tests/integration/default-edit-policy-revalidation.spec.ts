/**
 * Ticket 07: evidence is re-checked at the write, and the replace retry cannot
 * ride an allow that stopped being true.
 *
 * The seam is the main one plus the fixture's provider-write hook, which is where
 * a competing change is injected: the test option drives the injection, never the
 * condition under test.
 *
 * Traces FR-04/FR-05/FR-06 (M4 execution): POLICY-06, POLICY-07, POLICY-19,
 * POLICY-20's engineering part, POLICY-14's existing no-op/recovery regression.
 * @module dsh-tool-hashline/tests/integration/default-edit-policy-revalidation
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

describe('POLICY-19: the version is re-checked immediately before the write', () => {
  it('refuses when the target changed between the policy check and the write', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING }, race: true, raceOn: 'race-target.txt' })
    onTestFinished(() => harness.cleanup())
    const source = textOfBytes(CEILING)
    await writeFixture(harness.dir, 'race-target.txt', source)
    const read = await harness.read('race-target.txt')
    const citation = citationOf((read as unknown as { value: { nextAction: string | null } }).value.nextAction)
    expect(citation).toBeTypeOf('string')

    const result = await harness.callTool('edit', {
      path: 'race-target.txt',
      old_string: 'x'.repeat(8),
      new_string: 'Y'.repeat(8),
      fallbacks: [{ path: 'race-target.txt', reason: 'snapshot-limit', readCallId: citation }],
    })

    // The competitor wrote between the check and the commit, so the policy's own
    // re-check fires with a concrete stale version.
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_EVIDENCE_STALE')
    expect(harness.race?.competitorContent).toBeTypeOf('string')
    expect(await readFixture(harness.dir + '/race-target.txt')).toBe(harness.race!.competitorContent)
  })

  it('does not convert a host refusal into a policy pass', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'one\ntwo\n'
    const file = await writeFixture(harness.dir, 'host-refusal.txt', source)

    // A replace with a VALID user override that cannot match: the policy allows it
    // and the ENGINE reports its own match failure. That failure must stay the
    // engine's, not be relabelled as a policy decision, and the file is untouched.
    harness.appendUserMessage('use replace on host-refusal.txt, no tag needed')
    const result = await harness.callTool('edit', {
      path: 'host-refusal.txt',
      old_string: 'text-that-is-not-there',
      new_string: 'TWO',
      fallbacks: [{ path: 'host-refusal.txt', reason: 'user-override', userSource: { quote: 'use replace on host-refusal.txt' }, modes: ['replace'] }],
    })
    expect(result.isError).toBe(true)
    expect(errorText(result)).not.toContain('EDIT_POLICY_')
    expect(errorText(result)).toContain('Could not find')
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe(source)
  })
})

describe('POLICY-06/POLICY-07: recovery and cancellation keep their own contracts', () => {
  it('leaves the engine recovery contract alone: a stale tag can recover', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'one\ntwo\nthree\n'
    const file = await writeFixture(harness.dir, 'recover.txt', source)
    const first = await harness.read('recover.txt')
    const value = (first as unknown as { value: { path: string; tag: string } }).value

    const edit = await harness.edit('[' + value.path + '#' + value.tag + ']\nPUT 2.=2:\n+TWO')
    expect(edit.isError).toBe(false)
    // The old tag is stale now; the engine's own recovery applies it and reports so.
    const again = await harness.edit('[' + value.path + '#' + value.tag + ']\nPUT 3.=3:\n+THREE')
    expect(again.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\nTHREE\n')
  })

  it('surfaces a cancelled call as the host cancellation, not a policy refusal', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = textOfBytes(CEILING)
    const file = await writeFixture(harness.dir, 'cancelled.txt', source)
    const read = await harness.read('cancelled.txt')
    const citation = citationOf((read as unknown as { value: { nextAction: string | null } }).value.nextAction)

    const controller = new AbortController()
    controller.abort()
    const result = await harness.runtime.execute({
      callId: 'cancel-1' as never,
      name: 'edit',
      arguments: {
        path: 'cancelled.txt',
        old_string: 'x'.repeat(8),
        new_string: 'Y'.repeat(8),
        fallbacks: [{ path: 'cancelled.txt', reason: 'snapshot-limit', readCallId: citation }],
      },
      signal: controller.signal,
      agent: harness.agent,
    })

    expect(result.isError).toBe(true)
    // Cancellation is the host's business: the policy must not relabel it.
    expect(errorText(result)).not.toContain('EDIT_POLICY_EVIDENCE_STALE')
    expect(await readFixture(file)).toBe(source)
  })
})

describe('POLICY-04/POLICY-14: no-op and stale-evidence regressions stay intact', () => {
  it('reports an unchanged replace as No change, not as a policy failure', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'same\n'
    await writeFixture(harness.dir, 'noop.txt', source)
    harness.appendUserMessage('use replace on noop.txt, it is fine')

    const result = await harness.callTool('edit', {
      path: 'noop.txt',
      old_string: 'same',
      new_string: 'same',
      fallbacks: [{ path: 'noop.txt', reason: 'user-override', userSource: { quote: 'use replace on noop.txt' }, modes: ['replace'] }],
    })

    // The upstream no-op rule turns this into a success string; the policy has no
    // opinion about it and must not have refused it.
    expect(errorText(result)).not.toContain('EDIT_POLICY_')
  })

  it('still refuses the SAME call once the evidence stops being true', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'stops-being-true.txt', textOfBytes(CEILING))
    const read = await harness.read('stops-being-true.txt')
    const citation = citationOf((read as unknown as { value: { nextAction: string | null } }).value.nextAction)

    // The file is rewritten BELOW the ceiling: the same citation no longer holds.
    await writeFixture(harness.dir, 'stops-being-true.txt', 'small\n')
    const result = await harness.callTool('edit', {
      path: 'stops-being-true.txt',
      old_string: 'small',
      new_string: 'SMALL',
      fallbacks: [{ path: 'stops-being-true.txt', reason: 'snapshot-limit', readCallId: citation }],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_EVIDENCE_STALE')
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe('small\n')
  })
})

describe('POLICY-17/POLICY-19: a refusal ON THE RETRY is recorded as the final decision', () => {
  it('records retry=1 and refused when the retry no longer holds', async () => {
    // The competitor rewrites the file, so after the stale-version rejection the
    // retry's own preflight refuses: the citation no longer describes the bytes.
    const harness = await managed({ read: { snapshotMaxBytes: CEILING }, race: true, raceOn: 'retry-refusal.txt' })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'retry-refusal.txt', textOfBytes(CEILING))
    const read = await harness.read('retry-refusal.txt')
    const citation = citationOf((read as unknown as { value: { nextAction: string | null } }).value.nextAction)
    expect(citation).toBeTypeOf('string')

    const result = await harness.callTool('edit', {
      path: 'retry-refusal.txt',
      old_string: 'x'.repeat(8),
      new_string: 'Y'.repeat(8),
      fallbacks: [{ path: 'retry-refusal.txt', reason: 'snapshot-limit', readCallId: citation }],
    })

    // The competitor wrote a small file, so the retry's own preflight refuses.
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_EVIDENCE_STALE')
    const receipts = harness.policyReceipts() as unknown as { result: string; retry?: number; decision?: { retry: number }; code?: string }[]
    const last = receipts[receipts.length - 1]!
    expect(last.result).toBe('refused')
    expect(last.retry).toBe(1)
    expect(last.code).toBe('EDIT_POLICY_EVIDENCE_STALE')
    expect(await readFixture(file)).toBe(harness.race!.competitorContent)
  })
})

