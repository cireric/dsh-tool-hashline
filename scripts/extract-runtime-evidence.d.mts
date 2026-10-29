/** Type surface for the read-only evidence extractor (scripts/extract-runtime-evidence.mjs). */

export interface ZstdFrameRange { start: number; end: number }

export function scanZstdFrames(buffer: Buffer): { frames: ZstdFrameRange[]; tornStart?: number }

export function decodeArtifact(buffer: Buffer): { format: string; text: string; frames: number; tornStart?: number }

export function parseRecords(text: string): { records: Record<string, unknown>[]; failures: { line: number; message: string }[] }

export function messageText(message: unknown): string

export function judgeFirstLine(firstLine: string | undefined): 'valid' | 'invalid' | 'missing' | 'no-text'

export function validateBounds(seqMin?: number, seqMax?: number): { min: number; max: number } | undefined

export interface ExtractOptions {
  /** Task manifest entries for the additive tool-path judgement (see `--tasks`). */
  tasks?: readonly { id?: string; kind?: string; targets?: readonly string[] }[];
  sourcePath: string
  sessionId: string
  seqMin?: number
  seqMax?: number
  extractedAt: string
  bytes: number
  buffer: Buffer
  text: string
  format: string
  frames: number
  tornStart?: number
}

export interface ExtractedReport {
  tool: string
  version: number
  range: {
    requested: { min: number; max: number } | null
    effective: { min: number; max: number } | null
    available: { first: number | null; last: number | null }
    recordsInRange: number
    covered: boolean
  }
  /** Per-request cost ledger derived from the same range; counts and token totals only. */
  accounting: {
    totals: {
      requests: number
      repairs: number
      attempts: number
      inputTokens: number
      outputTokens: number
      usageUnknown: number
      unsettledQuestions: number
      failedTurns: number
    }
    requests: {
      index: number
      repairs: number
      accepted: number
      questions: number
      unsettledQuestions: number
      stages: Record<string, { attempts: number; published: number; inputTokens: number; outputTokens: number; usageUnknown: number }>
      outcomes: string[]
    }[]
  }
  /** Per-task tool-path judgement, reduced to ids and counts; `null` when no tasks were given. */
  /** What each finished policy-owned turn SHOULD look like in the web client (P3 route 1). */
  presentation: {
    rule: { recoveryCodes: string[] }
    totals: { turns: number; recovering: number; failure: number }
    turns: { turn: number | null; seq: number; code: string; presentedAs: 'recovering' | 'failure'; reason: string; announcedAtSeq?: number }[]
    note: string
  }
  toolPath: null | {
    incomplete: boolean
    tasks: {
      taskId: string
      kind: string
      verdict: string
      readTargets: number
      editTargets: number
      writeTargets: number
      shellTargets: number
      provenBypass: { reason: string; target: string }[]
      candidates: { signal: string; mentionsTarget: boolean }[]
      gaps: string[]
      unknowns: string[]
    }[]
    summary: string[]
  }
  evidence: {
    status: 'complete' | 'incomplete'
    issues: string[]
    assistantMessages: { index: number; seq: number; turn?: number; firstLine: string; gate: string }[]
    behaviorCalls: {
      via: 'ptc' | 'direct'
      callId?: string
      state: 'completed' | 'started' | 'denied' | 'settled-without-start'
      seq: number
      startSeq?: number
      doneSeq?: number
      turn?: number
      name: string
      rootCallId?: string
      carrierSeq?: number
      carrierFirstLine?: string
      carrierGate: string
      turnGate: string
    }[]
    denials: { seq: number; type: string; callId?: string; rootCallId?: string; reasonFirstLine: string }[]
    tally: Record<'valid' | 'invalid' | 'missing' | 'no-text' | 'unassociated', number>
    states: Record<'completed' | 'started' | 'denied' | 'settled-without-start', number>
    turnTally: Record<'valid' | 'invalid' | 'missing' | 'no-text' | 'unassociated', number>
    perTurn: {
      turn: number
      firstBehavior: { seq: number; name: string; via: string; state: string } | null
      carrierSeq: number | null
      carrierFirstLine: string | null
      carrierGate: string
      turnGate: string
    }[]
    userMessages: { seq: number; firstLine: string }[]
    note: string
  }
  records: { total: number; parsed: number; failures: { line: number; message: string }[] }
  source: { path: string; bytes: number; sha256: string; format: string; frames: number; tornStart?: number }
  session: Record<string, unknown>
}

export function extractSession(options: ExtractOptions): ExtractedReport

export function main(argv: string[]): Promise<number>
