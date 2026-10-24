/**
 * INC-01..06: incident evidence from one explicit session and seq range.
 *
 * The seam is the operations CLI (`run(['incident', ...])`) and the files it
 * writes: the skill body invokes exactly that, and every ticket acceptance point
 * is observable there without reaching into internals.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { EXIT, run } from '../../presets/ptc-hashline/operations/cli.mjs'
import { saveConfig } from '../../presets/ptc-hashline/operations/config.mjs'
import { encodeSegment, projectKey } from '../../presets/ptc-hashline/operations/session-log.mjs'

const SESSION = 'session-incident-0001'
const WORKSPACE = '/work/incident-project'
const DENIAL = '被拒的是 **edit** 调用\n[intent-gate] 这一次调用没有门行垫底 —— 本轮还没有出现过那个六桶行。'
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
const header = (id = SESSION, cwd = WORKSPACE) => record({ type: 'session', version: 4, id, cwd, agentPreset: 'ptc-hashline' })
const seqZero = record({ type: 'permission/preset', seq: 0, data: { preset: 'workspace-write' } })
const preset = record({ type: 'agent-preset/selected', seq: 1, data: { agentPreset: 'ptc-hashline' } })
const user = (seq: number, text: string) => record({ type: 'user/message', seq, data: { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } })
const assistant = (seq: number, text: string) => record({ type: 'assistant/message', seq, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } } })
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
  const state = await temp('incident-state-')
  const repository = await temp('incident-repo-')
  const evidence = await temp('incident-evidence-')
  await saveConfig({ directory: state, maintenanceRepository: repository, evidenceDirectory: evidence })
  return { state, repository, evidence }
}

const env = { DSH_SESSION_ID: SESSION, PWD: WORKSPACE }

function runIncident(root: string, state: string, argv: string[] = [], environment: Record<string, string> = env) {
  return run(['incident', ...argv] as ['incident', ...string[]], { env: environment, sessionsRoot: root, stateDir: state })
}

const base = (assistantText = 'Intent: fix — repair the parser') => [
  header(), seqZero, preset, user(2, 'fix the bug'), assistant(3, assistantText), call(4, 'run_code', 'c1'),
]

async function readJson<T = any>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

describe('INC-01: one call once, inner failures kept', () => {
  it('keeps an inner edit failure even when the outer run_code succeeds', async () => {
    const root = await temp('incident-sessions-')
    const { state } = await configured()
    await addSession(root, SESSION, WORKSPACE, [
      ...base(),
      startEvent(5, 'edit', 's1'),
      settle(6, 'edit', 'ToolOutputError: edit returned a value that violates its own schema', { isError: true, subCallId: 's1' }),
      result(7, 'edited ok', 'c1', false),
    ])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '7'])
    expect(report.code).toBe(EXIT.ok)
    expect(report.value.command).toBe('incident')
    const { incident } = await openBundle(report)
    expect(incident.events.map((event: any) => event.name)).toEqual(['run_code', 'edit'])
    const edit = incident.events.find((event: any) => event.name === 'edit')
    expect(edit.state).toBe('completed')
    expect(edit.isError).toBe(true)
    expect(edit.kind).toBe('suspected-implementation-defect')
    expect(edit.severity).toBe('high')
    const outer = incident.events.find((event: any) => event.name === 'run_code')
    expect(outer.isError).toBe(false)
    expect(outer.kind).toBe('success')
    expect(incident.counts.events).toBe(2)
    expect(incident.counts.states.completed).toBe(2)
    // A suspected defect needs follow-up without the caller asking again.
    expect(incident.issues.written).toHaveLength(1)
    expect(incident.issues.written[0].status).toBe('needs-triage')
  })
})

async function addFramedSession(root: string, id: string, cwd: string, frames: string[][], torn = true): Promise<void> {
  const directory = path.join(root, projectKey(cwd), encodeSegment(id))
  await mkdir(directory, { recursive: true })
  const buffers = frames.map(lines => zstdCompressSync(Buffer.from(lines.join('\n') + '\n', 'utf8')))
  if (torn) {
    const last = buffers[buffers.length - 1]!
    buffers[buffers.length - 1] = last.subarray(0, last.length - 6)
  }
  await writeFile(path.join(directory, 'session.v4.jsonl.zstd'), Buffer.concat(buffers))
}

async function walk(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(full))
    else files.push(full)
  }
  return files
}

type IncidentRun = Awaited<ReturnType<typeof runIncident>>

async function openBundle(report: IncidentRun): Promise<{ directory: string; incident: any }> {
  const evidence = report.value.evidence
  if (evidence === undefined) throw new Error('the incident command wrote no evidence bundle')
  return { directory: evidence.directory, incident: await readJson(path.join(evidence.directory, 'incident.json')) }
}

function countsOf(report: IncidentRun): { events: number } {
  const counts = report.value.counts
  if (counts === undefined) throw new Error('the incident command returned no counts')
  return counts
}

describe('INC-02: classification and severity are separate axes', () => {
  it('separates expected refusals, parameter errors, environment problems, defects, cancellations and partial successes', async () => {
    const root = await temp('incident-sessions-')
    const { state } = await configured()
    await addSession(root, SESSION, WORKSPACE, [
      ...base(),
      startEvent(5, 'read', 's1'),
      settle(6, 'read', 'FS_NOT_FOUND: cannot read "x": not found', { isError: true, subCallId: 's1' }),
      settle(7, 'edit', DENIAL, { subCallId: 's2' }),
      startEvent(8, 'edit', 's3'),
      settle(9, 'edit', 'ToolCallError: the operation was aborted', { isError: true, subCallId: 's3' }),
      startEvent(10, 'edit', 's4'),
      settle(11, 'edit', 'limit must be less than or equal to 2000', { isError: true, subCallId: 's4' }),
      startEvent(12, 'edit', 's5'),
      settle(13, 'edit', 'The file moved on disk from "a" to "b", but the move did not complete', { isError: true, subCallId: 's5' }),
      startEvent(14, 'run_code', 's6'),
      settle(15, 'run_code', 'SnapshotCommitError: bookkeeping did not complete', { isError: true, subCallId: 's6' }),
      result(16, 'done', 'c1', false),
    ])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '16'])
    expect(report.code).toBe(EXIT.ok)
    const { incident } = await openBundle(report)
    const byStart = (seq: number) => incident.events.find((event: any) => event.startSeq === seq)
    expect(byStart(5).kind).toBe('environment-problem')
    expect(byStart(5).severity).toBe('warning')
    const denial = incident.events.find((event: any) => event.doneSeq === 7)
    expect(denial.state).toBe('denied')
    expect(denial.kind).toBe('expected-refusal')
    expect(byStart(8).kind).toBe('cancelled')
    expect(byStart(10).kind).toBe('model-parameter-error')
    expect(byStart(12).kind).toBe('partial-success')
    expect(byStart(14).kind).toBe('partial-success')
    expect(byStart(14).severity).toBe('warning')
    // Kinds and severities are parallel maps, not one blended label.
    expect(incident.counts.kinds['expected-refusal']).toBe(1)
    expect(incident.counts.severities).toEqual({ info: 3, warning: 4 })
    // Only the partial successes need follow-up.
    expect(incident.issues.written.map((written: any) => written.kind)).toEqual(['partial-success', 'partial-success'])
  })
})

describe('INC-03: a successful call that produced a wrong result', () => {
  it('records the report, keeps isError false and registers the finding', async () => {
    const root = await temp('incident-sessions-')
    const { state } = await configured()
    await addSession(root, SESSION, WORKSPACE, [
      ...base(),
      startEvent(5, 'edit', 's1'),
      settle(6, 'edit', '', { subCallId: 's1' }),
      result(7, 'edited ok', 'c1', false),
    ])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '7', '--user-report', 'the bytes do not match what I asked for', '--user-evidence', 'byte diff at line 3'])
    const { directory, incident } = await openBundle(report)
    const edit = incident.events.find((event: any) => event.name === 'edit')
    expect(edit.isError).toBe(false)
    expect(edit.kind).toBe('success')
    expect(incident.userReport.statement).toBe('the bytes do not match what I asked for')
    // The inner edit is the call the user means; the run_code wrapper is not
    // reported as a related success (INC-03).
    expect(incident.userReport.relatedEventSeqs).toEqual([5])
    expect(incident.userReport.verification).toBe('independent-evidence-required')
    expect(incident.userReport.independentEvidence).toBe('byte diff at line 3')
    expect(incident.issues.written.map((written: any) => written.kind)).toEqual(['user-reported-mismatch'])
    const summary = await readFile(path.join(directory, 'summary.md'), 'utf8')
    expect(summary).toContain('## User report')
    expect(summary).toContain('the bytes do not match what I asked for')
  })
})

describe('INC-04: incomplete input never becomes a healthy report', () => {
  it('reports a seq gap and exits 2', async () => {
    const root = await temp('incident-sessions-')
    const { state } = await configured()
    await addSession(root, SESSION, WORKSPACE, [header(), seqZero, preset, user(2, 'fix'), assistant(3, 'Intent: fix — x'), call(4, 'run_code', 'c1'), result(8, 'done', 'c1', false)])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'])
    expect(report.code).toBe(EXIT.stopped)
    const { incident } = await openBundle(report)
    expect(incident.integrity.status).toBe('incomplete')
    expect(incident.integrity.issues.join(' ')).toContain('missing seq values')
  })

  it('reports duplicate seq values', async () => {
    const root = await temp('incident-sessions-')
    const { state } = await configured()
    await addSession(root, SESSION, WORKSPACE, [header(), seqZero, preset, user(2, 'fix'), assistant(4, 'Intent: fix — x'), call(4, 'run_code', 'c1'), result(5, 'done', 'c1', false)])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '5'])
    expect(report.code).toBe(EXIT.stopped)
    const { incident } = await openBundle(report)
    expect(incident.integrity.issues.join(' ')).toContain('duplicate seq values')
  })

  it('reports a start without a settle as started and incomplete', async () => {
    const root = await temp('incident-sessions-')
    const { state } = await configured()
    await addSession(root, SESSION, WORKSPACE, [...base(), startEvent(5, 'edit', 's1'), result(6, 'done', 'c1', false)])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '6'])
    expect(report.code).toBe(EXIT.stopped)
    const { incident } = await openBundle(report)
    const edit = incident.events.find((event: any) => event.name === 'edit')
    expect(edit.state).toBe('started')
    expect(edit.kind).toBe('insufficient-evidence')
    expect(incident.integrity.issues.join(' ')).toContain('no settle inside the range')
  })

  it('reports a torn zstd frame', async () => {
    const root = await temp('incident-sessions-')
    const { state } = await configured()
    await addFramedSession(root, SESSION, WORKSPACE, [
      [header(), seqZero, preset, user(2, 'fix')],
      [assistant(3, 'Intent: fix — x'), call(4, 'run_code', 'c1')],
      [startEvent(5, 'edit', 's1'), settle(6, 'edit', '', { subCallId: 's1' }), result(7, 'done', 'c1', false)],
    ])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '7'])
    expect(report.code).toBe(EXIT.stopped)
    const { incident } = await openBundle(report)
    expect(incident.integrity.issues.join(' ')).toContain('torn-final-frame')
    expect(incident.target.source.format).toBe('jsonl.v4.zstd')
  })

  it('stops without writing for an unsupported session generation', async () => {
    const root = await temp('incident-sessions-')
    const { state, evidence } = await configured()
    // The INVOKING session is valid; the TARGET session is the one without a
    // generation artifact, so the stop is about the target, not the guard.
    await addSession(root, SESSION, WORKSPACE, [...base(), startEvent(5, 'edit', 's1'), settle(6, 'edit', '', { subCallId: 's1' }), result(7, 'done', 'c1', false)])
    const targetCwd = '/work/unsupported-project'
    const targetDirectory = path.join(root, projectKey(targetCwd), encodeSegment('session-target'))
    await mkdir(targetDirectory, { recursive: true })
    await writeFile(path.join(targetDirectory, 'notes.txt'), 'no generation artifact here\n', 'utf8')
    const report = await runIncident(root, state, ['--target-session', 'session-target', '--target-cwd', targetCwd])
    expect(report.code).toBe(EXIT.stopped)
    expect(report.value.status).toBe('unsupported-generation')
    expect(report.value.evidence).toBeUndefined()
    expect(existsSync(path.join(evidence, 'incidents'))).toBe(false)
  })
})

describe('INC-05: secrets never reach an exported file', () => {
  it('keeps every exported file free of the secret and the home path, and leaves the source byte-identical', async () => {
    const secret = 'sk-liveabcdefghijklmnop'
    const cwd = '/work/' + secret + '/project'
    const root = await temp('incident-sessions-')
    const { state, repository } = await configured()
    const lines = [
      header(SESSION, cwd),
      seqZero,
      preset,
      user(2, 'the key ' + secret + ' leaks'),
      assistant(3, 'Intent: fix — rotate ' + secret),
      call(4, 'run_code', 'c1', JSON.stringify({ apiKey: secret })),
      startEvent(5, 'edit', 's1'),
      settle(6, 'edit', 'ToolOutputError: Bearer ' + secret + ' rejected', { isError: true, subCallId: 's1' }),
      result(7, 'done', 'c1', false),
    ]
    await addSession(root, SESSION, cwd, lines)
    const sourcePath = path.join(root, projectKey(cwd), encodeSegment(SESSION), 'session.v4.jsonl')
    const before = await readFile(sourcePath)
    const beforeHash = createHash('sha256').update(before).digest('hex')
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '7'], { DSH_SESSION_ID: SESSION, PWD: cwd })
    expect(report.code).toBe(EXIT.ok)
    const { directory, incident } = await openBundle(report)
    for (const file of await walk(directory)) expect(await readFile(file, 'utf8'), file).not.toContain(secret)
    const issueFiles = await walk(path.join(repository, '.scratch'))
    expect(issueFiles.length).toBeGreaterThan(0)
    for (const file of issueFiles) expect(await readFile(file, 'utf8'), file).not.toContain(secret)
    const summaryText = await readFile(path.join(directory, 'summary.md'), 'utf8')
    expect(summaryText).not.toContain(secret)
    // Generated ticket paths are exported too: the home directory is masked.
    expect(summaryText).not.toContain(os.homedir())
    expect(createHash('sha256').update(await readFile(sourcePath)).digest('hex')).toBe(beforeHash)
    expect(incident.target.source.sha256).toBe(beforeHash)
    expect(incident.target.cwd).not.toContain(secret)
    expect(incident.conversation.lastUserMessage.firstLine).not.toContain(secret)
  })
})

describe('INC-06: only suspected anomalies become triage issues', () => {
  it('keeps expected refusals and cancellations in the summary and opens no issue', async () => {
    const root = await temp('incident-sessions-')
    const { state, repository } = await configured()
    await addSession(root, SESSION, WORKSPACE, [
      ...base(),
      settle(5, 'edit', DENIAL, { subCallId: 's1' }),
      startEvent(6, 'edit', 's2'),
      settle(7, 'edit', 'ToolCallError: the operation was aborted', { isError: true, subCallId: 's2' }),
      result(8, 'done', 'c1', false),
    ])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '8'])
    expect(report.code).toBe(EXIT.ok)
    const { directory, incident } = await openBundle(report)
    expect(incident.issues.written).toEqual([])
    const summary = await readFile(path.join(directory, 'summary.md'), 'utf8')
    expect(summary).toContain('Summary-only outcomes')
    expect(summary).toContain('expected-refusal')
    expect(existsSync(path.join(repository, '.scratch'))).toBe(false)
  })

  it('writes a needs-triage issue with evidence, hypothesis and the recurrence boundary', async () => {
    const root = await temp('incident-sessions-')
    const { state, repository } = await configured()
    await addSession(root, SESSION, WORKSPACE, [
      ...base(),
      startEvent(5, 'edit', 's1'),
      settle(6, 'edit', 'ToolOutputError: edit returned a value that violates its own schema', { isError: true, subCallId: 's1' }),
      result(7, 'edited ok', 'c1', false),
    ])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '7'])
    expect(report.code).toBe(EXIT.ok)
    const issuesDirectory = path.join(repository, '.scratch', 'ptc-hashline-operations-skills', 'issues')
    const files = await walk(issuesDirectory)
    expect(files).toHaveLength(1)
    const text = await readFile(files[0]!, 'utf8')
    expect(text).toContain('**Status:** needs-triage')
    expect(text).toContain('## 证据')
    expect(text).toContain('## 假说')
    expect(text).toContain('票据 03')
    expect(text).toMatch(/^# \d{2}: /u)
  })

  it('numbers the next issue after the highest existing ticket', async () => {
    const root = await temp('incident-sessions-')
    const { state, repository } = await configured()
    const issuesDirectory = path.join(repository, '.scratch', 'ptc-hashline-operations-skills', 'issues')
    await mkdir(issuesDirectory, { recursive: true })
    await writeFile(path.join(issuesDirectory, '01-existing.md'), '# 01: existing\n', 'utf8')
    await writeFile(path.join(issuesDirectory, '02-existing.md'), '# 02: existing\n', 'utf8')
    await addSession(root, SESSION, WORKSPACE, [...base(), startEvent(5, 'edit', 's1'), settle(6, 'edit', 'ToolOutputError: schema', { isError: true, subCallId: 's1' }), result(7, 'done', 'c1', false)])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '7'])
    const { incident } = await openBundle(report)
    expect(incident.issues.written[0].number).toBe('03')
  })
})

describe('CONFIG-01: the incident command writes only where configured', () => {
  it('stops before writing when the evidence directory is not configured', async () => {
    const root = await temp('incident-sessions-')
    const state = await temp('incident-state-')
    const repository = await temp('incident-repo-')
    await saveConfig({ directory: state, maintenanceRepository: repository })
    await addSession(root, SESSION, WORKSPACE, [...base(), startEvent(5, 'edit', 's1'), settle(6, 'edit', '', { subCallId: 's1' }), result(7, 'done', 'c1', false)])
    const report = await runIncident(root, state)
    expect(report.code).toBe(EXIT.stopped)
    expect(report.value.status).toBe('read-only')
    expect(report.value.reason).toContain('evidenceDirectory')
    expect(countsOf(report).events).toBe(2)
    expect(report.value.evidence).toBeUndefined()
  })

  it('writes evidence but skips issue registration when the maintenance repository is unconfigured', async () => {
    const root = await temp('incident-sessions-')
    const state = await temp('incident-state-')
    const evidence = await temp('incident-evidence-')
    await saveConfig({ directory: state, evidenceDirectory: evidence })
    await addSession(root, SESSION, WORKSPACE, [...base(), startEvent(5, 'edit', 's1'), settle(6, 'edit', 'ToolOutputError: schema', { isError: true, subCallId: 's1' }), result(7, 'done', 'c1', false)])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '7'])
    expect(report.code).toBe(EXIT.ok)
    const { incident } = await openBundle(report)
    expect(incident.issues.configured).toBe(false)
    expect(incident.issues.skipped[0].reason).toContain('maintenanceRepository')
  })

  it('refuses a missing target session without writing', async () => {
    const root = await temp('incident-sessions-')
    const { state, evidence } = await configured()
    await addSession(root, SESSION, WORKSPACE, [...base(), startEvent(5, 'edit', 's1'), settle(6, 'edit', '', { subCallId: 's1' }), result(7, 'done', 'c1', false)])
    const report = await runIncident(root, state, ['--target-session', 'session-absent', '--target-cwd', '/work/absent'])
    expect(report.code).toBe(EXIT.stopped)
    expect(report.value.status).toBe('missing')
    expect(existsSync(path.join(evidence, 'incidents'))).toBe(false)
  })
})

describe('scope: only the named session is read', () => {
  it('does not pick up another session in the same root', async () => {
    const root = await temp('incident-sessions-')
    const { state } = await configured()
    await addSession(root, SESSION, WORKSPACE, [...base(), startEvent(5, 'edit', 's1'), settle(6, 'edit', '', { subCallId: 's1' }), result(7, 'done', 'c1', false)])
    const decoyCwd = '/work/decoy-project'
    await addSession(root, 'session-decoy', decoyCwd, [
      header('session-decoy', decoyCwd), seqZero, preset, user(2, 'decoy'), assistant(3, 'Intent: fix — decoy'), call(4, 'run_code', 'c9'),
      startEvent(5, 'edit', 's1', 'c9'), settle(6, 'edit', 'ToolOutputError: decoy', { isError: true, subCallId: 's1', rootCallId: 'c9' }), result(7, 'done', 'c9', false),
    ])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '7'])
    const { incident } = await openBundle(report)
    expect(incident.target.sessionId).toBe(SESSION)
    expect(incident.events.map((event: any) => event.name)).toEqual(['run_code', 'edit'])
    expect(incident.issues.written).toEqual([])
  })
})

describe('incident usage: refusals are visible', () => {
  it('rejects half a range, non-integers and a bad feature slug', async () => {
    const root = await temp('incident-sessions-')
    const { state } = await configured()
    await addSession(root, SESSION, WORKSPACE, [...base(), startEvent(5, 'edit', 's1'), settle(6, 'edit', '', { subCallId: 's1' }), result(7, 'done', 'c1', false)])
    await expect(runIncident(root, state, ['--seq-min', '3'])).rejects.toThrow(/given together/u)
    await expect(runIncident(root, state, ['--seq-min', '0', '--seq-max', '0.5'])).rejects.toThrow(/safe integer/u)
    await expect(runIncident(root, state, ['--feature', 'Bad Slug'])).rejects.toThrow(/lowercase slug/u)
  })

  it('stops when the invocation context is not the target preset', async () => {
    const stateRoot = await temp('incident-sessions-')
    const { state, evidence } = await configured()
    await addSession(stateRoot, SESSION, WORKSPACE, [record({ type: 'session', version: 4, id: SESSION, cwd: WORKSPACE, agentPreset: 'standard' })])
    const report = await runIncident(stateRoot, state)
    expect(report.code).toBe(EXIT.stopped)
    expect(report.value.status).toBe('stopped')
    expect(report.value.reason).toContain('wrong-preset')
    expect(existsSync(path.join(evidence, 'incidents'))).toBe(false)
  })
})

describe('range defaults and write ordering', () => {
  it('analyzes the whole visible log when no seq bounds are given', async () => {
    const root = await temp('incident-sessions-')
    const { state } = await configured()
    await addSession(root, SESSION, WORKSPACE, [...base(), startEvent(5, 'edit', 's1'), settle(6, 'edit', '', { subCallId: 's1' }), result(7, 'done', 'c1', false)])
    const report = await runIncident(root, state)
    expect(report.code).toBe(EXIT.ok)
    const { directory, incident } = await openBundle(report)
    expect(incident.range.requested).toBeNull()
    expect(incident.range.effective).toEqual({ min: 0, max: 7 })
    const summary = await readFile(path.join(directory, 'summary.md'), 'utf8')
    expect(summary).toContain('Requested range: whole visible log')
  })

  it('returns a read-only analysis when the evidence directory is not configured', async () => {
    const root = await temp('incident-sessions-')
    const state = await temp('incident-state-')
    await saveConfig({ directory: state })
    await addSession(root, SESSION, WORKSPACE, [...base(), startEvent(5, 'edit', 's1'), settle(6, 'edit', 'ToolOutputError: schema', { isError: true, subCallId: 's1' }), result(7, 'done', 'c1', false)])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '7'])
    expect(report.code).toBe(EXIT.stopped)
    expect(report.value.status).toBe('read-only')
    expect(report.value.reason).toContain('evidenceDirectory')
    expect(countsOf(report).events).toBe(2)
    expect(report.value.findings).toEqual([{ kind: 'suspected-implementation-defect', name: 'edit', seq: 5 }])
    expect(report.value.evidence).toBeUndefined()
  })

  it('never registers an issue when the bundle cannot be written', async () => {
    const root = await temp('incident-sessions-')
    const state = await temp('incident-state-')
    const repository = await temp('incident-repo-')
    const evidenceParent = await temp('incident-evidence-file-')
    const evidenceFile = path.join(evidenceParent, 'evidence.txt')
    await writeFile(evidenceFile, 'not a directory\n', 'utf8')
    await saveConfig({ directory: state, maintenanceRepository: repository, evidenceDirectory: evidenceFile })
    await addSession(root, SESSION, WORKSPACE, [...base(), startEvent(5, 'edit', 's1'), settle(6, 'edit', 'ToolOutputError: schema', { isError: true, subCallId: 's1' }), result(7, 'done', 'c1', false)])
    await expect(runIncident(root, state, ['--seq-min', '0', '--seq-max', '7'])).rejects.toThrow(/ENOTDIR|not a directory/u)
    // The write comes first: no triage ticket may cite a package that failed.
    expect(existsSync(path.join(repository, '.scratch'))).toBe(false)
  })

  it('counts one gate refusal once when the wrapper result echoes it', async () => {
    const root = await temp('incident-sessions-')
    const { state } = await configured()
    await addSession(root, SESSION, WORKSPACE, [...base(), settle(5, 'edit', DENIAL, { subCallId: 's1' }), result(6, 'code run failed (exception): ' + DENIAL, 'c1', true)])
    const report = await runIncident(root, state, ['--seq-min', '0', '--seq-max', '6'])
    expect(report.code).toBe(EXIT.ok)
    const { incident } = await openBundle(report)
    expect(incident.events).toHaveLength(1)
    expect(incident.events[0].state).toBe('denied')
    expect(incident.counts.states.denied).toBe(1)
  })
})