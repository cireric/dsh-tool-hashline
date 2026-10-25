import { describe, expect, it, onTestFinished } from 'vitest'
import type { ReadValue } from '../../src/index.ts'
import { createHarness, valueOf, writeFixture } from './harness.ts'

const textOf = (result: { content: { type: string; text?: string }[] }) =>
  result.content.map(block => block.type === 'text' ? block.text ?? '' : '').join('')

describe('default-edit guidance is opt-in and canonical', () => {
  for (const enabled of [true, false]) {
    it(`keeps context-less read guidance scoped to policyGuidance=${enabled}`, async () => {
      const harness = await createHarness({ read: { defaultEditPolicyGuidance: enabled } })
      onTestFinished(() => harness.cleanup())
      const file = await writeFixture(harness.dir, 'sessionless.txt', 'one\n')
      const result = await harness.callTool('read', { file_path: file }, { agent: null })
      const value = valueOf<ReadValue>(result)
      expect(value.tag).toBeNull()
      expect(value.nextAction).toContain('no agent session')
      if (enabled) {
        expect(value.nextAction).toContain('Stop')
        expect(value.nextAction).not.toMatch(/replace|patch mode/iu)
      } else {
        expect(value.nextAction).toContain('replace mode')
      }
      expect(textOf(result as never)).toContain(value.nextAction)
    })

    it.each([
      { name: 'snapshot', caps: { snapshotMaxBytes: 4 }, source: 'long text\n', reason: 'snapshot-limit' },
      { name: 'columns', caps: { maxLineLength: 4 }, source: 'long text\n', reason: 'window-limit' },
      { name: 'zero-window', caps: { maxBytes: 4 }, source: 'long text\n', reason: 'window-limit' },
    ])(`keeps $name limits and rendering scoped to policyGuidance=${enabled}`, async ({ name, caps, source, reason }) => {
      const harness = await createHarness({ read: { ...caps, defaultEditPolicyGuidance: enabled } })
      onTestFinished(() => harness.cleanup())
      const file = await writeFixture(harness.dir, `${name}.txt`, source)
      const result = await harness.callRead({ file_path: file })
      const value = valueOf<ReadValue>(result)
      expect(value.nextAction).not.toBeNull()
      expect(textOf(result as never)).toContain(value.nextAction)
      if (enabled) {
        expect(value.nextAction).toContain(reason)
        expect(value.nextAction).toMatch(/readCallId: \S+/u)
        expect(value.nextAction).toContain('complete original content')
        expect(value.nextAction).toContain('Stop')
        expect(value.nextAction).not.toMatch(/raise|maxLineLength|larger|remount/iu)
      } else {
        expect(value.nextAction).not.toContain('fallback')
        expect(value.nextAction).not.toContain('readCallId')
        if (reason === 'window-limit') expect(value.nextAction).toContain('remount')
      }
      // Guidance does not change the tag/window rules or public value shape.
      expect(value.tagged).toBe(name !== 'snapshot')
      expect(value.lines.length).toBe(name === 'zero-window' ? 0 : 1)
      expect(Object.keys(value).sort()).toEqual(['path', 'tag', 'tagged', 'offset', 'lines', 'totalLines', 'nextAction'].sort())
    })
  }
})
