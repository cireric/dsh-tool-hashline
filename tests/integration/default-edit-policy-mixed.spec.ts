/**
 * Ticket 06: one mixed edit is verified as a whole before its first write.
 *
 * Every case inspects the provider-write ledger: a refusal must leave it empty
 * (no earlier entry of the same request landed either), and an allowed request
 * must execute in the engine's own order.
 *
 * Traces FR-01/FR-06 (M4 batch): POLICY-16, POLICY-11/POLICY-12 for the mixed
 * scope, POLICY-18 regression.
 * @module dsh-tool-hashline/tests/integration/default-edit-policy-mixed
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

describe('POLICY-16: one unqualified entry stops the whole request before any write', () => {
  it('refuses a creation plus an undeclared content update', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'existing\n'
    const file = await writeFixture(harness.dir, 'mixed-update.txt', source)

    const result = await harness.callTool('edit', {
      path: 'mixed-update.txt',
      edits: [
        { op: 'update', diff: '@@ -1,1 +1,1 @@\n-existing\n+EXISTING' },
        { op: 'update', diff: '@@ -1,1 +1,2 @@\n+created\n' },
      ],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_FALLBACK_REQUIRED')
    // The first entry was qualified? No — the file holds content, so the FIRST
    // entry already needs a degradation and nothing ran.
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe(source)
  })

  it('refuses a limited target plus an ordinary target in one request', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const bigSource = textOfBytes(CEILING)
    const ordinarySource = 'ordinary\n'
    const big = await writeFixture(harness.dir, 'big-mixed.txt', bigSource)
    await writeFixture(harness.dir, 'ordinary-mixed.txt', ordinarySource)
    const read = await harness.read('big-mixed.txt')
    const value = (read as unknown as { value: { nextAction: string | null } }).value
    const citation = citationOf(value.nextAction)
    expect(citation).toBeTypeOf('string')

    // A single apply_patch envelope touching BOTH: the limited one has a fallback,
    // the ordinary one does not, so the request is refused as a whole.
    const result = await harness.callTool('edit', {
      input: [
        '*** Begin Patch',
        '*** Update File: big-mixed.txt',
        '@@',
        '-' + 'x'.repeat(8),
        '+' + 'Y'.repeat(8),
        '*** Update File: ordinary-mixed.txt',
        '@@',
        '-ordinary',
        '+ORDINARY',
        '*** End Patch',
      ].join('\n'),
      fallbacks: [{ path: 'big-mixed.txt', reason: 'snapshot-limit', readCallId: citation }],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_FALLBACK_REQUIRED')
    expect(errorText(result)).toContain('ordinary-mixed.txt')
    // NEITHER file moved: the limited target did not get written just because it
    // had a valid reason.
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(big)).toBe(bigSource)
    expect(await readFixture(harness.dir + '/ordinary-mixed.txt')).toBe(ordinarySource)
  })

  it('refuses a fallback that names a target this request does not update', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'unused-fallback-mixed.txt', textOfBytes(CEILING))
    const read = await harness.read('unused-fallback-mixed.txt')
    const citation = citationOf((read as unknown as { value: { nextAction: string | null } }).value.nextAction)

    const result = await harness.callTool('edit', {
      path: 'unused-fallback-mixed.txt',
      old_string: 'x'.repeat(8),
      new_string: 'Y'.repeat(8),
      fallbacks: [
        { path: 'unused-fallback-mixed.txt', reason: 'snapshot-limit', readCallId: citation },
        { path: 'some-other-file.txt', reason: 'snapshot-limit', readCallId: citation },
      ],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_FALLBACK_UNUSED')
    expect(harness.writes).toHaveLength(0)
  })
})

describe('POLICY-16: the request-scoped view follows the engine order', () => {
  it('classifies a delete followed by a recreate as two exceptions, and reports the host refusal', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'recreate-me\n'
    const file = await writeFixture(harness.dir, 'recreate.txt', source)

    // Delete then create in ONE request: the second entry sees the target as absent
    // (the request view), so both are exceptions and the policy does not speak.
    // The ENGINE then refuses the recreate because the observation policy still
    // holds the observation from before the delete — a host limit this ticket
    // records instead of pretending the pair works.
    const result = await harness.callTool('edit', {
      path: 'recreate.txt',
      edits: [
        { op: 'delete' },
        { op: 'create', diff: '+fresh content' },
      ],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).not.toContain('EDIT_POLICY_')
    expect(errorText(result)).toContain('no longer exists')
    // The delete landed (the engine is not transactional) and the recreate did not.
    await expect(readFixture(file)).rejects.toThrow()
  })

  it('recognizes a create followed by an update as two content operations', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'seed\n'
    const file = await writeFixture(harness.dir, 'create-then-update.txt', source)

    // `create` over content is a content update, and so is the following update:
    // neither is an exception, so with no fallbacks the whole request is refused.
    const result = await harness.callTool('edit', {
      path: 'create-then-update.txt',
      edits: [
        { op: 'create', diff: '+replaced' },
        { op: 'update', diff: '@@ -1,1 +1,1 @@\n-replaced\n+final' },
      ],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_FALLBACK_REQUIRED')
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe(source)
  })

  it('allows a pure REM plus a pure MV in one Hashline program', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'movable\n'
    const removed = await writeFixture(harness.dir, 'rem-me.txt', 'bye\n')
    const moved = await writeFixture(harness.dir, 'mv-me.txt', source)
    const readMoved = await harness.read('mv-me.txt')
    const movedValue = (readMoved as unknown as { value: { path: string; tag: string } }).value
    const readRemoved = await harness.read('rem-me.txt')
    const removedValue = (readRemoved as unknown as { value: { path: string; tag: string } }).value

    // A pure REM and a pure MV touch no content, so the policy has nothing to say.
    const result = await harness.edit(
      '[' + removedValue.path + '#' + removedValue.tag + ']\nREM\n[' + movedValue.path + '#' + movedValue.tag + ']\nMV moved-away.txt',
    )

    expect(result.isError, errorText(result)).toBe(false)
    await expect(readFixture(removed)).rejects.toThrow()
    expect(await readFixture(harness.dir + '/moved-away.txt')).toBe(source)
  })
})
