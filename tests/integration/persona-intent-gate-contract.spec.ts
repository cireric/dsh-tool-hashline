import { describe, expect, it, onTestFinished } from 'vitest'
import { PERSONA_SUFFIX, createPersonaHarness } from './persona-harness.ts'

/**
 * The PRESET'S OWN prompt contract for the 2026-10-28 joint repair (intent-gate P1 /
 * tool-routing T1).
 *
 * What this tier proves: the text the preset actually ASSEMBLES (the registry, the scope
 * layering and the variable interpolation are the host's own) still says what the
 * implementation relies on, and the instructions the two plans introduced do not
 * contradict each other. What it cannot prove: that the model follows it — that is the
 * frozen real-model evaluation (P6/T4), which is prepared and NOT executed.
 */
describe('preset persona intent and tool contract', () => {
  const render = async () => {
    const harness = await createPersonaHarness()
    onTestFinished(() => harness.dispose())
    return await harness.render()
  }

  it('keeps the declaration shape and scope in the assembled persona', async () => {
    const text = await render()
    expect(text).toContain('## Phase 0 — Intent Gate')
    expect(text).toContain('Intent: <bucket> — <goal and relevant boundary>; I will <next step>.')
    expect(text).toContain('Buckets, exactly six: research / implementation / investigation / evaluation / fix / open-ended')
    expect(text.endsWith(PERSONA_SUFFIX)).toBe(true)
    expect(text).toContain('Start every turn opened by a real user message')
    expect(text).toContain('including clarification answers, follow-up questions, corrections, and requests to continue the same task')
    expect(text).not.toContain('Tool results continue the same request; do not repeat the declaration.')
  })

  it('states the ambiguity rule without baking in a worked example, and keeps it English-only', async () => {
    const text = await render()
    expect(text).toMatch(/clear[\s\S]*proceed/iu)
    expect(text).toMatch(/plausible interpretations[\s\S]*different work[\s\S]*ask/iu)
    expect(text).toMatch(/required fact[\s\S]*cannot obtain[\s\S]*ask/iu)
    expect(text).toMatch(/both paths[\s\S]*conditionally/iu)
    expect(text).toMatch(/clarification is normal[\s\S]*not an error/iu)
    expect(text).toMatch(/do not[\s\S]*already supplied[\s\S]*manufacture/iu)
    // A pasted customer scenario and any Chinese prose are not part of the shipped prompt.
    expect(text).not.toContain('老板')
    expect(text).not.toContain('风控')
    expect(/[\u4e00-\u9fff]/u.test(text)).toBe(false)
  })

  it('scopes the question to its own program and makes the wait identity-based', async () => {
    const text = await render()
    expect(text).toMatch(/question-only `run_code`/u)
    expect(text).toMatch(/after it returns[\s\S]*next reply/iu)
    expect(text).toMatch(/question's own answer[\s\S]*settles it/iu)
    expect(text).toMatch(/bare continuation[\s\S]*not a choice/iu)
    expect(text).toMatch(/independent requests[\s\S]*original question open/iu)
    expect(text).not.toContain('the reply carries no action — no program')
  })

  it('states the tool path per task with arguments taken from the SDK, not from memory', async () => {
    const text = await render()
    for (const tool of ['read', 'edit', 'write', 'glob', 'grep', 'pwsh', 'bash', 'ask_user_question']) {
      expect(text).toContain('tools.' + tool)
    }
    expect(text).toMatch(/arguments[\s\S]*SDK[\s\S]*canonical/iu)
    expect(text).toMatch(/read first[\s\S]*Hashline[\s\S]*tag[\s\S]*nextAction/iu)
    expect(text).toMatch(/write[\s\S]*new files[\s\S]*not to overwrite/iu)
    expect(text).toMatch(/do not bypass[\s\S]*Node[\s\S]*child_process[\s\S]*shell/iu)
    expect(text).not.toContain('src/main.ts')
  })

  it('resolves the two instruction collisions the two plans introduced', async () => {
    const text = await render()
    expect(text).toMatch(/declarations[\s\S]*questions[\s\S]*take priority over brevity/iu)
    expect(text).toMatch(/ask in the reply body and end the turn[\s\S]*Wait for the user's answer/iu)
    expect(text).toMatch(/missing or malformed marker is not a failure[\s\S]*no separate repair turn/iu)
    expect(text).toContain('A declaration never grants authorization.')
    expect(text).not.toContain('current message contains an explicit implement verb')
  })
})
