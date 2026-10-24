/**
 * The two workflows, exercised against the INSTALLED bundle (ticket 08).
 *
 * Every command below runs from a business working directory that has nothing to
 * do with this checkout, through the `operations/cli.mjs` that the acceptance
 * profile installed. The incident chain runs as a REAL child process; the upgrade
 * chain runs in-process against the same installed module because its install
 * runner is injected (a real dependency install is not part of an acceptance
 * fixture — D16/UPG-13 pin a fixed candidate instead). The report says which
 * parts were child processes and which were in-process, and it never promotes an
 * injected run to a real upgrade.
 *
 * This module carries no shebang (see delivery-acceptance.mjs).
 * @module dsh-tool-hashline/scripts/delivery-acceptance-workflows
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { HASHLINE_PATCH_MARKERS, TOOL_EDIT_PATCH_MARKERS } from '../presets/ptc-hashline/operations/baseline.mjs'
import { encodeSegment as encodeSegmentOf, projectKey as projectKeyOf } from '../presets/ptc-hashline/operations/session-log.mjs'
// One definition each: the harness owns these, so a workflow fixture cannot drift
// from the report that measures it.
import { digestOf, posix, snapshot } from './delivery-acceptance.mjs'

/** The invoking session (the one the workflows believe they run in). */
export const SESSION = 'session-delivery-0001'
/** A historical target session, which also runs this preset. */
export const TARGET = 'session-delivery-target-0001'
/** Another session of the same preset: naming it must never authorize this one. */
export const HISTORY = 'session-delivery-history-0001'
/** A subagent of this preset (SCOPE-06). */
export const ASSISTED = 'session-delivery-assisted-0001'
export const PARENT = 'session-delivery-parent-0001'
export const WORKSPACE = '/work/delivery-business-project'
export const HASH_PKG = '@hy-sde-org/dsh-hashline'
export const EDIT_PKG = '@hy-sde-org/dsh-tool-edit'
/** The user's own verbatim reply, recorded in SESSION's log (UPG-03). */
export const REPLY = '批准两阶段：先做候选验证，通过后把目标 profile 切过去。'
/** A value that must never reach an exported file (INC-05). */
export const SECRET = 'sk-delivery-acceptance-secret-0987654321'
const ASSESSED_AT = '2026-11-02T03:10:00.000Z'
const PROPOSED_AT = '2026-11-02T04:20:00.000Z'
const VALIDATED_AT = '2026-11-02T05:30:00.000Z'
const SWITCHED_AT = '2026-11-02T06:40:00.000Z'
const PROFILE_NAME = 'delivery-target'

/** The host-managed facts a session's shell carries. */
export function hostEnv(home, extra = {}) {
  return { DSH_HOME: home, DSH_SESSION_ID: SESSION, PWD: WORKSPACE, ...extra }
}

/**
 * One session log, at the path the operations CLI derives from its cwd.
 * @param {string} sessionsRoot the fixture sessions root
 * @param {string} id the session id
 * @param {object} options preset projection and delegation facts
 * @returns {Promise<string>} the written file
 */
export async function writeSession(sessionsRoot, id, options = {}) {
  const projectKey = projectKeyOf
  const encodeSegment = encodeSegmentOf
  const directory = path.join(sessionsRoot, projectKey(options.cwd ?? WORKSPACE), encodeSegment(id))
  await mkdir(directory, { recursive: true })
  const header = {
    type: 'session',
    version: 4,
    id,
    cwd: options.cwd ?? WORKSPACE,
    createdAt: 1,
    isSeeded: false,
    delegationDepth: options.assisted === true ? 1 : 0,
    // The header records the FAMILY marker `ptc`; the session's own selection
    // event is what makes it `ptc-hashline` (the spec's projection rule).
    agentPreset: options.familyPreset ?? 'ptc',
    ...options.assisted === true ? { origin: 'subagent', parentSession: PARENT } : {},
  }
  const row = (value) => JSON.stringify(value)
  const user = (seq, text) => row({ type: 'user/message', seq, data: { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } })
  const selected = options.preset === false
    ? []
    : [row({ type: 'agent-preset/selected', seq: 1, data: { agentPreset: 'ptc-hashline' } })]
  const lines = [row(header), row({ type: 'permission/preset', seq: 0, data: { preset: 'workspace-write' } }), ...selected]
  const messages = options.messages ?? []
  let seq = 2
  for (const message of messages) {
    lines.push(user(seq, message))
    seq += 1
  }
  const file = path.join(directory, 'session.v4.jsonl')
  await writeFile(file, lines.join('\n') + '\n', 'utf8')
  return file
}

/**
 * A target session whose `run_code` succeeded while the inner `edit` failed,
 * and whose arguments carry a secret: INC-01, INC-03 and INC-05 in one artifact.
 * @param {string} sessionsRoot the fixture sessions root
 * @returns {Promise<string>} the written file
 */
export async function writeIncidentTarget(sessionsRoot) {
  const projectKey = projectKeyOf
  const encodeSegment = encodeSegmentOf
  const directory = path.join(sessionsRoot, projectKey(WORKSPACE), encodeSegment(TARGET))
  await mkdir(directory, { recursive: true })
  const row = (value) => JSON.stringify(value)
  const lines = [
    row({ type: 'session', version: 4, id: TARGET, cwd: WORKSPACE, createdAt: 1, isSeeded: false, delegationDepth: 0, agentPreset: 'ptc-hashline' }),
    row({ type: 'permission/preset', seq: 0, data: { preset: 'danger-full-access' } }),
    row({ type: 'user/message', seq: 1, data: { role: 'user', content: [{ type: 'text', text: '把那一行改掉' }], source: { kind: 'user' } } }),
    row({ type: 'assistant/message', seq: 2, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'Intent: fix — 改这一行; I will edit it.' }] } } }),
    row({ type: 'tool/call', seq: 3, data: { turn: 1, step: 1, callId: 'call-delivery-1', name: 'run_code', arguments: JSON.stringify({ note: 'token ' + SECRET }) } }),
    row({ type: 'tool/ptc-dispatch-start', seq: 4, data: { rootCallId: 'call-delivery-1', parentCallId: 'call-delivery-1', subCallId: 'sub-delivery-1', name: 'edit' } }),
    row({ type: 'tool/ptc-dispatch', seq: 5, data: { rootCallId: 'call-delivery-1', parentCallId: 'call-delivery-1', subCallId: 'sub-delivery-1', name: 'edit', isError: true, content: [{ type: 'text', text: 'ToolOutputError: edit returned a value that violates its own schema (' + SECRET + ')' }] } }),
    row({ type: 'tool/result', seq: 6, data: { turn: 1, step: 1, toolCallId: 'call-delivery-1', isError: false, message: { role: 'tool', isError: false, content: [{ type: 'text', text: 'edited ok' }] } } }),
  ]
  const file = path.join(directory, 'session.v4.jsonl')
  await writeFile(file, lines.join('\n') + '\n', 'utf8')
  return file
}

/**
 * One maintenance worktree that a run can reason about: a git commit, a
 * declared engine pair, the two local patches, and the `patchedDependencies`
 * registration whose key carries the exact version.
 * @param {string} repository the directory to fill
 * @param {{hashline: string, toolEdit: string}} versions the resolved engine pair
 * @returns {Promise<void>}
 */
export async function writeMaintenanceRepository(repository, versions) {
  await mkdir(repository, { recursive: true })
  // Idempotent: a second call on an already committed worktree must not fail the
  // gate with "nothing to commit".
  if (existsSync(path.join(repository, '.git'))) return undefined
  const patchFileName = (specifier, version) => specifier.replaceAll('/', '__') + '@' + version + '.patch'
  await writeFile(path.join(repository, 'package.json'), JSON.stringify({
    name: 'delivery-maintenance-fixture',
    version: '0.0.0',
    packageManager: 'pnpm@11.28.5',
    scripts: { build: 'node scripts/build.mjs', 'check:preset': 'node scripts/check-preset.mjs', 'test:unit': 'node scripts/unit.mjs' },
    dependencies: { [HASH_PKG]: versions.hashline, [EDIT_PKG]: versions.toolEdit },
  }, null, 2) + '\n', 'utf8')
  // The real maintenance repository gitignores `.scratch`, so an incident ticket
  // written there is never read back as an "uncommitted input". A fixture without
  // this file would make the upgrade phase treat the ticket DIRECTORY as a file
  // to digest — an artifact of the fixture, not of the workflow.
  await writeFile(path.join(repository, '.gitignore'), ['.scratch/', 'node_modules/', '.pnpm-store/', ''].join('\n'), 'utf8')
  await writeFile(path.join(repository, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')
  await mkdir(path.join(repository, 'patches'), { recursive: true })
  for (const [specifier, version] of [[HASH_PKG, versions.hashline], [EDIT_PKG, versions.toolEdit]]) {
    await writeFile(path.join(repository, 'patches', patchFileName(specifier, version)), 'fixture patch for ' + specifier + '\n', 'utf8')
  }
  await writeFile(path.join(repository, 'pnpm-workspace.yaml'), [
    'packages:',
    '  - .',
    '',
    'patchedDependencies:',
    "  '" + HASH_PKG + '@' + versions.hashline + "': patches/" + patchFileName(HASH_PKG, versions.hashline),
    "  '" + EDIT_PKG + '@' + versions.toolEdit + "': patches/" + patchFileName(EDIT_PKG, versions.toolEdit),
    '',
  ].join('\n'), 'utf8')
  const git = (...args) => execFileSync('git', args[0] === 'init' ? ['init', '-q', repository] : ['-C', repository, ...args], { encoding: 'utf8' })
  git('init')
  git('add', '.')
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'delivery fixture')
  return undefined
}

/**
 * A one-off profile install tree for the switch's target (a throwaway DSH_HOME,
 * never the daily profile).
 *
 * It starts INSTALLED at the baseline combination, because that is what an
 * upgrade target is: the user's own profile already resolves something, and a
 * restore claims it came back to that. An empty tree has no measurable baseline,
 * so "restored" could never be claimed for it at all (D15/UPG-12, R2).
 * @param {string} home the fixture DSH home
 * @param {string} repository the maintenance worktree the profile links
 * @param {{hashline: string, toolEdit: string}} versions the baseline engine pair
 * @returns {Promise<string>} the profile directory
 */
export async function writeTargetProfile(home, repository, versions) {
  const profile = path.join(home, 'profiles', PROFILE_NAME)
  await mkdir(profile, { recursive: true })
  const link = (relative) => 'link:' + posix(path.join(repository, relative))
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-delivery-target',
    private: true,
    dependencies: {
      'dsh-tool-hashline': link('.'),
      '@dsh-tool-hashline/tool-read': link('packages/tool-read'),
      '@dsh-tool-hashline/tool-edit': link('packages/tool-edit'),
      '@deepseek-ai/cordis': '4.0.5-alpha.2',
      '@deepseek-ai/dsh-tools': '0.2.1-rc.2',
      '@deepseek-ai/dsh-fs': '0.2.1-rc.2',
      '@deepseek-ai/dsh-fs-local': '0.2.1-rc.2',
      '@deepseek-ai/dsh-system-prompt': '0.2.1-rc.2',
    },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-tool-hashline'] } },
  }, null, 2) + '\n', 'utf8')
  await writeFile(path.join(profile, 'pnpm-workspace.yaml'), ['packages:', '  - .', '', 'nodeLinker: hoisted', ''].join('\n'), 'utf8')
  await materialize(profile, versions)
  return profile
}

/**
 * Run the installed operations CLI as a REAL child process from a foreign cwd.
 * @param {object} facts the install facts
 * @param {string[]} argv command plus flags
 * @param {object} options env/cwd overrides
 * @returns {Promise<{code: number, value: any, stdout: string, stderr: string}>} the outcome
 */
export async function runInstalledCli(facts, argv, options = {}) {
  const { spawn } = await import('node:child_process')
  const cwd = options.cwd ?? facts.businessCwd
  const env = hostEnv(options.home ?? facts.workflowHome, options.env ?? {})
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [facts.operationsEntry, ...argv], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => resolve({ code: -1, value: undefined, stdout, stderr: String(error) }))
    child.on('close', (code) => {
      let value
      try { value = JSON.parse(stdout) } catch { value = undefined }
      resolve({ code: code ?? -1, value, stdout, stderr })
    })
  })
}

/** The files a written incident bundle holds, or a loud failure. */
async function incidentBundleOf(value) {
  const evidence = value?.evidence
  if (evidence === undefined) throw new Error('the incident command wrote no evidence bundle: ' + JSON.stringify(value?.status ?? null))
  const directory = evidence.directory
  return {
    directory,
    summary: await readFile(path.join(directory, 'summary.md'), 'utf8'),
    incident: JSON.parse(await readFile(path.join(directory, 'incident.json'), 'utf8')),
    baseline: JSON.parse(await readFile(path.join(directory, 'baseline.json'), 'utf8')),
    excerpt: await readFile(path.join(directory, 'excerpt.json'), 'utf8'),
  }
}

/**
 * The incident workflow, end to end, through the installed CLI.
 *
 * Runs as real child processes from a business cwd that has nothing to do with
 * this checkout, so the qualification gate, the evidence bundle and the issue
 * registration are all measured on the delivered artifact.
 * @param {object} facts install facts (plus workflowHome/businessCwd)
 * @param {(id: string, part: string, ok: boolean, detail: string, extra?: object) => void} record report row writer
 * @returns {Promise<object>} the facts later phases reuse
 */
export async function runIncidentChain(facts, record, gap = () => undefined) {
  const sessionsRoot = path.join(facts.workflowHome, 'sessions')
  const repository = path.join(facts.workflowHome, 'maintenance')
  const evidence = path.join(facts.workflowHome, 'evidence')
  const state = path.join(facts.workflowHome, 'state', 'ptc-hashline-operations')
  await mkdir(repository, { recursive: true })
  await mkdir(evidence, { recursive: true })
  await writeMaintenanceRepository(repository, facts.versions)

  // CONFIG-01: an explicit assignment, saved once, reused from an unrelated cwd.
  const saveConfig = await runInstalledCli(facts, ['config', '--set-maintenance-repo', repository, '--set-evidence-dir', evidence], { home: facts.workflowHome })
  const readConfig = await runInstalledCli(facts, ['config'], { home: facts.workflowHome })
  record('CONFIG-01', 'explicit assignment then reuse', saveConfig.code === 0 && readConfig.code === 0
    && readConfig.value?.roles?.maintenanceRepository?.configured === true
    && readConfig.value?.roles?.evidenceDirectory?.configured === true,
  'config exit ' + saveConfig.code + '/' + readConfig.code + '; both roles configured from ' + facts.businessCwd)
  // A relative path is refused rather than silently meaning the business cwd.
  const relative = await runInstalledCli(facts, ['config', '--set-evidence-dir', 'relative-evidence'], { home: facts.workflowHome })
  record('CONFIG-01', 'relative path refused', relative.code === 3, 'config --set-evidence-dir relative-evidence exit ' + relative.code)

  // The sessions this run reasons about.
  await writeSession(sessionsRoot, SESSION, { messages: ['/ptc-hashline-incident 看看这次 edit 失败', REPLY] })
  await writeSession(sessionsRoot, HISTORY, { messages: ['/ptc-hashline-upgrade 先看看更新'] })
  await writeSession(sessionsRoot, ASSISTED, { assisted: true, messages: ['辅助取证'] })
  const noPreset = await writeSession(sessionsRoot, 'session-delivery-family-only', { preset: false })
  await writeIncidentTarget(sessionsRoot)

  // SCOPE-01/04: this session's own projection (header family `ptc` + selection) qualifies.
  const eligible = await runInstalledCli(facts, ['context'], { home: facts.workflowHome })
  record('SCOPE-01', 'installed CLI resolves this session\'s projection', eligible.code === 0 && eligible.value?.eligible === true
    && eligible.value?.evidence?.effectivePreset === 'ptc-hashline'
    && eligible.value?.evidence?.headerPreset === 'ptc'
    && eligible.value?.evidence?.selectedPreset === 'ptc-hashline',
  'context exit ' + eligible.code + '; header=' + String(eligible.value?.evidence?.headerPreset) + ' selected=' + String(eligible.value?.evidence?.selectedPreset))
  record('SCOPE-04', 'family marker alone does not qualify', (await runInstalledCli(facts, ['context'], { home: facts.workflowHome, env: { DSH_SESSION_ID: 'session-delivery-family-only' } })).code === 2,
    'context on a session whose header says ptc but which selected nothing')
  const forgedPreset = await runInstalledCli(facts, ['context', '--preset', 'ptc-hashline'], { home: facts.workflowHome, env: { DSH_SESSION_ID: 'session-delivery-family-only' } })
  record('SCOPE-04', 'a hand-typed --preset does not authorize', forgedPreset.code === 2 && forgedPreset.value?.evidence?.presetArgumentIgnored === 'ptc-hashline',
    'context --preset ptc-hashline exit ' + forgedPreset.code + '; presetArgumentIgnored=' + String(forgedPreset.value?.evidence?.presetArgumentIgnored))
  // SCOPE-05: naming a historical ptc-hashline session never authorizes THIS one.
  const borrowed = await runInstalledCli(facts, ['context', '--target-session', HISTORY], { home: facts.workflowHome, env: { DSH_SESSION_ID: 'session-delivery-family-only' } })
  record('SCOPE-05', 'a historical target cannot authorize the caller', borrowed.code === 2 && borrowed.value?.status === 'wrong-preset',
    'context --target-session ' + HISTORY + ' from a non-target session exit ' + borrowed.code + ' status ' + String(borrowed.value?.status))
  // The historical target IS usable as the analysed session, from a qualifying caller.
  const targetQualifies = await runInstalledCli(facts, ['context', '--target-session', HISTORY], { home: facts.workflowHome })
  record('SCOPE-05', 'the analysed session is reported separately', targetQualifies.code === 0 && targetQualifies.value?.target?.session === HISTORY,
    'context --target-session ' + HISTORY + ' from this session exit ' + targetQualifies.code)

  // SCOPE-06: a subagent records that it may analyse but not approve.
  const assisted = await runInstalledCli(facts, ['context'], { home: facts.workflowHome, env: { DSH_SESSION_ID: ASSISTED } })
  record('SCOPE-06', 'an assisted session may analyse, never approve', assisted.code === 0
    && assisted.value?.delegation?.role === 'subagent'
    && assisted.value?.delegation?.mayAssistAnalysis === true
    && assisted.value?.delegation?.mayApproveUpgrade === false,
  'context as ' + ASSISTED + ' exit ' + assisted.code + ' mayApproveUpgrade=' + String(assisted.value?.delegation?.mayApproveUpgrade))

  // INC-01/05/06: the bundle from one explicit target and range.
  const digestOfTarget = async () => digestOf(path.join(sessionsRoot, projectKeyOf(WORKSPACE), encodeSegmentOf(TARGET), 'session.v4.jsonl'))
  const targetDigestBefore = await digestOfTarget()
  const first = await runInstalledCli(facts, ['incident', '--target-session', TARGET, '--target-cwd', WORKSPACE, '--seq-min', '0', '--seq-max', '6', '--user-report', '工具说成功，但文件里那一行没改', '--user-evidence', 'diff 显示第 2 行仍是旧值', '--now', '2026-11-01T08:00:00.000Z'], { home: facts.workflowHome })
  const bundle = await incidentBundleOf(first.value)
  const editEvent = bundle.incident.events.find((event) => event.name === 'edit')
  record('INC-01', 'an inner edit failure survives a successful run_code', first.code === 0
    && editEvent !== undefined && editEvent.isError === true && editEvent.kind === 'suspected-implementation-defect'
    && bundle.incident.events.some((event) => event.name === 'run_code' && event.isError === false),
  'incident exit ' + first.code + '; events ' + bundle.incident.events.map((event) => event.name).join(',') + '; edit kind ' + String(editEvent?.kind))
  const targetDigestAfter = await digestOfTarget()
  record('INC-05', 'the secret never reaches an exported file and the source log is untouched', !bundle.summary.includes(SECRET)
    && !bundle.excerpt.includes(SECRET) && !JSON.stringify(bundle.incident).includes(SECRET)
    && !JSON.stringify(bundle.baseline).includes(SECRET)
    && targetDigestAfter === targetDigestBefore
    && (await readFile(path.join(sessionsRoot, projectKeyOf(WORKSPACE), encodeSegmentOf(TARGET), 'session.v4.jsonl'), 'utf8')).includes(SECRET),
  'summary/incident/excerpt/baseline free of the test secret; source log byte-identical (' + targetDigestBefore.slice(0, 12) + ') and still holds the secret')
  const issues = bundle.incident.issues?.written ?? []
  record('INC-06', 'a suspected defect becomes a needs-triage ticket without being called a confirmed bug', issues.length > 0
    && issues.every((entry) => entry.status === 'needs-triage')
    && issues.some((entry) => entry.kind === 'suspected-implementation-defect')
    && bundle.incident.issues !== undefined,
  'tickets ' + JSON.stringify(issues.map((entry) => entry.kind + ':' + entry.status)))

  // INC-07: the SAME occurrence analysed again is linked, not appended twice.
  const ticketDirectory = path.join(repository, '.scratch', 'ptc-hashline-operations-skills', 'issues')
  const ticketsBefore = (await readdir(ticketDirectory)).sort()
  const bytesBefore = new Map()
  for (const name of ticketsBefore) bytesBefore.set(name, await readFile(path.join(ticketDirectory, name), 'utf8'))
  const repeat = await runInstalledCli(facts, ['incident', '--target-session', TARGET, '--target-cwd', WORKSPACE, '--seq-min', '0', '--seq-max', '6', '--now', '2026-11-01T09:00:00.000Z'], { home: facts.workflowHome })
  const ticketsAfter = (await readdir(ticketDirectory)).sort()
  const unchanged = []
  for (const name of ticketsBefore) unchanged.push((await readFile(path.join(ticketDirectory, name), 'utf8')) === bytesBefore.get(name))
  const linked = repeat.value?.issues?.associated ?? []
  record('INC-07', 'a repeat is linked to the existing tickets and appends nothing', repeat.code === 0
    && ticketsAfter.length === ticketsBefore.length
    // The repeat run carries no --user-report, so it re-analyses the DEFECT class;
    // the ticket that a user report created is simply not re-derived.
    && linked.length === 1 && linked[0].kind === 'suspected-implementation-defect'
    && linked.every((entry) => entry.duplicate === true && entry.appended === false && entry.statusChanged === false)
    && unchanged.every(Boolean)
    && [...bytesBefore.values()].every((body) => /\*\*Status:\*\* needs-triage/u.test(body)),
  'second run exit ' + repeat.code + '; tickets ' + ticketsAfter.length + '/' + ticketsBefore.length
    + '; associated ' + JSON.stringify(linked.map((entry) => ({ duplicate: entry.duplicate, appended: entry.appended, statusChanged: entry.statusChanged })))
    + '; every ticket byte-identical ' + unchanged.every(Boolean))

  // INC-07: a WIDER range that now holds the retry success records the recovery and
  // closes nothing. The retry is appended to the same target log, then re-analysed.
  const targetFile = path.join(sessionsRoot, projectKeyOf(WORKSPACE), encodeSegmentOf(TARGET), 'session.v4.jsonl')
  const retryLines = [
    JSON.stringify({ type: 'tool/ptc-dispatch-start', seq: 7, data: { rootCallId: 'call-delivery-2', parentCallId: 'call-delivery-2', subCallId: 'sub-delivery-2', name: 'edit' } }),
    JSON.stringify({ type: 'tool/ptc-dispatch', seq: 8, data: { rootCallId: 'call-delivery-2', parentCallId: 'call-delivery-2', subCallId: 'sub-delivery-2', name: 'edit', isError: false, content: [{ type: 'text', text: 'edited ok' }] } }),
  ]
  await writeFile(targetFile, (await readFile(targetFile, 'utf8')) + retryLines.join('\n') + '\n', 'utf8')
  const widerRun = await runInstalledCli(facts, ['incident', '--target-session', TARGET, '--target-cwd', WORKSPACE, '--seq-min', '0', '--seq-max', '8', '--now', '2026-11-01T10:00:00.000Z'], { home: facts.workflowHome })
  const recoveries = widerRun.value?.issues?.recoveries ?? []
  const ticketAfterRecovery = (await readdir(ticketDirectory)).sort()
  const recoveryText = (await Promise.all(ticketAfterRecovery.map((name) => readFile(path.join(ticketDirectory, name), 'utf8')))).join('\n')
  record('INC-07', 'a later success records 「本次已恢复」 and closes nothing', widerRun.code === 0
    && recoveries.length > 0
    && recoveries.every((entry) => entry.closed === false)
    && recoveryText.includes('本次已恢复')
    && ticketAfterRecovery.length === ticketsBefore.length,
  'wider run exit ' + widerRun.code + '; recoveries ' + String(recoveries.length) + '; tickets ' + ticketAfterRecovery.length + '; recovery statement on file ' + recoveryText.includes('本次已恢复'))

  // SCOPE-06 (analysis branch): the assisted session writes evidence but cannot approve.
  const assistedBundle = await runInstalledCli(facts, ['incident', '--target-session', TARGET, '--target-cwd', WORKSPACE, '--seq-min', '0', '--seq-max', '6', '--user-report', '子 agent 转述的现象'], { home: facts.workflowHome, env: { DSH_SESSION_ID: ASSISTED } })
  const assistedEvidence = assistedBundle.value?.evidence === undefined ? undefined : JSON.parse(await readFile(path.join(assistedBundle.value.evidence.directory, 'incident.json'), 'utf8'))
  record('SCOPE-06', 'an assisted report is attributed, not read as consent', assistedBundle.code === 0
    && assistedEvidence?.invocation?.delegation?.mayApproveUpgrade === false
    && assistedEvidence?.invocation?.delegation?.mayAssistAnalysis === true,
  'incident as ' + ASSISTED + ' exit ' + assistedBundle.code + '; mayApproveUpgrade=' + String(assistedEvidence?.invocation?.delegation?.mayApproveUpgrade))

  return { sessionsRoot, repository, evidence, state, first, bundle, ticketDirectory, ticketNames: ticketsBefore, ticketText: bytesBefore.get(ticketsBefore[0]) }
}

/**
 * The upgrade workflow, end to end, against the installed bundle.
 *
 * The assessment, proposal, consent, candidate validation and target switch all
 * run through the INSTALLED `operations/cli.mjs` (imported from the acceptance
 * profile, not from this checkout). The candidate install runner is injected, so
 * no real dependency install happens; every version, marker and digest the
 * report reads comes from real files in the candidate tree (D16/UPG-13).
 * @param {object} facts install facts plus the workflow home
 * @param {object} incident the incident chain's facts (shared home and roles)
 * @param {(id: string, part: string, ok: boolean, detail: string, extra?: object) => void} record report row writer
 * @returns {Promise<object>} the finished facts
 */
export async function runUpgradeChain(facts, incident, record, gap = () => undefined) {
  const operations = await import(pathToFileURL(facts.operationsEntry).href)
  const { run } = operations
  // VALIDATE and SWITCH run IN-PROCESS: their install runner is injected, and a
  // child process cannot receive one. Every refusal that must be an exit CODE goes
  // through a real child process instead (`cli` below), and the report says which
  // is which.
  const inProcess = (extra = {}) => ({
    env: hostEnv(facts.workflowHome, extra.env ?? {}),
    sessionsRoot: incident.sessionsRoot,
    stateDir: incident.state,
    ...extra.runner === undefined ? {} : { runner: extra.runner },
  })
  /** A usage refusal THROWS from the exported entry point; the child process is
   * what turns it into the documented exit code, so every refusal is measured on
   * a real process. */
  const cli = (argv, options = {}) => runInstalledCli(facts, argv, { home: facts.workflowHome, ...options })
  const versions = facts.versions
  const candidate = { hashline: nextVersion(versions.hashline), toolEdit: nextVersion(versions.toolEdit) }
  const sourcesFile = path.join(facts.workflowHome, 'sources.json')
  await writeFile(sourcesFile, JSON.stringify({ note: 'pinned metadata fixture: a fixed candidate, never the live registry', records: recommendingRecords(versions, candidate) }, null, 2) + '\n', 'utf8')

  // A query that could not be made is `unverified`, never "the latest": the
  // conclusion is capped at defer/insufficient-evidence (UPG-01).
  const unverifiedFile = path.join(facts.workflowHome, 'unverified.json')
  await writeFile(unverifiedFile, JSON.stringify({ note: 'every channel failed to query', records: [
    { component: 'dsh', kind: 'release', status: 'unverified', queriedAt: '2026-11-02T02:00:00.000Z', source: 'registry', version: null, commit: null, url: null, detail: 'the registry could not be reached' },
    { component: 'dsh', kind: 'prerelease', status: 'unverified', queriedAt: ASSESSED_AT, source: 'registry', version: null, commit: null, url: null, detail: 'the registry could not be reached' },
    { component: 'dsh', kind: 'commit', status: 'unverified', queriedAt: ASSESSED_AT, source: 'git', version: null, commit: null, url: null, detail: 'git ls-remote failed' },
    { component: 'hashline', kind: 'release', status: 'unverified', queriedAt: ASSESSED_AT, source: 'registry', version: null, commit: null, url: null, detail: 'the registry could not be reached' },
    { component: 'hashline', kind: 'prerelease', status: 'unverified', queriedAt: ASSESSED_AT, source: 'registry', version: null, commit: null, url: null, detail: 'the registry could not be reached' },
    { component: 'hashline', kind: 'commit', status: 'unverified', queriedAt: ASSESSED_AT, source: 'git', version: null, commit: null, url: null, detail: 'git ls-remote failed' },
    { component: 'tool-edit', kind: 'release', status: 'unverified', queriedAt: ASSESSED_AT, source: 'registry', version: null, commit: null, url: null, detail: 'the registry could not be reached' },
    { component: 'tool-edit', kind: 'prerelease', status: 'unverified', queriedAt: ASSESSED_AT, source: 'registry', version: null, commit: null, url: null, detail: 'the registry could not be reached' },
    { component: 'tool-edit', kind: 'commit', status: 'unverified', queriedAt: ASSESSED_AT, source: 'git', version: null, commit: null, url: null, detail: 'git ls-remote failed' },
  ] }, null, 2) + '\n', 'utf8')
  const offline = await cli(['upgrade', 'assess', '--sources', unverifiedFile, '--now', '2026-11-02T02:00:00.000Z'])
  record('UPG-01', 'an unavailable query is unverified, never "the latest"', offline.value?.conclusion !== 'no-upgrade'
    && offline.value?.verified !== true
    && offline.value?.conclusion !== 'recommend-candidate',
  'assess exit ' + offline.code + '; conclusion ' + String(offline.value?.conclusion) + '; verified ' + String(offline.value?.verified))

  // UPG-01: the read-only assessment, through the installed CLI as a child process.
  const assessed = await cli(['upgrade', 'assess', '--sources', sourcesFile, '--now', ASSESSED_AT])
  const assessmentDirectory = assessed.value?.evidence?.directory
  const sourcesWritten = assessmentDirectory === undefined ? undefined : JSON.parse(await readFile(path.join(assessmentDirectory, 'sources.json'), 'utf8'))
  record('UPG-01', 'every query lands with its channel, status and query time', (assessed.code === 0 || assessed.code === 2)
    && Array.isArray(sourcesWritten?.records)
    && sourcesWritten.records.length > 0
    && sourcesWritten.records.every((entry) => typeof entry.queriedAt === 'string' && typeof entry.kind === 'string' && typeof entry.status === 'string')
    && assessed.value?.conclusion === 'recommend-candidate',
  'assess exit ' + assessed.code + '; conclusion ' + String(assessed.value?.conclusion) + '; records ' + String(sourcesWritten?.records?.length ?? 0) + '; verified ' + String(assessed.value?.verified) + '; gaps ' + JSON.stringify(assessed.value?.gaps ?? []))
  // UPG-11: this fixture cannot resolve the official DSH product version, so the
  // assessment is legitimately incomplete and must say so rather than claim a pass.
  if (assessed.value?.verified !== true) {
    gap('UPG-01', 'the assessment could not verify every component', 'conclusion ' + String(assessed.value?.conclusion)
      + ' with verified=false; pendingVerification=' + String(assessed.value?.pendingVerification)
      + '; gaps ' + JSON.stringify(assessed.value?.gaps ?? []) + ' — an unverified component is never "no upgrade" and never a switch basis (UPG-11)')
  }
  // UPG-03: the reviewable proposal, and nothing installed or switched by it.
  const proposed = await cli(['upgrade', 'propose', '--target', 'upgrade-target', '--target-path', facts.targetProfile, '--now', PROPOSED_AT])
  const proposalDirectory = proposed.value?.evidence?.directory
  if (proposalDirectory === undefined) {
    record('UPG-03', 'a bound proposal is written; no candidate tree, no switch', false,
      'propose exit ' + proposed.code + ': ' + String(proposed.value?.status ?? proposed.stderr.slice(-400)))
    return { candidate, versions, operations, assessed, proposed }
  }
  const proposalPath = path.join(proposalDirectory, 'proposal.json')
  record('UPG-03', 'a bound proposal is written; no candidate tree, no switch', proposed.code === 0
    && existsSync(proposalPath)
    && existsSync(path.join(proposalDirectory, 'proposal.md'))
    && !existsSync(path.join(proposalDirectory, 'candidate'))
    && JSON.parse(await readFile(path.join(proposalDirectory, 'consent.json'), 'utf8')).status === 'pending',
  'propose exit ' + proposed.code + '; proposal ' + String(proposed.value?.proposalId) + '; consent pending; no candidate directory')
  // UPG-07: the automatic-acceptance family is a usage refusal on a real process.
  const autoApprove = await cli(['upgrade', 'consent', '--proposal', proposalPath, '--decision', 'approve', '--reply', REPLY, '--yes'])
  const emptyReply = await cli(['upgrade', 'consent', '--proposal', proposalPath, '--decision', 'approve', '--reply', ''])
  record('UPG-07', 'no flag and no empty reply can stand in for the user', autoApprove.code === 3 && emptyReply.code === 3
    && JSON.parse(await readFile(path.join(proposalDirectory, 'consent.json'), 'utf8')).status === 'pending',
  'consent --yes exit ' + autoApprove.code + '; empty --reply exit ' + emptyReply.code + '; consent still pending')
  // UPG-03: a quote this session never wrote records nothing.
  const unfound = await cli(['upgrade', 'consent', '--proposal', proposalPath, '--decision', 'approve', '--reply', '我没有说过这句话。'])
  record('UPG-03', 'a quote the session never wrote records nothing', unfound.code === 2
    && JSON.parse(await readFile(path.join(proposalDirectory, 'consent.json'), 'utf8')).status === 'pending',
  'consent with an unwritten quote exit ' + unfound.code + '; consent still pending')
  // SCOPE-06: an assisted session cannot record the approval at all.
  const assistedConsent = await cli(['upgrade', 'consent', '--proposal', proposalPath, '--decision', 'approve', '--scope', 'validation-and-switch', '--reply', REPLY], { env: { DSH_SESSION_ID: ASSISTED } })
  record('SCOPE-06', 'an assisted session cannot record an approval', assistedConsent.code === 2
    && JSON.parse(await readFile(path.join(proposalDirectory, 'consent.json'), 'utf8')).status === 'pending',
  'consent as ' + ASSISTED + ' exit ' + assistedConsent.code + '; consent still pending')

  // The user's own reply, granting both phases in one explicit decision (D4).
  const consented = await cli(['upgrade', 'consent', '--proposal', proposalPath, '--decision', 'approve', '--scope', 'validation-and-switch', '--reply', REPLY, '--now', PROPOSED_AT])
  const consentRecord = JSON.parse(await readFile(path.join(proposalDirectory, 'consent.json'), 'utf8'))
  record('UPG-07', 'one explicit two-phase reply is recorded once, with its binding', consented.code === 0
    && consentRecord.status === 'approved'
    && consentRecord.records.length === 1
    && consentRecord.records[0].scope?.candidateValidation === true
    && consentRecord.records[0].scope?.switch === true
    && consentRecord.records[0].proposalHash === proposed.value?.proposalHash,
  'consent exit ' + consented.code + '; records ' + String(consentRecord.records?.length ?? 0) + '; scope ' + JSON.stringify(consentRecord.records?.[0]?.scope ?? null))

  // UPG-04/06: the approved candidate, isolated, with an injected install runner.
  const targetBeforeCandidate = await snapshot(facts.targetProfile)
  const candidateFake = fakeCandidateRunner(candidate)
  const validated = await run(['upgrade', 'validate', '--proposal', proposalPath, '--now', VALIDATED_AT], inProcess({ runner: candidateFake.runner }))
  const resultPath = path.join(proposalDirectory, 'candidate', 'result.json')
  const candidateResult = existsSync(resultPath) ? JSON.parse(await readFile(resultPath, 'utf8')) : undefined
  record('UPG-04', 'the approved candidate is validated in its own tree', validated.code === 0
    && candidateResult?.verdict === 'candidate-verified'
    && candidateResult?.runner?.source === 'injected'
    && candidateFake.calls.every((call) => call.cwd.startsWith(path.join(proposalDirectory, 'candidate'))),
  'validate exit ' + validated.code + '; verdict ' + String(candidateResult?.verdict) + '; runner ' + String(candidateResult?.runner?.source) + '; commands ' + String(candidateResult?.commands?.length ?? 0))
  record('UPG-04', 'the validated combination is the approved one', candidateResult?.versions?.after?.hashline === candidate.hashline
    && candidateResult?.versions?.after?.toolEdit === candidate.toolEdit
    && candidateResult?.checks?.some((check) => check.name === 'candidate-versions-match' && check.status === 'pass'),
  'resolved ' + String(candidateResult?.versions?.after?.hashline) + '/' + String(candidateResult?.versions?.after?.toolEdit) + ' vs approved ' + candidate.hashline + '/' + candidate.toolEdit)
  record('UPG-04', 'the candidate phase touched no target', await snapshot(facts.targetProfile).then((after) => JSON.stringify(after) === JSON.stringify(targetBeforeCandidate)),
    'the target profile is byte-identical to its pre-candidate snapshot')

  // UPG-06/12: the approved switch. The target install fails, so the round must
  // restore what it changed and prove it is back at the rollback baseline.
  const switchFake = fakeSwitchRunner(facts, candidate, { failTargetInstall: true })
  const switched = await run(['upgrade', 'switch', '--proposal', proposalPath, '--now', SWITCHED_AT], inProcess({ runner: switchFake.runner }))
  const switchRecord = existsSync(path.join(proposalDirectory, 'switch.json'))
    ? JSON.parse(await readFile(path.join(proposalDirectory, 'switch.json'), 'utf8'))
    : undefined
  const rollback = existsSync(path.join(proposalDirectory, 'rollback.json'))
    ? JSON.parse(await readFile(path.join(proposalDirectory, 'rollback.json'), 'utf8'))
    : undefined
  record('UPG-12', 'a partial failure restores only this round, and says so', switched.code === 2
    && switchRecord?.conclusion === 'switch-failed-restored'
    && rollback?.phase === 'restored'
    && (rollback?.externalChange ?? []).length === 0
    && (rollback?.restoredFiles ?? []).length > 0
    && (rollback?.restoredFiles ?? []).every((entry) => entry.action === 'restored' || entry.action === 'removed'),
  'switch exit ' + switched.code + '; conclusion ' + String(switchRecord?.conclusion) + '; rollback phase ' + String(rollback?.phase)
    + '; external changes ' + String((rollback?.externalChange ?? []).length)
    + '; restoredFiles ' + String((rollback?.restoredFiles ?? []).length))
  // The four target checks switch.mjs can emit are the only ones that could claim
  // the target is good. Each must be absent-or-not-pass here: a run that failed to
  // install the target cannot have verified it, and reading any of them as a pass
  // is exactly the overstatement this row exists to catch.
  const targetChecks = ['target-versions-match-approved', 'target-patch-markers', 'target-resolved-paths-and-shared-instance', 'target-read-edit-short-link']
  const targetCheckStatuses = targetChecks.map((name) => (switchRecord?.checks ?? []).find((check) => check.name === name)?.status ?? 'absent')
  record('UPG-06', 'no target verification reads as a pass when the target was never installed', (switchRecord?.steps ?? []).some((step) => step.status === 'failed')
    && targetCheckStatuses.every((status) => status !== 'pass')
    && (switchRecord?.skipped ?? []).some((entry) => entry.name === 'target-verification'),
  'failed steps ' + JSON.stringify((switchRecord?.steps ?? []).filter((step) => step.status === 'failed').map((step) => step.name))
    + '; target checks ' + JSON.stringify(Object.fromEntries(targetChecks.map((name, index) => [name, targetCheckStatuses[index]]))))
  // The restore is only "restored" when every measured item matches the proposal's
  // baseline: the lockfile digest, each patch file's digest and both resolved
  // engines. Reading those values is what separates a real restore from a claim.
  const reverted = rollback?.verification
  const revertedChecks = [
    ...reverted?.lockfile === undefined ? [] : [reverted.lockfile],
    ...reverted?.patchFiles ?? [],
    ...reverted?.engines ?? [],
  ]
  record('UPG-06', 'the rollback baseline really came back', revertedChecks.length >= 4
    && revertedChecks.every((entry) => entry.match === true)
    && reverted.engines.every((entry) => entry.now === versions[entry.component === 'tool-edit' ? 'toolEdit' : 'hashline']),
  'verified ' + revertedChecks.length + ' restored item(s), all matching: '
    + revertedChecks.map((entry) => (entry.path ?? entry.component ?? 'lockfile') + '=' + String(entry.match)).join(', '))

  // The two workflows must share ONE baseline/context contract: the upgrade run
  // reads the roles the incident chain saved, and the same session projection
  // gates both. Handing it a different stateDir would silently make them two
  // different workflows with two different answers.
  const upgradeConfig = await cli(['config'])
  record('CONFIG-01', 'both workflows read the same saved roles and the same projection', upgradeConfig.code === 0
    && upgradeConfig.value?.roles?.maintenanceRepository?.path === incident.repository
    && upgradeConfig.value?.roles?.evidenceDirectory?.path === incident.evidence
    && assessed.value?.context?.eligible === true,
  'config from the upgrade chain: repo ' + String(upgradeConfig.value?.roles?.maintenanceRepository?.path !== incident.repository ? 'DIFFERENT' : 'same')
    + ', evidence ' + String(upgradeConfig.value?.roles?.evidenceDirectory?.path !== incident.evidence ? 'DIFFERENT' : 'same')
    + '; assess gated by the same projection (' + String(assessed.value?.context?.status) + ')')

  return { proposalDirectory, proposalPath, candidateResult, switchRecord, rollback, candidate, versions, operations, assessed, validated, switched }
}

/** The next version above a version by semver precedence. */
export function nextVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/u.exec(String(version))
  if (match === null) throw new Error('this machine resolves no comparable engine version (' + JSON.stringify(version) + ')')
  const [, major, minor, patch, pre] = match
  if (pre === undefined) return major + '.' + minor + '.' + (Number(patch) + 1)
  const parts = pre.split('.')
  const last = parts[parts.length - 1]
  if (/^\d+$/u.test(last)) {
    parts[parts.length - 1] = String(Number(last) + 1)
    return major + '.' + minor + '.' + patch + '-' + parts.join('.')
  }
  return major + '.' + minor + '.' + patch + '-' + pre + '.1'
}

function source(component, kind, fields = {}) {
  return { component, kind, status: 'verified', queriedAt: '2026-11-02T03:00:00.000Z', source: 'fixture:' + component, version: null, commit: null, url: null, ...fields }
}

function stableChannels(component, version) {
  return [
    source(component, 'release', { version, url: 'https://example.invalid/' + component }),
    source(component, 'prerelease', { version: null, detail: 'no pre-release dist-tag is published' }),
    source(component, 'commit', { commit: 'c0ffee0'.repeat(5), url: 'https://example.invalid/' + component, unreleased: false }),
  ]
}

/** One fixed candidate that carries package text, so every patch item is decidable. */
function recommendingRecords(versions, candidate) {
  return [
    ...stableChannels('dsh', versions.dsh === 'unknown' ? '0.2.1-rc.2' : versions.dsh),
    source('hashline', 'release', { version: candidate.hashline, url: 'https://example.invalid/hashline', files: { 'dist/patcher.js': HASHLINE_PATCH_MARKERS[0].marker + '\n' } }),
    source('hashline', 'prerelease', { version: null }),
    source('hashline', 'commit', { commit: 'a'.repeat(40), unreleased: false }),
    source('tool-edit', 'release', { version: candidate.toolEdit, url: 'https://example.invalid/tool-edit', covers: TOOL_EDIT_PATCH_MARKERS.map((entry) => entry.marker), detail: '上游已在稳定版实现这些行为，本地补丁可整体删除' }),
    source('tool-edit', 'prerelease', { version: null }),
    source('tool-edit', 'commit', { commit: 'b'.repeat(40), unreleased: false }),
  ]
}

/** Write the fake install a candidate or target tree would receive. */
async function materialize(directory, engineVersions) {
  const write = async (relative, text) => {
    const target = path.join(directory, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, text, 'utf8')
  }
  const patcher = HASHLINE_PATCH_MARKERS.map((entry) => entry.marker).join('\n') + '\n'
  await write('node_modules/' + HASH_PKG + '/package.json', JSON.stringify({ name: HASH_PKG, version: engineVersions.hashline, type: 'module', main: 'dist/index.js' }, null, 2) + '\n')
  await write('node_modules/' + HASH_PKG + '/dist/patcher.js', patcher)
  await write('node_modules/' + HASH_PKG + '/dist/index.js', 'export const hashline = true\n')
  await write('node_modules/' + EDIT_PKG + '/package.json', JSON.stringify({ name: EDIT_PKG, version: engineVersions.toolEdit, type: 'module', main: 'dist/index.js', dependencies: { [HASH_PKG]: engineVersions.hashline } }, null, 2) + '\n')
  for (const entry of TOOL_EDIT_PATCH_MARKERS) await write('node_modules/' + EDIT_PKG + '/' + entry.file.join('/'), '// upstream implementation\n')
  for (const plugin of ['tool-read', 'tool-edit']) {
    await write('node_modules/@dsh-tool-hashline/' + plugin + '/package.json', JSON.stringify({ name: '@dsh-tool-hashline/' + plugin, version: '0.0.0', type: 'module', main: 'dist/index.js', dependencies: { [HASH_PKG]: engineVersions.hashline } }, null, 2) + '\n')
    await write('node_modules/@dsh-tool-hashline/' + plugin + '/dist/index.js', 'export const mounted = true\n')
  }
  if (!existsSync(path.join(directory, 'pnpm-lock.yaml'))) await write('pnpm-lock.yaml', 'lockfileVersion: 9.0\n# resolved by the acceptance fixture install\n')
}

/** The injected runner for the candidate phase: an install, then the proposed gates. */
function fakeCandidateRunner(candidate) {
  const calls = []
  const runner = async (command, args, options) => {
    calls.push({ command, args: [...args], cwd: options.cwd })
    if (args[0] === 'install') {
      await materialize(options.cwd, candidate)
      return { exitCode: 0, stdout: 'installed by the acceptance fixture' }
    }
    if (typeof args[0] === 'string' && args[0].endsWith('short-link.mjs')) {
      return { exitCode: 0, stdout: JSON.stringify({ status: 'ok', tag: 'A1B2' }) }
    }
    return { exitCode: 0, stdout: 'ok' }
  }
  return { runner, calls }
}

/**
 * The injected runner for the switch phase.
 *
 * Like a real install, it writes what the directory it runs in DECLARES: the
 * candidate versions while the round is applying, and the rollback baseline when
 * the round is undoing itself. The target's first install fails (the case this
 * run measures), and nothing is written in that attempt — a real failed install
 * leaves the tree as it found it.
 */
function fakeSwitchRunner(facts, candidate, options = {}) {
  const calls = []
  const installs = new Map()
  const runner = async (command, args, callOptions) => {
    calls.push({ command, args: [...args], cwd: callOptions.cwd })
    if (args[0] === 'install') {
      const count = (installs.get(callOptions.cwd) ?? 0) + 1
      installs.set(callOptions.cwd, count)
      const isTarget = callOptions.cwd === facts.targetProfile
      if (isTarget && options.failTargetInstall === true && count === 1) {
        return { exitCode: 1, stdout: '', stderr: 'the acceptance fixture refused this install' }
      }
      // A rollback re-install restores the baseline; an applying install writes the candidate.
      const rollingBack = count > 1
      await materialize(callOptions.cwd, rollingBack ? facts.versions : candidate)
      return { exitCode: 0, stdout: 'installed by the acceptance fixture' }
    }
    if (typeof args[0] === 'string' && args[0].endsWith('short-link.mjs')) {
      return { exitCode: 0, stdout: JSON.stringify({ status: 'ok', tag: 'A1B2' }) }
    }
    return { exitCode: 0, stdout: 'ok' }
  }
  return { runner, calls }
}