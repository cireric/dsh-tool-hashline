import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ReadResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import { FsError } from '@deepseek-ai/dsh-fs'
import { computeFileHash, formatHashlineHeader, getSessionSnapshotStore, normalizeToLF, stripBom } from '@dsh-tool-hashline/hashline'
import { toolCwdFromExec } from '@hy-sde-org/dsh-tool-edit/dist/session.js'
import * as path from 'node:path'

export const name = 'tool-read-hashline'
export const inject = ['tools', 'fs'] as const

export interface Config {
  enabled?: boolean
  snapshotMaxBytes?: number
  maxBytes?: number
  limit?: number
  maxLineLength?: number
}

const DEFAULT_LIMIT = 2000
const DEFAULT_LINE_LENGTH = 2000
const DEFAULT_MAX_BYTES = 51200
const DEFAULT_SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024
const GUIDE = 'Use offset and limit to continue reading large files.'

function positiveInteger(value: number, key: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`)
  return value
}

function windowText(text: string, offset: number, limit: number, maxLineLength: number, maxBytes: number) {
  const all = text.split('\n')
  if (all.at(-1) === '' && all.length > 1) all.pop()
  const totalLines = text.length === 0 ? 0 : all.length
  if (offset > totalLines && !(offset === 1 && totalLines === 0)) throw new FsError(`offset ${offset} is out of range for "file" (${totalLines} lines)`, 'FS_NOT_FOUND')
  const lines: { number: number; text: string; complete: boolean }[] = []
  let bytes = 0
  let byteCapped = false
  for (let i = offset - 1; i < Math.min(all.length, offset - 1 + limit); i++) {
    const raw = all[i] ?? ''
    const complete = raw.length <= maxLineLength
    const value = complete ? raw : `${raw.slice(0, maxLineLength)}... (line truncated to ${maxLineLength} chars)`
    const size = Buffer.byteLength(value, 'utf8') + (lines.length ? 1 : 0)
    if (bytes + size > maxBytes) { byteCapped = true; break }
    bytes += size
    lines.push({ number: i + 1, text: value, complete })
  }
  const end = lines.at(-1)?.number ?? Math.max(0, offset - 1)
  const footer = byteCapped
    ? `(Output capped. Showing lines ${offset}-${end}. Use offset=${end + 1} to continue.)`
    : end < totalLines
      ? `(Showing lines ${offset}-${end} of ${totalLines}. Use offset=${end + 1} to continue.)`
      : `(End of file - total ${totalLines} lines)`
  const body = lines.length ? `${lines.map(line => `${line.number}: ${line.text}`).join('\n')}\n\n${footer}` : footer
  return { lines, totalLines, body, footer, byteCapped }
}

export function apply(ctx: Context, config: Config = {}): void {
  const limit = positiveInteger(config.limit ?? DEFAULT_LIMIT, 'limit')
  const maxLineLength = positiveInteger(config.maxLineLength ?? DEFAULT_LINE_LENGTH, 'maxLineLength')
  const maxBytes = positiveInteger(config.maxBytes ?? DEFAULT_MAX_BYTES, 'maxBytes')
  const snapshotMaxBytes = positiveInteger(config.snapshotMaxBytes ?? DEFAULT_SNAPSHOT_MAX_BYTES, 'snapshotMaxBytes')
  if (config.enabled === false) return

  ctx.systemPrompt.section({
    name: 'tool:read',
    order: ctx.systemPrompt.getSectionOrder('TOOL_READ'),
    text: ({ scope }) => ctx.tools.get('read', scope) === undefined ? '' : 'Use the read tool — not shell commands like cat — to inspect text files. Use offset and limit to continue reading large files.',
  })

  ctx.tools.register(defineTool({
    name: 'read',
    description: 'Read a UTF-8 text file and return line-numbered content with a hashline tag.',
    parameters: {
      file_path: { type: 'string', required: true },
      offset: { type: 'number' },
      limit: { type: 'number' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          tag: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          tagged: { type: 'boolean', required: true },
          offset: { type: 'integer', required: true },
          lines: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { number: { type: 'integer', required: true }, text: { type: 'string', required: true } } } },
          totalLines: { type: 'integer', required: true },
          nextAction: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
        },
      },
      render: (_args, value) => {
        const header = value.tagged && value.tag ? `${formatHashlineHeader(value.path, value.tag)}\n` : ''
        const body = value.nextAction ? `${value.nextAction}\n\n${value._body}` : value._body
        return [{ type: 'text', text: `<path>${value.path}</path>\n<type>file</type>\n<content>\n${header}${body}\n</content>` }]
      },
      presentationMeta: (_args, value) => ({ path: value.path, offset: value.offset, lines: value.lines, totalLines: value.totalLines }),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!args.file_path.trim()) throw new Error('file_path must be a non-empty string')
      const offset = args.offset === undefined ? 1 : positiveInteger(args.offset, 'offset')
      const requestedLimit = args.limit === undefined ? limit : positiveInteger(args.limit, 'limit')
      if (requestedLimit > limit) throw new Error(`limit must be less than or equal to ${limit}`)
      const cwd = toolCwdFromExec(exec)
      const target = await ctx.fs.resolve(args.file_path, { cwd, signal: exec.signal })
      const info = await ctx.fs.stat(target, exec.signal)
      if (!info) {
        ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
        throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
      }
      if (info.type !== 'file') throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      const raw = await ctx.fs.readText(target, exec.signal)
      const normalized = normalizeToLF(stripBom(raw).text)
      const win = windowText(normalized, offset, requestedLimit, maxLineLength, maxBytes)
      const showPath = ctx.fs.processPath(target)
      const session = exec.agent?.session
      const tagged = normalized.length > 0 && Buffer.byteLength(normalized, 'utf8') < snapshotMaxBytes && session !== undefined
      let tag: string | null = null
      if (tagged) {
        tag = computeFileHash(normalized)
        const store = getSessionSnapshotStore(session)
        const seen = win.lines.filter(line => line.complete).map(line => line.number)
        const cwdKey = path.resolve(cwd, args.file_path)
        const showKey = path.resolve(cwd, showPath)
        store.record(cwdKey, normalized, seen.length ? seen : [0])
        if (showKey !== cwdKey) store.record(showKey, normalized, seen.length ? seen : [0])
      }
      let nextAction: string | null = null
      if (!session) nextAction = 'This read has no agent session, so its tag cannot be shared with edit. Use replace or patch mode.'
      else if (!normalized.length) nextAction = 'This file is empty and has no hashline tag. Use write to create its contents.'
      else if (Buffer.byteLength(normalized, 'utf8') >= snapshotMaxBytes) nextAction = 'This file is too large for a hashline snapshot. Use explicit replace or patch mode.'
      else if (win.lines.some(line => !line.complete)) nextAction = `Some lines were truncated. Increase maxLineLength${win.byteCapped ? ' and maxBytes' : ''}, remount, and read again, or use replace/patch mode.`
      else if (win.byteCapped && win.lines.length === 0) nextAction = 'The output byte limit is too small for the next line. Increase maxBytes, remount, and read again.'
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      return { path: showPath, tag, tagged, offset, lines: win.lines.map(({ number, text }) => ({ number, text })), totalLines: win.totalLines, nextAction, _body: win.body }
    },
    presentResult(_args, result: ToolResult): ReadResultView | undefined {
      if (result.isError) return undefined
      const meta = result.meta as { path: string; offset: number; lines: { number: number; text: string }[]; totalLines: number } | undefined
      const text = result.content.length === 1 && result.content[0]?.type === 'text' ? result.content[0].text : undefined
      const body = text && /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(text)?.[1]
      if (!meta || body === undefined) return undefined
      return { card: 'read', path: meta.path, offset: meta.offset, lines: meta.lines, totalLines: meta.totalLines, content: [{ type: 'text', text: body }] }
    },
    presentCall(args): GenericCallView { return { card: 'generic', title: `Read ${args.file_path}`, kind: 'read', locations: [{ path: args.file_path, line: args.offset ?? 1 }] } },
  }))
}
