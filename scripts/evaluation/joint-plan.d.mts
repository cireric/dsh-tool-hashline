/** Types for the frozen joint evaluation planner (scripts/evaluation/joint-plan.mjs). */

export type CaseLine = 'gate' | 'tool'
export type ToolKind = 'text-read' | 'text-update' | 'create' | 'search' | 'shell' | 'no-file-work'

export declare const REQUIRED_APPROVAL_FIELDS: readonly string[]
export declare const CASE_LINE: Readonly<{ GATE: 'gate'; TOOL: 'tool' }>
export declare const TOOL_KINDS: readonly ToolKind[]

export interface FrozenCase {
  id: string
  line: CaseLine
  kind?: ToolKind
  targets?: readonly string[]
  input?: readonly string[]
  tags?: readonly string[]
}

export interface FrozenDocument {
  frozen?: string
  notExecuted?: boolean
  budget?: {
    perConversationGenerations?: number
    conversations?: number
    nominalGenerationCap?: number
    requiresUserApproval?: readonly string[]
  }
  cases?: FrozenCase[]
}

export interface CaseValidation {
  ok: boolean
  errors: string[]
  stats: { cases: number; gate: number; tool: number; conversations: number | null; nominalGenerationCap: number | null }
}

export declare function validateCases(document: unknown): CaseValidation
export declare function approvalBlockers(config: unknown): string[]

export interface RunPlan {
  status: 'ready' | 'unauthorized'
  blockers: string[]
  validation: CaseValidation
  plan: {
    cases: string[]
    sessions: { caseId: string; session: 'a' | 'b' }[]
    limits: { perConversationGenerations: number | null; globalGenerationCap: unknown; walletCap: unknown; wallClockCap: unknown }
    evidenceSlots: string[]
  }
}

export declare function buildRunPlan(input: { document?: FrozenDocument; approval?: Record<string, unknown> }): RunPlan

export interface ReconciledRow {
  caseId: string
  line: string | null
  session: 'a' | 'b'
  complete: boolean
  declaration: { issues: number; repairs: number; accepted: number }
  cost: { attempts: number; inputTokens: number; outputTokens: number; usageUnknown: number }
  toolPath: null | { verdict: string; provenBypass: number; candidates: number; unknowns: number }
}

export interface ReconciledRun {
  rows: ReconciledRow[]
  /** P3 axis: null when the report predates the presentation block. */
  presentation: null | { turns: number; recovering: number; failures: number; refused: string[] }
  totals: {
    rows: number
    gaps: number
    repairs: number
    inputTokens: number
    outputTokens: number
    usageUnknown: number
    toolPathClean: number
    toolPathUnknown: number
    toolPathBypass: number
  }
  gaps: { caseId: string; session: 'a' | 'b'; kind: string }[]
}

export declare function reconcileRun(input: {
  document?: FrozenDocument
  runs?: { caseId: string; session: 'a' | 'b'; report?: unknown }[]
}): ReconciledRun
