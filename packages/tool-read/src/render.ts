/**
 * Model-facing rendering and replay-safe metadata narrowing for the read window.
 *
 * The envelope keeps the host's `<path>/<type>/<content>` shape so stock
 * `presentResult` parsing (and the Web read card) keep working; the hashline
 * header is inserted as the first line *inside* `<content>`.
 * @module @dsh-tool-hashline/tool-read/render
 */

import type { WindowLine } from './window.ts'

/** Anything renderable as a read window: canonical value or a replay projection. */
export interface RenderableWindow {
  offset: number
  lines: readonly { number: number; text: string }[]
  totalLines: number
  truncatedByBytes: boolean
}

/** Persisted read-card metadata (`tool/result.meta`), JSON-serializable for replay. */
export interface ReadMeta {
  path: string
  offset: number
  lines: { number: number; text: string }[]
  totalLines: number
  lang?: string
}

/**
 * Format the host-compatible footer.
 * @param window - the window to describe.
 * @returns the capped, partial, or end-of-file footer.
 */
export function readFooter(window: RenderableWindow): string {
  const endLine = window.lines.at(-1)?.number ?? Math.max(0, window.offset - 1)
  if (window.truncatedByBytes) {
    return `(Output capped. Showing lines ${window.offset}-${endLine}. Use offset=${endLine + 1} to continue.)`
  }
  if (endLine < window.totalLines) {
    return `(Showing lines ${window.offset}-${endLine} of ${window.totalLines}. Use offset=${endLine + 1} to continue.)`
  }
  return `(End of file - total ${window.totalLines} lines)`
}

/**
 * Render the numbered window body: lines, a blank separator, then the footer.
 * @param window - the window to render.
 * @returns the body text (no envelope, no tag header).
 */
export function readBody(window: RenderableWindow): string {
  const footer = readFooter(window)
  if (window.lines.length === 0) return footer
  return `${window.lines.map(line => `${line.number}: ${line.text}`).join('\n')}\n\n${footer}`
}

/**
 * Wrap a body in the host's read envelope.
 * @param displayPath - the model-facing path.
 * @param body - the numbered window plus footer.
 * @returns the complete model-facing tool content.
 */
export function renderEnvelope(displayPath: string, body: string): string {
  return `<path>${displayPath}</path>\n<type>file</type>\n<content>\n${body}\n</content>`
}

/**
 * Rebuild the byte-cap flag the host's renderer infers from a returned value.
 *
 * The canonical value carries no such flag (it is presentation state), so the
 * renderer re-derives it exactly like stock: a window that returned fewer lines
 * than requested and stopped before EOF hit the byte cap.
 * @param window - value lines plus totals.
 * @param requestedLimit - the resolved `limit` for this call.
 * @returns whether the window was byte-capped.
 */
export function byteCappedFromValue(window: Omit<RenderableWindow, 'truncatedByBytes'>, requestedLimit: number): boolean {
  const endLine = window.lines.at(-1)?.number ?? Math.max(0, window.offset - 1)
  return window.lines.length < requestedLimit && endLine < window.totalLines
}

/** Whether `value` is a valid replay line: integer, 1-based, non-empty text. */
function isReplayLine(value: unknown): value is { number: number; text: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { number, text } = value as Record<string, unknown>
  return typeof number === 'number' && Number.isInteger(number) && number >= 1 && typeof text === 'string'
}

/**
 * Narrow opaque (possibly replayed) `meta` to a read card.
 *
 * Malformed metadata, or metadata whose window is semantically impossible,
 * returns `undefined` so presentation falls back to a generic card instead of
 * throwing while replaying an old session.
 * @param meta - opaque result metadata.
 * @returns the validated read card data, or `undefined`.
 */
export function readMetaFromMeta(meta: unknown): ReadMeta | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { path, offset, lines, totalLines, lang } = meta as Record<string, unknown>
  if (typeof path !== 'string' || typeof offset !== 'number' || typeof totalLines !== 'number') return undefined
  if (!Number.isInteger(offset) || offset < 1) return undefined
  if (!Number.isInteger(totalLines) || totalLines < 0) return undefined
  if (!Array.isArray(lines) || !lines.every(isReplayLine)) return undefined
  if (lang !== undefined && typeof lang !== 'string') return undefined
  let previous = offset - 1
  for (const line of lines) {
    if (line.number <= previous || line.number > totalLines) return undefined
    previous = line.number
  }
  return { path, offset, lines: lines.map(line => ({ number: line.number, text: line.text })), totalLines, ...lang === undefined ? {} : { lang } }
}

/** Re-export the window line shape for consumers of this module. */
export type { WindowLine }
