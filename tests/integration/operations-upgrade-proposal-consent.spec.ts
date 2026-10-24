/**
 * UPG-03/05/06/07 and SCOPE-06's execution branch: the reviewable upgrade
 * proposal, and the consent record that binds the user's own reply to it.
 *
 * The seams are the ones tickets 02/03/04 established: the operations CLI
 * (`run(['upgrade', 'propose', ...])`, `run(['upgrade', 'consent', ...])`) and
 * the files written under `<evidenceDirectory>/upgrades/<proposalId>/`. Every
 * acceptance point is observable there; nothing reaches into an internal step.
 *
 * Two boundaries are stated once here:
 * - The assessment a proposal is built from is REAL: every fixture runs
 *   `upgrade assess` first, so the freshness rule ("the baseline drifted
 *   between the check and the proposal") is measured against the same collection
 *   the proposal re-runs, and no test hand-writes an assessment that could not
 *   exist on this machine (a candidate is always newer than the LIVE baseline).
 * - Nothing here installs, builds, switches or touches a manifest / lockfile /
 *   patch / dist / profile: the proposal is consent-only and the consent is a
 *   record. The maintenance worktree is snapshotted around every run.
 */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { HASHLINE_PATCH_MARKERS, TOOL_EDIT_PATCH_MARKERS } from '../../presets/ptc-hashline/operations/baseline.mjs'
import { EXIT, run } from '../../presets/ptc-hashline/operations/cli.mjs'
import { saveConfig } from '../../presets/ptc-hashline/operations/config.mjs'
import { bindingOf, proposalHashOf } from '../../presets/ptc-hashline/operations/proposals.mjs'
import { encodeSegment, projectKey } from '../../presets/ptc-hashline/operations/session-log.mjs'

const SESSION = 'session-proposal-0001'
const PARENT = 'session-proposal-parent-0001'
const WORKSPACE = '/work/proposal-project'
const ASSESSED_AT = '2026-10-23T09:30:00.000Z'
const ASSESS_STAMP = '20261023-093000'
const PROPOSED_AT = '2026-10-24T08:15:00.000Z'
const PROPOSED_STAMP = '20261024-081500'
const LATER_AT = '2026-10-24T09:45:00.000Z'
/** The user's own verbatim reply: writeSession puts it in this session's log at REPLY_SEQ. */
const REPLY = '同意只做候选验证，先不要切换目标。'
/** The seq of that reply in the fixture session log. */
const REPLY_SEQ = 2
const NEVER_SAID = '这一段用户从来没有说过。'
const SCRIPTS = { 'check:preset': 'node scripts/check-preset.mjs', 'test:unit': 'vitest run --config vitest.unit.config.ts' }
const CLI = path.resolve(process.cwd(), 'presets', 'ptc-hashline', 'operations', 'cli.mjs')
const execFileAsync = promisify(execFile)
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function readJson<T = any>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

interface Fixture {
  home: string
  state: string
  sessions: string
  repository: string
  evidence: string
}

interface FixtureOptions {
  /** Declared package.json scripts, or none (a gap the proposal must name). */
  scripts?: Record<string, string>
  /** Put the evidence directory INSIDE the maintenance worktree (a refused configuration). */
  evidenceInsideRepository?: boolean
  /** A subagent session header (SCOPE-06). */
  assisted?: boolean
}

/** One session log: the header, a preset projection and two user messages. */
async function writeSession(root: string, options: { assisted?: boolean } = {}): Promise<void> {
  const directory = path.join(root, projectKey(WORKSPACE), encodeSegment(SESSION))
  await mkdir(directory, { recursive: true })
  const header = {
    type: 'session',
    version: 4,
    id: SESSION,
    cwd: WORKSPACE,
    createdAt: 1,
    isSeeded: false,
    delegationDepth: options.assisted === true ? 1 : 0,
    agentPreset: 'ptc-hashline',
    ...options.assisted === true ? { origin: 'subagent', parentSession: PARENT } : {},
  }
  const user = (seq: number, text: string) => JSON.stringify({ type: 'user/message', seq, data: { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } })
  const lines = [
    JSON.stringify(header),
    JSON.stringify({ type: 'permission/preset', seq: 0, data: { preset: 'workspace-write' } }),
    // Contiguous seqs: a gap would make an incident bundle of this session
    // incomplete for a reason that has nothing to do with this ticket.
    user(1, '/ptc-hashline-upgrade 检查一下三方更新，升级要等我同意。'),
    user(2, REPLY),
  ]
  await writeFile(path.join(directory, 'session.v4.jsonl'), lines.join('\n') + '\n', 'utf8')
}

/** A whole host home: session log, saved roles and one clean maintenance worktree. */
async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const home = await temp('proposal-home-')
  const state = path.join(home, 'state', 'ptc-hashline-operations')
  const sessions = path.join(home, 'sessions')
  const repository = await temp('proposal-repo-')
  const manifest: Record<string, unknown> = { name: 'fixture', version: '0.0.0', packageManager: 'pnpm@11.28.5' }
  if (options.scripts !== undefined) manifest.scripts = options.scripts
  await writeFile(path.join(repository, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  await writeFile(path.join(repository, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')
  await mkdir(path.join(repository, 'patches'), { recursive: true })
  await writeFile(path.join(repository, 'patches', 'hashline.patch'), 'fixture patch\n', 'utf8')
  execFileSync('git', ['init', '-q', repository])
  execFileSync('git', ['-C', repository, 'add', '.'])
  execFileSync('git', ['-C', repository, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'])
  const evidence = options.evidenceInsideRepository === true ? await mkdir(path.join(repository, 'evidence'), { recursive: true }).then(() => path.join(repository, 'evidence')) : await temp('proposal-evidence-')
  await saveConfig({ directory: state, maintenanceRepository: repository, evidenceDirectory: evidence })
  await writeSession(sessions, { assisted: options.assisted === true })
  return { home, state, sessions, repository, evidence }
}

function environmentOf(): Record<string, string> {
  return { DSH_SESSION_ID: SESSION, PWD: WORKSPACE }
}

function cliEnvironment(f: Fixture) {
  return { env: environmentOf(), sessionsRoot: f.sessions, stateDir: f.state }
}

function runAssess(f: Fixture, argv: string[] = []) {
  return run(['upgrade', 'assess', ...argv] as ['upgrade', 'assess', ...string[]], cliEnvironment(f))
}

function runPropose(f: Fixture, argv: string[] = []) {
  return run(['upgrade', 'propose', ...argv] as ['upgrade', 'propose', ...string[]], cliEnvironment(f))
}

function runConsent(f: Fixture, argv: string[]) {
  return run(['upgrade', 'consent', ...argv] as ['upgrade', 'consent', ...string[]], cliEnvironment(f))
}

/** The live engine versions, so a candidate is newer THAN THIS machine's baseline. */
async function liveVersions(f: Fixture): Promise<{ hashline: string; toolEdit: string; dsh: string }> {
  const report = await run(['baseline'], cliEnvironment(f))
  const baseline = report.value.baseline
  return { hashline: baseline.engines.hashline.version, toolEdit: baseline.engines.toolEdit.version, dsh: baseline.versions.dsh }
}

/** The next version above `version` by semver precedence. */
function nextVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/u.exec(version)
  if (match === null) throw new Error('this machine resolves no comparable engine version (' + JSON.stringify(version) + '), so no deterministic candidate can be built')
  const [, major, minor, patch, pre] = match as unknown as [string, string, string, string, string | undefined]
  if (pre === undefined) return major + '.' + minor + '.' + (Number(patch) + 1)
  const parts = pre.split('.')
  const last = parts[parts.length - 1] as string
  if (/^\d+$/u.test(last)) {
    parts[parts.length - 1] = String(Number(last) + 1)
    return major + '.' + minor + '.' + patch + '-' + parts.join('.')
  }
  return major + '.' + minor + '.' + patch + '-' + pre + '.1'
}

function source(component: string, kind: 'release' | 'prerelease' | 'commit', fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { component, kind, status: 'verified', queriedAt: ASSESSED_AT, source: 'fixture:' + component, version: null, commit: null, url: null, ...fields }
}

/** Three VERIFIED channels that did not move away from `version`. */
function stableChannels(component: string, version: string): Record<string, unknown>[] {
  return [
    source(component, 'release', { version, url: 'https://example.invalid/' + component }),
    source(component, 'prerelease', { version: null, detail: 'no pre-release dist-tag is published' }),
    source(component, 'commit', { commit: 'c0ffee0'.repeat(5), url: 'https://example.invalid/' + component, unreleased: false }),
  ]
}

/** Candidate package text in which every hashline marker survives (decision: keep). */
function candidateFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  for (const entry of HASHLINE_PATCH_MARKERS) {
    const key = entry.file.join('/')
    files[key] = (files[key] ?? '') + entry.marker + '\n'
  }
  return files
}

async function sourcesFile(records: Record<string, unknown>[]): Promise<string> {
  const dir = await temp('proposal-sources-')
  const file = path.join(dir, 'sources.json')
  await writeFile(file, JSON.stringify({ note: 'pinned metadata fixture', records }, null, 2) + '\n', 'utf8')
  return file
}

interface Versions {
  hashline: string
  toolEdit: string
  dsh: string
}

/** The metadata that makes hashline a recommended candidate on THIS machine. */
function recommendingRecords(versions: Versions): Record<string, unknown>[] {
  return [
    ...stableChannels('dsh', versions.dsh === 'unknown' ? '0.2.1-rc.2' : versions.dsh),
    source('hashline', 'release', { version: nextVersion(versions.hashline), url: 'https://example.invalid/hashline', files: candidateFiles() }),
    source('hashline', 'prerelease', { version: null }),
    source('hashline', 'commit', { commit: 'a'.repeat(40), unreleased: false }),
    ...stableChannels('tool-edit', versions.toolEdit === 'unknown' ? '0.2.1-alpha.4' : versions.toolEdit),
  ]
}

/** The metadata that makes the whole run defer: a newer PRE-RELEASE only. */
function deferringRecords(versions: Versions): Record<string, unknown>[] {
  return [
    ...stableChannels('dsh', versions.dsh === 'unknown' ? '0.2.1-rc.2' : versions.dsh),
    source('hashline', 'release', { version: versions.hashline }),
    source('hashline', 'prerelease', { version: nextVersion(versions.hashline) }),
    source('hashline', 'commit', { commit: 'a'.repeat(40), unreleased: false }),
    ...stableChannels('tool-edit', versions.toolEdit === 'unknown' ? '0.2.1-alpha.4' : versions.toolEdit),
  ]
}

interface Assessed {
  fixture: Fixture
  versions: Versions
  candidateVersion: string
  assessmentDirectory: string
  assessment: any
}

/** Run the REAL assessment first: a proposal is built from what assess wrote. */
async function assessed(options: FixtureOptions = { scripts: SCRIPTS }): Promise<Assessed> {
  const created = await fixture(options)
  const versions = await liveVersions(created)
  const file = await sourcesFile(recommendingRecords(versions))
  await runAssess(created, ['--sources', file, '--now', ASSESSED_AT])
  const assessmentDirectory = path.join(created.evidence, 'upgrades', ASSESS_STAMP)
  return {
    fixture: created,
    versions,
    candidateVersion: nextVersion(versions.hashline),
    assessmentDirectory,
    assessment: await readJson(path.join(assessmentDirectory, 'assessment.json')),
  }
}

/** The proposal directory a propose run wrote, or a loud failure. */
function proposalDirOf(result: { value: any }): string {
  const evidence = result.value.evidence
  if (evidence === undefined) throw new Error('the propose command wrote no proposal: ' + String(result.value.status) + ' / ' + String(result.value.reason))
  return evidence.directory
}

interface Proposed {
  result: any
  directory: string
  proposal: any
  consent: any
}

async function proposalOf(f: Fixture, argv: string[] = ['--now', PROPOSED_AT]): Promise<Proposed> {
  const result = await runPropose(f, argv)
  const directory = proposalDirOf(result)
  return {
    result,
    directory,
    proposal: await readJson(path.join(directory, 'proposal.json')),
    consent: await readJson(path.join(directory, 'consent.json')),
  }
}

/** Sorted relative path -> text for every file under one directory (.git excluded). */
async function snapshot(directory: string): Promise<[string, string][]> {
  const entries: [string, string][] = []
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      entries.push([path.relative(directory, absolute).split(path.sep).join('/'), await readFile(absolute, 'utf8')])
    }
  }
  await walk(directory)
  return entries.sort((left, right) => left[0].localeCompare(right[0]))
}

function gitStatus(repository: string): string {
  return execFileSync('git', ['-C', repository, 'status', '--porcelain=v1'], { encoding: 'utf8' })
}

/** The entries of <evidence>/upgrades, sorted; empty when nothing was written. */
async function upgradeDirs(evidence: string): Promise<string[]> {
  try {
    return (await readdir(path.join(evidence, 'upgrades'))).sort()
  } catch {
    return []
  }
}

/** Every file under one directory tree, as sorted relative paths. */
async function filesUnder(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return []
  return (await snapshot(directory)).map(([relative]) => relative)
}

/** Run the shipped CLI as a real child process, to observe the real exit code. */
async function runCli(f: Fixture, argv: string[]): Promise<{ code: number; stderr: string; json?: any }> {
  const inherited = { ...process.env }
  delete inherited.NODE_PATH
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, ...argv], {
      env: { ...inherited, ...environmentOf(), DSH_HOME: f.home },
      encoding: 'utf8',
    })
    return { code: 0, stderr: '', json: JSON.parse(stdout) }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    const stdout = (failure.stdout ?? '').trim()
    return { code: typeof failure.code === 'number' ? failure.code : -1, stderr: failure.stderr ?? '', json: stdout === '' ? undefined : JSON.parse(stdout) }
  }
}

describe('UPG-03: the reviewable proposal, computed from a real assessment', () => {
  it('writes every required field, names the candidate directory without creating it, and hashes the same bound inputs to the same value', async () => {
    const { fixture: f, candidateVersion, assessmentDirectory } = await assessed()
    const before = await snapshot(f.repository)
    const { result, directory, proposal, consent } = await proposalOf(f)

    // proposalId / proposalHash, and the directory derived from them.
    expect(result.code).toBe(EXIT.ok)
    expect(result.value.status).toBe('proposed')
    expect(proposal.proposalId).toBe(PROPOSED_STAMP + '-' + proposal.proposalHash.slice(0, 12))
    expect(path.basename(directory)).toBe(proposal.proposalId)
    expect(path.dirname(directory)).toBe(path.join(f.evidence, 'upgrades'))
    expect((await readdir(directory)).sort()).toEqual(['consent.json', 'proposal.json', 'proposal.md'])

    // The exact baseline and its own hash.
    expect(proposal.baseline.hash).toBe(proposal.baselineHash)
    expect(proposal.baseline.dirty).toBe('clean')
    expect(proposal.baseline.lockfileSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(proposal.baseline.commit).toMatch(/^[0-9a-f]{40}$/u)
    expect(proposal.baseline.patchFiles).toHaveLength(1)
    expect(proposal.assessment.directory).toBe(assessmentDirectory)
    expect(proposal.assessment.conclusion).toBe('recommend-candidate')

    // Candidates, reasons with their upstream sources, and per-item patch decisions.
    expect(proposal.candidates.map((item: any) => item.component)).toEqual(['hashline'])
    const candidate = proposal.candidates[0]
    expect(candidate.version).toBe(candidateVersion)
    expect(candidate.source).toBe('fixture:hashline')
    expect(candidate.url).toBe('https://example.invalid/hashline')
    expect(proposal.reasons.map((item: any) => item.component).sort()).toEqual(['dsh', 'hashline', 'tool-edit'])
    for (const reason of proposal.reasons) {
      expect(typeof reason.reason).toBe('string')
      expect(reason.sources.map((entry: any) => entry.kind).sort()).toEqual(['commit', 'prerelease', 'release'])
    }
    // Every local patch item is listed with its decision. The candidate's own
    // items are decided from its bytes; a component nobody is upgrading keeps
    // 'pending-verification' rather than a silent 'keep'.
    const hashlineItems = proposal.patchDecisions.filter((item: any) => item.component === 'hashline')
    expect(hashlineItems).toHaveLength(HASHLINE_PATCH_MARKERS.length)
    expect(hashlineItems.every((item: any) => item.decision === 'keep')).toBe(true)
    const toolItems = proposal.patchDecisions.filter((item: any) => item.component === 'tool-edit')
    expect(toolItems).toHaveLength(TOOL_EDIT_PATCH_MARKERS.length)
    expect(toolItems.every((item: any) => item.decision === 'pending-verification')).toBe(true)
    expect(proposal.patchDecisions.every((item: any) => typeof item.reason === 'string' && typeof item.file === 'string' && typeof item.marker === 'string')).toBe(true)

    // Changes: files, candidate directory, verification commands, expected impact.
    expect(proposal.changes.files.map((entry: any) => entry.path)).toEqual(['package.json', 'pnpm-lock.yaml', 'patches/hashline.patch'])
    expect(proposal.changes.candidateDirectory).toBe(path.join(directory, 'candidate'))
    expect(existsSync(proposal.changes.candidateDirectory)).toBe(false)
    expect(proposal.changes.verification).toEqual([
      { name: 'check:preset', script: 'node scripts/check-preset.mjs', run: 'pnpm check:preset' },
      { name: 'test:unit', script: 'vitest run --config vitest.unit.config.ts', run: 'pnpm test:unit' },
    ])
    expect(proposal.changes.expectedImpact).toHaveLength(3)
    expect(proposal.changes.expectedImpact.join(' ')).toContain('来源未申报')

    // Scope, risks, stop conditions, rollback and the execution boundary.
    expect(proposal.scope).toMatchObject({ candidateValidation: true, switch: false })
    expect(proposal.risks.length).toBeGreaterThan(0)
    expect(proposal.stopConditions.join(' ')).toContain('无回复')
    expect(proposal.rollback.baselineHash).toBe(proposal.baselineHash)
    expect(proposal.rollback.commit).toBe(proposal.baseline.commit)
    expect(proposal.rollback.dirty).toBe('clean')
    expect(proposal.rollback.userInputs).toEqual([])
    expect(proposal.rollback.lockfileSha256).toBe(proposal.baseline.lockfileSha256)
    expect(proposal.rollback.patchFiles).toEqual(proposal.baseline.patchFiles)
    expect(proposal.rollback.roles.maintenanceRepository).toBe(f.repository)
    expect(proposal.rollback.target).toEqual({ role: 'maintenance-repository', path: f.repository })
    expect(proposal.execution).toMatchObject({ mode: 'consent-only', installed: false, built: false, switched: false })

    // No consent exists yet: pending, and the file says so.
    expect(consent.status).toBe('pending')
    expect(consent.records).toEqual([])
    expect(consent.proposalHash).toBe(proposal.proposalHash)
    expect(result.value.consent.status).toBe('pending')
    expect(String(result.value.next)).toContain('upgrade consent')

    // The worktree is untouched and no candidate directory was created.
    expect(await snapshot(f.repository)).toEqual(before)
    expect(gitStatus(f.repository)).toBe('')
    expect(await upgradeDirs(f.evidence)).toEqual([ASSESS_STAMP, proposal.proposalId].sort())

    // Same bound inputs, another run: same hash, another stamp (never another payload).
    const again = await proposalOf(f, ['--now', LATER_AT])
    expect(again.proposal.proposalHash).toBe(proposal.proposalHash)
    expect(path.basename(again.directory)).toBe('20261024-094500-' + proposal.proposalHash.slice(0, 12))
    expect(again.consent.status).toBe('pending')

    // The human report carries the same identity and claims nothing it did not do.
    const report = await readFile(path.join(directory, 'proposal.md'), 'utf8')
    expect(report).toContain(proposal.proposalHash)
    expect(report).toContain(candidateVersion)
    expect(report).toContain('未安装')
    expect(report).not.toContain('已升级')
  })

  it('refuses an assessment that is not recommend-candidate, and writes no proposal at all', async () => {
    const f = await fixture()
    const versions = await liveVersions(f)
    const file = await sourcesFile(deferringRecords(versions))
    const assessedRun = await runAssess(f, ['--sources', file, '--now', ASSESSED_AT])
    expect(assessedRun.value.conclusion).toBe('defer')
    const evidenceBefore = await filesUnder(f.evidence)

    const result = await runPropose(f, ['--now', PROPOSED_AT])
    expect(result.code).toBe(EXIT.stopped)
    expect(result.value.status).toBe('stopped')
    expect(String(result.value.reason)).toContain('defer')
    expect(String(result.value.reason)).toContain('recommend-candidate')
    expect(String(result.value.next)).toContain('upgrade assess')
    expect(result.value.evidence).toBeUndefined()
    // Nothing was written: the evidence directory still holds only the assessment.
    expect(await filesUnder(f.evidence)).toEqual(evidenceBefore)
    expect(await upgradeDirs(f.evidence)).toEqual([ASSESS_STAMP])
    expect((await filesUnder(f.evidence)).some(name => name.endsWith('proposal.json') || name === 'consent.json')).toBe(false)
  })

  it('refuses when there is no assessment to build on, or the named one cannot be read', async () => {
    const f = await fixture()
    const empty = await runPropose(f, ['--now', PROPOSED_AT])
    expect(empty.code).toBe(EXIT.stopped)
    expect(String(empty.value.reason)).toContain('no assessment')
    expect(String(empty.value.next)).toContain('upgrade assess')
    expect(await upgradeDirs(f.evidence)).toEqual([])

    const missing = await runPropose(f, ['--assessment', path.join(f.home, 'nope.json'), '--now', PROPOSED_AT])
    expect(missing.code).toBe(EXIT.stopped)
    expect(String(missing.value.reason)).toContain('cannot be read')

    // A named DIRECTORY that holds the assessment works the same way.
    const versions = await liveVersions(f)
    const file = await sourcesFile(recommendingRecords(versions))
    await runAssess(f, ['--sources', file, '--now', ASSESSED_AT])
    const byDirectory = await runPropose(f, ['--assessment', path.join(f.evidence, 'upgrades', ASSESS_STAMP), '--now', PROPOSED_AT])
    expect(byDirectory.code).toBe(EXIT.ok)
    expect(path.basename(proposalDirOf(byDirectory))).toContain(PROPOSED_STAMP)
  })

  it('binds the hash to the candidates, the target, the scope, the patch decisions, the verification and the baseline', async () => {
    const { fixture: f, candidateVersion } = await assessed()
    const first = await proposalOf(f)
    const proposal = first.proposal
    const bound = bindingOf(proposal)

    // Same bound inputs ⇒ same hash; any one of them ⇒ a different hash.
    expect(proposalHashOf(bindingOf(proposal))).toBe(proposal.proposalHash)
    expect(proposalHashOf({ ...bound, baselineHash: 'x'.repeat(64) })).not.toBe(proposal.proposalHash)
    expect(proposalHashOf({ ...bound, scope: { ...bound.scope, switch: true } })).not.toBe(proposal.proposalHash)
    expect(proposalHashOf({ ...bound, candidates: [{ ...bound.candidates[0], version: nextVersion(candidateVersion) }] })).not.toBe(proposal.proposalHash)
    expect(proposalHashOf({ ...bound, patchDecisions: [{ ...bound.patchDecisions[0], decision: 'redo' }] })).not.toBe(proposal.proposalHash)
    expect(proposalHashOf({ ...bound, verification: [] })).not.toBe(proposal.proposalHash)

    // The target role is bound: another role is another payload, and it names no path.
    const otherTarget = await proposalOf(f, ['--now', PROPOSED_AT, '--target', 'upgrade-target'])
    expect(otherTarget.proposal.proposalHash).not.toBe(proposal.proposalHash)
    expect(otherTarget.proposal.target).toMatchObject({ role: 'upgrade-target', path: 'unknown' })

    // The baseline is bound, and an UNCOMMITTED input counts (HEAD alone proves nothing).
    await writeFile(path.join(f.repository, 'pnpm-lock.yaml'), 'lockfileVersion: 9.1\n', 'utf8')
    const drifted = await proposalOf(f, ['--now', PROPOSED_AT])
    expect(drifted.proposal.baselineHash).not.toBe(proposal.baselineHash)
    expect(drifted.proposal.baseline.dirty).toBe('dirty')
    expect(drifted.proposal.rollback.userInputs).toContain('pnpm-lock.yaml')
    expect(drifted.proposal.proposalHash).not.toBe(proposal.proposalHash)
    expect(path.basename(drifted.directory)).not.toBe(path.basename(first.directory))
  })

  it('lists verification commands only from package.json, and names the gap instead of inventing one', async () => {
    const withScripts = await assessed()
    const listed = await proposalOf(withScripts.fixture)
    expect(listed.proposal.changes.verification.map((entry: any) => entry.run)).toEqual(['pnpm check:preset', 'pnpm test:unit'])

    const bare = await assessed({})
    const none = await proposalOf(bare.fixture)
    expect(none.proposal.changes.verification).toEqual([])
    expect(none.proposal.gaps.join(' ')).toContain('declares no scripts')

    // A declared script with NO declared package manager: the body is listed
    // verbatim and the run prefix stays null — never an invented "pnpm ...".
    const managerless = await assessed()
    await writeFile(
      path.join(managerless.fixture.repository, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { 'test:unit': 'vitest run' } }, null, 2) + '\n',
      'utf8',
    )
    const noPrefix = await proposalOf(managerless.fixture)
    expect(noPrefix.proposal.changes.verification).toEqual([{ name: 'test:unit', script: 'vitest run', run: null }])
    expect(noPrefix.proposal.gaps.join(' ')).toContain('declares no packageManager')
    const report = await readFile(path.join(noPrefix.directory, 'proposal.md'), 'utf8')
    expect(report).toContain('不筛选、不排序判断')
  })

  it('refuses an evidence directory inside the maintenance worktree, so no candidate directory can land there', async () => {
    const f = await fixture({ evidenceInsideRepository: true, scripts: SCRIPTS })
    const versions = await liveVersions(f)
    const file = await sourcesFile(recommendingRecords(versions))
    await runAssess(f, ['--sources', file, '--now', ASSESSED_AT])
    const result = await runPropose(f, ['--now', PROPOSED_AT])
    expect(result.code).toBe(EXIT.stopped)
    expect(String(result.value.reason)).toContain('candidate directory')
    expect(String(result.value.reason)).toContain('worktree')
    expect(result.value.evidence).toBeUndefined()
    expect((await filesUnder(f.evidence)).some(name => name.endsWith('proposal.json'))).toBe(false)
  })
})

describe('UPG-03/05/06/07: consent is a record bound to one proposal', () => {
  it('stays pending with no record, and refuses a reply this session never wrote', async () => {
    const { fixture: f } = await assessed()
    const { directory } = await proposalOf(f)
    const proposalPath = path.join(directory, 'proposal.json')
    const consentPath = path.join(directory, 'consent.json')
    const proposalBytes = await readFile(proposalPath, 'utf8')
    const consentBytes = await readFile(consentPath, 'utf8')
    expect((await readJson(consentPath)).status).toBe('pending')

    const refused = await runConsent(f, ['--proposal', proposalPath, '--decision', 'approve', '--reply', NEVER_SAID, '--now', PROPOSED_AT])
    expect(refused.code).toBe(EXIT.stopped)
    expect(String(refused.value.reason)).toContain('not found in this session')
    // The record is workflow traceability, and says it claims nothing more.
    expect(String(refused.value.reason)).toContain('workflow traceability')
    // Nothing was appended, and neither file was rewritten.
    expect(await readFile(consentPath, 'utf8')).toBe(consentBytes)
    expect(await readFile(proposalPath, 'utf8')).toBe(proposalBytes)
    expect((await readJson(consentPath)).records).toEqual([])
    expect(await filesUnder(directory)).toEqual(['consent.json', 'proposal.json', 'proposal.md'])
  })

  it('refuses to record anything for a proposal that lives outside the evidence tree', async () => {
    const { fixture: f } = await assessed()
    const { directory, proposal } = await proposalOf(f)
    // A hand-placed copy that still hashes correctly: the record may not follow it.
    const elsewhere = await temp('proposal-outside-')
    const copied = path.join(elsewhere, 'proposal.json')
    await writeFile(copied, JSON.stringify(proposal, null, 2) + '\n', 'utf8')
    const refused = await runConsent(f, ['--proposal', copied, '--decision', 'approve', '--reply', REPLY, '--now', PROPOSED_AT])
    expect(refused.code).toBe(EXIT.stopped)
    expect(String(refused.value.reason)).toContain('not under')
    expect(existsSync(path.join(elsewhere, 'consent.json'))).toBe(false)
    // The real proposal's record is untouched by the refused attempt.
    expect((await readJson(path.join(directory, 'consent.json'))).records).toEqual([])
  })

  it('approves candidate validation only, unless the user explicitly grants both phases', async () => {
    const { fixture: f } = await assessed()
    const first = await proposalOf(f)
    const proposalPath = path.join(first.directory, 'proposal.json')
    const consentPath = path.join(first.directory, 'consent.json')

    const approved = await runConsent(f, ['--proposal', proposalPath, '--decision', 'approve', '--reply', REPLY, '--now', PROPOSED_AT])
    expect(approved.code).toBe(EXIT.ok)
    expect(approved.value.status).toBe('recorded')
    const record = (await readJson(consentPath)).records[0]
    // The record binds exactly the fields the ticket names, and nothing more.
    expect(Object.keys(record).sort()).toEqual(['baselineHash', 'decision', 'proposalHash', 'recorder', 'repliedAt', 'reply', 'scope', 'target'])
    expect(record.proposalHash).toBe(first.proposal.proposalHash)
    expect(record.baselineHash).toBe(first.proposal.baselineHash)
    expect(record.target).toEqual({ role: 'maintenance-repository', path: f.repository })
    expect(record.scope).toEqual({ candidateValidation: true, switch: false })
    expect(record.decision).toBe('approve')
    expect(record.repliedAt).toBe(PROPOSED_AT)
    expect(record.reply).toEqual({ quote: REPLY, source: 'user', seq: REPLY_SEQ })
    expect(record.recorder).toEqual({ sessionId: SESSION, role: 'main' })
    expect((await readJson(consentPath)).status).toBe('approved')
    // The quote is unique in this session, and the run says so.
    expect(approved.value.replyMatches).toBe(1)
    // The approval is a record, not an execution.
    expect(approved.value.execution).toMatchObject({ mode: 'consent-only', installed: false, built: false, switched: false })

    // An explicit ONE-TIME two-phase approval is recorded as such.
    const both = await runConsent(f, ['--proposal', proposalPath, '--decision', 'approve', '--scope', 'validation-and-switch', '--reply', REPLY, '--now', LATER_AT])
    expect(both.code).toBe(EXIT.ok)
    const records = (await readJson(consentPath)).records
    expect(records).toHaveLength(2)
    expect(records[1].scope).toEqual({ candidateValidation: true, switch: true })
    // Append-only: the earlier record is untouched.
    expect(records[0]).toEqual(record)

    // A rejection grants nothing at all.
    const rejected = await runConsent(f, ['--proposal', proposalPath, '--decision', 'reject', '--reply', REPLY, '--now', LATER_AT])
    expect(rejected.code).toBe(EXIT.ok)
    const after = await readJson(consentPath)
    expect(after.status).toBe('rejected')
    expect(after.records).toHaveLength(3)
    expect(after.records[2]).toMatchObject({ decision: 'reject', scope: {} })
  })

  it('refuses a stale proposal hash, a drifted baseline and a moved target — and records nothing', async () => {
    // 1) A bound input changed after the proposal was written: the recorded hash no longer matches.
    const stale = await assessed()
    const staleProposal = await proposalOf(stale.fixture)
    const stalePath = path.join(staleProposal.directory, 'proposal.json')
    const staleConsent = path.join(staleProposal.directory, 'consent.json')
    const tampered = { ...staleProposal.proposal, candidates: staleProposal.proposal.candidates.map((item: any) => ({ ...item, version: '9.9.9' })) }
    await writeFile(stalePath, JSON.stringify(tampered, null, 2) + '\n', 'utf8')
    const staleRun = await runConsent(stale.fixture, ['--proposal', stalePath, '--decision', 'approve', '--reply', REPLY, '--now', PROPOSED_AT])
    expect(staleRun.code).toBe(EXIT.stopped)
    expect(String(staleRun.value.reason)).toContain('no longer hashes')
    expect((await readJson(staleConsent)).records).toEqual([])

    // 2) The lockfile changed: an uncommitted input is drift too.
    await writeFile(stalePath, JSON.stringify(staleProposal.proposal, null, 2) + '\n', 'utf8')
    await writeFile(path.join(stale.fixture.repository, 'pnpm-lock.yaml'), 'lockfileVersion: 9.9\n', 'utf8')
    const lockDrift = await runConsent(stale.fixture, ['--proposal', stalePath, '--decision', 'approve', '--reply', REPLY, '--now', PROPOSED_AT])
    expect(lockDrift.code).toBe(EXIT.stopped)
    expect(String(lockDrift.value.reason)).toContain('baselineHash')
    expect((await readJson(staleConsent)).records).toEqual([])

    // 3) A NEW untracked file is an uncommitted input as well.
    const untrackedCase = await assessed()
    const untrackedProposal = await proposalOf(untrackedCase.fixture)
    await writeFile(path.join(untrackedCase.fixture.repository, 'local-notes.txt'), 'mine\n', 'utf8')
    const untrackedRun = await runConsent(untrackedCase.fixture, ['--proposal', path.join(untrackedProposal.directory, 'proposal.json'), '--decision', 'approve', '--reply', REPLY, '--now', PROPOSED_AT])
    expect(untrackedRun.code).toBe(EXIT.stopped)
    expect(String(untrackedRun.value.reason)).toContain('baselineHash')
    expect((await readJson(path.join(untrackedProposal.directory, 'consent.json'))).records).toEqual([])

    // 4) The recorded target moved: the same worktree bytes at another path.
    const moved = await assessed()
    const movedProposal = await proposalOf(moved.fixture)
    const copy = await temp('proposal-repo-copy-')
    await cp(moved.fixture.repository, copy, { recursive: true })
    await saveConfig({ directory: moved.fixture.state, maintenanceRepository: copy, evidenceDirectory: moved.fixture.evidence })
    const movedRun = await runConsent(moved.fixture, ['--proposal', path.join(movedProposal.directory, 'proposal.json'), '--decision', 'approve', '--reply', REPLY, '--now', PROPOSED_AT])
    expect(movedRun.code).toBe(EXIT.stopped)
    expect(String(movedRun.value.reason)).toContain('target')
    expect((await readJson(path.join(movedProposal.directory, 'consent.json'))).records).toEqual([])
  })

  it('never lets an approval for one hash authorize another', async () => {
    const { fixture: f } = await assessed()
    const first = await proposalOf(f)
    const firstPath = path.join(first.directory, 'proposal.json')
    const approve = await runConsent(f, ['--proposal', firstPath, '--decision', 'approve', '--reply', REPLY, '--now', PROPOSED_AT])
    expect(approve.code).toBe(EXIT.ok)
    const approved = await readJson(path.join(first.directory, 'consent.json'))
    expect(approved.status).toBe('approved')
    expect(approved.records).toHaveLength(1)

    // Re-proposing the SAME payload never rewrites the approval already recorded.
    const again = await runPropose(f, ['--now', PROPOSED_AT])
    expect(path.basename(proposalDirOf(again))).toBe(path.basename(first.directory))
    const kept = await readJson(path.join(first.directory, 'consent.json'))
    expect(kept.status).toBe('approved')
    expect(kept.records).toEqual(approved.records)

    // The baseline moves: the next proposal is another payload with another hash.
    await writeFile(path.join(f.repository, 'pnpm-lock.yaml'), 'lockfileVersion: 9.2\n', 'utf8')
    const second = await proposalOf(f, ['--now', LATER_AT])
    expect(second.proposal.proposalHash).not.toBe(first.proposal.proposalHash)
    expect(second.consent.status).toBe('pending')
    expect(second.consent.records).toEqual([])
    expect(approved.records[0].proposalHash).toBe(first.proposal.proposalHash)

    // Carrying the approved file over is refused, never silently reused.
    const secondConsent = path.join(second.directory, 'consent.json')
    await writeFile(secondConsent, JSON.stringify(approved, null, 2) + '\n', 'utf8')
    const reused = await runConsent(f, ['--proposal', path.join(second.directory, 'proposal.json'), '--decision', 'approve', '--reply', REPLY, '--now', LATER_AT])
    expect(reused.code).toBe(EXIT.stopped)
    expect(String(reused.value.reason)).toContain('another proposal hash')
    expect((await readJson(secondConsent)).records).toHaveLength(1)
  })

  it('refuses a consent from an assisted session, while the proposal itself may be built there', async () => {
    const { fixture: f } = await assessed({ assisted: true })
    // SCOPE-06: analysis is allowed, so the proposal is built (and says who built it).
    const proposed = await proposalOf(f)
    expect(proposed.result.code).toBe(EXIT.ok)
    const refused = await runConsent(f, ['--proposal', path.join(proposed.directory, 'proposal.json'), '--decision', 'approve', '--reply', REPLY, '--now', PROPOSED_AT])
    expect(refused.code).toBe(EXIT.stopped)
    expect(String(refused.value.reason)).toContain('SCOPE-06')
    expect(refused.value.delegation).toMatchObject({ role: 'subagent', parentSession: PARENT, mayApproveUpgrade: false })
    expect((await readJson(path.join(proposed.directory, 'consent.json'))).records).toEqual([])
  })

  it('refuses automatic-acceptance flags, an empty reply and unknown flags with a usage error', async () => {
    const { fixture: f } = await assessed()
    const { directory } = await proposalOf(f)
    const proposalPath = path.join(directory, 'proposal.json')
    const cases: string[][] = [
      ['upgrade', 'consent', '--proposal', proposalPath, '--decision', 'approve', '--reply', REPLY, '--yes'],
      ['upgrade', 'consent', '--proposal', proposalPath, '--decision', 'approve', '--reply', REPLY, '--approved'],
      ['upgrade', 'consent', '--proposal', proposalPath, '--decision', 'approve', '--reply', REPLY, '--auto'],
      ['upgrade', 'consent', '--proposal', proposalPath, '--decision', 'approve', '--reply', ''],
      ['upgrade', 'consent', '--proposal', proposalPath, '--decision', 'maybe', '--reply', REPLY],
      ['upgrade', 'consent', '--proposal', proposalPath, '--decision', 'reject', '--scope', 'candidate-validation', '--reply', REPLY],
      ['upgrade', 'consent', '--proposal', proposalPath, '--decision', 'approve', '--reply', REPLY, '--nonsense'],
      ['upgrade', 'propose', '--now', PROPOSED_AT, '--yes'],
    ]
    for (const argv of cases) {
      const result = await runCli(f, argv)
      expect({ argv, code: result.code }).toEqual({ argv, code: EXIT.refused })
    }
    // None of those attempts left a record behind.
    expect((await readJson(path.join(directory, 'consent.json'))).records).toEqual([])
  })
})

describe('B15: the write boundary of this ticket', () => {
  it('writes only the proposal directory, and neither assess nor incident produces a proposal or a consent', async () => {
    const { fixture: f } = await assessed()
    const before = await snapshot(f.repository)
    const statusBefore = gitStatus(f.repository)

    // An incident run before any proposal: it never creates one.
    const incident = await run(['incident', '--target-session', SESSION, '--now', ASSESSED_AT], cliEnvironment(f))
    expect(incident.value.status).toBe('complete')
    expect((await filesUnder(f.evidence)).some(name => name.endsWith('proposal.json') || name === 'consent.json')).toBe(false)

    const { directory, proposal } = await proposalOf(f)
    const approved = await runConsent(f, ['--proposal', path.join(directory, 'proposal.json'), '--decision', 'approve', '--reply', REPLY, '--now', PROPOSED_AT])
    expect(approved.code).toBe(EXIT.ok)

    // Only the assessment directory and the proposal directory exist under upgrades.
    expect(await upgradeDirs(f.evidence)).toEqual([ASSESS_STAMP, proposal.proposalId].sort())
    expect(await filesUnder(directory)).toEqual(['consent.json', 'proposal.json', 'proposal.md'])
    // The maintenance worktree is byte-identical and still clean: no manifest,
    // lockfile, patch, dist or profile was touched, and nothing was installed.
    expect(await snapshot(f.repository)).toEqual(before)
    expect(gitStatus(f.repository)).toBe(statusBefore)
    expect(proposal.execution).toMatchObject({ mode: 'consent-only', installed: false, built: false, switched: false })
    expect(proposal.changes.created).toBe(false)
  })
})
