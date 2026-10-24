/** Type surface for the reviewable proposal and the consent record (operations/proposals.mjs). */

export const PROPOSAL_TOOL: string
export const CONSENT_TOOL: string
export const PROPOSAL_VERSION: number
export const DECISIONS: string[]
export const CONSENT_SCOPES: string[]
export const AUTO_APPROVAL_FLAGS: string[]
export const STOP_CONDITIONS: string[]

export interface ProposalScope {
  candidateValidation: boolean
  switch: boolean
  note: string
}

export const PROPOSAL_SCOPE: ProposalScope

export interface ExecutionBoundary {
  mode: 'consent-only'
  installed: false
  built: false
  switched: false
  note: string
}

export const EXECUTION_BOUNDARY: ExecutionBoundary

/** Bumped when the bound payload gains a required part; an older record is refused. */
export const BASELINE_FORMAT: number

export interface BaselineSnapshot {
  format: number
  commit: string
  dirty: string
  /** The uncommitted inputs: HEAD equality alone can never prove a file did not change. */
  changedPaths: string[]
  /**
   * The CONTENT of those inputs. Same path, different bytes must not hash the
   * same, or an approval would silently cover bytes the user never saw (R3/D10).
   */
  inputs: { path: string; state: string; kind: string; sha256: string; from?: string }[]
  /** Present when the input set could not be read at all: never "nothing uncommitted". */
  inputsProblem?: string
  lockfileSha256: string
  patchFiles: { path: string; sha256: string }[]
  versions: { dsh: string; hashline: string; toolEdit: string }
  patches: { hashline: string; toolEdit: string }
}

export interface ProposalCandidate {
  component: string
  label: string
  version: string | null
  kind: 'release'
  source: string
  url: string | null
  queriedAt: string | null
  /** D2: the official host is advised about (manual), never executed against. */
  execution: 'manual' | 'in-repo'
}

export interface ProposalReasonSource {
  kind: string
  status: string
  version: string | null
  commit: string | null
  queriedAt: string | null
  source: string
  url: string | null
}

export interface ProposalReason {
  component: string
  label: string
  conclusion: string
  recommended: boolean
  reason: string
  sources: ProposalReasonSource[]
}

export interface ProposalPatchDecision {
  component: string
  file: string
  marker: string
  decision: 'keep' | 'redo' | 'delete' | 'pending-verification'
  reason: string
  evidence: Record<string, unknown>
}

export interface VerificationCommand {
  name: string
  /** The script body, read verbatim from the maintenance repository's package.json. */
  script: string
  /** The declared package manager's prefix, or null when package.json declares none (never assumed). */
  run: string | null
}

export interface ChangedFile {
  path: string
  change: string
}

export interface ProposalChanges {
  files: ChangedFile[]
  /** Named under the evidence directory; NOT created by this ticket. */
  candidateDirectory: string
  created: false
  verification: VerificationCommand[]
  expectedImpact: string[]
}

export interface ProposalRollback {
  baselineHash: string
  commit: string
  dirty: string
  /** User changes that a rollback must never overwrite. */
  userInputs: string[]
  lockfileSha256: string
  patchFiles: { path: string; sha256: string }[]
  roles: Record<string, unknown>
  target: { role: string; path: string }
  note: string
}

export interface ProposalTarget {
  role: string
  path: string
  note: string
}

export interface ProposalBinding {
  baselineHash: string
  candidates: ProposalCandidate[]
  patchDecisions: ProposalPatchDecision[]
  target: ProposalTarget
  scope: ProposalScope
  verification: VerificationCommand[]
  rollback: ProposalRollback
}

export interface UpgradeProposal {
  tool: string
  version: number
  proposalId: string
  proposalHash: string
  generatedAt: string
  assessment: { directory: string | null; conclusion: string | null; summary: string | null; complete: boolean; verified: boolean }
  baseline: BaselineSnapshot & {
    hash: string
    collectedAt: string
    roles: Record<string, unknown>
    resolvedPaths: Record<string, unknown>
    realpaths: Record<string, unknown>
    unknown: string[]
  }
  baselineHash: string
  target: ProposalTarget
  candidates: ProposalCandidate[]
  reasons: ProposalReason[]
  patchDecisions: ProposalPatchDecision[]
  changes: ProposalChanges
  scope: ProposalScope
  risks: string[]
  stopConditions: string[]
  rollback: ProposalRollback
  execution: ExecutionBoundary
  gaps: string[]
  directory: string
  note: string
}

export interface ConsentScope {
  candidateValidation: boolean
  switch: boolean
}

export interface ConsentRecord {
  proposalHash: string
  baselineHash: string
  target: { role: string; path: string }
  /** Empty for a rejection: it grants nothing. */
  scope: Partial<ConsentScope>
  decision: 'approve' | 'reject'
  repliedAt: string
  reply: { quote: string; source: 'user'; seq: number }
  recorder: { sessionId: string; role: string }
}

export interface ConsentFile {
  tool: string
  version: number
  proposalId: string
  proposalHash: string
  baselineHash: string
  status: 'pending' | 'approved' | 'rejected'
  records: ConsentRecord[]
  note: string
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export function canonicalJson(value: unknown): string

export function proposalHashOf(bound: unknown): string

export function baselineSnapshot(baseline: unknown): BaselineSnapshot

/**
 * Why a proposal's bound inputs cannot be checked, or nothing when they can.
 * A record written before content binding is refused, never back-filled.
 */
export function baselineInputsProblem(proposal: unknown): string | undefined

/** The readable one-line rendering of a drift list, note included. */
export function driftSummary(drift: { field: string; recorded: unknown; now: unknown; note?: string }[]): string

export function baselineHashOf(baseline: unknown): string

export function proposalEligibility(assessment: unknown): { eligible: boolean; reason?: string; next?: string; components?: string[] }

export function candidatesOf(assessment: unknown): ProposalCandidate[]

export function reasonsOf(assessment: unknown): ProposalReason[]

export function patchDecisionsOf(assessment: unknown): ProposalPatchDecision[]

export function expectedImpactOf(assessment: unknown): string[]

export function changedFilesOf(baseline: unknown): ChangedFile[]

export function risksOf(options: { assessment: unknown; baseline: unknown; verification: unknown }): string[]

export function readVerificationCommands(repositoryPath: string | undefined): Promise<{ commands: VerificationCommand[]; gaps: string[] }>

export function buildProposal(options: {
  assessment: unknown
  baseline: unknown
  verification?: { commands: VerificationCommand[]; gaps: string[] }
  target: ProposalTarget
  now: string
  evidenceDirectory: string
  assessmentDirectory?: string
}): { proposal: UpgradeProposal; bound: ProposalBinding }

export function bindingOf(proposal: UpgradeProposal): ProposalBinding

export function freshnessDrift(assessment: unknown, baseline: unknown): { component: string; recorded: string; now: string }[]

export interface ConsentDrift {
  field: string
  recorded: unknown
  now: unknown
  note: string
}

export function consentDrift(options: { proposal: UpgradeProposal; baseline: unknown; maintenancePath?: string }): ConsentDrift[]

export function consentStatus(records: ConsentRecord[]): 'pending' | 'approved' | 'rejected'

export function scopeFor(name: string | undefined): ConsentScope

export function makeConsentRecord(options: {
  proposal: UpgradeProposal
  decision: 'approve' | 'reject'
  scope: ConsentScope
  reply: { quote: string; source: 'user'; seq: number }
  recorder: { sessionId: string; role: string }
  now: string
}): ConsentRecord

export function locateUserReply(records: object[], quote: string): { seq: number; matches: number } | undefined

export function findLatestAssessment(evidenceDirectory: string): Promise<string | undefined>

export function resolveAssessment(options: { value?: string | true; evidenceDirectory: string }): Promise<{
  path?: string
  directory?: string
  assessment?: unknown
  reason?: string
  next?: string
}>

export function readProposal(value: string | true | undefined): Promise<{
  path?: string
  directory?: string
  proposal?: UpgradeProposal
  reason?: string
}>

export function candidateDirectoryProblem(options: {
  candidateDirectory: string
  evidenceDirectory: string
  maintenanceRepository?: string
}): string | undefined

export function proposalPlacementProblem(options: {
  directory: string
  evidenceDirectory: string
}): string | undefined

export function readConsent(path: string): Promise<{ exists: boolean; raw?: string; consent?: ConsentFile; reason?: string }>

export function writeProposal(options: { directory: string; proposal: UpgradeProposal }): Promise<{ proposal: string; report: string; consent: string }>

export function appendConsentRecord(options: { path: string; proposal: UpgradeProposal; record: ConsentRecord }): Promise<{
  consent?: ConsentFile
  path?: string
  appended?: number
  reason?: string
}>

export function renderProposalReport(proposal: UpgradeProposal): string
