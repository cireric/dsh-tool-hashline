/**
 * POL-07: the policy decision survives the real PTC bridge — the accepted edit
 * and the stale-version conflict — in BOTH edit modes (hashline patch and
 * replace). Each mode prepares the write on its own path; a hashline result is
 * never reported as a replace result.
 * @module dsh-tool-hashline/tests/ptc/edit-policy
 */
import { describe, expect, it, onTestFinished } from 'vitest'
import { computeFileHash, normalizeToLF, stripBom } from '@dsh-tool-hashline/hashline'
import { createPolicyHarness, readFixture, writeFixture } from '../integration/edit-policy-harness.ts'

const tagOf = (text: string) => computeFileHash(normalizeToLF(stripBom(text).text))
const toPosix = (value: string) => value.split('\\').join('/')

interface PtcMode {
  label: string
  /** The program statement that issues one edit against `file`. */
  statement(file: string, text: string): string
  /** What the program sees when the competing write already broke the anchor. */
  conflictMessage: RegExp
}

const MODES: PtcMode[] = [
  {
    label: 'hashline PUT',
    statement: (file, text) => 'tools.edit({ input: ' + JSON.stringify('[' + toPosix(file) + '#' + tagOf(text) + ']\nPUT 2.=2:\n+TWO') + ' })',
    conflictMessage: /file changed since it was read/u,
  },
  {
    label: 'replace',
    statement: file => 'tools.edit({ file_path: ' + JSON.stringify(toPosix(file)) + ", old_string: 'two', new_string: 'TWO' })",
    // Upstream replace retries once after a stale-version rejection; the retry
    // re-reads the competitor, so the program sees the re-match failure.
    conflictMessage: /Could not find/u,
  },
]

const SOURCE = 'one\ntwo\nthree\n'
const EDITED = 'one\nTWO\nthree\n'

describe.each(MODES)('POL-07 ($label): the decision survives the PTC bridge', mode => {
  it('delivers the accepted edit as a value and the conflict as a program error', async () => {
    const harness = await createPolicyHarness({ policy: true, ptc: true, race: true, raceOn: 'pol07-b.txt' })
    onTestFinished(() => harness.cleanup())
    const accepted = await writeFixture(harness.dir, 'pol07-a.txt', SOURCE)
    const conflicted = await writeFixture(harness.dir, 'pol07-b.txt', SOURCE)

    const code = [
      'const a = await ' + mode.statement(accepted, SOURCE),
      'let b',
      'try { await ' + mode.statement(conflicted, SOURCE) + '; b = { ok: true } }',
      'catch (error) { b = { ok: false, message: String(error && error.message) } }',
      'return { aOk: a !== undefined && a !== null, b }',
    ].join('\n')

    const result = await harness.runCode(code)
    expect(result.isError).toBe(false)
    const value = (result.value as { result: { aOk: boolean; b: { ok: boolean; message?: string } } }).result
    expect(value.aOk).toBe(true)
    expect(value.b.ok).toBe(false)
    expect(value.b.message).toMatch(mode.conflictMessage)
    // Same disk outcome as the non-PTC case: the competitor is untouched.
    expect(await readFixture(accepted)).toBe(EDITED)
    expect(await readFixture(conflicted)).toBe(harness.race?.competitorContent)
  })
})
