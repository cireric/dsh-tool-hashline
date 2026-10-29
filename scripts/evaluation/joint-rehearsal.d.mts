/** Types for the dry-run rehearsal of the joint acceptance pipeline. */

export declare const REHEARSAL_CASES: readonly string[]

export interface RehearsalSummary {
  mode: 'dry-run-rehearsal'
  root: string
  extractExits: { G1: number; T3: number }
  reconcileExit: number
  rows: number
  gaps: number
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
  gateCase: null | {
    declaration: { issues: number; repairs: number; accepted: number }
    toolPath: null | { verdict: string; provenBypass: number; candidates: number; unknowns: number }
  }
  toolCase: null | {
    declaration: { issues: number; repairs: number; accepted: number }
    toolPath: null | { verdict: string; provenBypass: number; candidates: number; unknowns: number }
  }
  consistent: boolean
}

export declare function rehearsal(input?: { root?: string; casesPath?: string }): Promise<RehearsalSummary>
