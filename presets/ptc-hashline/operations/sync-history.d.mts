/** Type surface for repeat checks and review decisions (operations/sync-history.mjs). */

export const DECISIONS_FORMAT: 'ptc-hashline-sync-decisions/1'
export const DECISIONS_FILE: 'decisions.json'
export const DECISION_DISPOSITIONS: readonly ['follow-up', 'keep', 'pending-analysis', 'not-applicable']
export const SETTLED_DISPOSITIONS: readonly ['keep', 'follow-up', 'not-applicable']
export const CHANGE_STATUS: readonly ['new', 'unchanged', 'known', 'stale-decision', 'undecided']
export const HISTORY_STATUS: readonly ['absent', 'unreadable', 'unsupported', 'compared']
export const ROUND_VERDICT: readonly ['first-check', 'history-unavailable', 'no-new-changes', 'new-changes', 'decisions-need-review']

export interface ReviewDecision {
  id: string
  disposition: 'follow-up' | 'keep' | 'pending-analysis' | 'not-applicable'
  reason: string
  identity: { left: string; right: string }
  recheckWhen: string
  basis: string
  evidence: string[]
  decidedAt: string
  reviewer: string
}

export interface DecisionsRead {
  status: 'absent' | 'loaded' | 'invalid'
  path: string
  decisions: Map<string, ReviewDecision>
  detail: string
}

export interface PreviousRound {
  status: 'absent' | 'unreadable' | 'unsupported' | 'compared'
  previous: null | {
    checkId: string
    checkedAt: string
    status: string
    differences: Map<string, { left: string; right: string; disposition: string; area: string }>
  }
  detail: string
}

export interface HistoryEntry {
  id: string
  area?: string
  status: 'new' | 'unchanged' | 'known' | 'stale-decision' | 'undecided'
  disposition?: string
  decisionId?: string
  note?: string
  previous?: { left: string; right: string }
}

export interface HistorySection {
  historyStatus: string
  historyDetail: string
  previous: null | { checkId: string; checkedAt: string; status: string }
  decisions: { path: string; status: string; count: number; detail: string }
  verdict: string
  summary: { total: number; new: number; undecided: number; known: number; staleDecisions: number; orphans: number }
  entries: HistoryEntry[]
  orphans: { id: string; disposition: string; note: string }[]
}

export function isConcreteIdentity(value: unknown): boolean
export function readDecisions(options: { path: string; text?: string }): Promise<DecisionsRead>
export function normalizeDecisions(parsed: unknown): Map<string, ReviewDecision>
export function readPreviousRound(options: { evidenceDirectory: string; format: string }): PreviousRound
export function compareWithHistory(options: {
  differences: Record<string, any>[]
  decisions: Map<string, ReviewDecision>
  history: PreviousRound
  decisionsPath?: string
  decisionsStatus?: string
  decisionsDetail?: string
}): HistorySection
export function renderHistorySection(history: HistorySection | null | undefined): string[]
