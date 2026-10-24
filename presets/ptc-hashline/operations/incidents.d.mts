/** Type surface for the incident evidence assembler (operations/incidents.mjs). */

export const INCIDENT_TOOL: string
export const INCIDENT_VERSION: number
export const DEFAULT_FEATURE: string
export const TRIAGE_STATUS: 'needs-triage'

export type IncidentKind =
  | 'success'
  | 'expected-refusal'
  | 'model-parameter-error'
  | 'environment-problem'
  | 'suspected-implementation-defect'
  | 'partial-success'
  | 'cancelled'
  | 'insufficient-evidence'
  | 'user-reported-mismatch'

export type IncidentSeverity = 'info' | 'warning' | 'high' | 'unknown'

export type IncidentState = 'completed' | 'started' | 'denied' | 'settled-without-start'

export function redactText(text: string, options?: { home?: string }): string

export function errorCodeOf(body: string | undefined): string | null

export function classifyEvent(event: { state: string; isError: boolean | null; body?: string }): { kind: IncidentKind; severity: IncidentSeverity; detail: string }

export function validateSeqBounds(seqMin?: number, seqMax?: number): { min: number; max: number } | undefined

export function redactDeep(value: unknown, options?: { home?: string }): unknown

export interface IncidentEvent {
  seq: number
  startSeq: number | null
  doneSeq: number | null
  via: 'direct' | 'ptc'
  name: string
  turn: number | null
  state: IncidentState
  isError: boolean | null
  errorCode: string | null
  kind: IncidentKind
  severity: IncidentSeverity
  detail: string
  firstLine: string
}

export interface IncidentReport {
  tool: string
  version: number
  generatedAt: string
  invocation: { eligible: boolean; preset: string | null; reason: string | null; source: string | null }
  target: {
    sessionId: string
    cwd: string
    directory: string
    source: { path: string; bytes: number | null; sha256: string | null; format: string | null; frames: number | null; tornStart: number | null }
  }
  conversation: { lastUserMessage: { seq: number; firstLine: string } | null }
  route: { provider?: string; model?: string }
  range: {
    requested: { min: number; max: number } | null
    effective: { min: number; max: number } | null
    available: { first: number | null; last: number | null }
    recordsInRange: number
    covered: boolean
  }
  integrity: { status: 'complete' | 'incomplete'; issues: string[]; note: string }
  counts: { events: number; states: Record<string, number>; kinds: Record<string, number>; severities: Record<string, number> }
  events: IncidentEvent[]
  userReport: {
    kind: 'user-reported-mismatch'
    severity: IncidentSeverity
    statement: string
    relatedEventSeqs: number[]
    verification: 'independent-evidence-required'
    note: string
  } | null
  redaction: { applied: boolean; note: string }
  issues?: IncidentIssueRegistration
}

export interface IncidentFinding extends Partial<IncidentEvent> {
  kind: IncidentKind
  severity: IncidentSeverity
  name: string
  via: string
  state: string
  startSeq: number | null
  doneSeq: number | null
  firstLine: string
  errorCode: string | null
}

export interface IncidentIssueRegistration {
  configured: boolean
  directory: string | null
  written: { path: string; number: string; status: 'needs-triage'; kind: IncidentKind }[]
  skipped: { reason: string }[]
}

export interface IncidentFiles {
  summary: string
  incident: string
  baseline: string
  excerpt: string
}

export function buildIncident(options: {
  artifact: {
    directory?: string
    path?: string
    bytes?: number
    format?: string
    frames?: number
    tornStart?: number
    records?: Record<string, unknown>[]
    failures?: { line: number; message: string }[]
    buffer?: Buffer
  }
  targetSessionId: string
  targetCwd?: string
  seqMin?: number
  seqMax?: number
  userReport?: string
  generatedAt?: string
  invocation?: { eligible: boolean; reason?: string; evidence?: { effectivePreset?: string | null; source?: string | null } }
  home?: string
}): IncidentReport

export function incidentDirectory(evidenceDirectory: string, sessionId: string, at?: string | Date): string

export function renderSummaryMarkdown(incident: IncidentReport): string

export function writeIncidentBundle(options: { directory: string; incident: IncidentReport; baseline: object }): Promise<IncidentFiles>

export function collectFindings(incident: IncidentReport): IncidentFinding[]

export function registerNeedsTriageIssues(options: {
  maintenanceRepository: string
  feature: string
  incident: IncidentReport
  directory: string
}): Promise<IncidentIssueRegistration>
