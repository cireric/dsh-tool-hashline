
/**
 * Verifies HANDOFF.md §11.1 / risk 1: can a "tools/post-execute" listener replace
 * the model-facing "read" content and still keep the stock read card working?
 *
 * The read tool below mirrors stock @deepseek-ai/dsh-tool-fs:
 *   - output.render           -> formatReadOutput envelope (read-render.ts:152-169)
 *   - output.presentationMeta -> FsReadMeta (read.ts:124-133)
 *   - presentResult           -> envelope regex over the rendered text (read.ts:173-192)
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecutionResult, ToolResult } from '@deepseek-ai/dsh-tools'

const LINES = [
  'export function greet(name: string) {',
  '  return "hi " + name',
  '}',
]

const VALUE = {
  path: '/abs/src/demo.ts',
  offset: 1,
  lines: LINES.map((text, i) => ({ number: i + 1, text })),
  totalLines: 4,
}

type ReadValue = typeof VALUE

function formatReadOutput(path: string, outcome: ReadValue): string {
  const endLine = outcome.lines.at(-1)?.number ?? Math.max(0, outcome.offset - 1)
  const footer = endLine < outcome.totalLines
    ? '(Showing lines ' + outcome.offset + '-' + endLine + ' of ' + outcome.totalLines + '. Use offset=' + (endLine + 1) + ' to continue.)'
    : '(End of file - total ' + outcome.totalLines + ' lines)'
  const body = outcome.lines.length > 0
    ? outcome.lines.map(l => l.number + ': ' + l.text).join('\n') + '\n\n' + footer
    : footer
  return '<path>' + path + '</path>' + '\n' + '<type>file</type>' + '\n' + '<content>' + '\n' + body + '\n' + '</content>'
}

const ENVELOPE = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u

const readTool: ToolDefinition = {
  name: 'read',
  description: 'read a file',
  parameters: {
    type: 'object',
    properties: { filePath: { type: 'string', required: true } },
    required: ['filePath'],
    additionalProperties: false,
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'integer' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: { number: { type: 'integer' }, text: { type: 'string' } },
            required: ['number', 'text'],
          },
        },
        totalLines: { type: 'integer' },
      },
      required: ['path', 'offset', 'lines', 'totalLines'],
      additionalProperties: false,
    },
    render: (_args, value) => [{ type: 'text', text: formatReadOutput((value as unknown as ReadValue).path, value as unknown as ReadValue) }],
    presentationMeta: (_args, value) => {
      const v = value as unknown as ReadValue
      return {
        path: v.path,
        offset: v.offset,
        lines: v.lines.map(({ number, text }) => ({ number, text })),
        totalLines: v.totalLines,
      }
    },
  },
  async execute() { return VALUE },
  presentResult(_args, result: ToolResult) {
    if (result.isError) return undefined
    const meta = result.meta as
      | { path: string; offset: number; lines: { number: number; text: string }[]; totalLines: number }
      | undefined
    if (meta === undefined) return undefined
    const only = result.content.length === 1 ? result.content[0] : undefined
    const text = only?.type === 'text' ? only.text : undefined
    if (text === undefined) return undefined
    const body = ENVELOPE.exec(text)?.[1]
    if (body === undefined) return undefined
    return { card: 'read', path: meta.path, offset: meta.offset, lines: meta.lines, totalLines: meta.totalLines, content: [{ type: 'text', text: body }] }
  },
}

const HEADER = '[src/demo.ts#A1B2]'
const MARKER = '<content>' + '\n'

/** The exact insertion algorithm from HANDOFF.md §6.3. */
function insertHeader(text: string): string | undefined {
  const at = text.indexOf(MARKER)
  if (at < 0) return undefined
  const bodyStart = at + MARKER.length
  if (text.startsWith(HEADER, bodyStart)) return undefined
  return text.slice(0, bodyStart) + HEADER + '\n' + text.slice(bodyStart)
}

type Mode = 'off' | 'content' | 'value'

async function dispatch(mode: Mode): Promise<ToolExecutionResult> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(readTool)

  // A plain object stands in for the agent Session: getSessionSnapshotStore only
  // needs an identity key.
  const session = {}
  const agent = { id: 'agent-1', session } as never

  ctx.on('tools/post-execute', async (exec, result, next) => {
    if (mode === 'off') return next()
    if (exec.name !== 'read' || result.isError) return next()
    if (mode === 'value') {
      // Deliberately wrong seam: replacing the VALUE re-runs render() and mints
      // fresh content, so any header added here would be thrown away.
      return { kind: 'accept', value: result.value as never }
    }
    const only = result.content.length === 1 ? result.content[0] : undefined
    if (only?.type !== 'text') return next()
    const withHeader = insertHeader(only.text)
    if (withHeader === undefined) return next()
    return { kind: 'accept', content: [{ type: 'text', text: withHeader }] }
  })

  return ctx.tools.execute({
    callId: 'call-1' as never,
    name: 'read',
    arguments: { filePath: 'src/demo.ts' },
    agent,
    signal: new AbortController().signal,
  })
}

function textOf(result: ToolExecutionResult): string {
  const first = result.content[0]
  return first?.type === 'text' ? first.text : ''
}

describe('tools/post-execute can decorate read content', () => {
  it('baseline: stock output carries no hashline header', async () => {
    const result = await dispatch('off')
    expect(result.isError).toBe(false)
    expect(textOf(result)).not.toContain(HEADER)
    expect(textOf(result)).toContain('<content>' + '\n' + '1: export function greet')
  })

  it('replacing content injects the header inside the content envelope', async () => {
    const result = await dispatch('content')
    const text = textOf(result)
    expect(text).toContain(MARKER + HEADER + '\n')
    expect(ENVELOPE.test(text)).toBe(true)
  })

  it('replacing content keeps value and meta intact', async () => {
    const result = await dispatch('content')
    expect(result.value).toBeDefined()
    expect(result.meta).toBeDefined()
    expect((result.value as ReadValue).lines).toHaveLength(3)
    expect((result.meta as { lines: unknown[] }).lines).toHaveLength(3)
  })

  it('the stock read card still parses the decorated envelope', async () => {
    const result = await dispatch('content')
    const card = readTool.presentResult?.({}, result)
    expect(card).toBeDefined()
    if (card?.card !== 'read') throw new Error('expected a read card, got: ' + String(card?.card))
    // The card's structured lines come from meta, so they stay positionally exact.
    expect(card.lines).toHaveLength(3)
  })

  it('replacing value is the wrong seam: render() mints fresh content, header is lost', async () => {
    const result = await dispatch('value')
    const text = textOf(result)
    expect(text).not.toContain(HEADER)
    expect(ENVELOPE.test(text)).toBe(true)
  })
})
