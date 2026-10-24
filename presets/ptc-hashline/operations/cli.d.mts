/** Type surface for the operations CLI (operations/cli.mjs). */
import type { BaselineReport } from './baseline.mjs'
import type { DescribedConfig } from './config.mjs'
import type { InvocationVerdict } from './context.mjs'
import type { IncidentReport, IncidentIssueRegistration } from './incidents.mjs'

export const EXIT: { ok: 0; stopped: 2; refused: 3 }

export function installationRoot(): string

export function parseFlags(argv: string[]): Record<string, string | true>

export interface CliEnvironment {
  env: Record<string, string | undefined>
  sessionsRoot?: string
  stateDir?: string
}

export interface ResolvedEnvironment {
  sessionsRoot: string
  stateDir: string
  dshHome: string
  sessionId?: string
  cwd: string
}

export function resolveEnvironment(environment: CliEnvironment): ResolvedEnvironment

/** The session being ANALYZED, which the spec allows to be a historical one. Reported only; it never authorizes this session. */
/** The session being ANALYZED, which the spec allows to be a historical one. Reported only; it never authorizes this session. */
export interface AnalyzedTarget {
  session: string
  cwd: string
  note: string
}

export interface ContextValue extends InvocationVerdict { command: 'context'; target: AnalyzedTarget }
export interface BaselineValue {
  command: 'baseline'
  baseline: BaselineReport
  context: { eligible: boolean; status: string; reason?: string }
}

/** The incident command: a written evidence bundle plus its counts and gaps. */
export interface IncidentValue {
  command: 'incident'
  status: 'complete' | 'incomplete' | 'stopped' | 'read-only' | 'missing' | 'unsupported-generation'
  reason?: string
  counts?: IncidentReport['counts']
  gaps?: string[]
  findings?: { kind: string; name: string; seq: number }[]
  issues?: IncidentIssueRegistration
  evidence?: { directory: string; files: { summary: string; incident: string; baseline: string; excerpt: string } }
  context: { eligible: boolean; status: string; reason?: string }
  target?: { session: string; cwd: string }
}

/** One command's answer: the argv's first token selects the value shape. */
export type CliValue = ContextValue | ConfigValue | BaselineValue | IncidentValue

export function run(argv: ['context', ...string[]], environment?: CliEnvironment): Promise<{ code: number; value: ContextValue }>
export function run(argv: ['config', ...string[]], environment?: CliEnvironment): Promise<{ code: number; value: ConfigValue }>
export function run(argv: ['baseline', ...string[]], environment?: CliEnvironment): Promise<{ code: number; value: BaselineValue }>
export function run(argv: ['incident', ...string[]], environment?: CliEnvironment): Promise<{ code: number; value: IncidentValue }>
export function run(argv: string[], environment?: CliEnvironment): Promise<{ code: number; value: CliValue }>

export function main(argv: string[]): Promise<number>