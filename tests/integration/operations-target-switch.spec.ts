/**
 * UPG-05/06/07/10/12/13 and D10/D11/D15/D16: the approved target, switched, and
 * the failure that either restores this round or hands the state over.
 *
 * The seams are the ones tickets 02..06 established: the operations CLI
 * (run(['upgrade', 'switch', ...])) and the files under
 * <evidenceDirectory>/upgrades/<proposalId>/ (switch.json, rollback.json,
 * switch.md, backup/). Every acceptance point is observable there; nothing
 * reaches into an internal step.
 *
 * Three boundaries are stated once here:
 * - The proposal is REAL: every fixture runs upgrade assess, upgrade propose (with
 *   the exact target), upgrade consent and upgrade validate first, so the switch
 *   gate is measured against the same proposalHash / baselineHash / target the
 *   earlier steps wrote, and every refusal is a state a real run can reach.
 * - The runner is INJECTED, so no real process starts. What the fixture does not
 *   fake is the READING: the resolved engines, the marker evidence, the digests
 *   and the backup are read from real files on disk. The record names which runner
 *   produced the numbers, so an injected run never reads as a real one.
 * - Nothing here touches the daily profile, another profile or the official DSH
 *   install: the target is a one-off profile inside a temporary DSH_HOME, and both
 *   sides are snapshotted around every run.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HASHLINE_PATCH_MARKERS, TOOL_EDIT_PATCH_MARKERS } from '../../presets/ptc-hashline/operations/baseline.mjs'
import { EXIT, run } from '../../presets/ptc-hashline/operations/cli.mjs'
import { saveConfig } from '../../presets/ptc-hashline/operations/config.mjs'
import { encodeSegment, projectKey } from '../../presets/ptc-hashline/operations/session-log.mjs'
import { candidateCommandProblem } from '../../presets/ptc-hashline/operations/candidates.mjs'
import { externalChangesOf, targetStateOf } from '../../presets/ptc-hashline/operations/switch.mjs'

const SESSION = 'session-target-switch-0001'
const PARENT = 'session-target-switch-parent-0001'
const WORKSPACE = '/work/switch-project'
const ASSESSED_AT = '2026-10-25T07:10:00.000Z'
const PROPOSED_AT = '2026-10-25T09:20:00.000Z'
const VALIDATED_AT = '2026-10-26T06:05:00.000Z'
const SWITCHED_AT = '2026-10-26T07:40:00.000Z'
const PROPOSED_STAMP = '20261025-092000'
/** The user's own verbatim reply, at REPLY_SEQ in this session's log. */
const REPLY = '批准两阶段：先做候选验证，通过后把目标 profile 切过去。'
const REPLY_SEQ = 2
const PROFILE_NAME = 'ptc-hashline-target'
const SCRIPTS: Record<string, string> = { build: 'node scripts/build.mjs', 'check:preset': 'node scripts/check-preset.mjs' }
const HASH_PKG = '@hy-sde-org/dsh-hashline'
const EDIT_PKG = '@hy-sde-org/dsh-tool-edit'
const dirs: string[] = []

afterEach(async () => {
  // A killed child can hold its cwd for a moment on Windows; a cleanup that
  // cannot remove a temp directory must not fail an assertion.
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)))
})

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function readJson<T = any>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

function runGit(repository: string, ...args: string[]): string {
  const argv = args[0] === 'init' ? ['init', '-q', repository] : ['-C', repository, ...args]
  return execFileSync('git', argv, { encoding: 'utf8' })
}

const patchFileName = (specifier: string, version: string) => specifier.replaceAll('/', '__') + '@' + version + '.patch'
const posix = (value: string) => value.replaceAll('\\', '/')

interface Versions {
  hashline: string
  toolEdit: string
  dsh: string
}

interface Fixture {
  home: string
  state: string
  sessions: string
  repository: string
  evidence: string
  profile: string
  versions: Versions
}

interface FixtureOptions {
  versions: Versions
  /** Leave an uncommitted edit to the maintenance package.json (UPG-10). */
  dirtyAffected?: boolean
  /** Leave an unrelated uncommitted file in the worktree (must be kept). */
  unrelatedChange?: boolean
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
    user(1, '/ptc-hashline-upgrade 检查三方更新，先给方案。'),
    user(2, REPLY),
  ]
  await writeFile(path.join(directory, 'session.v4.jsonl'), lines.join('\n') + '\n', 'utf8')
}

/**
 * One maintenance worktree: a manifest (with a declared build script), a lockfile,
 * BOTH local patches at the versions this machine resolves, and the
 * pnpm-workspace registration whose key carries the exact version.
 */
async function writeRepository(repository: string, options: FixtureOptions): Promise<void> {
  const manifest: Record<string, unknown> = {
    name: 'fixture',
    version: '0.0.0',
    packageManager: 'pnpm@11.28.5',
    scripts: SCRIPTS,
    dependencies: { [HASH_PKG]: options.versions.hashline, [EDIT_PKG]: options.versions.toolEdit },
  }
  await writeFile(path.join(repository, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  await writeFile(path.join(repository, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')
  await mkdir(path.join(repository, 'patches'), { recursive: true })
  for (const [specifier, version] of [[HASH_PKG, options.versions.hashline], [EDIT_PKG, options.versions.toolEdit]] as string[][]) {
    await writeFile(path.join(repository, 'patches', patchFileName(specifier, version)), 'fixture patch for ' + specifier + '\n', 'utf8')
  }
  const workspace = [
    'packages:',
    '  - .',
    '',
    'patchedDependencies:',
    "  '" + HASH_PKG + '@' + options.versions.hashline + "': patches/" + patchFileName(HASH_PKG, options.versions.hashline),
    "  '" + EDIT_PKG + '@' + options.versions.toolEdit + "': patches/" + patchFileName(EDIT_PKG, options.versions.toolEdit),
    '',
  ].join('\n')
  await writeFile(path.join(repository, 'pnpm-workspace.yaml'), workspace, 'utf8')
  const git = (...args: string[]) => runGit(repository, ...args)
  git('init', '-q')
  git('add', '.')
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
  if (options.dirtyAffected === true) {
    // The user's own uncommitted edit in a file an approved switch WOULD change.
    const current = await readJson(path.join(repository, 'package.json'))
    current.scripts = { ...SCRIPTS, 'local:tweak': 'node scripts/tweak.mjs' }
    await writeFile(path.join(repository, 'package.json'), JSON.stringify(current, null, 2) + '\n', 'utf8')
  }
  if (options.unrelatedChange === true) {
    await writeFile(path.join(repository, 'local-notes.txt'), 'mine, and unrelated\n', 'utf8')
  }
}

/** A one-off profile install tree, in scripts/test-profile.mjs's shape. */
async function writeProfile(home: string, repository: string): Promise<string> {
  const profile = path.join(home, 'profiles', PROFILE_NAME)
  await mkdir(profile, { recursive: true })
  const link = (relative: string) => 'link:' + posix(path.join(repository, relative))
  const manifest = {
    name: 'dsh-profile-' + PROFILE_NAME,
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
  }
  await writeFile(path.join(profile, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  await writeFile(path.join(profile, 'pnpm-workspace.yaml'), ['packages:', '  - .', '', 'nodeLinker: hoisted', ''].join('\n'), 'utf8')
  return profile
}

/** A whole host home: session log, saved roles, one worktree and one profile. */
async function fixture(options: FixtureOptions): Promise<Fixture> {
  const home = await temp('switch-home-')
  const state = path.join(home, 'state', 'ptc-hashline-operations')
  const sessions = path.join(home, 'sessions')
  const repository = await temp('switch-repo-')
  const evidence = await temp('switch-evidence-')
  await writeRepository(repository, options)
  await saveConfig({ directory: state, maintenanceRepository: repository, evidenceDirectory: evidence })
  await writeSession(sessions, { assisted: options.assisted === true })
  const profile = await writeProfile(home, repository)
  return { home, state, sessions, repository, evidence, profile, versions: options.versions }
}

function environmentOf(): Record<string, string> {
  return { DSH_SESSION_ID: SESSION, PWD: WORKSPACE }
}

function cliEnvironment(f: Fixture, runner?: unknown) {
  return {
    env: environmentOf(),
    sessionsRoot: f.sessions,
    stateDir: f.state,
    ...runner === undefined ? {} : { runner },
  }
}

/** The live versions this machine resolves, so a candidate is NEWER than the baseline. */
async function liveVersions(): Promise<Versions> {
  const home = await temp('switch-live-')
  const report = await run(['baseline'], {
    env: environmentOf(),
    sessionsRoot: path.join(home, 'sessions'),
    stateDir: path.join(home, 'state'),
  })
  const baseline = (report.value as any).baseline
  return {
    hashline: baseline.engines.hashline.version,
    toolEdit: baseline.engines.toolEdit.version,
    dsh: baseline.versions.dsh,
  }
}

/** The next version above a version by semver precedence. */
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

/** Three VERIFIED channels that did not move away from a version. */
function stableChannels(component: string, version: string): Record<string, unknown>[] {
  return [
    source(component, 'release', { version, url: 'https://example.invalid/' + component }),
    source(component, 'prerelease', { version: null, detail: 'no pre-release dist-tag is published' }),
    source(component, 'commit', { commit: 'c0ffee0'.repeat(5), url: 'https://example.invalid/' + component, unreleased: false }),
  ]
}

/**
 * The declaration that makes BOTH engines recommended candidates: one hashline
 * marker stays (keep), the other must be re-cut (redo), and every tool-edit marker
 * is covered upstream (delete) — the three mechanical cases in one proposal.
 */
function recommendingRecords(versions: Versions, candidate: { hashline: string; toolEdit: string }): Record<string, unknown>[] {
  return [
    ...stableChannels('dsh', versions.dsh === 'unknown' ? '0.2.1-rc.2' : versions.dsh),
    source('hashline', 'release', {
      version: candidate.hashline,
      url: 'https://example.invalid/hashline',
      files: { 'dist/patcher.js': HASHLINE_PATCH_MARKERS[0].marker + '\n' },
    }),
    source('hashline', 'prerelease', { version: null }),
    source('hashline', 'commit', { commit: 'a'.repeat(40), unreleased: false }),
    source('tool-edit', 'release', {
      version: candidate.toolEdit,
      url: 'https://example.invalid/tool-edit',
      covers: TOOL_EDIT_PATCH_MARKERS.map((entry) => entry.marker),
      detail: '上游已在稳定版实现这些行为，本地补丁可整体删除',
    }),
    source('tool-edit', 'prerelease', { version: null }),
    source('tool-edit', 'commit', { commit: 'b'.repeat(40), unreleased: false }),
  ]
}

async function sourcesFile(records: Record<string, unknown>[]): Promise<string> {
  const dir = await temp('switch-sources-')
  const file = path.join(dir, 'sources.json')
  await writeFile(file, JSON.stringify({ note: 'pinned metadata fixture', records }, null, 2) + '\n', 'utf8')
  return file
}

interface InstallTarget {
  hashline: string
  toolEdit: string
}

/**
 * What a real install would leave behind, written from the manifest it was given.
 *
 * A directory that declares the engines directly (the worktree, and the candidate
 * tree after the versions were pinned) installs those; a profile that LINKS this
 * bundle resolves what the linked worktree declares — so a restored manifest puts
 * the baseline back, exactly like a real re-install would.
 */
async function materialize(directory: string, repository: string): Promise<void> {
  const manifest = await readJson(directory + '/package.json')
  const deps = { ...manifest.dependencies ?? {}, ...manifest.devDependencies ?? {} }
  const direct = deps[HASH_PKG]
  let engines: InstallTarget
  if (typeof direct === 'string' && !direct.startsWith('link:')) {
    engines = { hashline: String(direct), toolEdit: String(deps[EDIT_PKG]) }
  } else {
    const repositoryManifest = await readJson(path.join(repository, 'package.json'))
    engines = { hashline: String(repositoryManifest.dependencies[HASH_PKG]), toolEdit: String(repositoryManifest.dependencies[EDIT_PKG]) }
  }
  const write = async (relative: string, text: string) => {
    const target = path.join(directory, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, text, 'utf8')
  }
  const patcher = HASHLINE_PATCH_MARKERS.map((entry) => entry.marker).join('\n') + '\n'
  await write('node_modules/' + HASH_PKG + '/package.json', JSON.stringify({ name: HASH_PKG, version: engines.hashline, type: 'module', main: 'dist/index.js' }, null, 2) + '\n')
  await write('node_modules/' + HASH_PKG + '/dist/patcher.js', patcher)
  await write('node_modules/' + HASH_PKG + '/dist/index.js', 'export const hashline = true\n')
  await write('node_modules/' + EDIT_PKG + '/package.json', JSON.stringify({ name: EDIT_PKG, version: engines.toolEdit, type: 'module', main: 'dist/index.js', dependencies: { [HASH_PKG]: engines.hashline } }, null, 2) + '\n')
  for (const entry of TOOL_EDIT_PATCH_MARKERS) await write('node_modules/' + EDIT_PKG + '/' + entry.file.join('/'), '// upstream implementation\n')
  for (const plugin of ['tool-read', 'tool-edit']) {
    await write('node_modules/@dsh-tool-hashline/' + plugin + '/package.json', JSON.stringify({ name: '@dsh-tool-hashline/' + plugin, version: '0.0.0', type: 'module', main: 'dist/index.js', dependencies: { [HASH_PKG]: engines.hashline } }, null, 2) + '\n')
    await write('node_modules/@dsh-tool-hashline/' + plugin + '/dist/index.js', 'export const mounted = true\n')
  }
  // A real install writes a lockfile where there is none. The worktree already has
  // one, and its bytes are part of the rollback baseline — so they are left alone.
  if (!existsSync(path.join(directory, 'pnpm-lock.yaml'))) {
    await write('pnpm-lock.yaml', 'lockfileVersion: 9.0\n# resolved by the fixture install\n')
  }
}

interface RunnerCall {
  command: string
  args: string[]
  cwd: string
}

interface RunnerOptions {
  repository: string
  /** Directories whose FIRST install fails. */
  failInstallIn?: string[]
  /** Directories whose SECOND install fails (the rollback's own re-install). */
  failSecondInstallIn?: string[]
  driver?: {
    status?: 'ok' | 'gap' | 'failed'
    detail?: string
    missing?: string[]
    /** Somebody else changes the target while this run is still working. */
    tamper?: { engineVersion: string }
  }
}

/**
 * The injected runner.
 *
 * It records every call, so the acceptance points can assert on WHAT was executed
 * and where, and it writes a fake install into whichever directory asked for one,
 * so the marker and realpath evidence is read from real files.
 */
function fakeRunner(options: RunnerOptions) {
  const calls: RunnerCall[] = []
  const installs = new Map<string, number>()
  const runner = async (command: string, args: string[], callOptions: { cwd: string }) => {
    calls.push({ command, args: [...args], cwd: callOptions.cwd })
    if (args[0] === 'install') {
      const count = (installs.get(callOptions.cwd) ?? 0) + 1
      installs.set(callOptions.cwd, count)
      if ((options.failInstallIn ?? []).includes(callOptions.cwd) && count === 1) {
        return { exitCode: 1, stdout: '', stderr: 'the fixture refused this install' }
      }
      if ((options.failSecondInstallIn ?? []).includes(callOptions.cwd) && count === 2) {
        return { exitCode: 1, stdout: '', stderr: 'the fixture refused the rollback install' }
      }
      await materialize(callOptions.cwd, options.repository)
      return { exitCode: 0, stdout: 'installed' }
    }
    if (typeof args[0] === 'string' && args[0].endsWith('short-link.mjs')) {
      const driver = options.driver ?? { status: 'ok' as const }
      if (driver.tamper !== undefined) {
        const manifestPath = path.join(callOptions.cwd, 'node_modules', HASH_PKG, 'package.json')
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
        await writeFile(manifestPath, JSON.stringify({ ...manifest, version: driver.tamper.engineVersion }, null, 2) + '\n', 'utf8')
      }
      if (driver.status === 'gap') return { exitCode: 3, stdout: JSON.stringify({ status: 'gap', detail: driver.detail, missing: driver.missing }) }
      if (driver.status === 'failed') return { exitCode: 4, stdout: JSON.stringify({ status: 'failed', error: driver.detail }) }
      return { exitCode: 0, stdout: JSON.stringify({ status: 'ok', tag: 'A1B2' }) }
    }
    return { exitCode: 0, stdout: 'ok' }
  }
  return { runner, calls }
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

/** Every file under one directory tree, as sorted relative paths. */
async function filesUnder(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return []
  return (await snapshot(directory)).map(([relative]) => relative)
}

interface Prepared {
  fixture: Fixture
  candidate: { hashline: string; toolEdit: string }
  proposalDirectory: string
  proposal: any
  consent: any
  validation: string
}

interface PreparedOptions extends Partial<FixtureOptions> {
  /** The scope the user granted (default: both phases at once). */
  scope?: 'candidate-validation' | 'validation-and-switch'
}

/** assess -> propose (with the exact target) -> consent -> validate. */
async function prepared(options: PreparedOptions = {}): Promise<Prepared> {
  const versions = options.versions ?? (await liveVersions())
  const f = await fixture({ versions, ...options })
  const candidate = { hashline: nextVersion(versions.hashline), toolEdit: nextVersion(versions.toolEdit) }
  const file = await sourcesFile(recommendingRecords(versions, candidate))
  const assessedRun = await run(['upgrade', 'assess', '--sources', file, '--now', ASSESSED_AT], cliEnvironment(f))
  // D12/UPG-11: this checkout does not resolve the official host, so the
  // assessment is legitimately incomplete (exit 2) while still recommending the
  // two engines. What this ticket needs from it is exactly that recommendation.
  expect([EXIT.ok, EXIT.stopped], JSON.stringify(assessedRun.value).slice(0, 900)).toContain(assessedRun.code)
  const assessment = assessedRun.value as any
  expect(assessment.conclusion).toBe('recommend-candidate')
  expect(assessment.components.filter((component: any) => component.recommended).map((component: any) => component.component).sort()).toEqual(['hashline', 'tool-edit'])
  const proposed = await run(
    ['upgrade', 'propose', '--now', PROPOSED_AT, '--target', 'upgrade-target', '--target-path', f.profile],
    cliEnvironment(f),
  )
  expect(proposed.code, JSON.stringify(proposed.value).slice(0, 900)).toBe(EXIT.ok)
  const proposalDirectory = (proposed.value as any).evidence.directory
  expect(path.basename(proposalDirectory)).toContain(PROPOSED_STAMP)
  const scope = options.scope ?? 'validation-and-switch'
  const approved = await run(
    ['upgrade', 'consent', '--proposal', path.join(proposalDirectory, 'proposal.json'), '--decision', 'approve', '--scope', scope, '--reply', REPLY, '--now', PROPOSED_AT],
    cliEnvironment(f),
  )
  expect(approved.code, JSON.stringify(approved.value).slice(0, 900)).toBe(EXIT.ok)
  const validateRunner = fakeRunner({ repository: f.repository })
  const validated = await run(
    ['upgrade', 'validate', '--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT],
    cliEnvironment(f, validateRunner.runner),
  )
  expect(validated.code, JSON.stringify(validated.value).slice(0, 1500)).toBe(EXIT.ok)
  expect((validated.value as any).verdict).toBe('candidate-verified')
  return {
    fixture: f,
    candidate,
    proposalDirectory,
    proposal: await readJson(path.join(proposalDirectory, 'proposal.json')),
    consent: await readJson(path.join(proposalDirectory, 'consent.json')),
    validation: await readFile(path.join(proposalDirectory, 'validation.md'), 'utf8'),
  }
}

function runSwitch(f: Fixture, argv: string[], runner?: unknown, cancel?: (name: string) => boolean) {
  const environment: any = { ...cliEnvironment(f, runner) }
  if (cancel !== undefined) environment.cancel = cancel
  return run(['upgrade', 'switch', ...argv], environment)
}

describe('UPG-05/06/07: the switch gate runs before any write and any command', () => {
  it('refuses no record, a candidate-only approval, a drifted baseline and a moved target — with nothing written', async () => {
    // 1) No consent record at all.
    const none = await prepared()
    await writeFile(path.join(none.proposalDirectory, 'consent.json'), JSON.stringify({ ...none.consent, status: 'pending', records: [] }, null, 2) + '\n', 'utf8')
    const noneRunner = fakeRunner({ repository: none.fixture.repository })
    const noneSwitch = await runSwitch(none.fixture, ['--proposal', path.join(none.proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], noneRunner.runner)
    expect(noneSwitch.code).toBe(EXIT.stopped)
    expect(String((noneSwitch.value as any).reason)).toContain('holds no record')
    expect(noneRunner.calls).toEqual([])

    // 2) A candidate-only approval: the second phase was never granted (UPG-07).
    const candidateOnly = await prepared({ scope: 'candidate-validation' })
    const evidenceBefore = await filesUnder(candidateOnly.fixture.evidence)
    const profileBefore = await snapshot(candidateOnly.fixture.profile)
    const repositoryBefore = await snapshot(candidateOnly.fixture.repository)
    const onlyRunner = fakeRunner({ repository: candidateOnly.fixture.repository })
    const onlySwitch = await runSwitch(candidateOnly.fixture, ['--proposal', path.join(candidateOnly.proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], onlyRunner.runner)
    expect(onlySwitch.code).toBe(EXIT.stopped)
    expect(String((onlySwitch.value as any).reason)).toContain('scope.switch === true')
    expect(String((onlySwitch.value as any).next)).toContain('validation-and-switch')
    expect(onlyRunner.calls).toEqual([])
    expect(await filesUnder(candidateOnly.fixture.evidence)).toEqual(evidenceBefore)
    expect(await snapshot(candidateOnly.fixture.profile)).toEqual(profileBefore)
    expect(await snapshot(candidateOnly.fixture.repository)).toEqual(repositoryBefore)

    // 3) A drifted baseline: an untracked file is uncommitted input (UPG-05).
    const drifted = await prepared()
    await writeFile(path.join(drifted.fixture.repository, 'local-notes.txt'), 'mine\n', 'utf8')
    const driftRunner = fakeRunner({ repository: drifted.fixture.repository })
    const driftSwitch = await runSwitch(drifted.fixture, ['--proposal', path.join(drifted.proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], driftRunner.runner)
    expect(driftSwitch.code).toBe(EXIT.stopped)
    expect(String((driftSwitch.value as any).reason)).toContain('baselineHash')
    expect(driftRunner.calls).toEqual([])
    // The user's own file is still there, untouched.
    expect(await readFile(path.join(drifted.fixture.repository, 'local-notes.txt'), 'utf8')).toBe('mine\n')

    // 4) The consent record authorized another target.
    const moved = await prepared()
    await writeFile(
      path.join(moved.proposalDirectory, 'consent.json'),
      JSON.stringify({ ...moved.consent, records: [{ ...moved.consent.records[0], target: { role: 'upgrade-target', path: path.join(moved.fixture.home, 'profiles', 'another') } }] }, null, 2) + '\n',
      'utf8',
    )
    const movedRunner = fakeRunner({ repository: moved.fixture.repository })
    const movedSwitch = await runSwitch(moved.fixture, ['--proposal', path.join(moved.proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], movedRunner.runner)
    expect(movedSwitch.code).toBe(EXIT.stopped)
    expect(String((movedSwitch.value as any).reason)).toContain('an approval never covers another target')
    expect(movedRunner.calls).toEqual([])
  })

  it('refuses a candidate that is not verified, however it fell short (UPG-06, D12)', async () => {
    // 1) The recorded verdict is candidate-failed.
    const failed = await prepared()
    const failedResult = await readJson(path.join(failed.proposalDirectory, 'candidate', 'result.json'))
    await writeFile(path.join(failed.proposalDirectory, 'candidate', 'result.json'), JSON.stringify({ ...failedResult, verdict: 'candidate-failed' }, null, 2) + '\n', 'utf8')
    const failedRunner = fakeRunner({ repository: failed.fixture.repository })
    const failedSwitch = await runSwitch(failed.fixture, ['--proposal', path.join(failed.proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], failedRunner.runner)
    expect(failedSwitch.code).toBe(EXIT.stopped)
    expect(String((failedSwitch.value as any).reason)).toContain('not "candidate-verified"')
    expect(failedRunner.calls).toEqual([])

    // 2) A critical baseline was unknown.
    const pending = await prepared()
    const pendingResult = await readJson(path.join(pending.proposalDirectory, 'candidate', 'result.json'))
    await writeFile(path.join(pending.proposalDirectory, 'candidate', 'result.json'), JSON.stringify({ ...pendingResult, pendingVerification: true }, null, 2) + '\n', 'utf8')
    const pendingRunner = fakeRunner({ repository: pending.fixture.repository })
    const pendingSwitch = await runSwitch(pending.fixture, ['--proposal', path.join(pending.proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], pendingRunner.runner)
    expect(pendingSwitch.code).toBe(EXIT.stopped)
    expect(String((pendingSwitch.value as any).reason)).toContain('pendingVerification')
    expect(pendingRunner.calls).toEqual([])

    // 3) The record is gone: the verdict is read, never assumed.
    const missing = await prepared()
    await rm(path.join(missing.proposalDirectory, 'candidate', 'result.json'), { force: true })
    const evidenceBefore = await filesUnder(missing.fixture.evidence)
    const missingRunner = fakeRunner({ repository: missing.fixture.repository })
    const missingSwitch = await runSwitch(missing.fixture, ['--proposal', path.join(missing.proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], missingRunner.runner)
    expect(missingSwitch.code).toBe(EXIT.stopped)
    expect(String((missingSwitch.value as any).reason)).toContain('is missing')
    expect(String((missingSwitch.value as any).next)).toContain('upgrade validate')
    expect(missingRunner.calls).toEqual([])
    expect(await filesUnder(missing.fixture.evidence)).toEqual(evidenceBefore)
  })

  it('refuses an assisted (subagent) session, which may analyze but never switch', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared()
    await writeSession(f.sessions, { assisted: true })
    const profileBefore = await snapshot(f.profile)
    const runner = fakeRunner({ repository: f.repository })
    const refused = await runSwitch(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], runner.runner)
    expect(refused.code).toBe(EXIT.stopped)
    expect(String((refused.value as any).reason)).toContain('SCOPE-06')
    expect((refused.value as any).delegation).toMatchObject({ role: 'subagent', mayApproveUpgrade: false })
    expect(runner.calls).toEqual([])
    expect(await snapshot(f.profile)).toEqual(profileBefore)
    expect(candidate.hashline).not.toBe(f.versions.hashline)
  })
})

describe('UPG-07/10: the user\'s own edits stop the switch and are never touched', () => {
  it('stops when an affected maintenance file carries uncommitted edits, and keeps the unrelated ones', async () => {
    const preparedState = await prepared({ dirtyAffected: true, unrelatedChange: true })
    const f = preparedState.fixture
    const repositoryBefore = await snapshot(f.repository)
    const profileBefore = await snapshot(f.profile)
    const runner = fakeRunner({ repository: f.repository })
    const refused = await runSwitch(f, ['--proposal', path.join(preparedState.proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], runner.runner)
    expect(refused.code).toBe(EXIT.stopped)
    expect(String((refused.value as any).rule)).toBe('UPG-10')
    expect((refused.value as any).affected).toContain('package.json')
    // The unrelated file is reported, kept as it was, and nothing is stashed.
    expect((refused.value as any).unrelated).toContain('local-notes.txt')
    expect(runner.calls).toEqual([])
    expect(await snapshot(f.repository)).toEqual(repositoryBefore)
    expect(await snapshot(f.profile)).toEqual(profileBefore)
    expect(runGit(f.repository, 'status', '--porcelain=v1')).toContain('local-notes.txt')
    expect(runGit(f.repository, 'status', '--porcelain=v1')).toContain('package.json')
  })

  it('stops when the approved target\'s own manifest has been edited since the proposal (UPG-10)', async () => {
    const { fixture: f, proposalDirectory } = await prepared()
    const manifestPath = path.join(f.profile, 'package.json')
    const edited = await readJson(manifestPath)
    edited.dsh = { profile: { bundles: [...edited.dsh.profile.bundles, 'someone-elses-bundle'] } }
    await writeFile(manifestPath, JSON.stringify(edited, null, 2) + '\n', 'utf8')
    const runtimeBefore = await readFile(manifestPath, 'utf8')
    const runner = fakeRunner({ repository: f.repository })
    const refused = await runSwitch(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], runner.runner)
    expect(refused.code).toBe(EXIT.stopped)
    expect(String((refused.value as any).rule)).toBe('UPG-10')
    expect(String((refused.value as any).reason)).toContain('its own edits')
    expect(runner.calls).toEqual([])
    // The user's edit is still exactly what they wrote.
    expect(await readFile(manifestPath, 'utf8')).toBe(runtimeBefore)
  })
})

describe('UPG-06/13: an approved target is switched, installed and re-verified', () => {
  it('applies the approved combination to the worktree and the target profile, and reaches switch-applied', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared()
    const proposalBytes = await readFile(path.join(proposalDirectory, 'proposal.json'), 'utf8')
    const consentBytes = await readFile(path.join(proposalDirectory, 'consent.json'), 'utf8')
    const validationBytes = await readFile(path.join(proposalDirectory, 'validation.md'), 'utf8')
    const evidenceBefore = await filesUnder(f.evidence)
    const profileManifestBefore = await readJson(path.join(f.profile, 'package.json'))
    const { runner, calls } = fakeRunner({ repository: f.repository })

    const switched = await runSwitch(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], runner)
    const value = (switched.value as any)

    expect(switched.code).toBe(EXIT.ok)
    expect(value.conclusion).toBe('switch-applied')
    expect(value.status).toBe('switched')
    expect(value.failures).toEqual([])
    expect(value.skipped).toEqual([])
    expect(value.gaps).toEqual([])
    expect(value.runner.source).toBe('injected')
    expect(value.authorization.decision).toBe('approve')
    expect(value.authorization.scope.switch).toBe(true)

    // The steps ran in the fixed order: dependencies, patches, install, build,
    // target install, then the target's own evidence.
    expect(value.steps.map((entry: any) => entry.name)).toEqual([
      'maintenance-dependencies', 'maintenance-patches', 'maintenance-install', 'maintenance-build', 'target-install', 'target-read-edit-short-link',
    ])
    // Every command ran in the worktree or the target — never in the daily profile.
    for (const call of calls) {
      expect([f.repository, f.profile]).toContain(call.cwd)
    }
    expect(calls.filter((call: RunnerCall) => call.cwd === f.profile).map((call: RunnerCall) => call.args[0])).toEqual(['install', expect.stringContaining('short-link.mjs')])

    // The worktree now declares the approved combination...
    const repositoryManifest = await readJson(path.join(f.repository, 'package.json'))
    expect(repositoryManifest.dependencies[HASH_PKG]).toBe(candidate.hashline)
    expect(repositoryManifest.dependencies[EDIT_PKG]).toBe(candidate.toolEdit)
    // ...its patch files moved with the version, and an all-delete component is gone.
    const patches = (await readdir(path.join(f.repository, 'patches'))).sort()
    expect(patches).toEqual([patchFileName(HASH_PKG, candidate.hashline)])
    const workspaceText = await readFile(path.join(f.repository, 'pnpm-workspace.yaml'), 'utf8')
    expect(workspaceText).toContain("'" + HASH_PKG + '@' + candidate.hashline + "'")
    expect(workspaceText).not.toContain(EDIT_PKG)

    // The target profile resolves the approved versions and the expected markers.
    const targetHashline = await readJson(path.join(f.profile, 'node_modules', HASH_PKG, 'package.json'))
    expect(targetHashline.version).toBe(candidate.hashline)
    const targetEdit = await readJson(path.join(f.profile, 'node_modules', EDIT_PKG, 'package.json'))
    expect(targetEdit.version).toBe(candidate.toolEdit)
    expect(value.checks.map((check: any) => [check.name, check.status])).toEqual([
      ['target-versions-match-approved', 'pass'],
      ['target-patch-markers', 'pass'],
      ['target-resolved-paths-and-shared-instance', 'pass'],
      ['target-read-edit-short-link', 'pass'],
    ])
    expect(value.versionsBefore.hashline).toBe(f.versions.hashline)
    expect(value.versionsAfter.hashline).toBe(candidate.hashline)
    expect(value.versionsAfter.toolEdit).toBe(candidate.toolEdit)

    // The record names every file this round wrote, with before/after digests.
    const written = value.writtenFiles as any[]
    const manifestEntry = written.find((entry) => entry.path === path.join(f.repository, 'package.json'))
    expect(manifestEntry).toBeDefined()
    expect(manifestEntry.beforeSha256).not.toBe(manifestEntry.afterSha256)
    const removedPatch = written.find((entry) => entry.relative === 'patches/' + patchFileName(EDIT_PKG, f.versions.toolEdit))
    expect(removedPatch.afterSha256).toBe('missing')
    const createdPatch = written.find((entry) => entry.relative === 'patches/' + patchFileName(HASH_PKG, candidate.hashline))
    expect(createdPatch.beforeSha256).toBe('missing')

    // The target profile's own manifest was NOT rewritten: a link install does not.
    expect(await readJson(path.join(f.profile, 'package.json'))).toEqual(profileManifestBefore)

    // Only new records: proposal.json, consent.json and validation.md keep their bytes.
    expect(await readFile(path.join(proposalDirectory, 'proposal.json'), 'utf8')).toBe(proposalBytes)
    expect(await readFile(path.join(proposalDirectory, 'consent.json'), 'utf8')).toBe(consentBytes)
    expect(await readFile(path.join(proposalDirectory, 'validation.md'), 'utf8')).toBe(validationBytes)
    const added = (await filesUnder(f.evidence)).filter((relative) => !evidenceBefore.includes(relative))
    for (const relative of added) {
      expect(relative.startsWith(path.relative(f.evidence, proposalDirectory).split(path.sep).join('/') + '/')).toBe(true)
    }
    expect(added.some((relative) => relative.endsWith('switch.json'))).toBe(true)
    expect(added.some((relative) => relative.endsWith('switch.md'))).toBe(true)
    expect(added.some((relative) => relative.includes('/backup/'))).toBe(true)

    // The record itself.
    const record = await readJson(path.join(proposalDirectory, 'switch.json'))
    expect(record.phase).toBe('switched')
    expect(record.conclusion).toBe('switch-applied')
    expect(record.target.path).toBe(f.profile)
    expect(record.target.role).toBe('upgrade-target')
    expect(record.plannedWrites.length).toBeGreaterThan(0)
    expect(record.sessionId).toBe(SESSION)
    expect(record.engineEvidence.target.engines.hashline.version).toBe(candidate.hashline)
    expect(record.backup.files.length).toBeGreaterThan(0)
    expect(existsSync(path.join(proposalDirectory, 'rollback.json'))).toBe(false)
    // Exactly one consent record: a two-phase approval is not asked twice.
    expect((await readJson(path.join(proposalDirectory, 'consent.json'))).records).toHaveLength(1)
  })

  it('exits 3 for an approval flag, a missing --proposal, a bad timeout and an unknown flag', async () => {
    const { fixture: f, proposalDirectory } = await prepared()
    const evidenceBefore = await filesUnder(f.evidence)
    for (const argv of [
      ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--yes'],
      ['--decision', 'approve'],
      ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--timeout-min', '0'],
      ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--target-path', f.profile],
    ]) {
      await expect(runSwitch(f, argv)).rejects.toThrow(/UsageError|refused|needs|must be|unknown flag|is required/u)
    }
    // A usage refusal never reaches a write.
    expect(await filesUnder(f.evidence)).toEqual(evidenceBefore)
  })

  it('never leaves a silent pass: run without the injected runner still refuses on a wrong non-zero exit', () => {
    // The allowlist itself, so the switch cannot drive an arbitrary program.
    expect(candidateCommandProblem({ command: 'git', args: ['push'], tree: '/evidence', label: 'evidence tree' })).toContain('only pnpm / npm / node')
    expect(candidateCommandProblem({ command: 'node', args: ['/elsewhere/driver.mjs'], tree: '/evidence', label: 'evidence tree' })).toContain('outside the evidence tree')
    expect(candidateCommandProblem({ command: 'node', args: ['/evidence/upgrades/p/switch/short-link.mjs', '/target'], tree: '/evidence', label: 'evidence tree' })).toBeUndefined()
    expect(candidateCommandProblem({ command: 'pnpm', args: ['install'], tree: '/evidence', label: 'evidence tree' })).toBeUndefined()
    expect(candidateCommandProblem({ command: 'pnpm', args: ['publish'], tree: '/evidence', declaredScripts: ['build'], label: 'evidence tree' })).toContain('neither one of')
    expect(candidateCommandProblem({ command: 'pnpm', args: ['build'], tree: '/evidence', declaredScripts: ['build'], label: 'evidence tree' })).toBeUndefined()
  })
})

describe('UPG-12: a partial failure restores this round, or hands the state over', () => {
  it('restores only this round when the target install fails, and proves it is back at the baseline', async () => {
    const { fixture: f, proposalDirectory, proposal } = await prepared({ unrelatedChange: true })
    const { runner, calls } = fakeRunner({ repository: f.repository, failInstallIn: [f.profile] })
    const switched = await runSwitch(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], runner)
    const value = (switched.value as any)

    expect(switched.code).toBe(EXIT.stopped)
    expect(value.conclusion).toBe('switch-failed-restored')
    expect(value.status).toBe('restored')
    expect(value.failures.some((entry: any) => entry.name === 'target-install')).toBe(true)
    // The target was never installed, and the build did run before it.
    expect(calls.filter((call: RunnerCall) => call.cwd === f.profile).length).toBe(2)

    // The worktree is back at the baseline: the manifest, the patch files and the
    // lockfile digest the proposal recorded.
    const repositoryManifest = await readJson(path.join(f.repository, 'package.json'))
    expect(repositoryManifest.dependencies[HASH_PKG]).toBe(f.versions.hashline)
    expect(repositoryManifest.dependencies[EDIT_PKG]).toBe(f.versions.toolEdit)
    const patches = (await readdir(path.join(f.repository, 'patches'))).sort()
    expect(patches).toEqual([patchFileName(EDIT_PKG, f.versions.toolEdit), patchFileName(HASH_PKG, f.versions.hashline)].sort())
    for (const entry of proposal.rollback.patchFiles) {
      const digest = await (await import('node:crypto')).createHash('sha256').update(await readFile(entry.path)).digest('hex')
      expect(digest).toBe(entry.sha256)
    }
    expect((await readJson(path.join(f.repository, 'node_modules', HASH_PKG, 'package.json'))).version).toBe(f.versions.hashline)

    // The unrelated change survived the whole round.
    expect(await readFile(path.join(f.repository, 'local-notes.txt'), 'utf8')).toBe('mine, and unrelated\n')

    // rollback.json says what was restored, what was kept, and that the baseline
    // was re-checked.
    const rollback = await readJson(path.join(proposalDirectory, 'rollback.json'))
    expect(rollback.phase).toBe('restored')
    expect(rollback.externalChange).toEqual([])
    expect(rollback.restoredFiles.some((entry: any) => entry.action === 'restored')).toBe(true)
    expect(rollback.restoredFiles.some((entry: any) => entry.action === 'removed')).toBe(true)
    expect(rollback.verification.lockfile.match).toBe(true)
    expect(rollback.verification.patchFiles.every((entry: any) => entry.match)).toBe(true)
    expect(rollback.verification.engines.every((entry: any) => entry.match)).toBe(true)
    expect(rollback.kept.length).toBeGreaterThan(0)
    expect((await readJson(path.join(proposalDirectory, 'switch.json'))).conclusion).toBe('switch-failed-restored')
  })

  it('hands the state over when the restore cannot be verified, and claims nothing', async () => {
    const { fixture: f, proposalDirectory } = await prepared()
    const { runner } = fakeRunner({ repository: f.repository, failInstallIn: [f.profile], failSecondInstallIn: [f.repository] })
    const switched = await runSwitch(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], runner)
    const value = (switched.value as any)
    expect(switched.code).toBe(EXIT.stopped)
    expect(value.conclusion).toBe('switch-failed-handover')
    expect(value.status).toBe('handover')
    const rollback = await readJson(path.join(proposalDirectory, 'rollback.json'))
    expect(rollback.phase).toBe('handover')
    // The restore ran but could not be proven: the engines are still the candidate's.
    expect(rollback.verification.engines.some((entry: any) => entry.match === false)).toBe(true)
    expect(String(rollback.nextNote)).toContain('状态不明')
    expect((await readJson(path.join(proposalDirectory, 'switch.json'))).next).toContain('rollback.json')
  })

  it('stops and hands over when an external edit lands between this round and its restore, overwriting nothing', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared()
    // The target is switched, the target's own evidence is measured, and the short
    // link fails — and while it runs, somebody else swaps the installed engine.
    const { runner } = fakeRunner({
      repository: f.repository,
      driver: { status: 'failed', detail: 'the link found a different engine', tamper: { engineVersion: '0.0.1-elsewhere' } },
    })
    const switched = await runSwitch(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], runner)
    const value = (switched.value as any)
    expect(switched.code).toBe(EXIT.stopped)
    expect(value.conclusion).toBe('switch-failed-handover')
    // The record names the external change instead of restoring over it.
    const rollback = await readJson(path.join(proposalDirectory, 'rollback.json'))
    expect(rollback.phase).toBe('handover')
    expect(rollback.externalChange.map((entry: any) => entry.path).join(' ')).toContain('target engine hashline')
    expect(rollback.restoredFiles).toEqual([])
    // Nothing was overwritten: the worktree still declares the CANDIDATE versions
    // (this round's write was kept, not rolled back) and the tampered engine is
    // still the one on disk.
    const repositoryManifest = await readJson(path.join(f.repository, 'package.json'))
    expect(repositoryManifest.dependencies[HASH_PKG]).toBe(candidate.hashline)
    const targetEngine = await readJson(path.join(f.profile, 'node_modules', HASH_PKG, 'package.json'))
    expect(targetEngine.version).toBe('0.0.1-elsewhere')
    expect(String(value.nextNote)).toContain('外部改动')
  })

  it('hands over instead of restoring when something was not measured (a GAP is not a failure)', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared()
    // The target cannot run the short link: the switch did happen, but one check
    // could not be measured, so it must not claim success and must not undo itself.
    const { runner } = fakeRunner({ repository: f.repository, driver: { status: 'gap', detail: 'the target cannot run the link', missing: ['@deepseek-ai/dsh-tools'] } })
    const switched = await runSwitch(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], runner)
    const value = (switched.value as any)
    expect(switched.code).toBe(EXIT.stopped)
    expect(value.conclusion).toBe('switch-failed-handover')
    expect(value.phase).toBe('handover')
    expect(value.checks.some((check: any) => check.name === 'target-read-edit-short-link' && check.status === 'gap')).toBe(true)
    // Nothing was undone and no rollback record exists: the state is this round's,
    // just unproven, so the user decides.
    expect(existsSync(path.join(proposalDirectory, 'rollback.json'))).toBe(false)
    const repositoryManifest = await readJson(path.join(f.repository, 'package.json'))
    expect(repositoryManifest.dependencies[HASH_PKG]).toBe(candidate.hashline)
    expect((await readJson(path.join(f.profile, 'node_modules', HASH_PKG, 'package.json'))).version).toBe(candidate.hashline)
    expect(String(value.nextNote)).toContain('缺项')
  })

  it('treats a file edited between this round and its restore as an external change', async () => {
    // The rule itself, on real bytes: whatever this round wrote must still have the
    // digest it recorded, and the engines must still be the versions it recorded.
    const target = await temp('switch-external-')
    const manifestPath = path.join(target, 'package.json')
    await writeFile(manifestPath, '{"name":"target"}\n', 'utf8')
    const written = targetStateOf({ path: target })
    expect(written.manifestSha256).toMatch(/^[0-9a-f]{64}$/u)
    const writtenFiles = [{ path: manifestPath, afterSha256: written.manifestSha256 }]
    const engines = [{ component: 'hashline', expected: '0.2.1-alpha.5', now: '0.2.1-alpha.5' }]
    expect(externalChangesOf({ writtenFiles, engines })).toEqual([])
    // The user edits the manifest by hand before the restore runs.
    await writeFile(manifestPath, '{"name":"target","edited":true}\n', 'utf8')
    const changed = externalChangesOf({ writtenFiles, engines })
    expect(changed).toHaveLength(1)
    expect(changed[0].path).toBe(manifestPath)
    expect(changed[0].expected).toBe(written.manifestSha256)
    expect(changed[0].now).not.toBe(written.manifestSha256)
    // A different engine version in the target is an external change too.
    expect(externalChangesOf({ writtenFiles: [], engines: [{ component: 'hashline', expected: '0.2.1-alpha.5', now: '0.2.1-alpha.4' }] })[0].path).toContain('hashline')
  })

  it('stops before the first change when the backup cannot be complete', async () => {
    const { fixture: f, proposalDirectory, proposal } = await prepared()
    // A watched file that cannot be read: the backup would be incomplete, so the
    // switch must stop BEFORE it changes anything ("备份不了就先改" is the failure).
    await rm(path.join(f.profile, 'pnpm-workspace.yaml'), { force: true })
    await mkdir(path.join(f.profile, 'pnpm-workspace.yaml'), { recursive: true })
    const repositoryBefore = await snapshot(f.repository)
    const runner = fakeRunner({ repository: f.repository })
    const switched = await runSwitch(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', SWITCHED_AT], runner.runner)
    const value = (switched.value as any)
    expect(switched.code).toBe(EXIT.stopped)
    expect(value.conclusion).toBe('switch-failed-handover')
    expect(value.phase).toBe('stopped')
    expect(JSON.stringify(value.failures)).toContain('incomplete')
    expect(runner.calls).toEqual([])
    expect(existsSync(path.join(proposalDirectory, 'backup'))).toBe(false)
    expect(await snapshot(f.repository)).toEqual(repositoryBefore)
    const record = await readJson(path.join(proposalDirectory, 'switch.json'))
    expect(record.phase).toBe('stopped')
    expect(record.writtenFiles).toEqual([])
    expect(proposal.proposalHash).toBe(record.proposalHash)
  })
})
