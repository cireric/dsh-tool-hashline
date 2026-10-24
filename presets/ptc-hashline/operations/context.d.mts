/** Type surface for the operations context verifier (operations/context.mjs). */

export const TARGET_PRESET: 'ptc-hashline'

export interface PresetProjection {
  headerPreset?: string
  selectedPreset?: string
  selectionSeq?: number
  effective?: string
}

export function replayPresetProjection(records: Record<string, unknown>[]): PresetProjection

export function judgeProjection(projection: PresetProjection): { eligible: boolean; reason?: string }

export function replayRoute(records: Record<string, unknown>[]): { provider?: string; model?: string }

export interface InvocationEvidence {
  source?: string
  generation?: number
  format?: string
  frames?: number
  tornStart: number | null
  headerPreset: string | null
  selectedPreset: string | null
  selectionSeq: number | null
  effectivePreset?: string | null
  presetArgumentIgnored: string | null
  directory?: string
  provider?: string | null
  model?: string | null
}

export interface InvocationVerdict {
  workflow: string
  targetPreset: string
  sessionsRoot: string
  cwd: string
  sessionId?: string
  eligible: boolean
  status: 'eligible' | 'wrong-preset' | 'context-unverified'
  reason?: string
  evidence: InvocationEvidence
  route?: { provider?: string; model?: string }
  delegation: InvocationDelegation
}

/** What one session's header says about delegation (SCOPE-06). */
export interface ReplayedDelegation {
  role: 'main' | 'subagent' | 'unknown'
  parentSession: string | null
  delegationDepth: number | null
  origin: string | null
}

/** A subagent may assist the analysis; only the main session may hold the consent. */
export interface InvocationDelegation extends ReplayedDelegation {
  mayAssistAnalysis: boolean
  mayApproveUpgrade: boolean
  rule: string
}

export function replayDelegation(records: Record<string, unknown>[]): ReplayedDelegation

export function judgeDelegation(delegation: Partial<ReplayedDelegation> & { role: string }): InvocationDelegation

export function verifyInvocationContext(options: {
  sessionsRoot: string
  cwd: string
  sessionId?: string
  presetArgument?: string
}): Promise<InvocationVerdict>