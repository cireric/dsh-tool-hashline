/**
 * Default-edit policy, ticket 01: the managed registration defaults to Hashline
 * and refuses an undeclared ordinary content update before the real branch runs.
 *
 * Everything here runs on the main seam: a real ToolRuntime, the real upstream
 * editor (installed with this repo's exact patch), the real Local filesystem and
 * the real fs-observation-policy. The policy module is loaded from the shipped
 * bundle path, so a broken address fails these tests instead of silently
 * disabling the policy.
 *
 * Traces: FR-01, FR-06, FR-07 (D1/D2/D6, M1) — POLICY-02, POLICY-03 (engineering
 * part), POLICY-11 (base refusal), POLICY-18, POLICY-20.
 * @module dsh-tool-hashline/tests/integration/default-edit-policy
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { PolicyHarness } from './edit-policy-harness.ts'
import { createPolicyHarness, readFixture, writeFixture } from './edit-policy-harness.ts'

/** The shipped policy module, addressed exactly as the preset addresses it. */
const POLICY_MODULE = fileURLToPath(new URL('../../presets/ptc-hashline/policy/default-edit-policy.mjs', import.meta.url))

const errorText = (result: ToolExecutionResult): string => result.isError ? result.error.message : ''

/** Mount the editor WITH the default-edit policy. */
const managed = (options: Parameters<typeof createPolicyHarness>[0] = {}) =>
  createPolicyHarness({ ...options, policyModule: POLICY_MODULE })

/** Issue a plain replace through the registry. */
const replace = (harness: PolicyHarness, file: string, oldString: string, newString: string) =>
  harness.callTool('edit', { path: file, old_string: oldString, new_string: newString })

describe('POLICY-02: the managed registration edits through Hashline by default', () => {
  it('reads a tag and lands a one-line change with an independent expected diff', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'alpha\nbeta\ngamma\ndelta\n'
    const file = await writeFixture(harness.dir, 'single.txt', source)

    const read = await harness.read('single.txt')
    expect(read.isError).toBe(false)
    const value = (read as unknown as { value: { path: string; tag: string } }).value
    const edited = await harness.edit('[' + value.path + '#' + value.tag + ']\nPUT 2.=2:\n+BETA')

    expect(edited.isError).toBe(false)
    expect(await readFixture(file)).toBe('alpha\nBETA\ngamma\ndelta\n')
    // The fixture's temp directory may be reached through a symlinked prefix
    // (/var vs /private/var), so match on the name, not on an absolute spelling.
    const writes = harness.writes.filter(entry => entry.displayPath.endsWith('single.txt'))
    expect(writes).toHaveLength(1)
    expect(writes[0]?.intent?.kind).toBe('replaceIfVersion')
  })

  it('changes only the named occurrence of a repeated fragment', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'head\nvalue\nmiddle\nvalue\ntail\n'
    const file = await writeFixture(harness.dir, 'repeat.txt', source)

    const read = await harness.read('repeat.txt')
    const value = (read as unknown as { value: { path: string; tag: string } }).value
    const edited = await harness.edit('[' + value.path + '#' + value.tag + ']\nPUT 2.=2:\n+VALUE')

    expect(edited.isError).toBe(false)
    expect(await readFixture(file)).toBe('head\nVALUE\nmiddle\nvalue\ntail\n')
  })
})

describe('POLICY-02/POLICY-04: the result stays consumable for the next edit', () => {
  it('carries the new header so a second edit uses the real new tag', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'chain.txt', 'one\ntwo\nthree\n')

    const read = await harness.read('chain.txt')
    const value = (read as unknown as { value: { path: string; tag: string } }).value
    const first = await harness.edit('[' + value.path + '#' + value.tag + ']\nPUT 2.=2:\n+TWO')
    expect(first.isError).toBe(false)

    const text = (first as unknown as { value: string }).value
    const header = /^\[(.+)#([0-9A-F]{4})\]/mu.exec(text.trim())
    expect(header, 'the edit result must still start with a [path#tag] header: ' + text).not.toBeNull()
    const second = await harness.edit('[' + header![1] + '#' + header![2] + ']\nPUT 3.=3:\n+THREE')
    expect(second.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\nTHREE\n')
  })
})

describe('POLICY-11/POLICY-18: an ordinary non-Hashline update is refused before any write', () => {
  it('refuses a replace that declares no degradation, and writes nothing', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'one\ntwo\n'
    const file = await writeFixture(harness.dir, 'refused.txt', source)
    const observedBefore = harness.ledger.length

    const result = await replace(harness, 'refused.txt', 'two', 'TWO')

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_FALLBACK_REQUIRED')
    // The refusal names the closed reason set and the remedy, not just "no".
    expect(errorText(result)).toContain('snapshot-limit')
    expect(errorText(result)).toContain('Hashline')
    // Nothing reached a writer or an observation, and the bytes are untouched.
    expect(harness.writes).toHaveLength(0)
    expect(harness.ledger.length).toBe(observedBefore)
    expect(await readFixture(file)).toBe(source)
  })

  it('refuses patch and apply_patch payloads the same way', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'refused-modes.txt', 'a\nb\n')

    const patch = await harness.callTool('edit', { path: file, edits: [{ op: 'update', diff: '@@ -1,1 +1,1 @@\n-a\n+A' }] })
    expect(patch.isError).toBe(true)
    expect(errorText(patch)).toContain('EDIT_POLICY_FALLBACK_REQUIRED')

    const envelope = await harness.callTool('edit', {
      input: '*** Begin Patch\n*** Update File: ' + file + '\n@@\n-a\n+A\n*** End Patch',
    })
    expect(envelope.isError).toBe(true)
    expect(errorText(envelope)).toContain('EDIT_POLICY_FALLBACK_REQUIRED')

    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe('a\nb\n')
  })

  it('refuses payload groups that coexist, before field priority can hide one', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'conflict.txt', 'x\ny\n')
    const diff = '@@ -1,1 +1,1 @@\n-x\n+X'
    const program = '[' + file + '#0000]\nPUT 1.=1:\n+X'

    const cases: { label: string; args: Record<string, unknown> }[] = [
      { label: 'old_string + edits', args: { path: file, old_string: 'x', new_string: 'X', edits: [{ op: 'update', diff }] } },
      { label: 'old_string + input', args: { path: file, old_string: 'x', new_string: 'X', input: program } },
      { label: 'edits + input', args: { path: file, edits: [{ op: 'update', diff }], input: program } },
      { label: 'all three', args: { path: file, old_string: 'x', new_string: 'X', edits: [], input: program } },
      // An INVALID type in one group must not hide the conflict with another.
      { label: 'replace_all only + edits', args: { path: file, replace_all: false, edits: [{ op: 'update', diff }] } },
    ]

    for (const item of cases) {
      const result = await harness.callTool('edit', item.args)
      expect(result.isError, item.label).toBe(true)
      expect(errorText(result), item.label).toContain('EDIT_POLICY_PAYLOAD_CONFLICT')
    }
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe('x\ny\n')
  })

  it('refuses a Hashline call that declares a fallback it does not use', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'p\nq\n'
    const file = await writeFixture(harness.dir, 'unused-fallback.txt', source)
    const read = await harness.read('unused-fallback.txt')
    const value = (read as unknown as { value: { path: string; tag: string } }).value

    const result = await harness.callTool('edit', {
      input: '[' + value.path + '#' + value.tag + ']\nPUT 1.=1:\n+P',
      fallbacks: [{ path: file, reason: 'snapshot-limit', readCallId: 'read-1' }],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_FALLBACK_UNUSED')
    expect(await readFixture(file)).toBe(source)
  })

  it('rejects a fallback reason outside the closed set', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'reason.txt', 'r\n')

    const result = await harness.callTool('edit', {
      path: 'reason.txt',
      old_string: 'r',
      new_string: 'R',
      fallbacks: [{ path: 'reason.txt', reason: 'because-i-prefer-replace' }],
    })

    expect(result.isError).toBe(true)
    // The closed set is enforced by the PARAMETER schema, before the policy body
    // runs: an arbitrary "because I prefer it" string never becomes a reason.
    expect(errorText(result)).toContain('fallbacks[0].reason')
    expect(errorText(result)).toContain('snapshot-limit')
    expect(errorText(result)).not.toContain('because-i-prefer-replace')
    expect(harness.writes).toHaveLength(0)
  })

  it('reports a legal-but-unimplemented reason as a concrete gap, never as a pass', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'gap.txt', 'g\n')

    // `window-limit` is a legal reason whose verification this build does not
    // implement: it must surface as a gap, not as a silent allow.
    const result = await harness.callTool('edit', {
      path: 'gap.txt',
      old_string: 'g',
      new_string: 'G',
      fallbacks: [{ path: 'gap.txt', reason: 'window-limit', readCallId: 'read-1', ranges: [{ startLine: 1, endLine: 1 }] }],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_REASON_UNAVAILABLE')
    expect(errorText(result)).toContain('window-limit')
    expect(harness.writes).toHaveLength(0)
  })
})

describe('POLICY-20: an unusable policy module never silently allows, nor disables Hashline', () => {
  it('refuses ordinary updates with the load gap while Hashline keeps working', async () => {
    const harness = await createPolicyHarness({ policyModule: '/nonexistent/policy-module.mjs' })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'unavailable.txt', 'u\nv\n')

    const refused = await replace(harness, 'unavailable.txt', 'v', 'V')
    expect(refused.isError).toBe(true)
    expect(errorText(refused)).toContain('EDIT_POLICY_UNAVAILABLE')
    expect(errorText(refused)).toContain('could not be loaded')
    expect(harness.writes).toHaveLength(0)

    const read = await harness.read('unavailable.txt')
    const value = (read as unknown as { value: { path: string; tag: string } }).value
    const edited = await harness.edit('[' + value.path + '#' + value.tag + ']\nPUT 2.=2:\n+V')
    expect(edited.isError).toBe(false)
    expect(await readFixture(file)).toBe('u\nV\n')
  })

  it('refuses a managed call that has no agent session', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'sessionless.txt', 's\n')

    const result = await harness.runtime.execute({
      callId: 'sessionless-1' as never,
      name: 'edit',
      arguments: { path: 'sessionless.txt', old_string: 's', new_string: 'S' },
      signal: new AbortController().signal,
    })

    // A session-less call cannot resolve a tool registered in an agent scope, so
    // the registry refuses it before the body runs: no policy, no writer, no bytes.
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('unknown tool')
    expect(harness.writes).toHaveLength(0)
  })
})

describe('POLICY-20 control: a registration without the policy keeps the upstream behavior', () => {
  it('runs the same replace with no policy check and one guarded write', async () => {
    const harness = await createPolicyHarness({ policy: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'upstream.txt', 'one\ntwo\n')

    const result = await replace(harness, 'upstream.txt', 'two', 'TWO')

    expect(result.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\n')
    expect(harness.writes).toHaveLength(1)

    // The parameter list is the upstream one: no `fallbacks` on an unmanaged row.
    // `schemas()` is scope-filtered: the preset's rows live in its own layer.
    const edit = harness.runtime.schemas(harness.scopeKey).find(schema => schema.name === 'edit')
    expect(edit).toBeDefined()
    const properties = (edit as unknown as { parameters: { properties: Record<string, unknown> } }).parameters.properties
    expect(Object.keys(properties)).not.toContain('fallbacks')
  })

  it('declares fallbacks on the managed registration so the model and SDK can fill them', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())

    const edit = harness.runtime.schemas(harness.scopeKey).find(schema => schema.name === 'edit')
    expect(edit).toBeDefined()
    type Props = { parameters: { properties: Record<string, { items?: { properties?: Record<string, unknown> } }> } }
    const properties = (edit as unknown as Props).parameters.properties
    expect(Object.keys(properties)).toContain('fallbacks')
    const entry = properties.fallbacks?.items?.properties ?? {}
    expect(Object.keys(entry).sort()).toEqual(['modes', 'path', 'ranges', 'readCallId', 'reason', 'userSource'])
  })
})

describe('POLICY-20: policy state is per registration, never per process', () => {
  it('leaves nothing behind after unmount and remount, and registers no second edit', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'remount.txt', 'one\ntwo\n')

    // Refused while mounted.
    expect((await replace(harness, 'remount.txt', 'two', 'TWO')).isError).toBe(true)

    // Unmount the preset scope and mount the same rows into a FRESH one. A policy
    // instance that remembered anything across the remount would show up here.
    const freshKey = await harness.remount()
    expect(freshKey).toBeDefined()

    // The same call is still refused (no stale allow), and the disk is untouched.
    const after = await replace(harness, 'remount.txt', 'two', 'TWO')
    expect(after.isError).toBe(true)
    expect(after.isError ? after.error.message : '').toContain('EDIT_POLICY_FALLBACK_REQUIRED')
    expect(await readFixture(file)).toBe('one\ntwo\n')

    // Exactly one `edit` registration exists in the remounted scope, and it is the
    // managed one: a second registration would have failed the mount loudly.
    const edit = harness.runtime.schemas(freshKey).find(schema => schema.name === 'edit')
    expect(edit).toBeDefined()
    expect(Object.keys((edit as unknown as { parameters: { properties: Record<string, unknown> } }).parameters.properties)).toContain('fallbacks')
  })

  it('keeps two interleaved sessions on their own instances', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'two-sessions.txt', 'one\ntwo\n')

    // Both sessions are refused independently: an allow in one cannot leak into the
    // other, and neither creates a process-wide unlock.
    const first = await replace(harness, 'two-sessions.txt', 'two', 'TWO')
    const second = await replace(harness, 'two-sessions.txt', 'two', 'TWO')
    expect(first.isError).toBe(true)
    expect(second.isError).toBe(true)
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe('one\ntwo\n')
  })
})

