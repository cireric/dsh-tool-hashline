/** Type surface for the target switch and its rollback (operations/switch.mjs). */
import type { ConsentRecord } from './proposals.mjs'

export const SWITCH_TOOL: string
export const SWITCH_VERSION: number
/** The only three conclusions. */
export const SWITCH_VERDICTS: string[]
export const TARGET_BUNDLE: string
export const SWITCH_DRIVER_PATH: string[]
export const BACKUP_DIRECTORY: string
export const AFFECTED_MANIFEST_FILES: string[]
export const AFFECTED_PATCH_PREFIX: string
export const SIDES: string[]

export interface SwitchDrift {
  field: string
  recorded: unknown
  now: unknown
  note: string
}

/** Why one switch was refused (never written, never spawned a command). */
export interface SwitchRefusal {
  ok: false
  rule: string
  reason: string
  next: string
  drift?: SwitchDrift[]
}

export interface SwitchGrant {
  ok: true
  basis: Record<string, any>
  targetPath: string
}

export function switchAuthorization(options: {
  proposal: Record<string, any>
  proposalDirectory: string
  consentPath: string
  records: ConsentRecord[]
  consentProblem?: string
  evidenceDirectory: string
  baseline: Record<string, any>
  maintenancePath?: string
  /** The target's manifest bytes read now, to compare with what the proposal bound. */
  targetState?: { manifestSha256: string; lockfileSha256: string }
  delegation?: { mayApproveUpgrade?: boolean; parentSession?: string | null; role?: string }
}): SwitchGrant | SwitchRefusal

/** The candidate gate: a switch needs a candidate-verified run of THIS payload. */
export function candidateVerdictOf(options: {
  proposal: Record<string, any>
  candidateDirectory: string
}): { ok: boolean; path: string; verdict?: string; pendingVerification?: boolean; reason?: string; next?: string }

export function targetProfileProblem(options: { path: string; bundle?: string }): string | undefined

/** The two manifest bytes an approved target is bound to. */
export function targetStateOf(options: { path: string }): { manifestSha256: string; lockfileSha256: string }

/** Whether the target is still what THIS round wrote (UPG-12). */
export function externalChangesOf(options: {
  writtenFiles: { path: string; afterSha256: string }[]
  engines?: { component: string; expected: unknown; now: unknown }[]
}): { path: string; expected: unknown; now: unknown }[]

export function affectedUserChanges(options: { changedPaths: string[]; patchPrefix?: string }): { affected: string[]; unrelated: string[] }

export interface WatchedEntry {
  side: string
  root: string
  relative: string
  path: string
  /** A hex SHA-256, or 'missing' / 'unreadable' — never silently empty. */
  sha256: string
  problem?: string
}

export function watchedSnapshot(options: { maintenanceRepository: string; targetDirectory: string }): {
  maintenance: WatchedEntry[]
  target: WatchedEntry[]
}

export function backupProblems(snapshot: { maintenance: WatchedEntry[]; target: WatchedEntry[] }): string[]

export function writeBackup(options: {
  snapshot: { maintenance: WatchedEntry[]; target: WatchedEntry[] }
  directory: string
}): Promise<{ directory: string; files: { path: string; side: string; relative: string; backup: string | null; sha256: string }[]; problems: string[] }>

export function writtenFilesOf(options: {
  before: { maintenance: WatchedEntry[]; target: WatchedEntry[] }
  after: { maintenance: WatchedEntry[]; target: WatchedEntry[] }
}): { path: string; relative: string; side: string; beforeSha256: string; afterSha256: string }[]

export function targetPatchResults(options: { proposal: Record<string, any>; engines: Record<string, ResolvedEngines> }): Record<string, any>[]

/** One switch run: the record written to switch.json. */
export function switchTarget(options: {
  proposal: Record<string, any>
  proposalDirectory: string
  evidenceDirectory: string
  maintenanceRepository: string
  targetPath: string
  basis?: Record<string, any>
  candidateResultPath?: string
  candidateVerdict?: string
  now?: string
  finishedAt?: string
  sessionId?: string
  timeoutMin?: number
  runner?: (command: string, args: string[], options: { cwd: string; timeoutMs?: number }) => unknown
  cancel?: (name: string) => boolean
}): Promise<Record<string, any>>

export function writeSwitchReport(options: { report: Record<string, any>; proposalDirectory: string }): Promise<{ record: string; report: string }>

export function writeRollbackReport(options: { rollback: Record<string, any>; proposalDirectory: string }): Promise<{ path: string }>

export function renderSwitchReport(record: Record<string, any>): string
