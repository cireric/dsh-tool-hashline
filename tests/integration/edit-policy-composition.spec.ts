/**
 * POL-01..06: does the editor's policy chain actually decide the provider write,
 * and does the provider actually enforce it? The fixture keeps the real
 * topology (host root fs + policy, agent preset scope) and observes only the
 * intent edge, never the decision slot.
 *
 * Two edit modes reach the same writer through DIFFERENT preparation paths:
 * hashline (an `input` patch program, prepared by the hashline patcher) and
 * replace (`file_path` + `old_string` + `new_string`, prepared by the replace
 * executor). Every case that claims the writer is covered runs in both modes,
 * and each test says which mode it exercised; a hashline result is never
 * reported as a replace result.
 * @module dsh-tool-hashline/tests/integration/edit-policy-composition
 */
import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { computeFileHash, normalizeToLF, stripBom } from '@dsh-tool-hashline/hashline'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { PolicyHarness } from './edit-policy-harness.ts'
import { createPolicyHarness, readFixture, writeFixture } from './edit-policy-harness.ts'

const tagOf = (text: string) => computeFileHash(normalizeToLF(stripBom(text).text))
const errorCode = (result: ToolExecutionResult) => result.isError ? result.error.info?.code : undefined

interface EditMode {
  /** Mode name as the edit tool sees it; used verbatim in test titles. */
  label: string
  /** Issue one edit through the registry. */
  call(harness: PolicyHarness, file: string, text: string): Promise<ToolExecutionResult>
  /**
   * Upstream replace retries ONCE after a stale-version rejection (the guarded
   * write is the only side effect, so a fresh read + re-apply is safe). The
   * retry re-reads the competing content; hashline batches are never retried.
   * Tests assert the real contract per mode instead of pretending both behave alike.
   */
  retriesAfterConflict: boolean
}

const MODES: EditMode[] = [
  {
    label: 'hashline PUT',
    call: (harness, file, text) => harness.edit(`[${file}#${tagOf(text)}]\nPUT 2.=2:\n+TWO`),
    retriesAfterConflict: false,
  },
  {
    label: 'replace',
    call: (harness, file) => harness.replace(file, 'two', 'TWO'),
    retriesAfterConflict: true,
  },
]

const SOURCE = 'one\ntwo\nthree\n'
const EDITED = 'one\nTWO\nthree\n'

describe.each(MODES)('POL-01/02 ($label): the editor read authorises the write', mode => {
  it(`POL-01 (${mode.label}): no model read — observed first, then a versioned provider write`, async () => {
    const harness = await createPolicyHarness({ policy: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'pol01.txt', SOURCE)

    const result = await mode.call(harness, file, SOURCE)

    expect(result.isError).toBe(false)
    expect(await readFixture(file)).toBe(EDITED)
    const observedIndex = harness.ledger.findIndex(entry => entry.kind === 'observed' && entry.displayPath === file)
    const writeIndex = harness.ledger.findIndex(entry => entry.kind === 'write' && entry.displayPath === file)
    expect(observedIndex).toBeGreaterThanOrEqual(0)
    expect(writeIndex).toBeGreaterThan(observedIndex)
    expect(harness.writes).toHaveLength(1)
    expect(harness.writes[0]?.intent?.kind).toBe('replaceIfVersion')
    expect(harness.writes[0]?.intent?.version).toBe(harness.writes[0]?.versionBefore)
  })

  it(`POL-02 (${mode.label}): without the policy the same call carries no condition`, async () => {
    const harness = await createPolicyHarness({ policy: false })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'pol02.txt', SOURCE)

    const result = await mode.call(harness, file, SOURCE)

    expect(result.isError).toBe(false)
    expect(await readFixture(file)).toBe(EDITED)
    expect(harness.writes).toHaveLength(1)
    expect(harness.writes[0]?.intent).toBeUndefined()
  })
})

describe.each(MODES)('POL-03/04 ($label): a write landing after the read, before the commit', mode => {
  it(`POL-03 (${mode.label}): the provider rejects the stale version and the competitor survives`, async () => {
    const harness = await createPolicyHarness({ policy: true, race: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'pol03.txt', SOURCE)

    const result = await mode.call(harness, file, SOURCE)

    expect(harness.race).toBeDefined()
    expect(harness.race?.requestedVersion).toBeTypeOf('string')
    expect(harness.race?.versionAfterCompetitor).not.toBe(harness.race?.requestedVersion)
    // The provider itself rejected the guarded write — the CAS basis, in both modes.
    expect(harness.race?.providerRejected).toContain('FS_STALE_VERSION')
    expect(result.isError).toBe(true)
    const observed = harness.ledger.filter(entry => entry.kind === 'observed').length
    const message = result.isError ? result.error.message : ''
    if (mode.retriesAfterConflict) {
      // The single retry re-read the competitor and could not re-apply the anchor,
      // so the model sees the match failure, not the CAS code.
      expect(observed).toBe(2)
      expect(message).toContain('Could not find')
      expect(errorCode(result)).toBeUndefined()
    } else {
      expect(observed).toBe(1)
      expect(message).toContain('file changed since it was read')
      expect(errorCode(result)).toBe('FS_STALE_VERSION')
    }
    expect(await readFixture(file)).toBe(harness.race!.competitorContent)
  })

  it(`POL-04 (${mode.label}): the same race runs without the policy, and nothing detects it`, async () => {
    const harness = await createPolicyHarness({ policy: false, race: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'pol04.txt', SOURCE)

    const result = await mode.call(harness, file, SOURCE)

    // The competitor really was written before the provider's write in BOTH arms.
    expect(harness.race).toBeDefined()
    expect(await harness.race!.competitorContent).toBeTypeOf('string')
    // No policy: no version condition, so the provider has nothing to compare.
    expect(harness.race?.requestedVersion).toBeUndefined()
    expect(harness.writes[0]?.intent).toBeUndefined()
    expect(harness.race?.providerRejected).toBeUndefined()
    expect(result.isError).toBe(false)
    // The unguarded write wins: the competitor is overwritten by the editor's result.
    expect(await readFixture(file)).toBe(EDITED)
  })
})

describe('POL-05: a move to a new nested target is a write-intent decision', () => {
  it('creates the absent target with createIfAbsent and moves the bytes', async () => {
    const harness = await createPolicyHarness({ policy: true })
    onTestFinished(() => harness.cleanup())
    const text = 'alpha\nbeta\n'
    await writeFixture(harness.dir, 'pol05.txt', text)
    await mkdir(path.join(harness.dir, 'nested', 'deep'), { recursive: true })

    // A model read of the source is what makes the source editable; the DEST is unseen.
    const read = await harness.read('pol05.txt')
    expect(read.isError).toBe(false)
    const moved = await harness.edit(`[pol05.txt#${tagOf(text)}]\nMV nested/deep/pol05-dest.txt`)

    expect(moved.isError).toBe(false)
    const destWrites = harness.writes.filter(entry => entry.displayPath.endsWith('pol05-dest.txt'))
    expect(destWrites).toHaveLength(1)
    expect(destWrites[0]?.intent?.kind).toBe('createIfAbsent')
    expect(await readFixture(path.join(harness.dir, 'nested/deep/pol05-dest.txt'))).toBe(text)
    await expect(readFixture(path.join(harness.dir, 'pol05.txt'))).rejects.toThrow()
  })
})

describe('POL-06: the stock write control', () => {
  it('refuses an unobserved overwrite and succeeds after a read', async () => {
    const harness = await createPolicyHarness({ policy: true, stockWrite: true })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'pol06.txt', 'keep me\n')

    const refused = await harness.write('pol06.txt', 'overwritten\n')
    expect(refused.isError).toBe(true)
    expect(refused.isError ? refused.error.message : '').toMatch(/not been read|without reading it first/u)
    expect(errorCode(refused)).toBe('FS_NOT_OBSERVED')
    expect(await readFixture(file)).toBe('keep me\n')

    const read = await harness.read('pol06.txt')
    expect(read.isError).toBe(false)
    const allowed = await harness.write('pol06.txt', 'overwritten\n')
    expect(allowed.isError).toBe(false)
    expect(await readFixture(file)).toBe('overwritten\n')
    // The refused attempt was an unversioned create (the target was never observed);
    // the accepted one carried the observed version.
    expect(harness.writes.map(entry => entry.intent?.kind ?? 'none')).toEqual(['createIfAbsent', 'replaceIfVersion'])
  })
})
