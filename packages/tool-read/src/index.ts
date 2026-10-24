/**
 * A complete `read` tool that mints a hashline tag into its canonical value.
 *
 * The stock read tool's output schema is closed, so a tag cannot be injected
 * through `tools/post-execute`; under PTC the model's program only receives
 * `value`. This plugin therefore registers `read` itself (with stock
 * `tool-fs.read` turned off by the preset) and keeps the stock window, footer,
 * envelope, system-prompt guidance, and read-card projection.
 * @module @dsh-tool-hashline/tool-read
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ReadResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import { FsError } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-working-directory'
import { computeFileHash, formatHashlineHeader, getSessionSnapshotStore, normalizeToLF, stripBom } from '@dsh-tool-hashline/hashline'
import { resolveConfig, type Config, type ResolvedConfig } from './config.ts'
import type { ReadFact } from './facts.ts'
import { READ_FACT_EVENT } from './facts.ts'
import { nextActionFor } from './next-action.ts'
import { readLangHint } from './lang.ts'
import { byteCappedFromValue, readBody, readMetaFromMeta, renderEnvelope } from './render.ts'
import { snapshotKeys } from './session.ts'
import { buildReadWindow, parseReadArgs } from './window.ts'

export const name = 'tool-read-hashline'
export const inject = ['tools', 'fs', 'systemPrompt', 'workingDirectory'] as const
export type { Config }

/** The tool's canonical `value`: everything a PTC program can consume. */
export interface ReadValue {
  /** Model-facing canonical path (`ctx.fs.processPath`). */
  path: string
  /** 4-hex content tag, or `null` when this read could not mint one. */
  tag: string | null
  /** Whether `tag` is present and usable by the edit tool. */
  tagged: boolean
  /** 1-based first line requested (kept even for an empty window). */
  offset: number
  /** Returned window lines, numbered by file line. */
  lines: { number: number; text: string }[]
  /** Exact file line count. */
  totalLines: number
  /** Actionable guidance when the read is not directly editable, else `null`. */
  nextAction: string | null
}

/**
 * The `limit` a replayed call should be rendered with.
 *
 * Presentation may run on replay of arbitrary logged args (possibly from an
 * older schema), so this is total: anything that is not a positive integer no
 * larger than the deployment cap falls back to the cap instead of throwing.
 * @param args - raw call arguments (unknown on replay).
 * @param fallback - the configured line cap.
 * @returns a positive integer limit.
 */
function renderLimit(args: unknown, fallback: number): number {
  const candidate = typeof args === 'object' && args !== null ? (args as { limit?: unknown }).limit : undefined
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0 && candidate <= fallback ? candidate : fallback
}

/** Stock's system-prompt guidance for `read`, verbatim. */
const READ_PROMPT = 'Use the read tool \u2014 not shell commands like cat \u2014 to inspect text files. Use offset and limit to continue reading large files.'

/**
 * Register `read` plus its scope-aware prompt section.
 * @param ctx - plugin context providing `tools`, `fs`, and `systemPrompt`.
 * @param config - authored plugin config; invalid numbers fail the mount.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const caps: ResolvedConfig = resolveConfig(config)
  if (!caps.enabled) return

  ctx.tools.register(defineTool({
    name: 'read',
    description: 'Read a UTF-8 text file and return line-numbered content with a hashline tag.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to read, resolved by the filesystem backend.' },
      offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
      limit: { type: 'number', description: `Maximum number of lines to return. Defaults to ${caps.limit}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true, description: 'Canonical absolute path in the filesystem execution world.' },
          tag: {
            oneOf: [{ type: 'string' }, { type: 'null' }],
            required: true,
            description: '4-hex hashline content tag, or null when this read could not mint one.',
          },
          tagged: { type: 'boolean', required: true, description: 'Whether tag is present and usable by edit.' },
          offset: { type: 'integer', required: true },
          lines: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                number: { type: 'integer', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
          totalLines: { type: 'integer', required: true },
          nextAction: {
            oneOf: [{ type: 'string' }, { type: 'null' }],
            required: true,
            description: 'Actionable guidance when this read is not directly editable, else null.',
          },
        },
      },
      render: (args, value) => {
        const truncatedByBytes = byteCappedFromValue(value, renderLimit(args, caps.limit))
        const body = readBody({ offset: value.offset, lines: value.lines, totalLines: value.totalLines, truncatedByBytes })
        const header = value.tagged && value.tag !== null ? `${formatHashlineHeader(value.path, value.tag)}\n` : ''
        const guidance = value.nextAction === null ? '' : `\n\n${value.nextAction}`
        return [{ type: 'text', text: renderEnvelope(value.path, `${header}${body}${guidance}`) }]
      },
      // The raw canonical value is not on the wire, so the card's line window must
      // be persisted as metadata for live and replayed sessions alike.
      presentationMeta: (_args, value) => {
        const lang = readLangHint(value.path)
        return {
          path: value.path,
          offset: value.offset,
          lines: value.lines.map(({ number, text }) => ({ number, text })),
          totalLines: value.totalLines,
          ...lang === undefined ? {} : { lang },
        }
      },
    },
    // Reading races fail closed: a later guarded mutation re-checks the version.
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<ReadValue> {
      const input = parseReadArgs(args, caps.limit)
      // One directory for the whole call: the Session's effective working
      // directory (origin + any `working-directory/change`, with the host's
      // existence recovery). The path resolution and every snapshot key below
      // use this same value, and the patched edit tool reads the same owner, so
      // an edit of the same file cannot miss the read's key. No Agent keeps the
      // explicit agentless fallback.
      const cwd = exec.agent === undefined ? process.cwd() : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      // Exactly one resolve + one stat per call: absence, regular-file check, and
      // the observed version all come from this single observation.
      const target = await ctx.fs.resolve(input.filePath, { cwd, signal: exec.signal })
      const info = await ctx.fs.stat(target, exec.signal)
      if (info === undefined) {
        ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
        throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
      }
      if (info.type !== 'file') {
        throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      // Exactly one whole-text read; provider errors (permission, binary, abort)
      // propagate with their original code instead of being swallowed.
      const raw = await ctx.fs.readText(target, exec.signal)
      const normalized = normalizeToLF(stripBom(raw).text)
      const window = buildReadWindow(
        normalized,
        { offset: input.offset, limit: input.limit, maxLineLength: caps.maxLineLength, maxBytes: caps.maxBytes },
        target.displayPath,
      )
      const showPath = ctx.fs.processPath(target)
      // One key computation for the whole call: the snapshot record and the fact
      // published below must describe the same keys, never two derivations.
      const keys = snapshotKeys(cwd, input.filePath, showPath)
      const session = exec.agent?.session
      const empty = normalized.length === 0
      const bytes = Buffer.byteLength(normalized, 'utf8')
      const exceedsSnapshotLimit = !empty && bytes >= caps.snapshotMaxBytes
      let tag: string | null = null
      if (session !== undefined && !empty && !exceedsSnapshotLimit) {
        tag = computeFileHash(normalized)
        // Only fully displayed lines count as seen; a byte-capped window with no
        // complete line keeps the guard armed through the [0] sentinel (the
        // engine treats an empty set as "guard off"). Repeated reads of the same
        // text union through the engine, so this code never merges sets itself.
        const complete = window.lines.filter(line => line.complete).map(line => line.number)
        const seen = complete.length > 0 ? complete : [0]
        const store = getSessionSnapshotStore(session)
        for (const key of keys) store.record(key, normalized, seen)
      }
      const completeLines = window.lines.filter(line => line.complete).length
      const nextAction = nextActionFor({
        hasSession: session !== undefined,
        empty,
        exceedsSnapshotLimit,
        truncatedLines: window.lines.some(line => !line.complete),
        byteCapped: window.truncatedByBytes,
        zeroLines: window.lines.length === 0,
        snapshotMaxBytes: caps.snapshotMaxBytes,
        maxLineLength: caps.maxLineLength,
        maxBytes: caps.maxBytes,
        // The citation a program can hand back in an edit's `fallbacks`. It is
        // this call's own registry id, so the policy can look the fact up rather
        // than trusting a model-authored byte count.
        readCallId: session === undefined || empty ? null : exec.callId,
      })
      // The provisional fact is published BEFORE the result settles; the registry
      // reports the authoritative outcome afterwards, and only a SUCCESSFUL one
      // (see the `tools/result` listener below) promotes it to usable evidence.
      const fact: ReadFact = {
        callId: exec.callId,
        rootCallId: exec.rootCallId,
        // Only a session-owned read can be cited; the caller checked that above.
        session: session as object,
        cwd,
        targetKey: target.targetKey,
        displayPath: target.displayPath,
        keys,
        version: info.version,
        bytes,
        empty,
        totalLines: window.totalLines,
        caps: {
          limit: caps.limit,
          maxLineLength: caps.maxLineLength,
          maxBytes: caps.maxBytes,
          snapshotMaxBytes: caps.snapshotMaxBytes,
        },
        window: {
          offset: input.offset,
          returnedLines: window.lines.length,
          completeLines,
          truncatedLines: window.lines.some(line => !line.complete),
          byteCapped: window.truncatedByBytes,
          zeroLines: window.lines.length === 0,
        },
        tagged: tag !== null,
      }
      ctx.emit(READ_FACT_EVENT, fact, exec)
      // Observation is recorded after the read succeeded; the version is the
      // single stat's, so a guarded stock write can consume it.
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
      return {
        path: showPath,
        tag,
        tagged: tag !== null,
        offset: input.offset,
        lines: window.lines.map(({ number, text }) => ({ number, text })),
        totalLines: window.totalLines,
        nextAction,
      }
    },
    presentResult(_args, result: ToolResult): ReadResultView | undefined {
      if (result.isError) return undefined
      const meta = readMetaFromMeta(result.meta)
      if (meta === undefined) return undefined
      const only = result.content.length === 1 ? result.content[0] : undefined
      const text = only?.type === 'text' ? only.text : undefined
      if (text === undefined) return undefined
      const body = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(text)?.[1]
      if (body === undefined) return undefined
      return {
        card: 'read',
        path: meta.path,
        offset: meta.offset,
        lines: meta.lines,
        totalLines: meta.totalLines,
        ...meta.lang === undefined ? {} : { lang: meta.lang },
        content: [{ type: 'text', text: body }],
      }
    },
    presentCall(args): GenericCallView {
      const offset = args.offset ?? 1
      const window = args.limit !== undefined && args.limit > 0
        ? ` (${offset} - ${offset + args.limit - 1})`
        : args.offset === undefined ? '' : ` (from line ${offset})`
      return {
        card: 'generic',
        title: `Read ${args.file_path}${window}`,
        kind: 'read',
        locations: [{ path: args.file_path, line: offset }],
      }
    },
  }))

  // Registered after the tool so a second `read` provider fails on the duplicate
  // tool name (the deployment-shape error) instead of on this prompt section.
  ctx.systemPrompt.section({
    name: 'tool:read',
    order: ctx.systemPrompt.getSectionOrder('TOOL_READ'),
    text: ({ scope }) => ctx.tools.get('read', scope) === undefined ? '' : READ_PROMPT,
  })
}
