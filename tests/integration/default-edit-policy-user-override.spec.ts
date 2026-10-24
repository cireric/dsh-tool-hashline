/**
 * Ticket 04: a real user override, and the citations that must be refused.
 *
 * The seam is the main one plus the session's own event log: a user message is
 * APPENDED through the session stub, and the policy resolves the citation
 * against it. Nothing here invents a message to make a case pass.
 *
 * Traces FR-02/FR-03/FR-06/FR-07 (M3): POLICY-12 (user-override leg),
 * POLICY-21, POLICY-09 (session isolation of evidence).
 * @module dsh-tool-hashline/tests/integration/default-edit-policy-user-override
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { createPolicyHarness, readFixture, writeFixture } from './edit-policy-harness.ts'

const POLICY_MODULE = fileURLToPath(new URL('../../presets/ptc-hashline/policy/default-edit-policy.mjs', import.meta.url))
const errorText = (result: ToolExecutionResult): string => result.isError ? result.error.message : ''

const managed = (options: Parameters<typeof createPolicyHarness>[0] = {}) =>
  createPolicyHarness({ ...options, policyModule: POLICY_MODULE })

/** Issue a replace that cites a user quote. */
const replaceWithQuote = (harness: Awaited<ReturnType<typeof createPolicyHarness>>, file: string, quote: string, modes: string[] = ['replace']) =>
  harness.callTool('edit', {
    path: file,
    old_string: 'two',
    new_string: 'TWO',
    fallbacks: [{ path: file, reason: 'user-override', userSource: { quote }, modes }],
  })

describe('POLICY-12/POLICY-21: a real user override authorizes the declared mode', () => {
  it('lands the update when the quoted request exists and covers the mode', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'override.txt', 'one\ntwo\n')
    harness.appendUserMessage('please use replace mode on override.txt, the tag path is too fiddly')

    const result = await replaceWithQuote(harness, 'override.txt', 'use replace mode on override.txt')

    expect(result.isError, errorText(result)).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\n')
  })

  it('refuses a quote the session never received', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'one\ntwo\n'
    const file = await writeFixture(harness.dir, 'no-quote.txt', source)
    harness.appendUserMessage('please update no-quote.txt')

    const result = await replaceWithQuote(harness, 'no-quote.txt', 'use replace mode, I insist')

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_USER_SOURCE')
    expect(errorText(result)).toContain('no message the user typed')
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe(source)
  })

  it('refuses a model-authored message even when the text matches', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'one\ntwo\n'
    const file = await writeFixture(harness.dir, 'model-said.txt', source)
    // A TOOL message and an ASSISTANT message carrying the exact words: neither is
    // a user authorization, and both must be rejected as a source.
    harness.appendEvent('tool/result', { callId: 'c1', name: 'bash', content: [{ type: 'text', text: 'use replace mode on model-said.txt' }], isError: false })
    harness.appendEvent('assistant/message', { turn: 1, message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: 'use replace mode on model-said.txt' }] } })

    const result = await replaceWithQuote(harness, 'model-said.txt', 'use replace mode on model-said.txt')

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_USER_SOURCE')
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe(source)
  })

  it('refuses a mode the user did not declare', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'one\ntwo\n'
    const file = await writeFixture(harness.dir, 'wrong-mode.txt', source)
    harness.appendUserMessage('you may patch wrong-mode.txt instead of using the tag')

    // The user allowed patch; this call dispatches as replace.
    const result = await replaceWithQuote(harness, 'wrong-mode.txt', 'patch wrong-mode.txt', ['patch'])

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_USER_SOURCE')
    expect(errorText(result)).toContain('dispatch')
    expect(await readFixture(file)).toBe(source)
  })

  it('refuses an ambiguous quote that matches several user messages', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'ambiguous.txt', 'one\ntwo\n')
    harness.appendUserMessage('use replace mode please')
    harness.appendUserMessage('use replace mode please')

    const result = await replaceWithQuote(harness, 'ambiguous.txt', 'use replace mode')

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_USER_SOURCE')
    expect(errorText(result)).toContain('ambiguous')
    expect(harness.writes).toHaveLength(0)
  })

  it('refuses a citation from an unrelated session id', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'one\ntwo\n'
    const file = await writeFixture(harness.dir, 'other-session.txt', source)
    harness.appendUserMessage('use replace mode on other-session.txt')

    const result = await harness.callTool('edit', {
      path: 'other-session.txt',
      old_string: 'two',
      new_string: 'TWO',
      fallbacks: [{
        path: 'other-session.txt',
        reason: 'user-override',
        userSource: { quote: 'use replace mode on other-session.txt', sessionId: 'some-other-session' },
        modes: ['replace'],
      }],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_USER_SOURCE')
    expect(errorText(result)).toContain('neither this session nor its delegating parent')
    expect(await readFixture(file)).toBe(source)
  })

  it('does not transfer a user override across the remount', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'remount-override.txt', 'one\ntwo\n')
    harness.appendUserMessage('use replace mode on remount-override.txt')

    const before = await replaceWithQuote(harness, 'remount-override.txt', 'use replace mode on remount-override.txt')
    expect(before.isError, errorText(before)).toBe(false)

    await harness.remount()
    // The message is still in the session (it is a real event), so the same
    // citation still verifies: the override is a fact about the USER's words, not
    // a token the policy remembers. A fresh citation is required, not a fresh allow.
    const after = await harness.callTool('edit', {
      path: 'remount-override.txt',
      old_string: 'TWO',
      new_string: 'three',
      fallbacks: [{ path: 'remount-override.txt', reason: 'user-override', userSource: { quote: 'use replace mode on remount-override.txt' }, modes: ['replace'] }],
    })
    expect(after.isError, errorText(after)).toBe(false)
    expect(await readFixture(harness.dir + '/remount-override.txt')).toBe('one\nthree\n')
  })
})
