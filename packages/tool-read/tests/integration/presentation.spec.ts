import { describe, expect, it, onTestFinished } from 'vitest'
import type { ReadValue } from '../../src/index.ts'
import { createHarness, valueOf, writeFixture } from './harness.ts'

type Meta = { path: string; offset: number; lines: { number: number; text: string }[]; totalLines: number; lang?: string }
type Card = { card: string; path: string; offset: number; lines: { number: number; text: string }[]; totalLines: number; lang?: string; content: { type: string; text?: string }[] }

const toolOf = (harness: Awaited<ReturnType<typeof createHarness>>) => harness.runtime.get('read') as unknown as {
  presentResult(args: unknown, result: unknown): Card | undefined
}

const replay = (harness: Awaited<ReturnType<typeof createHarness>>, result: { meta: Meta; content: { type: string; text: string }[] }) => {
  // A replayed session only has the persisted JSON meta plus the rendered text.
  const meta = JSON.parse(JSON.stringify(result.meta)) as Meta
  const content = JSON.parse(JSON.stringify(result.content)) as { type: string; text: string }[]
  return { isError: false, meta, content }
}

describe('system-prompt projection (FR-12)', () => {
  it('registers the stock read guidance only while read is visible', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const assembly = await harness.ctx.systemPrompt.assemble()
    const section = assembly.sections.find(entry => entry.name === 'tool:read')
    expect(section?.text).toContain('Use the read tool')
    expect(section?.text).toContain('not shell commands like cat')
  })

  it('drops the guidance when this plugin is disabled (negative control)', async () => {
    const harness = await createHarness({ read: { enabled: false } })
    onTestFinished(() => harness.cleanup())
    const assembly = await harness.ctx.systemPrompt.assemble()
    const section = assembly.sections.find(entry => entry.name === 'tool:read')
    expect(section?.text ?? '').toBe('')
    expect(harness.runtime.get('read')).toBeUndefined()
  })
})

describe('read card and replay (FR-12)', () => {
  it('persists path/offset/lines/totalLines/lang and projects a live read card', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'card.ts', 'one\ntwo\nthree\n')
    const result = await harness.callRead({ file_path: file })
    const value = valueOf<ReadValue>(result)
    const meta = result.meta as Meta
    expect(meta).toEqual({ path: value.path, offset: 1, lines: value.lines, totalLines: 3, lang: 'ts' })
    const card = toolOf(harness).presentResult({ file_path: file }, result)
    expect(card).toMatchObject({ card: 'read', path: value.path, offset: 1, totalLines: 3, lang: 'ts' })
    expect(card?.lines).toEqual(value.lines)
    const body = card?.content[0]?.text ?? ''
    expect(body.startsWith('[' + value.path + '#' + value.tag + ']\n1: one')).toBe(true)
    expect(body).toContain('(End of file - total 3 lines)')
  })

  it('rebuilds an identical card from persisted JSON', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'replay.tsx', 'alpha\nbeta\n')
    const result = await harness.callRead({ file_path: file })
    const live = toolOf(harness).presentResult({ file_path: file }, result)
    const replayed = toolOf(harness).presentResult({ file_path: file }, replay(harness, result as never))
    expect(replayed).toEqual(live)
    expect(replayed?.lang).toBe('tsx')
  })

  it('shows remediation guidance in the body and no fake header when untagged', async () => {
    const harness = await createHarness({ read: { snapshotMaxBytes: 5 } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'untagged.txt', 'one\ntwo\n')
    const result = await harness.callRead({ file_path: file })
    const value = valueOf<ReadValue>(result)
    expect(value.tagged).toBe(false)
    const card = toolOf(harness).presentResult({ file_path: file }, result)
    const body = card?.content[0]?.text ?? ''
    expect(body).not.toMatch(/\[[^\]]+#[0-9A-F]{4}\]/u)
    expect(body).toContain('replace or patch')
    expect(card?.lang).toBeUndefined()
  })

  it('projects an empty window without throwing', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'empty.txt', '')
    const result = await harness.callRead({ file_path: file })
    const card = toolOf(harness).presentResult({ file_path: file }, result)
    expect(card).toMatchObject({ card: 'read', offset: 1, totalLines: 0 })
    expect(card?.lines).toEqual([])
    expect(card?.content[0]?.text).toBe('(End of file - total 0 lines)\n\nThis file is empty, so there is no hashline content to tag. Use the write tool to create its contents.')
  })

  it('degrades to the generic card for malformed meta, a missing envelope or an error result', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const tool = toolOf(harness)
    const args = { file_path: 'x.ts' }
    expect(tool.presentResult(args, { isError: false, meta: { path: 1 }, content: [] })).toBeUndefined()
    expect(tool.presentResult(args, { isError: false, content: [] })).toBeUndefined()
    expect(tool.presentResult(args, { isError: false, meta: { path: 'a', offset: 1, lines: [], totalLines: 0 }, content: [{ type: 'text', text: 'not an envelope' }] })).toBeUndefined()
    expect(tool.presentResult(args, { isError: true, meta: { path: 'a', offset: 1, lines: [], totalLines: 0 }, content: [{ type: 'text', text: 'boom' }] })).toBeUndefined()
    expect(tool.presentResult(args, { isError: false, meta: { path: 'a', offset: 2, lines: [{ number: 1, text: 'x' }], totalLines: 3 }, content: [{ type: 'text', text: '<path>a</path>\n<type>file</type>\n<content>\n1: x\n</content>' }] })).toBeUndefined()
  })
})
