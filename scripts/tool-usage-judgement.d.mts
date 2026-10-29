/**
 * Types for the per-task tool-path judgement (tool-routing plan T2).
 * The module itself is plain ESM shipped inside the bundle, so the declaration lives beside
 * it — the same arrangement the other `scripts/*.mjs` helpers use.
 */

export type TaskKind = 'text-read' | 'text-update' | 'create' | 'search' | 'shell' | 'no-file-work'

export type TaskVerdict = 'applied-tool-path' | 'normal-exception' | 'no-file-work' | 'unknown' | 'bypass'

export declare const TASK_VERDICT: Readonly<{
  APPLIED: 'applied-tool-path'
  EXCEPTION: 'normal-exception'
  NO_FILE_WORK: 'no-file-work'
  UNKNOWN: 'unknown'
  BYPASS: 'bypass'
}>

export type UnknownReason =
  | 'unsettled-dispatch'
  | 'no-target-declared'
  | 'no-dispatch-mentions-the-target'
  | 'unexplained-native-candidate-touching-target'
  | 'update-without-edit'
  | 'edit-without-read'
  | 'read-tool-not-used-for-target'
  | 'no-create-call'
  | 'no-search-call'
  | 'no-shell-call'
  | 'unknown-task-kind'
  | 'session-artifact-incomplete'

export type EvidenceGapCode =
  | 'tool-call-without-call-id'
  | 'dispatch-start-without-sub-call-id'
  | 'settle-without-start'
  | 'start-without-settle'
  | 'program-body-unreadable'

export declare const UNKNOWN_REASON: Readonly<Record<string, UnknownReason>>
export declare const EVIDENCE_GAP: Readonly<Record<string, EvidenceGapCode>>
/** One-line meaning per stable code; every declared code has an entry and vice versa. */
export declare const REASON_DICTIONARY: Readonly<Record<string, string>>

export declare const TASK_KIND: Readonly<{
  TEXT_READ: 'text-read'
  TEXT_UPDATE: 'text-update'
  CREATE: 'create'
  SEARCH: 'search'
  SHELL: 'shell'
  NO_FILE: 'no-file-work'
}>

export interface PairedCall {
  subCallId?: string
  callId?: string
  parentCallId?: string
  name: string
  arguments?: unknown
  isError?: boolean
  state: 'completed' | 'failed' | 'started' | 'settled-unknown'
  layer: 'ptc' | 'model-direct'
}

export interface UsageGap {
  kind: string
  subCallId?: string | null
  callId?: string
  seq?: number | null
}

export interface ProgramBody {
  callId: string
  code?: string
  readable: boolean
}

export interface ToolUsage {
  calls: PairedCall[]
  programs: ProgramBody[]
  gaps: UsageGap[]
}

export declare function readToolUsage(events: readonly unknown[]): ToolUsage

export declare function dispatchTouches(call: PairedCall, target: string): false | { via: string; exact: boolean }

export declare function scanProgramCandidates(
  program: ProgramBody,
  targets: readonly string[],
): { readable: boolean; candidates: { signal: string; mentionsTarget: boolean }[] }

export interface TaskUsageTask {
  id?: string
  kind?: TaskKind
  targets?: readonly string[]
}

export interface TaskJudgement {
  taskId: string
  kind: TaskKind
  verdict: TaskVerdict
  adoption: { read: number; edit: number; write: number; grep: number; glob: number; shell: number; other: string[] }
  path: {
    readTarget: { target: string; call: PairedCall }[]
    editTarget: { target: string; call: PairedCall }[]
    writeTarget: { target: string; call: PairedCall }[]
    shellTarget: { target: string; call: PairedCall }[]
  }
  provenBypass: { reason: string; target: string; call: PairedCall }[]
  candidates: { callId: string; signal: string; mentionsTarget: boolean }[]
  gaps: UsageGap[]
  unknowns: { kind: string }[]
}

export declare function judgeTaskUsage(input: {
  task?: TaskUsageTask
  events?: readonly unknown[]
}): TaskJudgement

export declare function summarizeJudgement(judgement: TaskJudgement): string

export interface TaskManifestEntry {
  id?: string
  kind?: TaskKind
  targets?: readonly string[]
  /** Which working line a manifest entry belongs to; `gate` entries are not tool-path tasks. */
  line?: string
}

export interface SessionJudgement {
  source: string
  format: string
  frames: number
  torn: number | null
  records: number
  failures: { line: number; message: string }[]
  complete: boolean
  judgements: TaskJudgement[]
  summary: string[]
}

export declare function judgeSessionArtifact(input: {
  sourcePath: string
  tasks: readonly TaskManifestEntry[]
}): Promise<SessionJudgement>

export declare function tasksOf(manifest: unknown): TaskManifestEntry[]
