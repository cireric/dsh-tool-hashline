/** Type surface for the read-only upgrade assessment (operations/upgrades.mjs). */

export const UPGRADE_TOOL: string
export const UPGRADE_VERSION: number

export const COMPONENTS: string[]
export const COMPONENT_LABELS: Record<string, string>
export const SOURCE_KINDS: string[]
export const SOURCE_STATUSES: string[]
export const CONCLUSIONS: string[]
export const TARGET_ROLES: string[]
export const PATCH_MARKERS: Record<string, { file: string[]; marker: string }[]>
export const IMPACT_SURFACE: Record<string, string[]>
export const QUERY_ALLOWLIST: { command: string; verb: string }[]
export const DSH_MANUAL_ACTIONS: string[]
export const CONCLUSION_SUMMARY: Record<string, string>

export type Conclusion = 'insufficient-evidence' | 'defer' | 'recommend-candidate' | 'no-upgrade'
export type SourceKind = 'release' | 'prerelease' | 'commit'
export type SourceStatus = 'verified' | 'unverified' | 'unknown'
export type PatchDecision = 'keep' | 'redo' | 'delete' | 'pending-verification'

export interface BoundDependency {
  name: string
  version: string | null
  /** true / false, or 'unknown' — an unstated readiness is not a licence to recommend. */
  ready: boolean | 'unknown'
}

export interface SourceRecord {
  component: string
  kind: SourceKind
  status: SourceStatus
  queriedAt: string
  source: string
  version: string | null
  commit: string | null
  url: string | null
  /** Whether a commit is part of a published release; 'unknown' never blocks no-upgrade by itself. */
  unreleased: boolean | 'unknown'
  /** Markers the upstream now implements (delete evidence), with this record as the citation. */
  covers: string[]
  /** Impact-surface areas this diff declares it touches. */
  areas: string[]
  boundDependencies: BoundDependency[]
  blocking: boolean
  detail?: string
  /** Candidate package text: package-relative path -> file text. Never written verbatim. */
  files?: Record<string, string>
}

export interface PatchItem {
  file: string
  marker: string
  decision: PatchDecision
  reason: string
  evidence: {
    source: string | null
    url: string | null
    version: string | null
    commit?: string | null
    present?: boolean | null
    covers?: boolean
  }
}

export interface ChannelReport {
  kind: SourceKind
  status: SourceStatus
  version: string | null
  commit: string | null
  queriedAt: string | null
  source: string
  url: string | null
  detail?: string
}

export interface ComponentAssessment {
  component: string
  label: string
  /** D2: the official DSH host is advised about (manual), never executed against. */
  execution: 'manual' | 'in-repo'
  baseline: { version: string; patch: { status: string; present?: string[]; missing?: string[] } }
  channels: Record<SourceKind, ChannelReport>
  latest: { stable: string | null; prerelease: string | null; commit: string | null }
  update: {
    comparable: boolean
    stableNewer: -1 | 0 | 1 | null
    prereleaseNewer: -1 | 0 | 1 | null
    unreleasedCommit: string | null
  }
  impact: { surface: string[]; affected: string[]; unmapped: string[]; note: string }
  patches: PatchItem[]
  boundDependencies: BoundDependency[]
  channelsVerified: boolean
  conclusion: Conclusion
  reason: string
  /** True only when the version comparison rests on verified sources. */
  verified: boolean
  pendingVerification: boolean
  recommended: boolean
  manualActions?: string[]
}

export interface UpgradeAssessment {
  tool: string
  version: number
  generatedAt: string
  target: { role: string; path: string; note: string }
  scope: {
    wrote: string
    mutated: unknown[]
    installed: boolean
    built: boolean
    switched: boolean
    announcedSuccess: boolean
    note: string
  }
  conclusion: Conclusion
  summary: string
  complete: boolean
  verified: boolean
  pendingVerification: boolean
  conclusions: Record<string, Conclusion>
  components: ComponentAssessment[]
  sources: { total: number; verified: number; unverified: number }
  manualActions: string[]
  gaps: string[]
}

export function parseVersion(text: unknown): { core: number[]; pre: string[] } | null

export function compareVersions(left: unknown, right: unknown): -1 | 0 | 1 | null

export function normalizeSource(record: Record<string, unknown>, options?: { now?: string }): SourceRecord

export function publicSource(record: SourceRecord): Record<string, unknown>

export function offlineSources(now: string, detail?: string): SourceRecord[]

export function completeSources(records: SourceRecord[], now: string): SourceRecord[]

export function prepareSources(records: Record<string, unknown>[] | undefined, now: string): SourceRecord[]

export function impactOf(component: string, records: SourceRecord[]): { surface: string[]; affected: string[]; unmapped: string[]; note: string }

export function decidePatches(options: { component: string; records: SourceRecord[]; baseline?: { present?: string[] } }): PatchItem[]

export function channelOf(records: SourceRecord[], kind: string): ChannelReport

export function baselineOf(baseline: unknown, component: string): { version: string; patch: Record<string, unknown> }

export function assessComponent(options: {
  component: string
  baseline?: { version: string; patch: Record<string, unknown> }
  records: SourceRecord[]
}): ComponentAssessment

export function aggregateConclusion(components: ComponentAssessment[]): Conclusion

export function assessUpgrade(options: {
  baseline: unknown
  records?: Record<string, unknown>[]
  now?: string
  target?: { role: string; path: string; note: string }
}): UpgradeAssessment

export function createMetadataQueries(options?: {
  runner?: (command: string, args: string[]) => string
  now?: string
  packages?: Record<string, string>
  repositories?: Record<string, string>
}): (component: string) => Promise<Record<string, unknown>[]>

export interface GitRef {
  commit: string
  ref: string
}

export function parseRefs(stdout: string): GitRef[]

export function pickHead(refs: GitRef[]): string | null

export function findTagCommit(refs: GitRef[], version: string): GitRef | undefined

export function assertReadOnly(command: 'npm' | 'git', verb: string): void

export function upstreamRepositories(baseline: unknown): Promise<Record<string, string>>

export function renderUpgradeReport(assessment: UpgradeAssessment): string

export function upgradeDirectory(evidenceDirectory: string, at?: string | Date): string

export function writeUpgradeAssessment(options: {
  directory: string
  assessment: UpgradeAssessment
  records: SourceRecord[]
}): Promise<{ assessment: string; report: string; sources: string }>