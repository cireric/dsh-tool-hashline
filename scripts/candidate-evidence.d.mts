/** Types for scripts/candidate-evidence.mjs. */

export declare const VERDICT_ORDER: readonly string[]
export declare function worstVerdict(verdicts: readonly string[]): string
export declare function tallyDelivery(summary: unknown): { PASS: number; FAIL: number; GAP: number; BLOCKED: number; unknown: number }

export interface CandidateEvidenceInput {
  installation?: { profile?: string; bundleRoot?: string }
  hostResult?: { status?: string; cases?: { id: string; status: string }[]; installed?: { gateModuleSha256?: string; personaSha256?: string; bundleRoot?: string } }
  surfaceResult?: { status?: string; cases?: { id: string; status: string }[]; browserScreenshot?: boolean; installed?: { gateModuleSha256?: string; personaSha256?: string } }
  deliverySummary?: { install?: { bundleRoot?: string }; verdicts?: Record<string, string>; rows?: unknown[]; gates?: unknown[] }
  expected?: Record<string, string>
}

export interface CandidateEvidenceResult {
  candidate: Record<string, unknown>
  axes: { identity: string; host: { gate: string; verdict: string; cases: number; pass: number; fail: number }; surface: { gate: string; verdict: string; cases: number; pass: number; fail: number; browser: boolean }; delivery: { gate: string; verdict: string; tally: Record<string, number> | null; gates: number; cases: number } }
  verdict: string
  findings: { axis: string; verdict: string; detail: string }[]
  table: string[][]
}

export declare function candidateEvidence(input?: CandidateEvidenceInput): CandidateEvidenceResult
export declare function main(argv: readonly string[]): Promise<number>
