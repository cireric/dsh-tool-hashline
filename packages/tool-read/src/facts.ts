/**
 * The internal read fact a degradation can cite (SRS FR-03 / plan D3).
 *
 * A read that cannot mint a tag still knows facts the model cannot prove: the
 * effective caps, the normalized byte count, the observed version, and the
 * window it actually returned. Those facts are published on a context event and
 * are NOT part of the canonical value: the read's schema stays exactly as the
 * base spec defines it, and a program still reads the citation out of
 * `nextAction`.
 *
 * The event is a contract with the policy module, which imports nothing from
 * this package (it must run from a packed install with Node builtins only). The
 * policy therefore re-validates every field it uses instead of trusting it.
 *
 * A fact is provisional until the registry reports a SUCCESSFUL `tools/result`
 * for the same call: a failed, cancelled, or output-invalid read never becomes
 * evidence.
 * @module @dsh-tool-hashline/tool-read/facts
 */

/** The context event name carrying one provisional read fact. */
export const READ_FACT_EVENT = 'tool-read/read-fact'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One provisional read fact, published before the read's result settles.
     *
     * A listener must pair it with the `tools/result` outcome for the same
     * `callId` and keep it only when that outcome is a success: a failed,
     * cancelled, or output-invalid read is not evidence.
     * @mode emit
     */
    'tool-read/read-fact'(fact: ReadFact, actor: object | undefined): void
  }
}

/** The window one read actually returned, described by its own outcome. */
export interface ReadFactWindow {
  /** 1-based first line requested. */
  offset: number
  /** How many lines were returned. */
  returnedLines: number
  /** How many of them are whole file lines (usable as seen evidence). */
  completeLines: number
  /** Whether any returned line was column-truncated. */
  truncatedLines: boolean
  /** Whether the window stopped on the output byte cap. */
  byteCapped: boolean
  /** Whether the window returned no line at all. */
  zeroLines: boolean
  /**
   * File line numbers that were COLUMN-TRUNCATED in this window.
   *
   * These are the lines whose returned text is not the file's text. A
   * degradation must name at least one of them: a target whose anchors were
   * fully returned is editable with Hashline and needs no fallback.
   */
  truncatedLineNumbers: number[]
  /**
   * The first file line this window returned NO text for, or `null`.
   *
   * The byte cap stops the window at one line, so every later line of the file is
   * omitted: one start line describes the whole omission, and a huge file cannot
   * turn this fact into an array of millions of numbers.
   */
  omittedFrom: number | null
}

/** Everything a degraded edit may cite about one read, and nothing more. */
export interface ReadFact {
  /** The read call this fact belongs to; this is the citation's identity. */
  callId: string
  /** Root model-requested call, for pairing a nested dispatch. */
  rootCallId: string
  /** The owning Session object (identity, not an id). */
  session: object
  /** The effective working directory used for resolution and keys. */
  cwd: string
  /** Provider identity key of the resolved target. */
  targetKey: string
  /** Model-facing path the read resolved. */
  displayPath: string
  /** Every snapshot store key this read recorded. */
  keys: string[]
  /** Provider version observed by the single stat. */
  version: string
  /** Normalized (BOM-stripped, LF) text size in UTF-8 bytes. */
  bytes: number
  /** Whether the normalized text is empty. */
  empty: boolean
  /** Exact file line count. */
  totalLines: number
  /** The caps this read actually applied. */
  caps: {
    limit: number
    maxLineLength: number
    maxBytes: number
    snapshotMaxBytes: number
  }
  /** What the window returned. */
  window: ReadFactWindow
  /** Whether a tag was minted for this read. */
  tagged: boolean
}
