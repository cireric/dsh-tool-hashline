/** Type surface for the delivery-acceptance harness (scripts/delivery-acceptance*.mjs). */

export function enginePinsFromAnchors(hashlineAnchor: { dependencies?: Record<string, string> }, editAnchor: { dependencies?: Record<string, string> }): Record<string, string>

export interface AcceptanceRow {
  id: string
  part: string
  /** Present on every recorded row; the verdict rule reads it as "not a failure". */
  ok?: boolean
  gap?: boolean
  detail: string
}

/** The subset of a row the verdict rule inspects. */
export type VerdictInput = Pick<Partial<AcceptanceRow>, 'ok' | 'gap'> & { ok?: boolean }

export interface AcceptanceGate {
  command: string
  exitCode: number
  note: string
}

export interface AcceptanceRun {
  startedAt: string
  finishedAt?: string
  rows: AcceptanceRow[]
  gates: AcceptanceGate[]
  boundaries: string[]
  acceptanceIds: readonly string[]
  install?: { bundleRoot: string; profile: string }
}

export interface AcceptanceSummary {
  startedAt: string
  finishedAt?: string
  install?: { bundleRoot: string; profile: string }
  verdicts: Record<string, string>
  sections: { title: string; ids: readonly string[]; verdict: string; cases: number }[]
  rows: AcceptanceRow[]
  gates: AcceptanceGate[]
  boundaries: string[]
  counts: Record<string, number>
}

export const ACCEPTANCE_IDS: readonly string[]
/** The driver source that mounts the installed skill rows (pinned against the source harness by a test). */
export const SKILL_LAYER_DRIVER: string
export const REPORT_SECTIONS: { title: string; ids: readonly string[] }[]
export const STATUS: { pass: string; fail: string; gap: string; blocked: string }
export const GATES: { command: string; argv: string[]; env?: string }[]

export interface ReportNames { report: string; summary: string }

export function reportNames(startedAt: string): ReportNames
export function boundariesFor(upgrade: Record<string, unknown> | undefined): string[]
export function profileNames(home: string): Promise<string[]>
export function dshCliEnv(): Record<string, string>
export function runAcceptance(options?: { gates?: boolean; keep?: boolean; out?: string }): Promise<{ report: string; summary: AcceptanceSummary; directory: string }>

export function redact(value: unknown): string
export function byAcceptanceId(rows: AcceptanceRow[], acceptanceIds: readonly string[]): Map<string, AcceptanceRow[]>
export function verdictOf(rows: VerdictInput[]): string
export function renderReport(run: AcceptanceRun): string
export function renderSummary(run: AcceptanceRun): AcceptanceSummary

export function nextVersion(version: string): string
export function writeMaintenanceRepository(repository: string, versions: { hashline: string; toolEdit: string }): Promise<void>
/**
 * The one-off target profile, started INSTALLED at the baseline engine pair: an
 * empty profile has no measurable baseline, so a restore could never claim it
 * came back to one (D15/UPG-12).
 */
export function writeTargetProfile(home: string, repository: string, versions: { hashline: string; toolEdit: string }): Promise<string>
