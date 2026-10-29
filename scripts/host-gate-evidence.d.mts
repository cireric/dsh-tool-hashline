/** Types for the installed-host evidence pre-check (scripts/host-gate-evidence.mjs). */

export declare const REQUIRED_EVIDENCE_FIELDS: readonly string[]
export declare const IDENTITY_ASSETS: readonly string[]
export declare function assetDigest(text: string): string
export declare function expectedIdentity(root?: string): Promise<Record<string, string>>

export interface HostGateCase {
  id: string
  status: 'PASS' | 'FAIL'
  error?: string
}

export interface HostGateEvidence {
  status?: 'PASS' | 'FAIL'
  cases?: HostGateCase[]
  installed?: { gateModuleSha256?: string; personaSha256?: string; versions?: Record<string, string> }
  scriptedLlmRequests?: number
  realModelRequests?: number
  finishedAt?: string
}

export interface HostGateCheck {
  ok: boolean
  errors: string[]
  summary: { cases: number; pass: number; fail: number }
  coverage: { required: number; present: number; missing: string[]; failed: string[] }
}

export declare function checkHostGateEvidence(
  evidence: unknown,
  options?: { expected?: Record<string, string>; requiredCaseIds?: readonly string[] },
): HostGateCheck

export declare const SURFACE_CASE_IDS: readonly string[]
export declare const SURFACE_CASE_RULES: Readonly<Record<string, (entry: Record<string, unknown>) => string[]>>

export interface SurfaceGateEvidence {
  status?: 'PASS' | 'FAIL' | 'EMPTY'
  cases?: { id: string; status: 'PASS' | 'FAIL'; error?: string; clientVisibleText?: string; withheldDispatch?: boolean; declarationFirst?: boolean; assistantMessages?: number }[]
  surface?: string
  browserScreenshot?: boolean
  installed?: { gateModuleSha256?: string; personaSha256?: string }
  scriptedLlmRequests?: number
  realModelRequests?: number
  finishedAt?: string
  fatal?: string
}

export interface SurfaceGateCheck {
  ok: boolean
  errors: string[]
  gaps: string[]
  summary: { cases: number; pass: number; fail: number }
  coverage: { required: number; present: number; missing: string[]; failed: string[] }
}

export declare function checkSurfaceGateEvidence(
  evidence: unknown,
  options?: { expected?: Record<string, string>; requiredCaseIds?: readonly string[] },
): SurfaceGateCheck
