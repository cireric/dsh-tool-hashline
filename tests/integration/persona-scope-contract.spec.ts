import { describe, expect, it, onTestFinished } from 'vitest'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { PERSONA_SUFFIX, createPersonaHarness } from './persona-harness.ts'

/**
 * Host contract that makes the persona-override defect possible.
 *
 * No deployment plugin is loaded here: this pins the registry semantics the fix
 * must respect, so a later host change cannot silently re-open the hole.
 */
describe('preset persona scope contract (D2)', () => {
  it('keeps the preset persona when only an assembly listener rewrites text', async () => {
    const harness = await createPersonaHarness()
    onTestFinished(() => harness.dispose())
    // Stand-in for the de-brand plugin's layer 3: rewrite assembled text only.
    harness.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const resolved = await next()
      return {
        ...resolved,
        sections: resolved.sections.map(section => ({
          ...section,
          text: section.text.replace('DeepSeek Harness', ''),
        })),
      }
    })
    const text = await harness.render()
    expect(text).toContain('## Phase 0 — Intent Gate')
    expect(text).toContain('Intent: <what the user will get, in outcome terms>')
  })

  it('shadows the preset persona when a nearer scope registers the same section name', async () => {
    const harness = await createPersonaHarness()
    onTestFinished(() => harness.dispose())
    harness.agentScope.ctx.systemPrompt.section({
      name: 'deployment:persona-prefix',
      order: harness.ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      text: 'You are a helpful assistant.',
    })
    const text = await harness.render()
    // The model-visible consequence: the whole preset persona is gone, not just
    // its first sentence.
    expect(text).not.toContain('## Phase 0 — Intent Gate')
    expect(text.startsWith('You are a helpful assistant.')).toBe(true)
    expect(text).toContain(PERSONA_SUFFIX)
  })

  it('renders the untouched control assembly with the shipped persona', async () => {
    const harness = await createPersonaHarness()
    onTestFinished(() => harness.dispose())
    const text = renderPrompt(await harness.assemble())
    expect(text).toContain('## Phase 0 — Intent Gate')
    expect(text).toContain('Intent: <what the user will get, in outcome terms>')
    expect(text).not.toContain('Buckets, exactly six')
    expect(text).toContain(PERSONA_SUFFIX)
    expect(text.startsWith('You are a coding agent powered by the deepseek-v4.1-flash model.')).toBe(true)
  })
})
