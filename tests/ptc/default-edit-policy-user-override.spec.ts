/**
 * Ticket 04 over the PTC bridge: the user citation is discoverable and
 * fillable from the program, and the SDK carries the optional identifiers.
 * @module dsh-tool-hashline/tests/ptc/default-edit-policy-user-override
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createPtcHarness, readFixture, writeFixture } from './harness.ts'

const POLICY_MODULE = fileURLToPath(new URL('../../presets/ptc-hashline/policy/default-edit-policy.mjs', import.meta.url))
const q = (value: string) => JSON.stringify(value)

describe('PTC: a user-override degradation from the program', () => {
  it('quotes the user message verbatim and lands the declared mode', async () => {
    const harness = await createPtcHarness({ policyModule: POLICY_MODULE })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'ptc-override.txt', 'one\ntwo\n')
    harness.appendUserMessage('use replace on ptc-override.txt, I do not want a tag round trip')

    const result = await harness.runCode(`
      const out = await tools.edit({
        path: ${q(file)},
        old_string: 'two',
        new_string: 'TWO',
        fallbacks: [{
          path: ${q(file)},
          reason: 'user-override',
          userSource: { quote: 'use replace on ptc-override.txt' },
          modes: ['replace'],
        }],
      })
      return { out }
    `)

    expect(result.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\n')
  })

  it('carries the userSource fields into the generated SDK', async () => {
    const harness = await createPtcHarness({ policyModule: POLICY_MODULE })
    onTestFinished(() => harness.cleanup())
    const sdk = (await harness.ctx.systemPrompt.assemble())
      .sections.find(section => section.name === 'tools:sdk')?.text ?? ''
    expect(sdk).toContain('userSource')
    expect(sdk).toContain('quote')
    // The identifiers are optional: a model never has to guess a session id.
    expect(sdk).toMatch(/sessionId\?:/u)
    expect(sdk).toMatch(/eventSeq\?:/u)
  })

  it('refuses a fabricated quote inside the program', async () => {
    const harness = await createPtcHarness({ policyModule: POLICY_MODULE })
    onTestFinished(() => harness.cleanup())
    const source = 'one\ntwo\n'
    const file = await writeFixture(harness.dir, 'ptc-override-refused.txt', source)

    const result = await harness.runCode(`
      let outcome
      try {
        await tools.edit({
          path: ${q(file)},
          old_string: 'two',
          new_string: 'TWO',
          fallbacks: [{
            path: ${q(file)},
            reason: 'user-override',
            userSource: { quote: 'the user told me to use replace' },
            modes: ['replace'],
          }],
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
    expect(value.outcome.message).toContain('EDIT_POLICY_USER_SOURCE')
    expect(await readFixture(file)).toBe(source)
  })
})
