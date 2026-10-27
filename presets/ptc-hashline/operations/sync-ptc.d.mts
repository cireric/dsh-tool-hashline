/** Type surface for the PTC comparator (operations/sync-ptc.mjs). */
import type { AreaResult, DshSourceIdentity, ProjectBaseline } from './sync.mjs'

export const PTC_AREA: 'ptc'
export const PTC_COMPARATOR_VERSION: 2
export const PTC_UPSTREAM_PRESET: string
export const PTC_LOCAL_PRESET: string

export interface PtcContract {
  id: string
  source: string
  statement: string
  tokens: string[]
  recheckWhen: string
}

export interface PtcKeepEntry {
  id: string
  /** Which ends must carry the object for the keep reason to describe this round. */
  expect: { left: boolean; right: boolean }
  basis: string
  reason: string
  recheckWhen: string
}

export const PTC_CONTRACTS: PtcContract[]
export const PTC_KEEP_LIST: PtcKeepEntry[]

export interface PresetRow {
  id: string
  path: string[]
  row: Record<string, unknown>
}

export interface PresetModel {
  label: string
  path: string
  present: boolean
  sha256?: string
  problem?: string
  preset?: { id: string | null; name: string | null; order: number | null; description: string | null }
  rows?: PresetRow[]
}

export function readPresetModel(absolute: string, label: string): PresetModel
export function comparePtcArea(context: { source: DshSourceIdentity; project: ProjectBaseline }): AreaResult
export const PTC_COMPARATOR: {
  area: 'ptc'
  version: number
  compare: (context: { source: DshSourceIdentity; project: ProjectBaseline }) => AreaResult
}
export { stableJson } from './sync-hash.mjs'
