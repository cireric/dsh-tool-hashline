/**
 * INC-07 + SCOPE-06: a repeated class of failure links the existing issue, keeps
 * this occurrence's own evidence and baseline, and records a later retry success
 * as a recovery instead of closing anything.
 *
 * The seam is the same one ticket 02 established: the operations CLI
 * (`run(['incident', ...])`) plus the files it writes — the evidence bundle and
 * the issue package under `.scratch/<feature>/issues/`. Every acceptance point
 * below is observable there, without reaching into internals.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EXIT, run } from '../../presets/ptc-hashline/operations/cli.mjs'
import { saveConfig } from '../../presets/ptc-hashline/operations/config.mjs'
import { normalizeFirstLine } from '../../presets/ptc-hashline/operations/incidents.mjs'
import { encodeSegment, projectKey } from '../../presets/ptc-hashline/operations/session-log.mjs'

const SESSION_A = 'session-recurrence-a'
const SESSION_B = 'session-recurrence-b'
const SESSION_C = 'session-recurrence-c'
const PARENT = 'session-recurrence-parent'
const WORKSPACE = '/work/recurrence-project'
const FEATURE = 'ptc-hashline-operations-skills'
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

const record = (value: Record<string, unknown>) => JSON.stringify(value)
const header = (id: string, cwd = WORKSPACE, extra: Record<string, unknown> = {}) =>
  record({ type: 'session', version: 4, id, cwd, agentPreset: 'ptc-hashline', ...extra })
const seqZero = record({ type: 'permission/preset', seq: 0, data: { preset: 'workspace-write' } })
const preset = record({ type: 'agent-preset/selected', seq: 1, data: { agentPreset: 'ptc-hashline' } })
const user = (seq: number, text: string) => record({ type: 'user/message', seq, data: { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } })
const assistant = (seq: number, text: string) => record({ type: 'assistant/message', seq, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } } })
// The host's own route record: the baseline of one occurrence is not guessed
// from the process, so two sessions can carry two different baselines.
const route = (seq: number, model: string) => record({ type: 'request/header', seq, data: { header: { config: { provider: 'test-provider', model } } } })
const call = (seq: number, name: string, callId = 'c1', args = '{}') => record({ type: 'tool/call', seq, data: { turn: 1, step: 1, callId, name, arguments: args } })
const startEvent = (seq: number, name: string, subCallId = 's1', rootCallId = 'c1') => record({ type: 'tool/ptc-dispatch-start', seq, data: { rootCallId, parentCallId: rootCallId, subCallId, name } })
const settle = (seq: number, name: string, body = '', options: { isError?: boolean; subCallId?: string; rootCallId?: string } = {}) => record({
  type: 'tool/ptc-dispatch',
  seq,
  data: {
    rootCallId: options.rootCallId ?? 'c1',
    parentCallId: options.rootCallId ?? 'c1',
    subCallId: options.subCallId ?? 's1',
    name,
    isError: options.isError ?? body.includes('[intent-gate]'),
    content: body === '' ? [] : [{ type: 'text', text: body }],
  },
})
const result = (seq: number, text: string, callId = 'c1', isError = false) => record({ type: 'tool/result', seq, data: { turn: 1, step: 1, toolCallId: callId, isError, message: { role: 'tool', isError, content: [{ type: 'text', text }] } } })

async function addSession(root: string, id: string, cwd: string, lines: string[]): Promise<void> {
  const directory = path.join(root, projectKey(cwd), encodeSegment(id))
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'session.v4.jsonl'), lines.join('\n') + '\n', 'utf8')
}

async function configured(): Promise<{ state: string; repository: string; evidence: string }> {
  const state = await temp('recurrence-state-')
  const repository = await temp('recurrence-repo-')
  const evidence = await temp('recurrence-evidence-')
  await saveConfig({ directory: state, maintenanceRepository: repository, evidenceDirectory: evidence })
  return { state, repository, evidence }
}

function runIncident(root: string, state: string, argv: string[] = [], sessionId: string = SESSION_A) {
  return run(['incident', ...argv] as ['incident', ...string[]], { env: { DSH_SESSION_ID: sessionId, PWD: WORKSPACE }, sessionsRoot: root, stateDir: state })
}

/** One session whose tool call failed with `body`, optionally retried later. */
function failingSession(options: {
  sessionId: string
  model: string
  body: string
  tool?: string
  retrySucceeds?: boolean
  extraHeader?: Record<string, unknown>
}): string[] {
  const tool = options.tool ?? 'edit'
  const lines = [
    header(options.sessionId, WORKSPACE, options.extraHeader ?? {}),
    seqZero,
    preset,
    user(2, 'fix the bug'),
    assistant(3, 'Intent: fix — repair the parser'),
    route(4, options.model),
    call(5, 'run_code', 'c1'),
    startEvent(6, tool, 's1'),
    settle(7, tool, options.body, { isError: true, subCallId: 's1' }),
    ...options.retrySucceeds === true
      ? [startEvent(8, tool, 's2'), settle(9, tool, '', { subCallId: 's2' }), result(10, 'done', 'c1', false)]
      : [result(8, 'done', 'c1', false)],
  ]
  return lines
}

const LAST_SEQ = 10

async function readJson<T = any>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

async function issueFiles(repository: string): Promise<string[]> {
  const directory = path.join(repository, '.scratch', FEATURE, 'issues')
  try {
    return (await readdir(directory)).filter(name => name.endsWith('.md')).sort().map(name => path.join(directory, name))
  } catch {
    return []
  }
}

type IncidentRun = Awaited<ReturnType<typeof runIncident>>

function issuesOf(report: IncidentRun): any {
  const issues = report.value.issues
  if (issues === undefined) throw new Error('the incident command reported no issue registration')
  return issues
}

function incidentOf(report: IncidentRun): Promise<any> {
  const evidence = report.value.evidence
  if (evidence === undefined) throw new Error('the incident command wrote no evidence bundle')
  return readJson(path.join(evidence.directory, 'incident.json'))
}

const CLASS_A = 'ToolOutputError: edit returned a value for "alpha.txt" that violates its own schema'
const CLASS_B = 'ToolOutputError: edit returned a value for "beta.txt" that violates its own schema'

describe('same-class normalisation', () => {
  it('masks the volatile parts of a first line but not the class itself', () => {
    // Two instances of one class differ only in their payload, its size and the
    // byte offset they name: they must share a fingerprint.
    expect(normalizeFirstLine('ToolOutputError: cannot read "alpha.txt" at byte 42')).toBe(
      normalizeFirstLine('tooloutputerror: cannot read "beta.txt"   at byte 7'),
    )
    expect(normalizeFirstLine('FS_NOT_FOUND: at 2026-01-02T03:04:05.678Z 0xdeadbeef')).toContain('<time>')
    // A different class stays different.
    expect(normalizeFirstLine('ToolOutputError: schema')).not.toBe(normalizeFirstLine('SnapshotCommitError: bookkeeping'))
  })
})

describe('INC-07: the first occurrence opens the issue with a same-class fingerprint', () => {
  it('stores kind, tool and normalised first line so a repeat can be matched', async () => {
    const root = await temp('recurrence-sessions-')
    const { state, repository } = await configured()
    await addSession(root, SESSION_A, WORKSPACE, failingSession({ sessionId: SESSION_A, model: 'model-a', body: CLASS_A }))
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'])
    expect(report.code).toBe(EXIT.ok)
    const issues = issuesOf(report)
    expect(issues.written).toHaveLength(1)
    expect(issues.associated).toEqual([])
    expect(issues.written[0].recurrenceKey).toBe('suspected-implementation-defect|edit|' + normalizeFirstLine(CLASS_A))
    const files = await issueFiles(repository)
    expect(files).toHaveLength(1)
    const text = await readFile(files[0]!, 'utf8')
    expect(text).toContain('## 同类判据')
    expect(text).toContain(normalizeFirstLine(CLASS_A))
    expect(text).toContain('### 发生 1 ·')
    // The first occurrence is a record, not a second copy of the evidence body.
    expect(text).toContain('**Status:** needs-triage')
  })
})

describe('INC-07: a repeat links the existing issue and appends exactly one record', () => {
  it('appends one occurrence record, keeps Status, keeps the old evidence and its own baseline', async () => {
    const root = await temp('recurrence-sessions-')
    const { state, repository } = await configured()
    await addSession(root, SESSION_A, WORKSPACE, failingSession({ sessionId: SESSION_A, model: 'model-a', body: CLASS_A }))
    await addSession(root, SESSION_B, WORKSPACE, failingSession({ sessionId: SESSION_B, model: 'model-b', body: CLASS_B }))
    const first = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'], SESSION_A)
    expect(first.code).toBe(EXIT.ok)
    const files = await issueFiles(repository)
    expect(files).toHaveLength(1)
    const before = await readFile(files[0]!, 'utf8')

    // A different session, a different first-line payload and a different
    // recorded route: same class, so it must NOT become a second issue.
    const second = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'], SESSION_B)
    expect(second.code).toBe(EXIT.ok)
    const issues = issuesOf(second)
    expect(issues.written).toEqual([])
    expect(issues.associated).toHaveLength(1)
    expect(issues.associated[0].number).toBe('01')
    expect(issues.associated[0].occurrence).toBe(2)
    expect(issues.associated[0].statusChanged).toBe(false)
    expect(issues.associated[0].duplicate).toBe(false)

    const after = await readFile(files[0]!, 'utf8')
    // Append-only by construction: the older bytes are still there, verbatim.
    expect(after.startsWith(before)).toBe(true)
    expect(after.match(/^\*\*Status:\*\* .*$/gmu)).toEqual(['**Status:** needs-triage'])
    expect(after).toContain(CLASS_A)
    expect(after).toContain('### 发生 2 ·')
    expect(after).toContain(SESSION_B)
    expect(after).toContain('Status 未改变')
    // Each occurrence carries the baseline it happened under: the first one
    // keeps its own, the appended one carries the newer route.
    expect(after).toContain('model-a')
    expect(after).toContain('model-b')
  })

  it('opens a separate issue for a genuinely different class', async () => {
    const root = await temp('recurrence-sessions-')
    const { state, repository } = await configured()
    await addSession(root, SESSION_A, WORKSPACE, failingSession({ sessionId: SESSION_A, model: 'model-a', body: CLASS_A }))
    await addSession(root, SESSION_C, WORKSPACE, failingSession({ sessionId: SESSION_C, model: 'model-c', body: CLASS_A, tool: 'read' }))
    const first = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'], SESSION_A)
    expect(first.code).toBe(EXIT.ok)
    const filesAfterFirst = await issueFiles(repository)
    const before = await readFile(filesAfterFirst[0]!, 'utf8')

    // Same text, different tool: a different class, so a different issue.
    const second = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'], SESSION_C)
    expect(second.code).toBe(EXIT.ok)
    const issues = issuesOf(second)
    expect(issues.associated).toEqual([])
    expect(issues.written).toHaveLength(1)
    expect(issues.written[0].number).toBe('02')
    const files = await issueFiles(repository)
    expect(files).toHaveLength(2)
    expect(await readFile(filesAfterFirst[0]!, 'utf8')).toBe(before)
  })

  it('never appends the same occurrence twice', async () => {
    const root = await temp('recurrence-sessions-')
    const { state, repository } = await configured()
    await addSession(root, SESSION_A, WORKSPACE, failingSession({ sessionId: SESSION_A, model: 'model-a', body: CLASS_A }))
    const first = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8', '--now', '2026-01-01T00:00:00.000Z'], SESSION_A)
    expect(first.code).toBe(EXIT.ok)
    const files = await issueFiles(repository)
    const before = await readFile(files[0]!, 'utf8')

    // The same session and range analyzed again is the same occurrence.
    const again = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8', '--now', '2026-01-01T00:05:00.000Z'], SESSION_A)
    expect(again.code).toBe(EXIT.ok)
    const issues = issuesOf(again)
    expect(issues.written).toEqual([])
    expect(issues.associated).toHaveLength(1)
    expect(issues.associated[0].duplicate).toBe(true)
    expect(await readFile(files[0]!, 'utf8')).toBe(before)
  })
})

describe('INC-07: a later retry success records a recovery and closes nothing', () => {
  it('records \u300c本次已恢复\u300d on the existing issue without changing its status', async () => {
    const root = await temp('recurrence-sessions-')
    const { state, repository } = await configured()
    await addSession(root, SESSION_A, WORKSPACE, failingSession({ sessionId: SESSION_A, model: 'model-a', body: CLASS_A }))
    await addSession(root, SESSION_B, WORKSPACE, failingSession({ sessionId: SESSION_B, model: 'model-b', body: CLASS_B, retrySucceeds: true }))
    const first = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'], SESSION_A)
    expect(first.code).toBe(EXIT.ok)

    const second = await runIncident(root, state, ['--seq-min', '0', '--seq-max', String(LAST_SEQ)], SESSION_B)
    expect(second.code).toBe(EXIT.ok)
    const issues = issuesOf(second)
    expect(issues.associated).toHaveLength(1)
    expect(issues.recoveries).toHaveLength(1)
    expect(issues.recoveries[0].statement).toBe('本次已恢复')
    // Cited at the seq the retry SETTLED on (9): that is when it succeeded.
    expect(issues.recoveries[0].evidenceSeqs).toEqual([9])
    expect(issues.recoveries[0].closed).toBe(false)

    const files = await issueFiles(repository)
    const text = await readFile(files[0]!, 'utf8')
    expect(text).toContain('### 恢复 1 ·')
    expect(text).toContain('\u672c\u6b21\u5df2\u6062\u590d')
    expect(text).toContain('不自动关闭')
    // A recovery is a record, never a status transition.
    expect(text.match(/^\*\*Status:\*\* .*$/gmu)).toEqual(['**Status:** needs-triage'])
    const incident = await incidentOf(second)
    expect(incident.issues.recoveries[0].statement).toBe('本次已恢复')
    const summary = await readFile(path.join(second.value.evidence!.directory, 'summary.md'), 'utf8')
    expect(summary).toContain('本次已恢复')
  })

  it('records no recovery when the retry never succeeded', async () => {
    const root = await temp('recurrence-sessions-')
    const { state, repository } = await configured()
    await addSession(root, SESSION_A, WORKSPACE, failingSession({ sessionId: SESSION_A, model: 'model-a', body: CLASS_A }))
    await addSession(root, SESSION_B, WORKSPACE, failingSession({ sessionId: SESSION_B, model: 'model-b', body: CLASS_B }))
    expect((await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'], SESSION_A)).code).toBe(EXIT.ok)
    const second = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'], SESSION_B)
    expect(issuesOf(second).recoveries).toEqual([])
    const files = await issueFiles(repository)
    expect(await readFile(files[0]!, 'utf8')).not.toContain('### 恢复')
  })

  it('keeps secrets out of the appended occurrence record', async () => {
    const secret = 'sk-liveabcxyz0123456789'
    const root = await temp('recurrence-sessions-')
    const { state, repository } = await configured()
    await addSession(root, SESSION_A, WORKSPACE, failingSession({ sessionId: SESSION_A, model: 'model-a', body: CLASS_A }))
    // The secret sits inside the payload the fingerprint masks, so this is the
    // same class as CLASS_A and must be appended to the same issue — masked.
    await addSession(root, SESSION_B, WORKSPACE, failingSession({
      sessionId: SESSION_B,
      model: 'model-b',
      body: 'ToolOutputError: edit returned a value for "' + secret + '" that violates its own schema',
    }))
    expect((await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'], SESSION_A)).code).toBe(EXIT.ok)
    const second = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'], SESSION_B)
    expect(second.code).toBe(EXIT.ok)
    const files = await issueFiles(repository)
    expect(files).toHaveLength(1)
    expect(await readFile(files[0]!, 'utf8')).not.toContain(secret)
  })

  it('adds the recovery on a widened re-analysis without appending the occurrence again', async () => {
    const root = await temp('recurrence-sessions-')
    const { state, repository } = await configured()
    // The wrapper settles at 8; the retry that succeeds runs afterwards at 9/10.
    await addSession(root, SESSION_A, WORKSPACE, [
      header(SESSION_A),
      seqZero,
      preset,
      user(2, 'fix the bug'),
      assistant(3, 'Intent: fix — repair the parser'),
      route(4, 'model-a'),
      call(5, 'run_code', 'c1'),
      startEvent(6, 'edit', 's1'),
      settle(7, 'edit', CLASS_A, { isError: true, subCallId: 's1' }),
      result(8, 'done', 'c1', false),
      startEvent(9, 'edit', 's2'),
      settle(10, 'edit', '', { subCallId: 's2' }),
    ])
    // First analysis stops before the retry: one occurrence, no recovery yet.
    const first = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'], SESSION_A)
    expect(first.code).toBe(EXIT.ok)
    expect(issuesOf(first).recoveries).toEqual([])
    // The log grew in place (same file, same seqs for the failure). The same range
    // is the same occurrence: only the NEW fact — the retry success — is added.
    const second = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '10'], SESSION_A)
    expect(second.code).toBe(EXIT.ok)
    const issues = issuesOf(second)
    expect(issues.written).toEqual([])
    expect(issues.associated).toHaveLength(1)
    expect(issues.associated[0].duplicate).toBe(true)
    expect(issues.associated[0].appended).toBe(true)
    expect(issues.associated[0].occurrence).toBe(1)
    expect(issues.recoveries).toHaveLength(1)
    expect(issues.recoveries[0].evidenceSeqs).toEqual([10])
    const files = await issueFiles(repository)
    expect(files).toHaveLength(1)
    const text = await readFile(files[0]!, 'utf8')
    expect(text.match(/^### 发生 \d+ · /gmu)).toHaveLength(1)
    expect(text).toContain('### 恢复 1 ·')
    expect(text.match(/^\*\*Status:\*\* .*$/gmu)).toEqual(['**Status:** needs-triage'])
  })

  it('still links a ticket whose file was checked out with CRLF', async () => {
    const root = await temp('recurrence-sessions-')
    const { state, repository } = await configured()
    await addSession(root, SESSION_A, WORKSPACE, failingSession({ sessionId: SESSION_A, model: 'model-a', body: CLASS_A }))
    await addSession(root, SESSION_B, WORKSPACE, failingSession({ sessionId: SESSION_B, model: 'model-b', body: CLASS_B }))
    expect((await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'], SESSION_A)).code).toBe(EXIT.ok)
    const files = await issueFiles(repository)
    // A CRLF checkout must not turn the next occurrence into a second ticket.
    await writeFile(files[0]!, (await readFile(files[0]!, 'utf8')).replace(/\n/gu, '\r\n'), 'utf8')
    const second = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'], SESSION_B)
    expect(second.code).toBe(EXIT.ok)
    expect(issuesOf(second).written).toEqual([])
    expect(issuesOf(second).associated).toHaveLength(1)
    expect(await issueFiles(repository)).toHaveLength(1)
    expect(await readFile(files[0]!, 'utf8')).toContain('### 发生 2 ·')
  })
})

describe('SCOPE-06: a same-preset subagent may assist the analysis, never approve', () => {
  it('lets a subagent session run the analysis and records its role in the bundle', async () => {
    const root = await temp('recurrence-sessions-')
    const { state } = await configured()
    await addSession(root, SESSION_A, WORKSPACE, failingSession({
      sessionId: SESSION_A,
      model: 'model-a',
      body: CLASS_A,
      extraHeader: { origin: 'subagent', parentSession: PARENT, delegationDepth: 1 },
    }))
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'], SESSION_A)
    // Analysis is the assisted branch: it is allowed and writes its package.
    expect(report.code).toBe(EXIT.ok)
    const incident = await incidentOf(report)
    expect(incident.invocation.delegation.role).toBe('subagent')
    expect(incident.invocation.delegation.parentSession).toBe(PARENT)
    expect(incident.invocation.delegation.delegationDepth).toBe(1)
    expect(incident.invocation.delegation.mayAssistAnalysis).toBe(true)
    // An agent's own message is never the user's consent.
    expect(incident.invocation.delegation.mayApproveUpgrade).toBe(false)
  })

  it('marks a report supplied by an assisted session as an agent statement', async () => {
    const root = await temp('recurrence-sessions-')
    const { state } = await configured()
    // Same preset, but the header says this session is a subagent of PARENT.
    await addSession(root, SESSION_A, WORKSPACE, failingSession({
      sessionId: SESSION_A,
      model: 'model-a',
      body: CLASS_A,
      extraHeader: { origin: 'subagent', parentSession: PARENT, delegationDepth: 1 },
    }))
    await addSession(root, SESSION_B, WORKSPACE, failingSession({ sessionId: SESSION_B, model: 'model-b', body: CLASS_B }))
    const assisted = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8', '--user-report', 'the bytes are wrong'], SESSION_A)
    expect(assisted.code).toBe(EXIT.ok)
    const assistedIncident = await incidentOf(assisted)
    // Provenance is recorded, not silently promoted to the user's own words.
    expect(assistedIncident.userReport.source).toBe('subagent')
    expect(assistedIncident.userReport.standsForUser).toBe(false)
    const summary = await readFile(path.join(assisted.value.evidence!.directory, 'summary.md'), 'utf8')
    expect(summary).toContain('an agent statement, not a user confirmation')

    const ownRun = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8', '--user-report', 'the bytes are wrong'], SESSION_B)
    const ownIncident = await incidentOf(ownRun)
    expect(ownIncident.userReport.source).toBe('user')
    expect(ownIncident.userReport.standsForUser).toBe(true)
  })

  it('reports the delegation rule through the context command for both roles', async () => {
    const root = await temp('recurrence-sessions-')
    const { state } = await configured()
    await addSession(root, SESSION_A, WORKSPACE, [header(SESSION_A), seqZero, preset, user(2, 'fix'), assistant(3, 'Intent: fix — x')])
    await addSession(root, SESSION_B, WORKSPACE, [header(SESSION_B, WORKSPACE, { origin: 'subagent', parentSession: PARENT, delegationDepth: 2 }), seqZero, preset, user(2, 'assist'), assistant(3, 'Intent: investigation — x')])
    const child = await run(['context'] as ['context'], { env: { DSH_SESSION_ID: SESSION_B, PWD: WORKSPACE }, sessionsRoot: root, stateDir: state })
    expect(child.code).toBe(EXIT.ok)
    expect(child.value.delegation.role).toBe('subagent')
    expect(child.value.delegation.mayApproveUpgrade).toBe(false)
    expect(child.value.delegation.mayAssistAnalysis).toBe(true)
    const main = await run(['context'] as ['context'], { env: { DSH_SESSION_ID: SESSION_A, PWD: WORKSPACE }, sessionsRoot: root, stateDir: state })
    expect(main.code).toBe(EXIT.ok)
    expect(main.value.delegation.role).toBe('main')
    expect(main.value.delegation.mayApproveUpgrade).toBe(true)
  })
})
