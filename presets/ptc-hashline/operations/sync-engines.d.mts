/** Type surface for the engine comparator (operations/sync-engines.mjs). */
import type { AreaResult, ProjectBaseline, RawReleaseSource } from './sync.mjs'

export const ENGINES_AREA: 'engines'
export const ENGINES_COMPARATOR_VERSION: 1
export const ENGINE_ORDER: readonly ['hashline', 'tool-edit']
export const ENGINE_PACKAGES: Record<'hashline' | 'tool-edit', string>
export const DEFAULT_QUERY_TIMEOUT_MS: number
export const CHANNELS: readonly ['stable', 'prerelease']

export interface VersionChannels {
  stable: string[]
  prerelease: string[]
  invalid: string[]
}

export interface ReleaseSourceRecord {
  package: string
  status: 'verified' | 'failed'
  queriedAt: string
  source: string
  versions: string[]
  tags: Record<string, string>
  timeout: boolean
  detail?: string
}

export interface EngineBaselineFacts {
  declared: string
  locked: string
  installed: string
  patchStatus: string
  present: string[]
  missing: string[]
}

export interface PatchItem {
  index: number
  file: string
  marker: string
  decision: 'pending-verification'
  reason: string
  evidence: { resolvedBuildHasMarker: boolean; resolvedBuildMissingMarker: boolean; candidate: string | null }
}

export interface UpdateBasis {
  fixed: string
  candidate: string
  direction: 'newer' | 'not-newer'
  steps: string[]
  intermediate: string[]
  note: string
}

export interface EngineReport {
  engine: string
  package: string
  status: 'queried' | 'blocked'
  baseline: EngineBaselineFacts
  fixed: string
  source?: { source: string; queriedAt: string }
  published?: { total: number; stable: string[]; prerelease: string[]; invalid: string[]; tags: Record<string, string>; untagged: string[] }
  candidates?: { stable: string | null; prerelease: string | null; highest: string | null }
  update?: UpdateBasis | null
  patches?: PatchItem[]
  record?: { source: string; queriedAt: string; timeout: boolean; detail: string | null }
}

export interface EnginesAreaResult extends AreaResult {
  engines: EngineReport[]
  releaseQueries: { package: string; mode: string }[]
  cacheUsed: false
}

export function classifyVersions(versions: string[]): VersionChannels
export function highest(versions: string[]): string | undefined
export function newerThan(options: { fixed: string; ordered: string[] }): string[]
export function updateBasis(options: { fixed: string; candidate: string; ordered: string[] }): UpdateBasis
export function normalizeReleaseSource(record: Record<string, unknown>): ReleaseSourceRecord
export function normalizeReleaseSources(records: Record<string, unknown>[]): Map<string, ReleaseSourceRecord>
export function queryReleaseSource(options: {
  package: string
  queriedAt: string
  timeoutMs?: number
  runner?: Function
}): ReleaseSourceRecord
export function engineBaseline(project: ProjectBaseline, engine: string): EngineBaselineFacts
export function patchItems(engine: string, baseline: EngineBaselineFacts, candidate: string | undefined): PatchItem[]
export function compareEnginesArea(context: {
  project: ProjectBaseline
  options?: { releaseSources?: Map<string, ReleaseSourceRecord>; sources?: RawReleaseSource[]; queryTimeoutMs?: number; deps?: { runner?: Function } }
  now?: string
}): EnginesAreaResult
export const ENGINES_COMPARATOR: {
  area: 'engines'
  version: number
  compare: (context: { project: ProjectBaseline; options?: Record<string, unknown>; now?: string }) => EnginesAreaResult
}
