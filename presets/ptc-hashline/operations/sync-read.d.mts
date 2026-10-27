/** Type surface for the stock-read comparator (operations/sync-read.mjs). */
import type { AreaResult, DshSourceIdentity, ProjectBaseline } from './sync.mjs'

export const STOCK_READ_AREA: 'stock-read'
export const STOCK_READ_COMPARATOR_VERSION: 2
export const STOCK_READ_FILES: Record<string, string>
export const OUR_READ_FILES: Record<string, string>

export interface ReadProbe {
  source: string
  tokens?: string[]
  constant?: string
  sources?: string[]
  absentTokens?: string[]
}

export interface ReadContractPoint {
  id: string
  dimension: string
  statement: string
  ours: ReadProbe
  theirs: ReadProbe
  recheckWhen: string
}

export interface ReadValuePoint {
  id: string
  dimension: string
  statement: string
  ours: ReadProbe
  theirs: ReadProbe
  recheckWhen: string
}

export interface ReadDocumentedDifference extends ReadContractPoint {
  impact: string
  disposition: 'keep' | 'not-applicable'
  basis: string
  reason: string
}

export interface ReadScopeExclusion {
  id: string
  dimension: string
  statement: string
  theirs: ReadProbe
  reason: string
  recheckWhen: string
}

export const STOCK_READ_CONTRACTS: ReadContractPoint[]
export const STOCK_READ_VALUES: ReadValuePoint[]
export const READ_DOCUMENTED_DIFFERENCES: ReadDocumentedDifference[]
export const READ_SCOPE_EXCLUSIONS: ReadScopeExclusion[]

export function numericValue(expression: string): number | undefined
export function declaredConstant(text: string, constant: string): string | undefined
export function compareStockReadArea(context: { source: DshSourceIdentity; project: ProjectBaseline }): AreaResult
export const STOCK_READ_COMPARATOR: {
  area: 'stock-read'
  version: number
  compare: (context: { source: DshSourceIdentity; project: ProjectBaseline }) => AreaResult
}
