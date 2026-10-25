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
  /**
   * This read's own call id, printed as a citation a program can hand back.
   *
   * A degraded edit must cite the read it relies on; the policy verifies that
   * read instead of trusting a model-authored byte count. `null` when the
   * reason does not need a citation (empty file, session-less read).
   */
  readCallId: string | null
}

/**
 * The stable citation a policy can parse out of the guidance.
 *
 * One spelling only: a program that copies the guidance verbatim hands back a
 * token the policy recognizes, and the model never has to invent a byte count.
 * @param callId - the read call this guidance belongs to.
 * @returns the bracketed citation, or '' when there is nothing to cite.
 */
export function readCallCitation(callId: string | null): string {
  return callId === null ? '' : ` (readCallId: ${callId})`
}

/**
 * Decide the one actionable sentence (or `null` for a complete window).
 *
 * Reasons are ordered from "no tag at all" to "window-only degradation" so the
 * model is told the reason that actually decides whether `edit` can accept a tag.
 * A truncated window never claims that re-reading with the same config reveals
 * the rest of a long line.
 * @param input - the read outcome facts.
 * @param policyGuidance - opt in only where the default-edit policy is mounted.
 * @returns guidance text, or `null` when the window is complete and tagged.
 */
export function nextActionFor(input: NextActionInput, policyGuidance = false): string | null {
  if (!input.hasSession) {
    if (policyGuidance) return 'This read has no agent session, so no tag was minted and the managed editor cannot verify its context. Stop and establish the editing session, then read the target again. Missing session context does not authorize a fallback.'
    return 'This read has no agent session, so it cannot share a hashline snapshot and no tag was minted. Use the edit tool\'s replace mode (path + old_string + new_string) or patch mode (path + edits) instead.'
  }
  if (input.empty) {
    return 'This file is empty, so there is no hashline content to tag. Use the write tool to create its contents.'
  }
  if (input.exceedsSnapshotLimit) {
    const prefix = `This file's normalized text is ${input.snapshotMaxBytes} bytes or more, so it was not snapshotted and no tag was minted.`
    if (policyGuidance) return `${prefix} A "snapshot-limit" fallback for this target requires complete original content from an authorized source, unique target identification and the required text/byte preservation${readCallCitation(input.readCallId)}. Only then may replace or patch be used. Stop if these conditions cannot be verified.`
    return `${prefix} Use the edit tool's replace or patch mode instead.`
  }
  if (input.truncatedLines) {
    const prefix = `Some returned lines were column-truncated at ${input.maxLineLength} characters, so they are not usable as seen lines.`
    if (policyGuidance) return `${prefix} Page with offset/limit when that can supply complete target anchors and context. Only a target range that cannot be completed this way can use a "window-limit" fallback; it also requires complete original content from an authorized source and the required text/byte preservation${readCallCitation(input.readCallId)}. Declare only the affected ranges. Repeating this read will not reveal the rest of those lines. Stop if sufficient content cannot be obtained; do not change tool configuration.`
    return `${prefix} Raise maxLineLength${input.byteCapped ? ' and maxBytes' : ''} in the tool-read config, remount, then read again; or use the edit tool's replace or patch mode. Repeating this read with the same config will not reveal the rest of those lines.`
  }
  if (input.zeroLines && input.byteCapped) {
    const prefix = `The output byte cap (${input.maxBytes}) is smaller than the next displayed line, so this window returned no lines.`
    if (policyGuidance) return `${prefix} No complete anchor was returned. A "window-limit" fallback is limited to target ranges that offset/limit cannot complete and requires complete original content from an authorized source and the required text/byte preservation${readCallCitation(input.readCallId)}. Declare only the affected ranges. Stop if sufficient content cannot be obtained; repeating this window does not help and does not authorize changing tool configuration.`
    return `${prefix} Raise maxBytes (and maxLineLength if lines are also truncated) in the tool-read config, remount, then read again at the same offset; or use the edit tool's replace or patch mode.`
  }
  return null
}
