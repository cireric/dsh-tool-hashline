/** Types for scripts/suite-triage.mjs. */

export type TriageKind =
  | 'runs'
  | 'runner-gap (vitest feature)'
  | 'environment-sandbox (spawn/ACL)'
  | 'environment-subprocess (CLI produced nothing)'
  | 'needs-human'

export declare const TRIAGE_KIND: Readonly<{
  RUNS: 'runs'
  RUNNER_GAP: 'runner-gap (vitest feature)'
  ENVIRONMENT_SANDBOX: 'environment-sandbox (spawn/ACL)'
  ENVIRONMENT_SUBPROCESS: 'environment-subprocess (CLI produced nothing)'
  NEEDS_HUMAN: 'needs-human'
}>

export interface TriageRow {
  file: string
  code: number
  summary: string
  env: boolean
  shim: boolean
  fails: string
  detail: string
}

export declare function classifyRow(row: Partial<TriageRow>): TriageKind
export declare function parseTriageLog(text: string): TriageRow[]
export declare function summarize(rows: TriageRow[], options?: { generatedAt?: string }): {
  counts: Record<string, number>
  json: { generatedAt: string; scopeNote: string; counts: Record<string, number>; rows: (TriageRow & { kind: TriageKind })[] }
  markdown: string
  classified: (TriageRow & { kind: TriageKind })[]
}
export declare function main(argv: readonly string[]): Promise<number>
