/** Type surface for the isolated candidate validation (operations/candidates.mjs). */
import type { ConsentRecord } from './proposals.mjs'
import type { PatchDecision } from './upgrades.mjs'

export const CANDIDATE_TOOL: string
export const CANDIDATE_VERSION: number
/** The only three verdicts, in decreasing strength. */
export const VERDICTS: string[]
/** The engine each component's patch belongs to. */
export const PACKAGE_OF_COMPONENT: Record<string, string>
export const MANAGERS: string[]
export const MANAGER_VERBS: string[]
/** The manifest fields a pinned candidate dependency may live in. */
export const DEPENDENCY_FIELDS: string[]
export const SNAPSHOT_EXCLUDES: string[]
export const DEFAULT_TIMEOUT_MIN: number
export const SHORT_LINK_DRIVER_PATH: string[]
export const SHORT_LINK_GAP_EXIT: number

/** The authorization facts a report cites, verbatim from the consent record. */
export interface ValidationBasis {
  decision: ConsentRecord['decision']
  proposalHash: string
  baselineHash: string
  scope: ConsentRecord['scope']
  repliedAt: string
  reply: ConsentRecord['reply']
  recorder: ConsentRecord['recorder']
}

export interface ValidationDrift {
  field: string
  recorded: unknown
  now: unknown
  note: string
}

/** Why one validation was refused (never written, never spawned a command). */
export interface ValidationRefusal {
  ok: false
  rule: string
  reason: string
  next: string
  drift?: ValidationDrift[]
}

export interface ValidationGrant {
  ok: true
  basis: ValidationBasis
}

export function validationAuthorization(options: {
  proposal: Record<string, any>
  proposalDirectory: string
  consentPath: string
  records: ConsentRecord[]
  consentProblem?: string
  evidenceDirectory: string
  baseline: Record<string, any>
  maintenancePath?: string
  delegation?: { mayApproveUpgrade?: boolean; parentSession?: string | null; role?: string }
}): ValidationGrant | ValidationRefusal

export function authorizationBasis(record: ConsentRecord): ValidationBasis

export function candidateTargetProblem(options: {
  proposal: Record<string, any>
  proposalDirectory: string
  evidenceDirectory: string
  maintenanceRepository?: string
}): string | undefined

export function copyCandidateTree(options: { from: string; to: string }): Promise<{ root: string; topLevelEntries: number }>

export interface IncludedInputFile {
  path: string
  /** A hex SHA-256, or 'missing' / 'unreadable' — never silently empty. */
  sha256: string
  problem?: string
}

export interface IncludedInputs {
  commit: string
  dirty: string
  files: IncludedInputFile[]
  lockfileSha256: string
  patchFiles: { path: string; sha256: string }[]
  problems: string[]
  note: string
}

export function includedInputsOf(options: { baseline: Record<string, any>; tree: string }): IncludedInputs

export interface DependencyUpdate {
  package: string
  field: string
  from: string
  to: string
  changed: boolean
}

export function applyDependencyUpdates(options: {
  tree: string
  proposal: Record<string, any>
}): Promise<{ updates: DependencyUpdate[]; gaps: string[]; written: boolean }>

export function decodePatchFileName(name: string): { file: string; package: string; version: string } | undefined

export function encodePatchFileName(specifier: string, version: string): string

export function rewritePatchedDependencies(
  text: string,
  plans: { key: string; nextKey: string | null; nextPath: string }[],
): { text: string; changed: string[]; missing: string[] }

export interface AppliedPatchItem {
  component: string
  file: string
  marker: string
  decision: PatchDecision | string
  reason?: string
  /** What the candidate package text declared: 'present' | 'absent' | 'unknown'. */
  declared: 'present' | 'absent' | 'unknown'
  /** The mechanical action this run took (or could not take). */
  apply?: 'patch-file-removed' | 'registered-for-candidate-version' | 'patch-kept' | 'requires-recut' | 'undecided' | 'no-patch-file'
  requiresRecut?: boolean
  patchFile?: string
}

export interface PatchMove {
  from: string
  to: string | null
  action: 'removed' | 'renamed'
}

export function applyPatchDecisions(options: { tree: string; proposal: Record<string, any> }): Promise<{
  items: AppliedPatchItem[]
  files: PatchMove[]
  changed: string[]
  gaps: string[]
}>

export interface ResolutionFacts {
  readSide: string
  editSide: string
  readSideResolved: boolean
  editSideResolved: boolean
  samePhysicalInstance: boolean
  insideCandidateTree: boolean
  note: string
}

export interface CandidateEngine {
  version: string
  realpath?: string
  problem?: string
  patch?: { status?: string; present?: string[]; missing?: string[] }
}

export function resolvedCandidateEngines(options: { tree: string; /** The tree the reasons name. */ label?: string }): {
  resolution: ResolutionFacts
  engines: Record<string, CandidateEngine>
  unknown: string[]
}

export interface PatchDigestEntry {
  path: string
  recorded: string
  now: string
  match: boolean
  removedByDecision?: boolean
  recordedVersion?: string
}

export function patchDigestCheck(options: {
  recorded: { path: string; sha256: string }[]
  tree: string
  /** Package names whose patch the decisions removed on purpose. */
  removed?: string[]
}): { entries: PatchDigestEntry[]; problems: string[] }

export interface CandidateVersionItem {
  component: string
  approved: string | null
  resolved: string
  match: boolean
}

export function candidateVersionCheck(options: {
  proposal: Record<string, any>
  engines: Record<string, CandidateEngine>
}): { items: CandidateVersionItem[]; unknown: string[] }

export function satisfiesRange(range: string, version: string): boolean | null

export interface EngineConstraintItem {
  component: string
  field: string
  package: string
  declared: string
  resolved: string
  evaluated: boolean
  match: boolean | null
}

export function engineConstraintCheck(options: { engines: Record<string, CandidateEngine> }): {
  items: EngineConstraintItem[]
  gaps: string[]
}

export function candidateCommandProblem(options: {
  command: string
  args: string[]
  tree: string
  declaredScripts?: string[]
  /** The tree the reasons name (the candidate run's default, or this run's own). */
  label?: string
}): string | undefined

/** The entry names of one directory, plus the reason it could not be listed. */
export function namesIn(directory: string): { names: string[]; problem?: string }

/** The argv a declared verification entry runs as, when it is runnable at all. */
export function splitDeclared(entry: Record<string, any>): { command: string; args: string[] } | undefined

/** One patch item's mechanical state versus the resolved build. */
export function resolvedPatchItem(item: Record<string, any>, engines: Record<string, CandidateEngine>, label?: string): Record<string, any>

export type CandidateRunner = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number; env?: Record<string, string> },
) => unknown

export function createDefaultRunner(launcher?: CandidateRunner): CandidateRunner

export function managerCommand(manager: string): string

export function interruptPredicate(): { cancelled: () => boolean; dispose: () => void }

export interface RecordedCommand {
  name: string
  source: 'candidate-install' | 'proposal-changes' | 'own-check'
  command: string
  args: string[]
  cwd: string
  exitCode: number | null
  durationMs: number
  timedOut?: boolean
  stdout?: string
  stderr?: string
  refused?: string
  failure?: string
  /** The full output of this command, written under `<candidateDirectory>/logs/`. */
  log?: string
}

export interface CandidateCheck {
  /** 'n/a' means there was nothing to measure: it neither passes nor fails. */
  name: string
  status: 'pass' | 'fail' | 'gap' | 'n/a'
  detail: string
  exitCode?: number | null
  durationMs?: number
}

export interface CandidatePatchResult extends AppliedPatchItem {
  expected: 'present' | 'absent' | 'undecided'
  resolved: 'present' | 'absent' | 'unknown'
  satisfied: boolean
  /** Always 'not-measured': this step cannot judge the semantic regression. */
  semanticRegression: 'not-measured'
  requiresRecut: boolean
  patchFile: string | null
  note: string
}

export type CandidateVerdict = 'candidate-verified' | 'candidate-failed' | 'candidate-incomplete'

export interface CandidateReport {
  tool: string
  version: number
  generatedAt: string
  proposalId: string
  proposalHash: string
  baselineHash: string
  proposalDirectory: string
  candidateDirectory: string
  evidenceDirectory: string
  tree: string
  treeEntries: number
  runner: { source: 'default' | 'injected'; note: string }
  verdict: CandidateVerdict
  authorization: ValidationBasis & { rule: string }
  includedInputs: IncludedInputs
  dependencyUpdates: DependencyUpdate[]
  candidateBaseline: {
    collectedAt: string
    tree: string
    commit: string
    engines: Record<string, CandidateEngine>
    resolution: ResolutionFacts
    patchDigests: PatchDigestEntry[]
    lockfileSha256: string
    constraints: { items: EngineConstraintItem[]; gaps: string[] }
    unknown: string[]
    note: string
  }
  patchDecisions: AppliedPatchItem[]
  patchResults: CandidatePatchResult[]
  patchFiles: PatchMove[]
  workspaceChanges: string[]
  checks: CandidateCheck[]
  commands: RecordedCommand[]
  skipped: { name: string; reason: string }[]
  gaps: string[]
  criticalUnknowns: string[]
  pendingVerification: boolean
  failures: { name: string; reason: string }[]
  stop: { rule: string; note: string; next: string } | null
  versions: {
    before: { dsh: string; hashline: string; toolEdit: string }
    after: { dsh: string; hashline: string; toolEdit: string }
    approved: Record<string, string | null>
    note: string
  }
  scope: { switchAuthorized: boolean; switched: boolean; installedInto: string; note: string }
  statements: {
    mayClaimSecondPhasePrecondition: boolean
    mayClaimUpgraded: boolean
    mayClaimSemanticRegression: boolean
    targetUntouched: boolean
    dailyProfileUntouched: boolean
    officialInstallUntouched: boolean
    note: string
  }
  /** The next command (the shape every sibling `next` uses). */
  next: string
  /** The same next step as prose for validation.md. */
  nextNote: string
}

export function validateCandidate(options: {
  proposal: Record<string, any>
  proposalDirectory: string
  candidateDirectory: string
  evidenceDirectory: string
  maintenanceRepository: string
  baseline: Record<string, any>
  basis?: ValidationBasis
  now: string
  timeoutMin?: number
  runner?: CandidateRunner
  cancel?: (name: string) => boolean
}): Promise<CandidateReport>

export function failureLocations(entry: RecordedCommand): string[]

export function verdictOf(options: {
  state: {
    commands: RecordedCommand[]
    failures: { name: string; reason: string }[]
    skipped: { name: string; reason: string }[]
    gaps: string[]
    checks: CandidateCheck[]
  }
  criticalUnknowns: string[]
}): CandidateVerdict

export function writeCandidateReport(options: { report: CandidateReport; proposalDirectory: string }): Promise<{
  result: string
  report: string
}>

export function renderValidationReport(report: CandidateReport): string
