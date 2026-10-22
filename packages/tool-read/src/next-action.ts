/**
 * The canonical `nextAction` guidance for every read that cannot be satisfied by
 * a follow-up `edit` with the same tag.
 *
 * The guidance lives in the tool's canonical `value`, not only in rendered text:
 * under PTC the model's program reads `value`, and the session log never re-enters
 * the model's context.
 * @module @dsh-tool-hashline/tool-read/next-action
 */

/** Why one read did not produce a plain, fully editable window. */
export interface NextActionInput {
  /** Whether the call has an agent session (only a session-owned snapshot is shareable). */
  hasSession: boolean
  /** Whether the normalized text is empty. */
  empty: boolean
  /** Whether the normalized UTF-8 text reached the snapshot byte ceiling. */
  exceedsSnapshotLimit: boolean
  /** Whether at least one returned line was column-truncated. */
  truncatedLines: boolean
  /** Whether the window stopped on the output byte cap. */
  byteCapped: boolean
  /** Whether the window returned no line at all. */
  zeroLines: boolean
  /** Configured snapshot ceiling, for the message. */
  snapshotMaxBytes: number
  /** Configured column cap, for the message. */
  maxLineLength: number
  /** Configured window byte cap, for the message. */
  maxBytes: number
}

/**
 * Decide the one actionable sentence (or `null` for a complete window).
 *
 * Reasons are ordered from "no tag at all" to "window-only degradation" so the
 * model is told the reason that actually decides whether `edit` can accept a tag.
 * A truncated window never claims that re-reading with the same config reveals
 * the rest of a long line.
 * @param input - the read outcome facts.
 * @returns guidance text, or `null` when the window is complete and tagged.
 */
export function nextActionFor(input: NextActionInput): string | null {
  if (!input.hasSession) {
    return 'This read has no agent session, so it cannot share a hashline snapshot and no tag was minted. Use the edit tool\'s replace mode (path + old_string + new_string) or patch mode (path + edits) instead.'
  }
  if (input.empty) {
    return 'This file is empty, so there is no hashline content to tag. Use the write tool to create its contents.'
  }
  if (input.exceedsSnapshotLimit) {
    return `This file\'s normalized text is ${input.snapshotMaxBytes} bytes or more, so it was not snapshotted and no tag was minted. Use the edit tool\'s replace or patch mode instead.`
  }
  if (input.truncatedLines) {
    return `Some returned lines were column-truncated at ${input.maxLineLength} characters, so they are not usable as seen lines. Raise maxLineLength${input.byteCapped ? ' and maxBytes' : ''} in the tool-read config, remount, then read again; or use the edit tool\'s replace or patch mode. Repeating this read with the same config will not reveal the rest of those lines.`
  }
  if (input.zeroLines && input.byteCapped) {
    return `The output byte cap (${input.maxBytes}) is smaller than the next displayed line, so this window returned no lines. Raise maxBytes (and maxLineLength if lines are also truncated) in the tool-read config, remount, then read again at the same offset; or use the edit tool\'s replace or patch mode.`
  }
  return null
}
