/** Type surface for the upstream-sync check (operations/sync.mjs). */
import type { DescribedConfig } from './config.mjs'

export const SYNC_TOOL: 'ptc-hashline-operations-sync'
export const SYNC_VERSION: 1
export const REPORT_FORMAT: 'ptc-hashline-upstream-sync/1'
export const SYNC_EXIT: { ok: 0; incomplete: 2; refused: 3 }
export const AREA_IDS: readonly ['source', 'ptc', 'stock-read', 'engines']
export const AREA_LABELS: Record<string, string>
export const AREA_TICKETS: Record<string, string>
export const DISPOSITIONS: readonly ['follow-up', 'keep', 'pending-analysis', 'not-applicable']
export const SOURCE_LAYERS: readonly ['explicit', 'environment', 'config']
export const SETTINGS_NAMESPACE: 'sync'
export const DEFAULT_RELEVANT_INPUTS: readonly string[]
export const WATCHED_SPECIFIERS: readonly string[]

export type Disposition = 'follow-up' | 'keep' | 'pending-analysis' | 'not-applicable'
export type AreaStatus = 'covered' | 'not-covered' | 'incomplete'
export type CheckStatus = 'complete' | 'incomplete'
export type SourceOrigin = 'explicit' | 'environment' | 'config'

/** Every way a named source path can fail to be usable. */
export type SourceStatus =
  | 'resolved'
  | 'missing'
  | 'missing-path'
  | 'not-absolute'
  | 'broken-link'
  | 'unreadable'
  | 'not-a-directory'
  | 'not-a-dsh-checkout'
  | 'usable'

export interface SourceDeclaration {
  name: string
  version: string
  packageManager: string
}

export interface SourceAttempt {
  layer: string
  origin?: string
  status: string
  reason?: string
  inputPath?: string
  resolvedPath?: string
  link?: boolean
  declaration?: SourceDeclaration
}

export interface SourceResolution extends SourceAttempt {
  status: SourceStatus
  origin: SourceOrigin | null
  attempts: SourceAttempt[]
  next?: string
}

export interface CheckoutVcs {
  commit: string
  dirty: 'clean' | 'dirty' | 'unknown'
  changedPaths: string[]
  detail?: string
}

export interface FileIdentity {
  path: string
  state: 'present' | 'missing' | 'unreadable' | 'not-a-file'
  sha256: string
  bytes?: number
  detail?: string
}

export interface DshSourceIdentity {
  role: 'dsh-checkout'
  origin: SourceOrigin
  inputPath: string
  resolvedPath: string
  link: boolean
  declaration: SourceDeclaration
  vcs: CheckoutVcs
  snapshot: 'clean-checkout' | 'local-modified' | 'unknown'
  snapshotNote: string
  files: FileIdentity[]
  collectedAt: string
  unknown: string[]
}

export interface DeclarationAnchor {
  path: string
  state: string
  sha256?: string
  specifier: string
  declaredVersion: string
  exact?: boolean
}

export interface ProjectBaseline {
  role: 'maintenance-repository'
  path: string
  repository: Record<string, unknown>
  declarations: { anchors: Record<string, DeclarationAnchor>; host: Record<string, string>; sha256: string; problems: string[] }
  locked: { entries: { specifier: string; version: string }[]; sha256: string; method: string; problems: string[] }
  patches: {
    files: { path: string; name: string; state: string; sha256: string }[]
    bound: { specifier: string; patch: string }[]
    source: string
    problems: string[]
  }
  installed: Record<string, unknown> | { status: 'unavailable'; detail: string }
  installedNote: string
  collectedAt: string
  unknown: string[]
}

/** One object both ends were asked about: the checklist item behind a difference. */
export interface Checkpoint {
  id: string
  object: string
  impact: string
  left: { source: string; identity: string; present: boolean }
  right: { source: string; identity: string; present: boolean }
  status: 'same' | 'changed' | 'only-upstream' | 'only-local' | 'unreadable'
}

export interface Difference extends Checkpoint {
  area: string
  change: 'added' | 'removed' | 'changed'
  disposition: Disposition
  reason: string
  /** The specification or ADR that justifies a kept difference. */
  basis?: string
  recheckWhen: string
  evidence: string[]
}

export interface CoverageEntry {
  area: string
  label: string
  status: AreaStatus
  detail: string
  checks: number
  differences: number
  ticket: string
}

export interface Gap {
  id: string
  status: 'GAP' | 'BLOCKED'
  detail: string
}

export interface AreaResult {
  area: string
  status: AreaStatus
  detail: string
  checks?: number
  differences?: Difference[]
  /** Every object the comparator walked, so a reader sees WHAT was compared. */
  checklist?: Checkpoint[]
  recommendations?: { id: string; text: string }[]
  gaps?: Gap[]
  ticket?: string
  releaseQueries?: { package: string; mode: string }[]
}

export interface SyncCheck {
  tool: string
  version: number
  reportFormat: string
  checkId: string
  contentHash: string
  checkedAt: string
  status: CheckStatus
  statusReason: string
  source: DshSourceIdentity
  project: ProjectBaseline
  coverage: CoverageEntry[]
  /** Per-area checkpoints; an area without a comparator has no entry. */
  checkpoints: Record<string, Checkpoint[]>
  differences: Difference[]
  releaseQueries?: { package: string; mode: string }[]
  recommendations: { id: string; text: string }[]
  gaps: Gap[]
}

/** What the entry prints: the round's verdict, not the whole record. */
export interface SyncCheckSummary {
  checkId: string
  contentHash: string
  checkedAt: string
  reportFormat: string
  status: CheckStatus | 'stopped' | 'read-only'
  statusReason: string
  source: {
    origin: SourceOrigin
    inputPath: string
    resolvedPath: string
    link: boolean
    commit: string
    dirty: CheckoutVcs['dirty']
    snapshot: DshSourceIdentity['snapshot']
    version: string
  }
  project: {
    path: string
    commit: string
    dirty: string
    lockfileSha256: string
    anchors: Record<string, DeclarationAnchor>
  }
  coverage: CoverageEntry[]
  differences: number
  gaps: number
}

export interface SyncCheckValue {
  command: 'sync check'
  status: 'complete' | 'incomplete' | 'stopped' | 'read-only'
  reason?: string
  next?: string
  origin?: SourceOrigin | null
  attempts?: SourceAttempt[]
  configuration?: { path: string; exists: boolean; settings: { dshCheckout?: string } }
  check?: SyncCheckSummary
  evidence?: { directory: string; files: { record: string; report: string } }
  written: string[]
}

export function comparatorFor(area: string): { area: string; version: number; compare: Function } | undefined
export function stableJson(value: unknown): string
export function hashOf(value: unknown): string
export function settingsOf(described: { values?: Record<string, unknown> }): { dshCheckout?: string }
export function saveDshCheckout(options: { directory: string; dshCheckout: string }): Promise<DescribedConfig>
export function captureRunner(file: string, args: string[], options?: { tmpdir?: string }): string
export function probeCheckoutPath(raw: string, origin: string): SourceAttempt & { status: SourceStatus; reason: string }
export function resolveDshSource(options?: { explicit?: string; environment?: string; configured?: string }): SourceResolution
export function readCheckoutVcs(directory: string, deps?: { execFileSync?: Function }): CheckoutVcs
export function fileIdentity(absolute: string): FileIdentity
export function inspectCheckout(options: {
  /** A resolved source: an unresolved one has no directory to read. */
  source: SourceResolution
  now?: string
  inputs?: string[]
  deps?: { execFileSync?: Function }
}): DshSourceIdentity
export function readDeclarations(repository: string): ProjectBaseline['declarations']
export function readLockedVersions(repository: string): ProjectBaseline['locked']
export function readPatchIdentity(repository: string, repositoryState: Record<string, unknown>): ProjectBaseline['patches']
export function projectBaseline(options: {
  repository: string
  installationRoot: string
  now?: string
  deps?: { execFileSync?: Function; readRepositoryState?: Function; collectBaseline?: Function }
}): ProjectBaseline
export function sourceCoverage(facts: { source: DshSourceIdentity; project: ProjectBaseline }): AreaResult
export function buildSyncCheck(options: {
  source: DshSourceIdentity
  project: ProjectBaseline
  areas: AreaResult[]
  now: string
}): SyncCheck
export function stampOf(at: string): string
export function renderSyncReport(check: SyncCheck): string
export function syncDirectory(evidenceDirectory: string, check: SyncCheck): string
export function roundDirectory(evidenceDirectory: string, check: SyncCheck): string
export function writeSyncCheck(options: { directory: string; check: SyncCheck }): Promise<{ record: string; report: string }>
export function runSyncCheck(options?: {
  env?: Record<string, string | undefined>
  now?: string
  checkout?: string
  stateDir?: string
  repository?: string
  installationRoot?: string
  evidenceDirectory?: string
  /** Pinned release answers for this run (the external-source boundary). */
  sources?: RawReleaseSource[]
  /** The query budget one engine's release lookup gets. */
  queryTimeoutMs?: number
  /** The review-decision file for this run (default <evidenceDirectory>/sync/decisions.json). */
  decisions?: string
  deps?: { execFileSync?: Function; readRepositoryState?: Function; collectBaseline?: Function; runner?: Function }
}): Promise<{ code: number; value: SyncCheckValue }>

/** One raw release-source record: the external-source boundary fixture seam. */
export interface RawReleaseSource {
  package?: string
  component?: string
  status?: 'verified' | 'failed'
  queriedAt?: string
  source?: string
  versions?: string[]
  tags?: Record<string, string>
  detail?: string
  timeout?: boolean
}
export function summariseCheck(check: SyncCheck): SyncCheckSummary
