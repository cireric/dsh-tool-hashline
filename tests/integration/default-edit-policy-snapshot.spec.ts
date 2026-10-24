/**
 * Ticket 02: a REAL snapshot-limit degradation, and every way a citation can
 * fail to support it.
 *
 * The seam is the main one: a real ToolRuntime, the real read tool (its facts
 * event and its citation), the real patched editor, the real Local filesystem.
 * The target is over the snapshot ceiling only because the mounted read config
 * says so, so the boundary can be walked at N-1 / N / N+1 bytes.
 *
 * Traces FR-02/FR-03/FR-06/FR-07 (M2 snapshot part): POLICY-05 (snapshot leg),
 * POLICY-11, POLICY-12, POLICY-19 (read facts).
 * @module dsh-tool-hashline/tests/integration/default-edit-policy-snapshot
 */
import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { PolicyHarness } from './edit-policy-harness.ts'
import { createPolicyHarness, readFixture, writeFixture } from './edit-policy-harness.ts'

const POLICY_MODULE = fileURLToPath(new URL('../../presets/ptc-hashline/policy/default-edit-policy.mjs', import.meta.url))
const errorText = (result: ToolExecutionResult): string => result.isError ? result.error.message : ''

/** The ceiling every case below mounts: small enough to walk byte by byte. */
const CEILING = 16

const managed = (options: Parameters<typeof createPolicyHarness>[0] = {}) =>
  createPolicyHarness({ ...options, policyModule: POLICY_MODULE })

/**
 * A text whose NORMALIZED (LF, BOM-stripped) UTF-8 size is exactly `bytes`.
 *
 * The trailing newline counts: the snapshot ceiling is measured on the whole
 * normalized text, not on the characters a human would count.
 */
const textOfBytes = (bytes: number): string => 'x'.repeat(Math.max(0, bytes - 1)) + '\n'

/** Read one file and return its value (the program-facing facts). */
const readValue = async (harness: PolicyHarness, path: string) => {
  const result = await harness.read(path)
  expect(result.isError).toBe(false)
  return (result as unknown as { value: { path: string; tag: string | null; tagged: boolean; nextAction: string | null } }).value
}

/** The citation a program copies out of the guidance. */
const citationOf = (nextAction: string | null): string | undefined => /readCallId: (\S+?)\)/u.exec(nextAction ?? '')?.[1]

describe('POLICY-05/POLICY-12: a true snapshot-limit degradation lands', () => {
  it('refuses the read a tag, prints a citation, and lets a declared replace update the target', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const source = textOfBytes(CEILING)
    const file = await writeFixture(harness.dir, 'big.txt', source)

    const value = await readValue(harness, 'big.txt')
    expect(value.tagged).toBe(false)
    expect(value.tag).toBeNull()
    expect(value.nextAction).toContain('snapshot-limit')
    const readCallId = citationOf(value.nextAction)
    expect(readCallId, 'the guidance must carry a parsable citation: ' + value.nextAction).toBeTypeOf('string')

    const result = await harness.callTool('edit', {
      path: 'big.txt',
      old_string: 'x'.repeat(8),
      new_string: 'Y'.repeat(8),
      fallbacks: [{ path: 'big.txt', reason: 'snapshot-limit', readCallId }],
    })

    expect(result.isError, errorText(result)).toBe(false)
    // The independent expectation: the first eight x become Y, the rest is untouched.
    expect(await readFixture(file)).toBe('Y'.repeat(8) + 'x'.repeat(CEILING - 9) + '\n')
  })

  it('walks the ceiling at N-1 / N / N+1 normalized bytes', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())

    // N-1: still tagged, so no degradation can be justified.
    await writeFixture(harness.dir, 'under.txt', textOfBytes(CEILING - 1))
    const under = await readValue(harness, 'under.txt')
    expect(under.tagged).toBe(true)
    expect(under.nextAction).toBeNull()

    // N: refused a tag, so a declared degradation is verifiable.
    await writeFixture(harness.dir, 'at.txt', textOfBytes(CEILING))
    const at = await readValue(harness, 'at.txt')
    expect(at.tagged).toBe(false)

    // N+1: same.
    await writeFixture(harness.dir, 'over.txt', textOfBytes(CEILING + 1))
    const over = await readValue(harness, 'over.txt')
    expect(over.tagged).toBe(false)

    // The N-1 file cannot be degraded: its own read minted a tag.
    const refused = await harness.callTool('edit', {
      path: 'under.txt',
      old_string: 'xxxx',
      new_string: 'YYYY',
      fallbacks: [{ path: 'under.txt', reason: 'snapshot-limit', readCallId: citationOf(under.nextAction) ?? 'missing' }],
    })
    expect(refused.isError).toBe(true)
    // No citation exists for a tagged read at all, so the citation is unknown.
    expect(errorText(refused)).toContain('EDIT_POLICY_READ_UNKNOWN')
  })

  it('measures normalized bytes, not the raw file size', async () => {
    // CRLF halves the line count for the same byte total: the fact is computed on
    // the normalized text, so a CRLF file of 2*N raw bytes is only N normalized.
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    // 18 RAW bytes (two CRLF endings) normalize to 16: the ceiling decides on the
    // normalized text, so the same file is "over" or "under" depending on that,
    // never on its size on disk.
    const file = await writeFixture(harness.dir, 'crlf.txt', 'x'.repeat(CEILING - 2) + '\r\n' + 'y' + '\r\n')
    const value = await readValue(harness, 'crlf.txt')
    // normalized = (CEILING-2) + 1 + 1 + 1 + 1 = CEILING + 2 >= ceiling
    expect(value.tagged).toBe(false)
    const citation = citationOf(value.nextAction)
    expect(citation).toBeTypeOf('string')
    const ok = await harness.callTool('edit', {
      path: 'crlf.txt',
      old_string: 'y'.repeat(1),
      new_string: 'Z',
      fallbacks: [{ path: 'crlf.txt', reason: 'snapshot-limit', readCallId: citation }],
    })
    expect(ok.isError, errorText(ok)).toBe(false)
    expect(await readFixture(file)).toContain('Z')
  })
})

describe('POLICY-11/POLICY-19: a citation that does not support the degradation is refused', () => {
  it('refuses an unknown citation and writes nothing', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const source = textOfBytes(CEILING)
    const file = await writeFixture(harness.dir, 'unknown-cite.txt', source)

    const result = await harness.callTool('edit', {
      path: 'unknown-cite.txt',
      old_string: 'xxx',
      new_string: 'YYY',
      fallbacks: [{ path: 'unknown-cite.txt', reason: 'snapshot-limit', readCallId: 'read-that-never-happened' }],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_READ_UNKNOWN')
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe(source)
  })

  it('refuses a citation whose read minted a tag (the reason is false)', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const small = textOfBytes(CEILING - 1)
    await writeFixture(harness.dir, 'small.txt', small)
    const big = await writeFixture(harness.dir, 'big-target.txt', textOfBytes(CEILING))
    // The model reads the SMALL file (tagged) and tries to cite it for the big one.
    const smallValue = await readValue(harness, 'small.txt')
    expect(smallValue.tagged).toBe(true)
    const bigValue = await readValue(harness, 'big-target.txt')
    const bigCitation = citationOf(bigValue.nextAction)

    const result = await harness.callTool('edit', {
      path: 'big-target.txt',
      old_string: 'x'.repeat(8),
      new_string: 'Y'.repeat(8),
      fallbacks: [{ path: 'big-target.txt', reason: 'snapshot-limit', readCallId: bigCitation }],
    })
    // This one is legitimate — the control that the citation works at all.
    expect(result.isError, errorText(result)).toBe(false)

    // A tagged read prints NO citation at all: there is nothing to cite, so a
    // model cannot even express this degradation for a target that is editable.
    expect(smallValue.nextAction).toBeNull()

    // And a citation only supports the target it read: the big read's citation
    // cannot authorize an update of the small file.
    const wrongTarget = await harness.callTool('edit', {
      path: 'small.txt',
      old_string: 'x'.repeat(8),
      new_string: 'Z'.repeat(8),
      fallbacks: [{ path: 'small.txt', reason: 'snapshot-limit', readCallId: bigCitation }],
    })
    expect(wrongTarget.isError).toBe(true)
    expect(errorText(wrongTarget)).toContain('EDIT_POLICY_READ_TARGET')
    expect(await readFixture(big)).toContain('YYY')
  })

  it('refuses a citation whose target changed after the read', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'drift.txt', textOfBytes(CEILING))
    const value = await readValue(harness, 'drift.txt')
    const citation = citationOf(value.nextAction)
    expect(citation).toBeTypeOf('string')

    // Something else writes the file between the read and the edit.
    await writeFixture(harness.dir, 'drift.txt', textOfBytes(CEILING + 4))

    const result = await harness.callTool('edit', {
      path: 'drift.txt',
      old_string: 'xxx',
      new_string: 'YYY',
      fallbacks: [{ path: 'drift.txt', reason: 'snapshot-limit', readCallId: citation }],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_EVIDENCE_STALE')
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe(textOfBytes(CEILING + 4))
  })

  it('refuses a citation whose read belongs to another session', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const source = textOfBytes(CEILING)
    const file = await writeFixture(harness.dir, 'cross-session.txt', source)

    // A REAL second session over the same host plane reads the same target.
    const foreign = await harness.callAsOtherSession('read', { file_path: 'cross-session.txt' })
    expect(foreign.isError).toBe(false)
    const foreignValue = (foreign as unknown as { value: { nextAction: string | null } }).value
    const foreignCitation = citationOf(foreignValue.nextAction)
    expect(foreignCitation).toBeTypeOf('string')

    // This session cannot replay it: the citation names a read of another
    // session's registration, so it is unknown here. Evidence is per session and
    // cannot be forwarded — the model must read in the session that edits.
    const result = await harness.callTool('edit', {
      path: 'cross-session.txt',
      old_string: 'xxx',
      new_string: 'YYY',
      fallbacks: [{ path: 'cross-session.txt', reason: 'snapshot-limit', readCallId: foreignCitation }],
    })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_READ_UNKNOWN')
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe(source)
  })

  it('refuses a citation whose read ran in another working directory', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const source = textOfBytes(CEILING)
    const file = await writeFixture(harness.dir, 'cwd.txt', source)
    const value = await readValue(harness, 'cwd.txt')
    const citation = citationOf(value.nextAction)
    expect(citation).toBeTypeOf('string')

    // The session's effective directory moves to a subdirectory that holds a file
    // with the same name. The read resolved in the parent; the edit resolves here.
    await mkdir(path.join(harness.dir, 'sub'), { recursive: true })
    await writeFixture(path.join(harness.dir, 'sub'), 'cwd.txt', source)
    harness.session.header.cwd = path.join(harness.dir, 'sub')

    const result = await harness.callTool('edit', {
      path: 'cwd.txt',
      old_string: 'xxx',
      new_string: 'YYY',
      fallbacks: [{ path: 'cwd.txt', reason: 'snapshot-limit', readCallId: citation }],
    })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_READ_CWD')
    expect(harness.writes).toHaveLength(0)
    // Both files are untouched: the refusal happened before any write.
    expect(await readFixture(file)).toBe(source)
    expect(await readFixture(path.join(harness.dir, 'sub', 'cwd.txt'))).toBe(source)
  })

  it('drops every citation when the registration is remounted', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    const source = textOfBytes(CEILING)
    const file = await writeFixture(harness.dir, 'remount-cite.txt', source)
    const value = await readValue(harness, 'remount-cite.txt')
    const citation = citationOf(value.nextAction)
    expect(citation).toBeTypeOf('string')

    await harness.remount()
    const result = await harness.callTool('edit', {
      path: 'remount-cite.txt',
      old_string: 'xxx',
      new_string: 'YYY',
      fallbacks: [{ path: 'remount-cite.txt', reason: 'snapshot-limit', readCallId: citation }],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_READ_UNKNOWN')
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe(source)
  })

  it('does not treat a failed read as evidence, even when it published a fact', async () => {
    const harness = await managed({ read: { snapshotMaxBytes: CEILING } })
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'failed-read.txt', textOfBytes(CEILING))

    // A read of a missing file fails; no fact survives its result.
    const missing = await harness.read('does-not-exist.txt')
    expect(missing.isError).toBe(true)

    const result = await harness.callTool('edit', {
      path: 'failed-read.txt',
      old_string: 'xxx',
      new_string: 'YYY',
      fallbacks: [{ path: 'failed-read.txt', reason: 'snapshot-limit', readCallId: 'call-that-failed' }],
    })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_READ_UNKNOWN')
  })
})

