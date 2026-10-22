/**
 * Pure read-window construction, byte-for-byte compatible with the host's
 * `buildWindow` / `formatReadOutput` in `@deepseek-ai/dsh-tool-fs` (mirrored, not
 * imported: this package must not compose the host read pipeline).
 *
 * The window consumes one already-normalized (BOM-stripped, LF) text and reports
 * which returned lines are *complete* — the only lines a snapshot may mark as
 * seen. A column-truncated line is displayed but never offered as content
 * evidence.
 * @module @dsh-tool-hashline/tool-read/window
 */

import { FsError } from '@deepseek-ai/dsh-fs'

/** One returned line: display text plus whether the file line fits the column cap. */
export interface WindowLine {
  /** 1-based file line number. */
  number: number
  /** Rendered text (column-truncated when `complete` is false). */
  text: string
  /** Whether `text` is the whole file line (not a column-truncated prefix). */
  complete: boolean
}

/** Resolved window request; the caller applies config defaults first. */
export interface WindowRequest {
  /** 1-based first line to return. */
  offset: number
  /** Maximum number of lines to return. */
  limit: number
  /** Maximum characters returned for a single line. */
  maxLineLength: number
  /** Maximum bytes of selected output. */
  maxBytes: number
}

/** One built window. */
export interface ReadWindow {
  /** Returned lines, already numbered. */
  lines: WindowLine[]
  /** Exact total line count of the file. */
  totalLines: number
  /** Whether selected output hit the byte cap before the window filled. */
  truncatedByBytes: boolean
}

/** The stock column-truncation suffix. */
export function truncationSuffix(maxLineLength: number): string {
  return `... (line truncated to ${maxLineLength} chars)`
}

/**
 * Split normalized text into addressable file lines.
 *
 * A trailing newline terminates the last line rather than opening an empty one,
 * and an empty file has zero lines — the same count the host renders.
 * @param text - normalized (LF) file text.
 * @returns the file's lines without their trailing newlines.
 */
export function splitFileLines(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * Build one bounded window and report column/byte truncation.
 *
 * Column truncation happens before byte accounting, so a single huge line costs
 * at most its truncated width. A line that does not fit the remaining byte
 * budget stops the window: it and every following line are omitted, while the
 * total line count still reflects the whole file. An offset past EOF raises
 * `FS_NOT_FOUND` with the host's message — except when the window was already
 * byte-capped, which the host also tolerates.
 * @param text - normalized (LF) file text.
 * @param request - resolved window request.
 * @param displayPath - path rendered in the out-of-range error.
 * @returns the numbered window, the total line count, and the byte-cap flag.
 */
export function buildReadWindow(text: string, request: WindowRequest, displayPath: string): ReadWindow {
  const all = splitFileLines(text)
  const totalLines = all.length
  const lines: WindowLine[] = []
  let outputBytes = 0
  let truncatedByBytes = false
  for (let index = 0; index < totalLines; index += 1) {
    const number = index + 1
    if (truncatedByBytes || number < request.offset || lines.length >= request.limit) continue
    const raw = all[index] ?? ''
    const complete = raw.length <= request.maxLineLength
    const rendered = complete ? raw : `${raw.slice(0, request.maxLineLength)}${truncationSuffix(request.maxLineLength)}`
    const bytes = Buffer.byteLength(rendered, 'utf8') + (lines.length > 0 ? 1 : 0)
    if (outputBytes + bytes > request.maxBytes) {
      truncatedByBytes = true
      continue
    }
    outputBytes += bytes
    lines.push({ number, text: rendered, complete })
  }
  if (!truncatedByBytes && request.offset > totalLines && !(totalLines === 0 && request.offset === 1)) {
    throw new FsError(`offset ${request.offset} is out of range for "${displayPath}" (${totalLines} lines)`, 'FS_NOT_FOUND')
  }
  return { lines, totalLines, truncatedByBytes }
}

/** Validated `read` arguments after defaulting. */
export interface ReadInput {
  filePath: string
  offset: number
  limit: number
}

function parsePositiveInteger(value: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

/**
 * Validate the model-supplied arguments against the deployment line cap.
 * @param args - schema-validated raw arguments.
 * @param maxLimit - configured default and maximum `limit`.
 * @returns the arguments with `offset`/`limit` defaulted.
 */
export function parseReadArgs(args: { file_path: string; offset?: number; limit?: number }, maxLimit: number): ReadInput {
  if (typeof args.file_path !== 'string' || args.file_path.trim().length === 0) {
    throw new Error('file_path must be a non-empty string')
  }
  const offset = args.offset === undefined ? 1 : parsePositiveInteger(args.offset, 'offset')
  const limit = args.limit === undefined ? maxLimit : parsePositiveInteger(args.limit, 'limit')
  if (limit > maxLimit) throw new Error(`limit must be less than or equal to ${maxLimit}`)
  return { filePath: args.file_path, offset, limit }
}
