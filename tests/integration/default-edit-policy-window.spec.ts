/**
 * Ticket 03: a REAL window-limit degradation, and the refusals that keep an
 * ordinary page from being treated as one.
 *
 * The seam is the main one. The target is limited only because the mounted read
 * config says so (a tiny column cap, or a byte cap smaller than one line), so
 * the boundary is the config and not a fixture pretending to be truncated.
 *
 * Traces FR-02/FR-03/FR-06 (M2 window part): POLICY-04 (paging), POLICY-05
 * (window leg), POLICY-12, POLICY-13.
 * @module dsh-tool-hashline/tests/integration/default-edit-policy-window
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { PolicyHarness } from './edit-policy-harness.ts'
import { createPolicyHarness, readFixture, writeFixture } from './edit-policy-harness.ts'

const POLICY_MODULE = fileURLToPath(new URL('../../presets/ptc-hashline/policy/default-edit-policy.mjs', import.meta.url))
const errorText = (result: ToolExecutionResult): string => result.isError ? result.error.message : ''
const citationOf = (nextAction: string | null): string | undefined => /readCallId: (\S+?)\)/u.exec(nextAction ?? '')?.[1]

const managed = (options: Parameters<typeof createPolicyHarness>[0] = {}) =>
  createPolicyHarness({ ...options, policyModule: POLICY_MODULE })

const readValue = async (harness: PolicyHarness, path: string) => {
  const result = await harness.read(path)
  expect(result.isError).toBe(false)
  return (result as unknown as { value: { path: string; tag: string | null; tagged: boolean; nextAction: string | null } }).value
}

describe('POLICY-05/POLICY-13: a column-truncated target can be degraded for its limited lines', () => {
  it('degrades the truncated line and leaves the fully returned lines to Hashline', async () => {
    const harness = await managed({ read: { maxLineLength: 8 } })
    onTestFinished(() => harness.cleanup())
    const source = 'short\n' + 'x'.repeat(40) + '\n' + 'tail\n'
    const file = await writeFixture(harness.dir, 'long-line.txt', source)

    const value = await readValue(harness, 'long-line.txt')
    expect(value.nextAction).toContain('window-limit')
    const citation = citationOf(value.nextAction)
    expect(citation).toBeTypeOf('string')

    // The declared range covers line 2 — the line the read could not deliver.
    const result = await harness.callTool('edit', {
      path: 'long-line.txt',
      old_string: 'x'.repeat(40),
      new_string: 'y'.repeat(40),
      fallbacks: [{ path: 'long-line.txt', reason: 'window-limit', readCallId: citation, ranges: [{ startLine: 2, endLine: 2 }] }],
    })

    expect(result.isError, errorText(result)).toBe(false)
    expect(await readFixture(file)).toBe('short\n' + 'y'.repeat(40) + '\n' + 'tail\n')
  })

  it('refuses a range that covers only fully returned lines', async () => {
    const harness = await managed({ read: { maxLineLength: 8 } })
    onTestFinished(() => harness.cleanup())
    const source = 'short\n' + 'x'.repeat(40) + '\n' + 'tail\n'
    const file = await writeFixture(harness.dir, 'wrong-range.txt', source)
    const value = await readValue(harness, 'wrong-range.txt')
    const citation = citationOf(value.nextAction)

    // Line 1 was returned in full: a window limit cannot authorize changing it.
    const result = await harness.callTool('edit', {
      path: 'wrong-range.txt',
      old_string: 'short',
      new_string: 'SHORT',
      fallbacks: [{ path: 'wrong-range.txt', reason: 'window-limit', readCallId: citation, ranges: [{ startLine: 1, endLine: 1 }] }],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_REASON_FALSE')
    expect(errorText(result)).toContain('limited lines')
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe(source)
  })

  it('refuses the whole degradation when the read delivered everything in full', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'a\nb\nc\n'
    const file = await writeFixture(harness.dir, 'complete.txt', source)
    // A plain page is not a window limit: this read has no guidance at all.
    const value = await readValue(harness, 'complete.txt')
    expect(value.tagged).toBe(true)
    expect(value.nextAction).toBeNull()

    const result = await harness.callTool('edit', {
      path: 'complete.txt',
      old_string: 'b',
      new_string: 'B',
      fallbacks: [{ path: 'complete.txt', reason: 'window-limit', readCallId: 'anything', ranges: [{ startLine: 2, endLine: 2 }] }],
    })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_READ_UNKNOWN')
    expect(await readFixture(file)).toBe(source)
  })

  it('degrades a zero-line byte-capped window, and only for its omitted lines', async () => {
    // A byte cap smaller than the first displayed line returns NO lines at all.
    const harness = await managed({ read: { maxBytes: 4 } })
    onTestFinished(() => harness.cleanup())
    const source = 'first-line-is-long\nsecond\n'
    const file = await writeFixture(harness.dir, 'zero-window.txt', source)

    const value = await readValue(harness, 'zero-window.txt')
    expect(value.nextAction).toContain('window-limit')
    const citation = citationOf(value.nextAction)
    expect(citation).toBeTypeOf('string')

    const result = await harness.callTool('edit', {
      path: 'zero-window.txt',
      old_string: 'first-line-is-long',
      new_string: 'FIRST',
      fallbacks: [{ path: 'zero-window.txt', reason: 'window-limit', readCallId: citation, ranges: [{ startLine: 1, endLine: 1 }] }],
    })
    expect(result.isError, errorText(result)).toBe(false)
    expect(await readFixture(file)).toBe('FIRST\nsecond\n')
  })
})

describe('POLICY-04/POLICY-13: paging is the remedy, not a degradation', () => {
  it('pages to a later window and edits that window with Hashline', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = Array.from({ length: 12 }, (_, index) => 'line-' + (index + 1)).join('\n') + '\n'
    const file = await writeFixture(harness.dir, 'paged.txt', source)

    // Page 2 covers lines 6..10 and is a complete, tagged window.
    const paged = await harness.callTool('read', { file_path: 'paged.txt', offset: 6, limit: 5 })
    expect(paged.isError).toBe(false)
    const value = (paged as unknown as { value: { path: string; tag: string; tagged: boolean; nextAction: string | null } }).value
    expect(value.tagged).toBe(true)
    expect(value.nextAction).toBeNull()

    // The paged window's own tag edits line 7 without any fallback.
    const edited = await harness.edit('[' + value.path + '#' + value.tag + ']\nPUT 7.=7:\n+LINE-7')
    expect(edited.isError).toBe(false)
    expect(await readFixture(file)).toBe(source.replace('line-7', 'LINE-7'))
  })

  it('keeps a target with an unrelated truncated line on the Hashline path', async () => {
    const harness = await managed({ read: { maxLineLength: 8 } })
    onTestFinished(() => harness.cleanup())
    // Line 2 is huge (truncated); the target on line 1 is complete.
    const source = 'target\n' + 'z'.repeat(40) + '\n'
    const file = await writeFixture(harness.dir, 'unrelated.txt', source)
    const value = await readValue(harness, 'unrelated.txt')
    expect(value.nextAction).toContain('window-limit')
    const citation = citationOf(value.nextAction)

    // Editing the COMPLETE line 1 with the cited read's ranges is refused...
    const degraded = await harness.callTool('edit', {
      path: 'unrelated.txt',
      old_string: 'target',
      new_string: 'TARGET',
      fallbacks: [{ path: 'unrelated.txt', reason: 'window-limit', readCallId: citation, ranges: [{ startLine: 1, endLine: 1 }] }],
    })
    expect(degraded.isError).toBe(true)
    expect(errorText(degraded)).toContain('EDIT_POLICY_REASON_FALSE')

    // ...and the same change through Hashline is allowed, because line 1 was
    // returned in full (the truncation was on an unrelated line).
    const hashline = await harness.edit('[' + value.path + '#' + value.tag + ']\nPUT 1.=1:\n+TARGET')
    expect(hashline.isError, errorText(hashline)).toBe(false)
    expect(await readFixture(file)).toBe('TARGET\n' + 'z'.repeat(40) + '\n')
  })
})
