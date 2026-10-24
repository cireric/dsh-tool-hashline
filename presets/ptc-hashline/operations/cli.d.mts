/** Type surface for the operations CLI (operations/cli.mjs). */
import type { BaselineReport } from './baseline.mjs'
import type { DescribedConfig } from './config.mjs'
import type { InvocationVerdict } from './context.mjs'
import type { IncidentReport, IncidentIssueRegistration } from './incidents.mjs'
import type { ConsentDrift, ConsentFile, ConsentRecord, ExecutionBoundary, ProposalCandidate, ProposalChanges, ProposalPatchDecision, ProposalReason, ProposalRollback, ProposalScope, ProposalTarget } from './proposals.mjs'
import type { PatchDecision, UpgradeAssessment } from './upgrades.mjs'

export const EXIT: { ok: 0; stopped: 2; refused: 3 }

export function installationRoot(): string

export function parseFlags(argv: string[]): Record<string, string | true>

/** The three words `upgrade` accepts after it. */
export const UPGRADE_SUBCOMMANDS: string[]

/** One row of legal flags per command; a flag outside its row is a usage refusal (3). */
export const FLAG_ALLOWLIST: Record<string, string[]>

/** Refuse an unknown flag and the automatic-acceptance family outright. */
export function assertFlagsAllowed(flags: Record<string, string | true>, key: string): void

export function timeFlag(raw: string | true | undefined): string

export function targetFlag(raw: string | true | undefined, fallback: string): string

/** The one consent answer the entry accepts; a default answer is a usage error. */
export function consentAnswer(flags: Record<string, string | true>): {
  decision: string
  scopeName?: string
  quote: string
  proposalValue: string
  now: string
}

export interface CliEnvironment {
  env: Record<string, string | undefined>
  sessionsRoot?: string
  stateDir?: string
  /** Metadata provider override: the default is the real read-only registry/ref query. */
  query?: (component: string) => Promise<Record<string, unknown>[]>
}

export interface ResolvedEnvironment {
  sessionsRoot: string
  stateDir: string
  dshHome: string
  sessionId?: string
  cwd: string
}

export function resolveEnvironment(environment: CliEnvironment): ResolvedEnvironment

/** The session being ANALYZED, which the spec allows to be a historical one. Reported only; it never authorizes this session. */
/** The session being ANALYZED, which the spec allows to be a historical one. Reported only; it never authorizes this session. */
export interface AnalyzedTarget {
  session: string
  cwd: string
  note: string
}

export interface ContextValue extends InvocationVerdict { command: 'context'; target: AnalyzedTarget }
export interface BaselineValue {
  command: 'baseline'
  baseline: BaselineReport
  context: { eligible: boolean; status: string; reason?: string }
}

/** The incident command: a written evidence bundle plus its counts and gaps. */
export interface IncidentValue {
  command: 'incident'
  status: 'complete' | 'incomplete' | 'stopped' | 'read-only' | 'missing' | 'unsupported-generation'
  reason?: string
  counts?: IncidentReport['counts']
  gaps?: string[]
  findings?: { kind: string; name: string; seq: number }[]
  issues?: IncidentIssueRegistration
  evidence?: { directory: string; files: { summary: string; incident: string; baseline: string; excerpt: string } }
  context: { eligible: boolean; status: string; reason?: string }
  target?: { session: string; cwd: string }
}

/** The upgrade command's answer: one read-only assessment and the files it wrote. */
export interface UpgradeValue {
  command: 'upgrade'
  /** 'incomplete' means the analysis finished but its files could not be written. */
  status: 'assessed' | 'incomplete' | 'read-only' | 'stopped'
  reason?: string
  conclusion?: UpgradeAssessment['conclusion']
  summary?: string
  complete?: boolean
  verified?: boolean
  pendingVerification?: boolean
  conclusions?: UpgradeAssessment['conclusions']
  components?: {
    component: string
    conclusion: UpgradeAssessment['conclusion']
    recommended: boolean
    verified: boolean
    pendingVerification: boolean
    baseline: string
    patches: { file: string; decision: PatchDecision }[]
  }[]
  target?: UpgradeAssessment['target']
  scope?: UpgradeAssessment['scope']
  manualActions?: string[]
  gaps?: string[]
  evidence?: { directory: string; files: { assessment: string; report: string; sources: string } }
  context: { eligible: boolean; status: string; reason?: string }
}


/** The propose command's answer: the written proposal and its identity. */
export interface UpgradeProposalValue {
  command: 'upgrade'
  /** 'incomplete' means the proposal could not be written; nothing was installed either way. */
  status: 'proposed' | 'incomplete' | 'read-only' | 'stopped'
  reason?: string
  /** Where to go next when the command refused (always another assessment or a new proposal). */
  next?: string
  proposalId?: string
  proposalHash?: string
  baselineHash?: string
  conclusion?: string | null
  summary?: string | null
  target?: ProposalTarget
  candidates?: ProposalCandidate[]
  reasons?: ProposalReason[]
  patchDecisions?: ProposalPatchDecision[]
  changes?: ProposalChanges
  scope?: ProposalScope
  risks?: string[]
  stopConditions?: string[]
  rollback?: ProposalRollback
  execution?: ExecutionBoundary
  gaps?: string[]
  drift?: { component: string; recorded: string; now: string }[]
  assessment?: { path?: string; conclusion?: string | null }
  evidence?: { directory: string; files: { proposal: string; report: string; consent: string } }
  /** `problem` names an existing consent file this run could not read (never read as 'pending'). */
  consent?: { status: ConsentFile['status']; records: number; path: string; problem?: string }
  delegation?: Record<string, unknown>
  context: { eligible: boolean; status: string; reason?: string }
}

/** The consent command's answer: the appended record, never an execution. */
export interface UpgradeConsentValue {
  command: 'upgrade'
  status: 'recorded' | 'stopped'
  reason?: string
  next?: string
  proposalId?: string
  proposalHash?: string
  baselineHash?: string
  decision?: ConsentRecord['decision']
  scope?: ConsentRecord['scope']
  target?: ConsentRecord['target']
  repliedAt?: string
  reply?: ConsentRecord['reply']
  /** How many of this session's own user messages contain the quote (>1 is ambiguous). */
  replyMatches?: number
  recorder?: ConsentRecord['recorder']
  consent?: { path: string; status: ConsentFile['status']; records: number }
  execution?: ExecutionBoundary | null
  drift?: ConsentDrift[]
  delegation?: Record<string, unknown>
  context: { eligible: boolean; status: string; reason?: string }
}

/** One command's answer: the argv's first token selects the value shape. */
export type CliValue = ContextValue | ConfigValue | BaselineValue | IncidentValue | UpgradeValue | UpgradeProposalValue | UpgradeConsentValue

export function run(argv: ['context', ...string[]], environment?: CliEnvironment): Promise<{ code: number; value: ContextValue }>
export function run(argv: ['config', ...string[]], environment?: CliEnvironment): Promise<{ code: number; value: ConfigValue }>
export function run(argv: ['baseline', ...string[]], environment?: CliEnvironment): Promise<{ code: number; value: BaselineValue }>
export function run(argv: ['incident', ...string[]], environment?: CliEnvironment): Promise<{ code: number; value: IncidentValue }>
export function run(argv: ['upgrade', 'propose', ...string[]], environment?: CliEnvironment): Promise<{ code: number; value: UpgradeProposalValue }>
export function run(argv: ['upgrade', 'consent', ...string[]], environment?: CliEnvironment): Promise<{ code: number; value: UpgradeConsentValue }>
export function run(argv: ['upgrade', ...string[]], environment?: CliEnvironment): Promise<{ code: number; value: UpgradeValue }>
export function run(argv: string[], environment?: CliEnvironment): Promise<{ code: number; value: CliValue }>

export function main(argv: string[]): Promise<number>