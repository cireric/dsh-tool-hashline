/**
 * UPG-04/06/09/11/13 and D7/D10/D11/D15: the approved candidate, validated in
 * isolation, and the report that says exactly what was and was not proven.
 *
 * The seams are the ones tickets 02..05 established: the operations CLI
 * (`run(['upgrade', 'validate', ...])`) and the files under
 * `<evidenceDirectory>/upgrades/<proposalId>/` (`candidate/` and
 * `validation.md`). Every acceptance point is observable there; nothing reaches
 * into an internal step.
 *
 * Three boundaries are stated once here:
 * - The proposal is REAL: every fixture runs `upgrade assess` and
 *   `upgrade propose` first, so the authorization gate is measured against the
 *   same proposalHash/baselineHash the proposal wrote, and every refusal is a
 *   state a real run can reach.
 * - The runner is INJECTED, so no real process starts in these cases. What the
 *   fixture does not fake is the reading: the resolved engines, the marker
 *   evidence and every digest are read from real files in the candidate tree
 *   that the fake install materializes. The report records which runner produced
 *   the numbers, so an injected run never reads as a real one. Exactly one case
 *   (`createDefaultRunner`) exercises a real child process, and it reports a
 *   platform gap instead of inventing a pass.
 * - Nothing here switches, rolls back, or touches a target install tree, a daily
 *   profile or the official DSH install: those belong to ticket 07. The
 *   maintenance worktree is snapshotted around every run.
 */
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HASHLINE_PATCH_MARKERS, TOOL_EDIT_PATCH_MARKERS } from '../../presets/ptc-hashline/operations/baseline.mjs'
import {
  CANDIDATE_TOOL,
  candidateCommandProblem,
  createDefaultRunner,
  includedInputsOf,
  managerCommand,
  rewritePatchedDependencies,
} from '../../presets/ptc-hashline/operations/candidates.mjs'
import { saveConfig } from '../../presets/ptc-hashline/operations/config.mjs'
import { encodeSegment, projectKey } from '../../presets/ptc-hashline/operations/session-log.mjs'

const SESSION = 'session-candidate-0001'
const PARENT = 'session-candidate-parent-0001'
const WORKSPACE = '/work/candidate-project'
const ASSESSED_AT = '2026-10-25T07:10:00.000Z'
const ASSESS_STAMP = '20261025-071000'
const PROPOSED_AT = '2026-10-25T09:20:00.000Z'
const PROPOSED_STAMP = '20261025-092000'
const VALIDATED_AT = '2026-10-26T06:05:00.000Z'
/** The user's own verbatim reply, at REPLY_SEQ in this session's log. */
const REPLY = '批准只做候选验证，先不要切换目标。'
const REPLY_SEQ = 2
const SCRIPTS: Record<string, string> = { 'check:preset': 'node scripts/check-preset.mjs', 'test:unit': 'node scripts/unit.mjs' }
const HASH_PKG = '@hy-sde-org/dsh-hashline'
const EDIT_PKG = '@hy-sde-org/dsh-tool-edit'
const dirs: string[] = []

afterEach(async () => {
  // A child killed by a timeout can hold its cwd for a moment on Windows; a
  // cleanup that cannot remove a temp directory must not fail an assertion.
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)))
})

/**
 * R5: the FIXED versions the shared bundle carries.
 *
 * These used to be read off the machine: `liveVersions()` ran the real `baseline`
 * command against this checkout, so every case that prepares a proposal depended on
 * the official host RESOLVING here. It resolves in this deployment only because the
 * DSH development store is injected through NODE_PATH; with that injection absent the
 * baseline reports `version: dsh` unknown, `upgrade assess` stops with exit 2, and 20
 * cases fail inside `prepared()` before reaching the behaviour they claim to cover.
 *
 * The bundle below decides the host itself, so the same facts hold on a machine that
 * has no official DSH installed at all — and a bundle built WITHOUT the host is how
 * the refusal side is measured.
 */
const BUNDLE_VERSIONS: Versions = { dsh: '0.3.0', hashline: '0.2.1-alpha.4', toolEdit: '0.2.1-alpha.4' }
/** Directories that must outlive one test, cleaned once at the end of the file. */
const persistent: string[] = []
/** The bundle this whole file prepares its proposals in, built once. */
let operationsBundle: string
let EXIT: { ok: number; stopped: number; refused: number }
let run: (argv: string[], environment?: any) => Promise<{ code: number; value: any }>

/**
 * One bundle install, at whatever versions the caller names.
 *
 * It copies the SHIPPED operations modules and gives them a node_modules of their
 * own, so the modules that actually execute are the ones under test and the baseline
 * they collect is the fixture's, never this machine's. `dsh: null` leaves the official
 * host out entirely: the only way to reproduce "a key baseline is unknown"
 * deterministically.
 * @param versions the versions the bundle carries
 * @returns the bundle root
 */
async function bundleFixture(versions: { dsh: string | null; hashline: string; toolEdit: string }): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'candidate-bundle-'))
  persistent.push(root)
  await cp(path.resolve(process.cwd(), 'presets', 'ptc-hashline', 'operations'), path.join(root, 'presets', 'ptc-hashline', 'operations'), { recursive: true })
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'dsh-tool-hashline',
    version: '0.0.0',
    type: 'module',
    exports: { './package.json': './package.json', './presets/*': './presets/*' },
  }, null, 2), 'utf8')
  const packages: [string, string, { file: string[]; marker: string }[]][] = [
    ...versions.dsh === null ? [] : [['@deepseek-ai/dsh', versions.dsh, []] as [string, string, { file: string[]; marker: string }[]]],
    ['@hy-sde-org/dsh-hashline', versions.hashline, HASHLINE_PATCH_MARKERS],
    ['@hy-sde-org/dsh-tool-edit', versions.toolEdit, TOOL_EDIT_PATCH_MARKERS],
  ]
  for (const [name, version, markers] of packages) {
    const directory = path.join(root, 'node_modules', ...name.split('/'))
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }, null, 2), 'utf8')
    const files = new Map<string, string[]>()
    for (const { file, marker } of markers) {
      const key = file.join('/')
      files.set(key, [...(files.get(key) ?? []), marker])
    }
    for (const [key, lines] of files) {
      const target = path.join(directory, ...key.split('/'))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, lines.join('\n') + '\n', 'utf8')
    }
  }
  return root
}

/** The bundle's own CLI entry, imported so `installationRoot()` is the bundle. */
async function loadCli(bundle: string): Promise<{ EXIT: typeof EXIT; run: typeof run }> {
  const entry = path.join(bundle, 'presets', 'ptc-hashline', 'operations', 'cli.mjs')
  return (await import(pathToFileURL(entry).href)) as { EXIT: typeof EXIT; run: typeof run }
}

/** The bundle's CLI path, for the cases that observe a real exit code. */
function bundleCli(bundle: string): string {
  return path.join(bundle, 'presets', 'ptc-hashline', 'operations', 'cli.mjs')
}

const execFileAsync = promisify(execFile)

/**
 * Run one bundle's CLI as a real child process, with NODE_PATH stripped.
 *
 * NODE_PATH is dropped on purpose: pnpm injects the DSH development store into it, and
 * a package that only exists in that store must not decide whether a fixture bundle
 * carries the official host. This is the only reliable isolation — an in-process import
 * inherits the same global paths, which is how a "hostless" fixture silently acquired
 * a host before this helper existed.
 */
async function runBundleChild(bundle: string, argv: string[], env: Record<string, string>): Promise<{ code: number; json?: any; stderr: string }> {
  const { NODE_PATH: _nodePath, ...inherited } = process.env
  try {
    const { stdout } = await execFileAsync(process.execPath, [bundleCli(bundle), ...argv], { env: { ...inherited, ...env }, encoding: 'utf8' })
    return { code: 0, json: JSON.parse(stdout), stderr: '' }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    const stdout = (failure.stdout ?? '').trim()
    return { code: failure.code ?? -1, json: stdout === '' ? undefined : JSON.parse(stdout), stderr: failure.stderr ?? '' }
  }
}

beforeAll(async () => {
  operationsBundle = await bundleFixture(BUNDLE_VERSIONS)
  const cli = await loadCli(operationsBundle)
  EXIT = cli.EXIT
  run = cli.run
})

afterAll(async () => {
  await Promise.all(persistent.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)))
})

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function readJson<T = any>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

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
  versions: Versions
}

interface FixtureOptions {
  versions: Versions
  /** Declared package.json scripts (a proposal's verification list). */
  scripts?: Record<string, string> | null
  /** Leave the worktree outside git, so the commit is a critical unknown. */
  noGit?: boolean
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

const patchFileName = (specifier: string, version: string) => specifier.replaceAll('/', '__') + '@' + version + '.patch'

/**
 * One maintenance worktree: a manifest, a lockfile, BOTH local patches at the
 * versions this machine actually resolves, and the pnpm-workspace registration
 * that carries the exact version in its key (the coupling this ticket must keep
 * in sync).
 */
async function writeRepository(repository: string, options: FixtureOptions): Promise<void> {
  const manifest: Record<string, unknown> = {
    name: 'fixture',
    version: '0.0.0',
    packageManager: 'pnpm@11.28.5',
    // A maintenance repository DECLARES the engines it pins; pinning the approved
    // candidate version is only possible for a dependency the manifest names.
    dependencies: { [HASH_PKG]: options.versions.hashline, [EDIT_PKG]: options.versions.toolEdit },
  }
  if (options.scripts !== null) manifest.scripts = options.scripts ?? SCRIPTS
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
  if (options.noGit === true) return
  const git = (...args: string[]) => runGit(repository, ...args)
  git('init', '-q')
  git('add', '.')
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
}

function runGit(repository: string, ...args: string[]): string {
  const argv = args[0] === 'init' ? ['init', '-q', repository] : ['-C', repository, ...args]
  return execFileSync('git', argv, { encoding: 'utf8' })
}

/** A whole host home: session log, saved roles and one maintainable worktree. */
async function fixture(options: FixtureOptions): Promise<Fixture> {
  const home = await temp('candidate-home-')
  const state = path.join(home, 'state', 'ptc-hashline-operations')
  const sessions = path.join(home, 'sessions')
  const repository = await temp('candidate-repo-')
  const evidence = await temp('candidate-evidence-')
  await writeRepository(repository, options)
  await saveConfig({ directory: state, maintenanceRepository: repository, evidenceDirectory: evidence })
  await writeSession(sessions, { assisted: options.assisted === true })
  return { home, state, sessions, repository, evidence, versions: options.versions }
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

/**
 * The versions the shared bundle resolves.
 *
 * This used to run the real `baseline` command against this checkout, which made the
 * whole file depend on the official host resolving here (R5). The candidate must be
 * newer than a baseline the FIXTURE declares, never one the machine happens to have.
 * @returns the fixed versions
 */
async function liveVersions(): Promise<Versions> {
  return { ...BUNDLE_VERSIONS }
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

/**
 * The declaration that makes BOTH engines recommended candidates.
 *
 * The candidate package text carries ONE of the two hashline markers: the other
 * is then reading `redo` ("the hunk must be re-cut"), while the tool-edit
 * release declares `covers` for all five of its markers, which is a `delete`
 * for each. So one proposal carries keep, redo AND delete, which is what the
 * mechanical half is measured on.
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
  const dir = await temp('candidate-sources-')
  const file = path.join(dir, 'sources.json')
  await writeFile(file, JSON.stringify({ note: 'pinned metadata fixture', records }, null, 2) + '\n', 'utf8')
  return file
}

interface Prepared {
  fixture: Fixture
  candidate: { hashline: string; toolEdit: string }
  proposalDirectory: string
  proposal: any
  consent: any
}

interface PreparedOptions extends Partial<FixtureOptions> {
  /** A records builder other than the both-engines one (e.g. hashline only). */
  records?: (versions: Versions, candidate: { hashline: string; toolEdit: string }) => Record<string, unknown>[]
}

/** hashline is recommended, tool-edit is not — so its patch items stay undecided. */
function recommendingHashlineOnly(versions: Versions, candidate: { hashline: string; toolEdit: string }): Record<string, unknown>[] {
  return [
    ...stableChannels('dsh', versions.dsh === 'unknown' ? '0.2.1-rc.2' : versions.dsh),
    source('hashline', 'release', {
      version: candidate.hashline,
      url: 'https://example.invalid/hashline',
      files: { 'dist/patcher.js': HASHLINE_PATCH_MARKERS[0].marker + '\n' },
    }),
    source('hashline', 'prerelease', { version: null }),
    source('hashline', 'commit', { commit: 'a'.repeat(40), unreleased: false }),
    ...stableChannels('tool-edit', versions.toolEdit),
  ]
}

/** assess → propose → approve: the full prior authorization this ticket needs. */
async function prepared(options: PreparedOptions = {}): Promise<Prepared> {
  const versions = options.versions ?? (await liveVersions())
  const f = await fixture({ versions, ...options })
  const candidate = { hashline: nextVersion(versions.hashline), toolEdit: nextVersion(versions.toolEdit) }
  const file = await sourcesFile((options.records ?? recommendingRecords)(versions, candidate))
  const assessedRun = await run(['upgrade', 'assess', '--sources', file, '--now', ASSESSED_AT], cliEnvironment(f))
  expect(assessedRun.code).toBe(EXIT.ok)
  const proposed = await run(['upgrade', 'propose', '--now', PROPOSED_AT], cliEnvironment(f))
  expect(proposed.code).toBe(EXIT.ok)
  const proposalDirectory = (proposed.value as any).evidence.directory
  expect(path.basename(proposalDirectory)).toContain(PROPOSED_STAMP)
  const approved = await run(
    ['upgrade', 'consent', '--proposal', path.join(proposalDirectory, 'proposal.json'), '--decision', 'approve', '--reply', REPLY, '--now', PROPOSED_AT],
    cliEnvironment(f),
  )
  expect(approved.code).toBe(EXIT.ok)
  return {
    fixture: f,
    candidate,
    proposalDirectory,
    proposal: await readJson(path.join(proposalDirectory, 'proposal.json')),
    consent: await readJson(path.join(proposalDirectory, 'consent.json')),
  }
}

/** Run the shipped CLI as a real child process, to observe the real exit code. */
async function runCli(f: Fixture, argv: string[]): Promise<{ code: number; stderr: string }> {
  const inherited = { ...process.env }
  delete inherited.NODE_PATH
  try {
    execFileSync(process.execPath, [bundleCli(operationsBundle), ...argv], {
      env: { ...inherited, ...environmentOf(), DSH_HOME: f.home },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; stderr?: string }
    return { code: typeof failure.status === 'number' ? failure.status : -1, stderr: failure.stderr ?? '' }
  }
}

function runValidate(f: Fixture, argv: string[], runner?: unknown, cancel?: (name: string) => boolean) {
  const environment: any = { ...cliEnvironment(f, runner) }
  if (cancel !== undefined) environment.cancel = cancel
  return run(['upgrade', 'validate', ...argv], environment)
}

interface RunnerCall {
  command: string
  args: string[]
  cwd: string
  /** The dependency block the candidate tree declared when the install started. */
  manifest?: Record<string, string>
}

/** What the fake `pnpm install` leaves in the candidate tree. */
interface InstallOptions {
  hashlineVersion: string
  toolEditVersion: string
  /** Which hashline markers the INSTALLED build carries. */
  hashlineMarkers?: string[]
}

async function materializeInstall(tree: string, options: InstallOptions): Promise<void> {
  const write = async (relative: string, text: string) => {
    const target = path.join(tree, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, text, 'utf8')
  }
  const markers = options.hashlineMarkers ?? HASHLINE_PATCH_MARKERS.map((entry) => entry.marker)
  const patcher = HASHLINE_PATCH_MARKERS.map((entry) => (markers.includes(entry.marker) ? entry.marker : '// re-cut elsewhere') + '\n').join('')
  await write('node_modules/' + HASH_PKG + '/package.json', JSON.stringify({ name: HASH_PKG, version: options.hashlineVersion, type: 'module', main: 'dist/index.js' }, null, 2) + '\n')
  await write('node_modules/' + HASH_PKG + '/dist/patcher.js', patcher)
  await write('node_modules/' + HASH_PKG + '/dist/index.js', 'export const hashline = true\n')
  // The tool-edit candidate is the version in which upstream implemented every
  // local behaviour, so its build carries NONE of the local markers.
  await write('node_modules/' + EDIT_PKG + '/package.json', JSON.stringify({ name: EDIT_PKG, version: options.toolEditVersion, type: 'module', main: 'dist/index.js', dependencies: { [HASH_PKG]: options.hashlineVersion } }, null, 2) + '\n')
  for (const entry of TOOL_EDIT_PATCH_MARKERS) await write('node_modules/' + EDIT_PKG + '/' + entry.file.join('/'), '// upstream implementation\n')
  for (const plugin of ['tool-read', 'tool-edit']) {
    await write('node_modules/@dsh-tool-hashline/' + plugin + '/package.json', JSON.stringify({ name: '@dsh-tool-hashline/' + plugin, version: '0.0.0', type: 'module', main: 'dist/index.js', dependencies: { [HASH_PKG]: options.hashlineVersion } }, null, 2) + '\n')
    await write('node_modules/@dsh-tool-hashline/' + plugin + '/dist/index.js', 'export const mounted = true\n')
  }
}

interface RunnerBehaviour {
  /** Per-gate override: an exit code, or 'timeout'. */
  gates?: Record<string, number | 'timeout'>
  /** The short-link driver's outcome. */
  driver?: { status?: 'ok' | 'gap' | 'failed'; detail?: string; missing?: string[]; exitCode?: number }
  /** Skip the fake install (so nothing resolves in the tree). */
  skipInstall?: boolean
  install?: InstallOptions
}

/**
 * The injected runner.
 *
 * It records every call, so the acceptance points can assert on WHAT was
 * executed, where, and with which store — and it writes the fake install into
 * the candidate tree, so the marker and realpath evidence is read from real
 * files rather than being canned.
 */
function fakeRunner(behaviour: RunnerBehaviour = {}) {
  const calls: RunnerCall[] = []
  const runner = async (command: string, args: string[], options: { cwd: string }) => {
    calls.push({ command, args: [...args], cwd: options.cwd })
    if (args[0] === 'install') {
      const declared = JSON.parse(await readFile(path.join(options.cwd, 'package.json'), 'utf8'))
      calls[calls.length - 1].manifest = declared.dependencies ?? {}
      if (behaviour.skipInstall !== true && behaviour.install !== undefined) await materializeInstall(options.cwd, behaviour.install)
      return { exitCode: 0, stdout: 'installed' }
    }
    if (typeof args[0] === 'string' && args[0].endsWith('short-link.mjs')) {
      const driver = behaviour.driver ?? { status: 'ok' as const }
      if (driver.exitCode !== undefined) return { exitCode: driver.exitCode, stdout: JSON.stringify({ status: driver.status, detail: driver.detail, missing: driver.missing }) }
      if (driver.status === 'gap') return { exitCode: 3, stdout: JSON.stringify({ status: 'gap', detail: driver.detail, missing: driver.missing }) }
      if (driver.status === 'failed') return { exitCode: 4, stdout: JSON.stringify({ status: 'failed', error: driver.detail }) }
      return { exitCode: 0, stdout: JSON.stringify({ status: 'ok', tag: 'A1B2' }) }
    }
    const name = args[0]
    const gate = behaviour.gates?.[name]
    if (gate === 'timeout') return { exitCode: null, stdout: '', stderr: 'killed', timedOut: true }
    if (typeof gate === 'number') return { exitCode: gate, stdout: '', stderr: 'gate ' + name + ' failed at test/fixture.spec.ts:12:5\n  expected 1 to be 2' }
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

function gitStatus(repository: string): string {
  return runGit(repository, 'status', '--porcelain=v1')
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

describe('UPG-04/07: the authorization gate runs before any write and any command', () => {
  it('refuses an unapproved proposal with zero files written and zero commands started', async () => {
    // No record at all: the consent file is `pending`.
    const approved = await prepared()
    await writeFile(path.join(approved.proposalDirectory, 'consent.json'), JSON.stringify({ ...approved.consent, status: 'pending', records: [] }, null, 2) + '\n', 'utf8')
    const proposalBytes = await readFile(path.join(approved.proposalDirectory, 'proposal.json'), 'utf8')
    const evidenceBefore = await filesUnder(approved.fixture.evidence)
    const { runner, calls } = fakeRunner({ install: { hashlineVersion: approved.candidate.hashline, toolEditVersion: approved.candidate.toolEdit } })

    const refused = await runValidate(approved.fixture, ['--proposal', path.join(approved.proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    expect(refused.code).toBe(EXIT.stopped)
    expect(String((refused.value as any).reason)).toContain('holds no record')
    expect(String((refused.value as any).next)).toContain('upgrade consent')
    // Zero writes and zero commands: the candidate directory does not exist.
    expect(existsSync(path.join(approved.proposalDirectory, 'candidate'))).toBe(false)
    expect(await filesUnder(approved.fixture.evidence)).toEqual(evidenceBefore)
    expect(await readFile(path.join(approved.proposalDirectory, 'proposal.json'), 'utf8')).toBe(proposalBytes)
    expect(calls).toEqual([])
  })

  it('refuses a rejection, a scope without candidate validation, and an approval for another hash — with nothing written', async () => {
    const rejected = await prepared()
    const rejectedConsent = {
      ...rejected.consent,
      status: 'rejected',
      records: [{ ...rejected.consent.records[0], decision: 'reject', scope: {} }],
    }
    await writeFile(path.join(rejected.proposalDirectory, 'consent.json'), JSON.stringify(rejectedConsent, null, 2) + '\n', 'utf8')
    const runner1 = fakeRunner({ install: { hashlineVersion: rejected.candidate.hashline, toolEditVersion: rejected.candidate.toolEdit } })
    const rejection = await runValidate(rejected.fixture, ['--proposal', path.join(rejected.proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner1.runner)
    expect(rejection.code).toBe(EXIT.stopped)
    expect(String((rejection.value as any).reason)).toContain('not "approve"')
    expect(existsSync(path.join(rejected.proposalDirectory, 'candidate'))).toBe(false)
    expect(runner1.calls).toEqual([])

    // An approval that grants no candidate-validation scope.
    const scoped = await prepared()
    await writeFile(
      path.join(scoped.proposalDirectory, 'consent.json'),
      JSON.stringify({ ...scoped.consent, records: [{ ...scoped.consent.records[0], scope: {} }] }, null, 2) + '\n',
      'utf8',
    )
    const runner2 = fakeRunner({ install: { hashlineVersion: scoped.candidate.hashline, toolEditVersion: scoped.candidate.toolEdit } })
    const noScope = await runValidate(scoped.fixture, ['--proposal', path.join(scoped.proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner2.runner)
    expect(noScope.code).toBe(EXIT.stopped)
    expect(String((noScope.value as any).reason)).toContain('candidateValidation')
    expect(runner2.calls).toEqual([])

    // An approval recorded for ANOTHER proposal hash never covers this one.
    const foreign = await prepared()
    await writeFile(
      path.join(foreign.proposalDirectory, 'consent.json'),
      JSON.stringify({ ...foreign.consent, records: [{ ...foreign.consent.records[0], proposalHash: 'f'.repeat(64) }] }, null, 2) + '\n',
      'utf8',
    )
    const runner3 = fakeRunner({ install: { hashlineVersion: foreign.candidate.hashline, toolEditVersion: foreign.candidate.toolEdit } })
    const other = await runValidate(foreign.fixture, ['--proposal', path.join(foreign.proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner3.runner)
    expect(other.code).toBe(EXIT.stopped)
    expect(String((other.value as any).reason)).toContain('an approval never covers another payload')
    expect(runner3.calls).toEqual([])
  })

  it('refuses a proposal whose payload changed after it was written', async () => {
    const { fixture: f, proposalDirectory, proposal, candidate } = await prepared()
    const tampered = { ...proposal, candidates: proposal.candidates.map((entry: any) => ({ ...entry, version: '9.9.9' })) }
    await writeFile(path.join(proposalDirectory, 'proposal.json'), JSON.stringify(tampered, null, 2) + '\n', 'utf8')
    const { runner, calls } = fakeRunner({ install: { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit } })
    const refused = await runValidate(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    expect(refused.code).toBe(EXIT.stopped)
    expect(String((refused.value as any).reason)).toContain('no longer hashes')
    expect(String((refused.value as any).next)).toContain('upgrade propose')
    expect(existsSync(path.join(proposalDirectory, 'candidate'))).toBe(false)
    expect(calls).toEqual([])
  })

  it('refuses a drifted baseline — an edited lockfile AND a new untracked file both count', async () => {
    const edited = await prepared()
    const { runner, calls } = fakeRunner({ install: { hashlineVersion: edited.candidate.hashline, toolEditVersion: edited.candidate.toolEdit } })
    await writeFile(path.join(edited.fixture.repository, 'pnpm-lock.yaml'), 'lockfileVersion: 9.9\n', 'utf8')
    const lockDrift = await runValidate(edited.fixture, ['--proposal', path.join(edited.proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    expect(lockDrift.code).toBe(EXIT.stopped)
    expect(String((lockDrift.value as any).reason)).toContain('baselineHash')
    expect(String((lockDrift.value as any).next)).toContain('upgrade assess')
    expect(existsSync(path.join(edited.proposalDirectory, 'candidate'))).toBe(false)
    expect(calls).toEqual([])

    // HEAD equality would have hidden this one: a NEW file is uncommitted input.
    const added = await prepared()
    const second = fakeRunner({ install: { hashlineVersion: added.candidate.hashline, toolEditVersion: added.candidate.toolEdit } })
    await writeFile(path.join(added.fixture.repository, 'local-notes.txt'), 'mine\n', 'utf8')
    const untracked = await runValidate(added.fixture, ['--proposal', path.join(added.proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], second.runner)
    expect(untracked.code).toBe(EXIT.stopped)
    expect(String((untracked.value as any).reason)).toContain('baselineHash')
    expect(second.calls).toEqual([])
  })

  it('refuses a proposal that is not inside this workflow\'s evidence tree', async () => {
    const { fixture: f, proposalDirectory, proposal, consent, candidate } = await prepared()
    const elsewhere = await temp('candidate-outside-')
    // (a) A byte-identical copy: the directory it names is not the one this run
    //     may build (changes.candidateDirectory is not part of proposalHash).
    await writeFile(path.join(elsewhere, 'proposal.json'), JSON.stringify(proposal, null, 2) + '\n', 'utf8')
    await writeFile(path.join(elsewhere, 'consent.json'), JSON.stringify(consent, null, 2) + '\n', 'utf8')
    const { runner, calls } = fakeRunner({ install: { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit } })
    const copied = await runValidate(f, ['--proposal', path.join(elsewhere, 'proposal.json'), '--now', VALIDATED_AT], runner)
    expect(copied.code).toBe(EXIT.stopped)
    expect(String((copied.value as any).reason)).toContain('the only directory this run may create')
    expect(calls).toEqual([])
    expect(existsSync(path.join(elsewhere, 'candidate'))).toBe(false)

    // (b) Rewriting the name to fit the new location changes the payload, so the
    //     stronger check refuses first: the two rules compose instead of leaking.
    // (b) `changes` is not part of proposalHash, so renaming the directory keeps
    //     the payload valid — and the PLACEMENT rule is what refuses it.
    const rewritten = { ...proposal, changes: { ...proposal.changes, candidateDirectory: path.join(elsewhere, 'candidate') } }
    await writeFile(path.join(elsewhere, 'proposal.json'), JSON.stringify(rewritten, null, 2) + '\n', 'utf8')
    const moved = await runValidate(f, ['--proposal', path.join(elsewhere, 'proposal.json'), '--now', VALIDATED_AT], runner)
    expect(moved.code).toBe(EXIT.stopped)
    expect(String((moved.value as any).reason)).toContain('is outside the evidence directory')
    expect(calls).toEqual([])
    // The real proposal was never touched by either attempt.
    expect(await readFile(path.join(proposalDirectory, 'proposal.json'), 'utf8')).toBe(JSON.stringify(proposal, null, 2) + '\n')
  })

  it('refuses an assisted (subagent) session, which may analyze but never validate a candidate', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared()
    // The approval was recorded from the main session; the SAME session id then
    // comes back as an assisted one (SCOPE-06: analysis yes, execution no).
    await writeSession(f.sessions, { assisted: true })
    const { runner, calls } = fakeRunner({ install: { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit } })
    const refused = await runValidate(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    expect(refused.code).toBe(EXIT.stopped)
    expect(String((refused.value as any).reason)).toContain('SCOPE-06')
    expect((refused.value as any).delegation).toMatchObject({ role: 'subagent', mayApproveUpgrade: false })
    expect(existsSync(path.join(proposalDirectory, 'candidate'))).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('UPG-04/06: an approved candidate is validated in its own tree and store', () => {
  it('runs the install, the declared gates and the short link, applies keep/redo/delete, and reaches candidate-verified', async () => {
    const { fixture: f, proposalDirectory, proposal, candidate, consent } = await prepared()
    const candidateDirectory = path.join(proposalDirectory, 'candidate')
    const proposalBytes = await readFile(path.join(proposalDirectory, 'proposal.json'), 'utf8')
    const consentBytes = await readFile(path.join(proposalDirectory, 'consent.json'), 'utf8')
    const includeFile = path.join(f.repository, 'local-input.txt')
    // D10: the maintenance worktree may be dirty; the candidate still validates —
    // and the uncommitted input is part of what was validated.
    await writeFile(includeFile, 'user work in progress\n', 'utf8')
    const reprepared = await run(['upgrade', 'propose', '--now', PROPOSED_AT], cliEnvironment(f))
    expect(reprepared.code).toBe(EXIT.ok)
    const dirtyDirectory = (reprepared.value as any).evidence.directory
    expect(dirtyDirectory).not.toBe(proposalDirectory)
    const dirtyProposal = await readJson(path.join(dirtyDirectory, 'proposal.json'))
    await run(
      ['upgrade', 'consent', '--proposal', path.join(dirtyDirectory, 'proposal.json'), '--decision', 'approve', '--reply', REPLY, '--now', PROPOSED_AT],
      cliEnvironment(f),
    )
    const dirtyBytes = await readFile(path.join(dirtyDirectory, 'proposal.json'), 'utf8')
    const dirtyConsentBytes = await readFile(path.join(dirtyDirectory, 'consent.json'), 'utf8')
    const repositoryBefore = await snapshot(f.repository)
    const statusBefore = gitStatus(f.repository)

    const install = { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit }
    const { runner, calls } = fakeRunner({ install })
    const validated = await runValidate(f, ['--proposal', path.join(dirtyDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    const value = validated.value as any

    // The verdict and the exit code.
    expect(validated.code).toBe(EXIT.ok)
    expect(value.status).toBe('validated')
    expect(value.verdict).toBe('candidate-verified')
    expect(value.pendingVerification).toBe(false)
    expect(value.skipped).toEqual([])
    expect(value.gaps).toEqual([])
    expect(value.failures).toEqual([])
    expect(value.runner.source).toBe('injected')

    // Every declared gate ACTUALLY ran, in order, plus the install and the link.
    expect(value.commands.map((entry: any) => entry.name)).toEqual(['install', 'check:preset', 'test:unit', 'read-edit-short-link'])
    expect(value.commands.map((entry: any) => entry.source)).toEqual(['candidate-install', 'proposal-changes', 'proposal-changes', 'own-check'])
    for (const entry of value.commands) {
      expect(entry.exitCode).toBe(0)
      expect(typeof entry.durationMs).toBe('number')
    }
    expect(value.commands[0].args.slice(0, 1)).toEqual(['install'])
    // The store is the candidate's OWN: never the repository root, never global.
    expect(value.commands[0].args[2]).toBe(path.join(dirtyDirectory, 'candidate', '.pnpm-store'))
    for (const call of calls) expect(call.cwd).toBe(path.join(dirtyDirectory, 'candidate', 'tree'))

    // The APPROVED candidate versions were pinned into the tree's own manifest
    // before the install (this is what makes the run validate the candidate, not
    // the baseline), and the resolved build matches them.
    expect(value.dependencyUpdates.map((entry: any) => [entry.package, entry.to])).toEqual([
      [HASH_PKG, candidate.hashline],
      [EDIT_PKG, candidate.toolEdit],
    ])
    expect(value.dependencyUpdates.every((entry: any) => entry.changed)).toBe(true)
    expect(value.checks.find((check: any) => check.name === 'candidate-versions-match').status).toBe('pass')
    expect(value.checks.find((check: any) => check.name === 'engine-version-constraints').status).toBe('pass')
    expect(value.versions.approved.hashline).toBe(candidate.hashline)
    expect(value.versions.after.hashline).toBe(value.versions.approved.hashline)

    // includedInputs: the commit AND every uncommitted path, digested for real.
    expect(value.includedInputs.commit).toBe(git(f.repository, 'rev-parse', 'HEAD'))
    expect(value.includedInputs.dirty).toBe('dirty')
    expect(value.includedInputs.files.map((entry: any) => entry.path)).toContain('local-input.txt')
    const recorded = value.includedInputs.files.find((entry: any) => entry.path === 'local-input.txt')
    // The expectation comes from the bytes this test wrote, not from the code path
    // that produced the digest.
    expect(recorded.sha256).toBe(createHash('sha256').update('user work in progress\n', 'utf8').digest('hex'))
    expect(value.includedInputs.lockfileSha256).toMatch(/^[0-9a-f]{64}$/u)

    // keep / redo / delete, each applied mechanically and judged by the build.
    const hashlineItems = value.patchResults.filter((item: any) => item.component === 'hashline')
    const toolItems = value.patchResults.filter((item: any) => item.component === 'tool-edit')
    expect(hashlineItems.map((item: any) => item.decision).sort()).toEqual(['keep', 'redo'])
    expect(hashlineItems.every((item: any) => item.satisfied)).toBe(true)
    expect(toolItems.every((item: any) => item.decision === 'delete')).toBe(true)
    expect(toolItems.every((item: any) => item.satisfied)).toBe(true)
    expect(toolItems.every((item: any) => item.apply === 'patch-file-removed')).toBe(true)
    expect(value.patchResults.every((item: any) => item.requiresRecut === false)).toBe(true)

    // The version coupling: the file name AND the patchedDependencies key moved.
    const tree = path.join(dirtyDirectory, 'candidate', 'tree')
    const patches = (await readdir(path.join(tree, 'patches'))).sort()
    expect(patches).toEqual([patchFileName(HASH_PKG, candidate.hashline)])
    expect(existsSync(path.join(tree, 'patches', patchFileName(EDIT_PKG, f.versions.toolEdit)))).toBe(false)
    const workspace = await readFile(path.join(tree, 'pnpm-workspace.yaml'), 'utf8')
    expect(workspace).toContain("'" + HASH_PKG + '@' + candidate.hashline + "'")
    expect(workspace).not.toContain(EDIT_PKG)
    // …and the patch BYTES are the ones the proposal recorded: the expectation is
    // recomputed here from the candidate tree, not taken from the digest the code
    // just produced.
    const recordedHashline = dirtyProposal.rollback.patchFiles.find((entry: any) => entry.path.includes('dsh-hashline'))
    const renamedPatch = path.join(tree, 'patches', patchFileName(HASH_PKG, candidate.hashline))
    expect(createHash('sha256').update(await readFile(renamedPatch)).digest('hex')).toBe(recordedHashline.sha256)
    expect(value.candidateBaseline.patchDigests.find((entry: any) => entry.path === recordedHashline.path).match).toBe(true)

    // The resolved build, its identity and the shared physical instance.
    expect(value.checks.find((check: any) => check.name === 'resolved-paths-and-shared-instance').status).toBe('pass')
    expect(value.checks.find((check: any) => check.name === 'patch-marker-evidence').status).toBe('pass')
    expect(value.candidateBaseline.resolution.samePhysicalInstance).toBe(true)
    expect(value.candidateBaseline.resolution.insideCandidateTree).toBe(true)
    expect(value.candidateBaseline.engines.hashline.version).toBe(candidate.hashline)

    // The report: the preconditions and the boundaries, and never "already upgraded".
    expect(value.statements).toMatchObject({ mayClaimSecondPhasePrecondition: true, mayClaimUpgraded: false, targetUntouched: true, dailyProfileUntouched: true })
    expect(value.scope).toMatchObject({ switchAuthorized: false, switched: false })
    expect(value.versions.after.hashline).toBe(candidate.hashline)
    expect(String(value.nextNote)).toContain('第二阶段')
    const resultBytes = await readJson(path.join(dirtyDirectory, 'candidate', 'result.json'))
    expect(resultBytes.tool).toBe(CANDIDATE_TOOL)
    expect(resultBytes.authorization.reply.seq).toBe(REPLY_SEQ)
    expect(resultBytes.authorization.proposalHash).toBe(dirtyProposal.proposalHash)
    expect(resultBytes.authorization.baselineHash).toBe(dirtyProposal.baselineHash)

    // One log per command, inside the candidate directory.
    const logs = (await readdir(path.join(dirtyDirectory, 'candidate', 'logs'))).sort()
    expect(logs).toHaveLength(value.commands.length)
    expect(logs[0]).toContain('install')

    // The one file written outside candidate/: validation.md, beside the proposal.
    const report = await readFile(path.join(dirtyDirectory, 'validation.md'), 'utf8')
    expect(report).toContain('candidate-verified')
    expect(report).toContain('授权依据')
    expect(report).toContain('includedInputs')
    expect(report).toContain('local-input.txt')
    expect(report).toContain('逐项补丁结果与标记证据')
    expect(report).toContain('未切换目标')
    expect(report).toContain('未改日常 profile')
    expect(report).not.toContain('已升级')
    expect(report).not.toContain('可切换')

    // Byte boundaries: the maintenance worktree, the proposal and the consent.
    expect(await snapshot(f.repository)).toEqual(repositoryBefore)
    expect(gitStatus(f.repository)).toBe(statusBefore)
    expect(await readFile(path.join(dirtyDirectory, 'proposal.json'), 'utf8')).toBe(dirtyBytes)
    expect(await readFile(path.join(dirtyDirectory, 'consent.json'), 'utf8')).toBe(dirtyConsentBytes)
    expect(existsSync(path.join(f.repository, 'node_modules'))).toBe(false)
    expect(existsSync(path.join(f.repository, '.pnpm-store'))).toBe(false)
    // Under upgrades there are now the assessment, two proposals — and no target.
    expect(await upgradeDirs(f.evidence)).toEqual([ASSESS_STAMP, path.basename(proposalDirectory), path.basename(dirtyDirectory)].sort())
    expect(await filesUnder(path.join(dirtyDirectory, 'candidate'))).toEqual(expect.arrayContaining(['result.json', 'tree/package.json', 'tree/pnpm-lock.yaml']))
    // The untouched earlier proposal is still exactly as approved.
    expect(await readFile(path.join(proposalDirectory, 'proposal.json'), 'utf8')).toBe(proposalBytes)
    expect(await readFile(path.join(proposalDirectory, 'consent.json'), 'utf8')).toBe(consentBytes)
    expect(consent.records[0].scope).toEqual({ candidateValidation: true, switch: false })
    expect(existsSync(candidateDirectory)).toBe(false)
  })

  it('refuses to call a tree that resolves the BASELINE instead of the approved candidate', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared()
    // The install silently resolves the baseline: every baseline marker is present,
    // so the marker evidence alone would look perfectly healthy.
    const { runner } = fakeRunner({ install: { hashlineVersion: f.versions.hashline, toolEditVersion: f.versions.toolEdit } })
    const validated = await runValidate(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    const value = validated.value as any
    expect(validated.code).toBe(EXIT.stopped)
    expect(value.verdict).toBe('candidate-failed')
    expect(value.checks.find((check: any) => check.name === 'candidate-versions-match').status).toBe('fail')
    expect(value.failures.some((entry: any) => entry.name === 'candidate-versions-match')).toBe(true)
    expect(value.versions.after.hashline).toBe(f.versions.hashline)
    expect(value.versions.approved.hashline).toBe(candidate.hashline)
    expect(value.statements.mayClaimSecondPhasePrecondition).toBe(false)
    const report = await readFile(path.join(proposalDirectory, 'validation.md'), 'utf8')
    expect(report).toContain('MISMATCH')
  })

  it('pins the approved candidate version into the candidate tree before the install', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared()
    const { runner, calls } = fakeRunner({ install: { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit } })
    const validated = await runValidate(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    expect(validated.code).toBe(EXIT.ok)
    // The install saw a manifest that already names the approved combination…
    expect(calls[0].manifest).toMatchObject({ [HASH_PKG]: candidate.hashline, [EDIT_PKG]: candidate.toolEdit })
    // …and the maintenance worktree still declares the baseline it declares.
    const repositoryManifest = JSON.parse(await readFile(path.join(f.repository, 'package.json'), 'utf8'))
    expect(repositoryManifest.dependencies).toEqual({ [HASH_PKG]: f.versions.hashline, [EDIT_PKG]: f.versions.toolEdit })
  })

  it('keeps an undecided patch item undecided instead of turning it into keep', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared({ records: recommendingHashlineOnly })
    const { runner } = fakeRunner({ install: { hashlineVersion: candidate.hashline, toolEditVersion: f.versions.toolEdit } })
    const validated = await runValidate(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    const value = validated.value as any
    expect(validated.code).toBe(EXIT.stopped)
    expect(value.verdict).toBe('candidate-incomplete')
    const undecided = value.patchResults.filter((item: any) => item.decision === 'pending-verification')
    expect(undecided.length).toBeGreaterThan(0)
    expect(undecided.every((item: any) => item.apply === 'undecided' && item.satisfied === false)).toBe(true)
    expect(value.gaps.join(' ')).toContain('pending-verification')
    expect(value.checks.find((check: any) => check.name === 'patch-marker-evidence').status).toBe('fail')
  })

  it('records a cancelled run as NOT executed, never as a pass', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared()
    const { runner } = fakeRunner({ install: { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit } })
    const validated = await runValidate(
      f,
      ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT],
      runner,
      () => true,
    )
    const value = validated.value as any
    expect(validated.code).toBe(EXIT.stopped)
    expect(value.verdict).toBe('candidate-incomplete')
    expect(value.commands.map((entry: any) => entry.name)).toEqual(['install'])
    expect(value.skipped.map((entry: any) => entry.name)).toEqual(['check:preset', 'test:unit', 'read-edit-short-link'])
    expect(value.skipped[0].reason).toContain('cancelled')
    expect(value.statements.mayClaimSecondPhasePrecondition).toBe(false)
  })

  it('reports an uncommitted input the candidate tree does not carry as a critical unknown', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared()
    // `.tmp` is copied nowhere (it is excluded by design), and it is a TRACKED path
    // here, so a modification to it is uncommitted input the copy cannot carry.
    await mkdir(path.join(f.repository, '.tmp'), { recursive: true })
    await writeFile(path.join(f.repository, '.tmp', 'note.txt'), 'first\n', 'utf8')
    runGit(f.repository, 'add', '-A')
    runGit(f.repository, 'add', '-f', '.tmp/note.txt')
    runGit(f.repository, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'track tmp')
    await writeFile(path.join(f.repository, '.tmp', 'note.txt'), 'second\n', 'utf8')
    const again = await run(['upgrade', 'propose', '--now', '2026-10-25T11:00:00.000Z'], cliEnvironment(f))
    expect(again.code).toBe(EXIT.ok)
    const directory = (again.value as any).evidence.directory
    await run(['upgrade', 'consent', '--proposal', path.join(directory, 'proposal.json'), '--decision', 'approve', '--reply', REPLY, '--now', PROPOSED_AT], cliEnvironment(f))
    const { runner } = fakeRunner({ install: { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit } })
    const validated = await runValidate(f, ['--proposal', path.join(directory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    const value = validated.value as any
    expect(validated.code).toBe(EXIT.stopped)
    expect(value.verdict).toBe('candidate-incomplete')
    const entry = value.includedInputs.files.find((item: any) => item.path === '.tmp/note.txt')
    expect(entry.sha256).toBe('missing')
    // R3: the copy is compared with the APPROVED bytes, not merely read. A path the
    // copy cannot carry does not match the approval, and that is reported as such.
    expect(entry.expected).toMatch(/^[0-9a-f]{64}$/u)
    expect(entry.match).toBe(false)
    expect(value.criticalUnknowns.join(' ')).toContain('.tmp/note.txt')
    expect(value.pendingVerification).toBe(true)
    expect(path.basename(proposalDirectory).length).toBeGreaterThan(0)
  })

  it('records a failed gate as candidate-failed, stops there, and keeps the failure evidence', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared()
    const { runner, calls } = fakeRunner({
      install: { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit },
      gates: { 'check:preset': 1 },
    })
    const validated = await runValidate(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    const value = validated.value as any
    expect(validated.code).toBe(EXIT.stopped)
    expect(value.status).toBe('failed')
    expect(value.verdict).toBe('candidate-failed')
    expect(value.statements.mayClaimSecondPhasePrecondition).toBe(false)
    // The second gate and the short link were NOT executed: a stop is a stop.
    expect(value.commands.map((entry: any) => entry.name)).toEqual(['install', 'check:preset'])
    expect(value.skipped.map((entry: any) => entry.name)).toEqual(['test:unit', 'read-edit-short-link'])
    expect(value.stop.rule).toBe('UPG-09')
    expect(String(value.stop.next)).toContain('upgrade propose')
    expect(calls.filter((call) => String(call.args[0]).endsWith('short-link.mjs'))).toEqual([])
    // The failure text lands in the report with its path and line.
    const report = await readFile(path.join(proposalDirectory, 'validation.md'), 'utf8')
    expect(report).toContain('candidate-failed')
    expect(report).toContain('test/fixture.spec.ts:12:5')
    expect(report).toContain('另提方案')
  })

  it('records a timeout as a stop, never as a pass', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared()
    const { runner } = fakeRunner({
      install: { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit },
      gates: { 'check:preset': 'timeout' },
    })
    const validated = await runValidate(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    const value = validated.value as any
    expect(validated.code).toBe(EXIT.stopped)
    expect(value.verdict).toBe('candidate-failed')
    expect(value.commands.find((entry: any) => entry.name === 'check:preset').timedOut).toBe(true)
    expect(value.failures.some((entry: any) => String(entry.reason).includes('timed out'))).toBe(true)
  })

  it('reports a gate that was never executed as incomplete, never as verified', async () => {
    // No packageManager declared: the repository's scripts are listed verbatim
    // with run: null, so there is nothing this run may execute.
    const { fixture: f, candidate } = await prepared({ scripts: SCRIPTS })
    const manifest = JSON.parse(await readFile(path.join(f.repository, 'package.json'), 'utf8'))
    delete manifest.packageManager
    await writeFile(path.join(f.repository, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    const again = await run(['upgrade', 'propose', '--now', '2026-10-25T10:00:00.000Z'], cliEnvironment(f))
    expect(again.code).toBe(EXIT.ok)
    const directory = (again.value as any).evidence.directory
    expect((again.value as any).gaps.join(' ')).toContain('declares no packageManager')
    await run(['upgrade', 'consent', '--proposal', path.join(directory, 'proposal.json'), '--decision', 'approve', '--reply', REPLY, '--now', PROPOSED_AT], cliEnvironment(f))
    const { runner } = fakeRunner({ install: { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit } })
    const validated = await runValidate(f, ['--proposal', path.join(directory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    const value = validated.value as any
    expect(validated.code).toBe(EXIT.stopped)
    expect(value.verdict).toBe('candidate-incomplete')
    expect(value.skipped.length).toBeGreaterThan(0)
    expect(value.gaps.join(' ')).toContain('no runnable command')
    const report = await readFile(path.join(directory, 'validation.md'), 'utf8')
    expect(report).toContain('不计入通过')
  })

  it('caps a candidate whose critical baseline is unknown at incomplete, marked pendingVerification', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared({ noGit: true })
    const { runner } = fakeRunner({ install: { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit } })
    const validated = await runValidate(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    const value = validated.value as any
    expect(validated.code).toBe(EXIT.stopped)
    expect(value.verdict).toBe('candidate-incomplete')
    expect(value.pendingVerification).toBe(true)
    expect(value.criticalUnknowns.join(' ')).toContain('commit is unknown')
    expect(value.statements.mayClaimSecondPhasePrecondition).toBe(false)
    const report = await readFile(path.join(proposalDirectory, 'validation.md'), 'utf8')
    expect(report).toContain('candidate-incomplete')
    expect(report).toContain('关键 unknown')
    expect(report).not.toContain('已升级')
  })

  it('reports a short link the candidate tree cannot run as a GAP, not as a pass', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared()
    const { runner } = fakeRunner({
      install: { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit },
      driver: { status: 'gap', detail: 'the candidate tree does not carry the host runtime this short link needs', missing: ['@deepseek-ai/dsh-tools'] },
    })
    const validated = await runValidate(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    const value = validated.value as any
    expect(validated.code).toBe(EXIT.stopped)
    expect(value.verdict).toBe('candidate-incomplete')
    expect(value.gaps.join(' ')).toContain('@deepseek-ai/dsh-tools')
    expect(value.checks.find((check: any) => check.name === 'read-edit-short-link').status).toBe('gap')
    expect(value.statements.mayClaimSecondPhasePrecondition).toBe(false)
  })

  it('keeps a plan-outside assertion failure as it is: stop, no relaxed assertion, no wider fix', async () => {
    const { fixture: f, proposalDirectory, candidate } = await prepared()
    const before = await snapshot(f.repository)
    const proposalBytes = await readFile(path.join(proposalDirectory, 'proposal.json'), 'utf8')
    const consentBytes = await readFile(path.join(proposalDirectory, 'consent.json'), 'utf8')
    const ownPrefix = 'upgrades/' + path.basename(proposalDirectory) + '/'
    const evidenceBefore = (await filesUnder(f.evidence)).filter((name) => !name.startsWith(ownPrefix))
    const { runner } = fakeRunner({
      install: { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit },
      gates: { 'test:unit': 1 },
    })
    const validated = await runValidate(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    const value = validated.value as any
    expect(validated.code).toBe(EXIT.stopped)
    expect(value.verdict).toBe('candidate-failed')
    expect(value.stop).toMatchObject({ rule: 'UPG-09' })
    expect(String(value.stop.note)).toContain('不放宽断言')
    // Nothing outside the candidate tree and validation.md changed: no assertion
    // was edited to make the gate green, and no repository file was touched.
    const after = (await filesUnder(f.evidence)).filter((name) => !name.startsWith(ownPrefix))
    expect(after).toEqual(evidenceBefore)
    expect(await snapshot(f.repository)).toEqual(before)
    expect(await readFile(path.join(proposalDirectory, 'proposal.json'), 'utf8')).toBe(proposalBytes)
    expect(await readFile(path.join(proposalDirectory, 'consent.json'), 'utf8')).toBe(consentBytes)
    expect(await filesUnder(path.join(proposalDirectory, 'candidate')).then((names) => names.filter((name) => name.includes('spec')))).toEqual([])
  })
})

describe('UPG-07: a two-phase approval still only delivers the preconditions', () => {
  it('records switchAuthorized but never switches, and says the switch belongs to ticket 07', async () => {
    const versions = await liveVersions()
    const f = await fixture({ versions })
    const candidate = { hashline: nextVersion(versions.hashline), toolEdit: nextVersion(versions.toolEdit) }
    const file = await sourcesFile(recommendingRecords(versions, candidate))
    await run(['upgrade', 'assess', '--sources', file, '--now', ASSESSED_AT], cliEnvironment(f))
    const proposed = await run(['upgrade', 'propose', '--now', PROPOSED_AT], cliEnvironment(f))
    const directory = (proposed.value as any).evidence.directory
    const both = await run(
      ['upgrade', 'consent', '--proposal', path.join(directory, 'proposal.json'), '--decision', 'approve', '--scope', 'validation-and-switch', '--reply', REPLY, '--now', PROPOSED_AT],
      cliEnvironment(f),
    )
    expect(both.code).toBe(EXIT.ok)
    const before = await snapshot(f.repository)
    const { runner } = fakeRunner({ install: { hashlineVersion: candidate.hashline, toolEditVersion: candidate.toolEdit } })
    const validated = await runValidate(f, ['--proposal', path.join(directory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    const value = validated.value as any
    expect(validated.code).toBe(EXIT.ok)
    expect(value.verdict).toBe('candidate-verified')
    expect(value.scope).toMatchObject({ switchAuthorized: true, switched: false })
    expect(value.statements.mayClaimSecondPhasePrecondition).toBe(true)
    expect(value.statements.mayClaimUpgraded).toBe(false)
    expect(String(value.next)).toContain('ticket 07')
    expect(String(value.nextNote)).toContain('票据 07')
    // The target — the maintenance worktree — is byte-identical: no switch happened.
    expect(await snapshot(f.repository)).toEqual(before)
    expect(gitStatus(f.repository)).toBe('')
    const report = await readFile(path.join(directory, 'validation.md'), 'utf8')
    expect(report).toContain('用户是否已一次批准两阶段：true')
    expect(report).not.toContain('已升级')
  })
})

describe('UPG-11: a bundle that carries no official host authorizes nothing', () => {
  it('stops the assessment incomplete and forbids a target switch, whatever the approval says', async () => {
    // The host is missing from the FIXTURE, so `version: dsh` is unknown for a reason
    // this test owns — never because this machine happens to lack it (R5). It runs as a
    // CHILD with NODE_PATH stripped, so the fixture alone decides whether the official
    // host resolves.
    const hostless = await bundleFixture({ dsh: null, hashline: BUNDLE_VERSIONS.hashline, toolEdit: BUNDLE_VERSIONS.toolEdit })
    const versions = { ...BUNDLE_VERSIONS }
    const f = await fixture({ versions })
    const candidate = { hashline: nextVersion(versions.hashline), toolEdit: nextVersion(versions.toolEdit) }
    const file = await sourcesFile(recommendingRecords(versions, candidate))
    const childEnv = { DSH_HOME: f.home, DSH_SESSION_ID: SESSION, PWD: WORKSPACE }

    // (a) The assessment is honest about what it could not establish.
    const assessed = await runBundleChild(hostless, ['upgrade', 'assess', '--sources', file, '--now', ASSESSED_AT], childEnv)
    const assessment = assessed.json as any
    expect(assessed.code).toBe(EXIT.stopped)
    expect(assessment.complete).toBe(false)
    expect(assessment.verified).toBe(false)
    expect(assessment.pendingVerification).toBe(true)
    expect(assessment.gaps.join(' ')).toContain('version: dsh')
    expect(assessment.scope.switched).toBe(false)

    // (b) A pending candidate may still be PROPOSED — and that is all it is: the
    // proposal is written, no candidate is built, nothing is switched.
    const proposed = await runBundleChild(hostless, ['upgrade', 'propose', '--now', PROPOSED_AT], childEnv)
    expect(proposed.code).toBe(EXIT.ok)
    const directory = (proposed.json as any).evidence.directory
    const proposalPath = path.join(directory, 'proposal.json')
    const proposal = await readJson(proposalPath)
    expect(await upgradeDirs(f.evidence)).toEqual([ASSESS_STAMP, path.basename(directory)].sort())
    expect(existsSync(path.join(directory, 'candidate'))).toBe(false)
    expect(existsSync(path.join(directory, 'backup'))).toBe(false)

    // (c) A switch is REFUSED and touches nothing: with the host unknown the proposal
    // cannot name a resolvable upgrade target, so "unknown" is never a switch target
    // (D12/UPG-11) and the maintenance worktree keeps every byte.
    const before = await snapshot(f.repository)
    const switched = await runBundleChild(hostless, ['upgrade', 'switch', '--proposal', proposalPath, '--now', VALIDATED_AT], childEnv)
    const value = switched.json as any
    expect(switched.code).toBe(EXIT.stopped)
    expect(String(value.reason ?? '')).toContain('no target was switched')
    // A refusal carries no phase record at all: nothing was executed.
    expect(value.phase).toBeUndefined()
    expect(await snapshot(f.repository)).toEqual(before)
    expect(await readFile(proposalPath, 'utf8')).toBe(JSON.stringify(proposal, null, 2) + '\n')
    expect(existsSync(path.join(directory, 'switch.json'))).toBe(false)
    expect(existsSync(path.join(directory, 'backup'))).toBe(false)
  })
})

describe('R3: a copied input is compared with the approved bytes, like for like', () => {
  it('matches a symlink by its link target, the way the approval recorded it', async () => {
    const tree = await temp('candidate-copy-')
    await writeFile(path.join(tree, 'real.txt'), 'content\n', 'utf8')
    try {
      await symlink('real.txt', path.join(tree, 'link.txt'))
    } catch {
      // A host that cannot create symlinks cannot exercise this case.
      return
    }
    const digestOf = (text: string) => createHash('sha256').update(text).digest('hex')
    const included = includedInputsOf({
      baseline: {
        repository: {
          commit: 'abc1234',
          dirty: 'dirty',
          changedPaths: ['link.txt'],
          changedInputs: [{ path: 'link.txt', state: 'modified', kind: 'symlink', sha256: digestOf('real.txt') }],
        },
      },
      tree,
    })
    expect(included.files).toHaveLength(1)
    // Hashing the copied file's CONTENT here would never equal the recorded link
    // string, so every symlink input would refuse a candidate for an unfixable reason.
    expect(included.files[0].match).toBe(true)
    expect(included.problems.filter((problem: string) => problem.includes('link.txt'))).toEqual([])
  })
})

describe('the candidate command allowlist and the version coupling', () => {
  it('allows only the manager verbs, node scripts inside the tree, and declared scripts', () => {
    const tree = '/candidate/tree'
    expect(candidateCommandProblem({ command: 'pnpm', args: ['install'], tree })).toBeUndefined()
    expect(candidateCommandProblem({ command: 'npm', args: ['run', 'build'], tree })).toBeUndefined()
    expect(candidateCommandProblem({ command: 'node', args: ['.candidate/short-link.mjs', tree], tree })).toBeUndefined()
    expect(candidateCommandProblem({ command: 'pnpm', args: ['test:unit'], tree })).toContain('neither one of')
    expect(candidateCommandProblem({ command: 'pnpm', args: ['test:unit'], tree, declaredScripts: ['test:unit'] })).toBeUndefined()
    expect(candidateCommandProblem({ command: 'curl', args: ['https://example.invalid'], tree })).toContain('only pnpm')
    expect(candidateCommandProblem({ command: 'pnpm', args: ['publish'], tree })).toContain('neither one of')
    expect(candidateCommandProblem({ command: 'node', args: ['/etc/passwd'], tree })).toContain('outside the candidate tree')
    expect(candidateCommandProblem({ command: 'node', args: ['--version'], tree })).toContain('needs a script path')
  })

  it('moves the patchedDependencies key with the patch file, and leaves every other line alone', () => {
    const text = [
      'packages:',
      '  - .',
      '',
      'patchedDependencies:',
      "  '@hy-sde-org/dsh-hashline@0.2.1-alpha.4': patches/@hy-sde-org__dsh-hashline@0.2.1-alpha.4.patch",
      "  '@hy-sde-org/dsh-tool-edit@0.2.1-alpha.4': patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch",
      '',
      'allowBuilds:',
      '  esbuild: false',
      '',
    ].join('\n')
    const rewritten = rewritePatchedDependencies(text, [
      { key: HASH_PKG + '@0.2.1-alpha.4', nextKey: HASH_PKG + '@0.3.0', nextPath: 'patches/@hy-sde-org__dsh-hashline@0.3.0.patch' },
      { key: EDIT_PKG + '@0.2.1-alpha.4', nextKey: null, nextPath: '' },
    ])
    expect(rewritten.changed).toEqual(['renamed ' + HASH_PKG + '@0.2.1-alpha.4 -> ' + HASH_PKG + '@0.3.0', 'removed ' + EDIT_PKG + '@0.2.1-alpha.4'])
    expect(rewritten.missing).toEqual([])
    expect(rewritten.text).toBe([
      'packages:',
      '  - .',
      '',
      'patchedDependencies:',
      "  '" + HASH_PKG + "@0.3.0': patches/@hy-sde-org__dsh-hashline@0.3.0.patch",
      '',
      'allowBuilds:',
      '  esbuild: false',
      '',
    ].join('\n'))
    // A block that does not register the key is named, never silently skipped.
    const absent = rewritePatchedDependencies('packages:\n  - .\n', [{ key: HASH_PKG + '@1.0.0', nextKey: null, nextPath: '' }])
    expect(absent.missing).toEqual([HASH_PKG + '@1.0.0'])
  })
})

describe('UPG-03: no automatic acceptance reaches the candidate command', () => {
  it('exits 3 for an approval flag, a missing --proposal, a bad timeout and an unknown flag', async () => {
    const { fixture: f, proposalDirectory } = await prepared()
    const proposalPath = path.join(proposalDirectory, 'proposal.json')
    const cases: string[][] = [
      ['upgrade', 'validate', '--proposal', proposalPath, '--yes'],
      ['upgrade', 'validate', '--proposal', proposalPath, '--approved'],
      ['upgrade', 'validate', '--proposal', proposalPath, '--auto'],
      ['upgrade', 'validate', '--proposal', proposalPath, '--assume-yes'],
      ['upgrade', 'validate', '--now', VALIDATED_AT],
      ['upgrade', 'validate', '--proposal', proposalPath, '--timeout-min', 'zero'],
      ['upgrade', 'validate', '--proposal', proposalPath, '--nonsense'],
    ]
    for (const argv of cases) {
      const result = await runCli(f, argv)
      expect({ argv, code: result.code }).toEqual({ argv, code: EXIT.refused })
    }
    // None of them created a candidate directory or wrote a report.
    expect(existsSync(path.join(proposalDirectory, 'candidate'))).toBe(false)
    expect(existsSync(path.join(proposalDirectory, 'validation.md'))).toBe(false)
  })
})

describe('the real runner (the one smoke case, and it never invents a pass)', () => {
  it('spawns a real child process, honours a quoted argument, and surfaces a timeout and a non-zero exit', async () => {
    const tree = await temp('candidate-smoke-')
    const script = path.join(tree, 'probe.mjs')
    const spaced = path.join(tree, 'a dir with spaces')
    await mkdir(spaced, { recursive: true })
    const out = path.join(spaced, 'out.json')
    await writeFile(
      script,
      [
        "import { writeFileSync } from 'node:fs'",
        'const target = process.argv[2]',
        'const code = Number(process.argv[3] ?? 0)',
        'writeFileSync(target, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))',
        'console.log(JSON.stringify({ ok: code === 0 }))',
        'process.exit(code)',
        '',
      ].join('\n'),
      'utf8',
    )
    const runner = createDefaultRunner()
    // A real process, a real exit code, and an argument with spaces in it: on
    // win32 this goes through a shell, so a quoting bug here would be invisible
    // to an injected runner.
    const stdout = runner(managerCommand('node'), [script, out], { cwd: tree, timeoutMs: 30_000 })
    expect(String(stdout)).toContain('"ok":true')
    const written = JSON.parse(await readFile(out, 'utf8'))
    expect(written.cwd).toBe(tree)
    expect(written.argv[0]).toBe(out)

    // A failing child is THROWN, never returned as a success.
    let failed: any
    try {
      runner(managerCommand('node'), [script, path.join(tree, 'second.json'), '7'], { cwd: tree, timeoutMs: 30_000 })
    } catch (error) {
      failed = error
    }
    expect(failed).toBeDefined()
    expect(failed.status).toBe(7)

    // A timeout kills the child instead of hanging the gate.
    await writeFile(path.join(tree, 'sleep.mjs'), 'setTimeout(() => {}, 60000)\n', 'utf8')
    const started = Date.now()
    let timedOut: any
    try {
      runner(managerCommand('node'), [path.join(tree, 'sleep.mjs')], { cwd: tree, timeoutMs: 1500 })
    } catch (error) {
      timedOut = error
    }
    expect(timedOut).toBeDefined()
    expect(Date.now() - started).toBeLessThan(30_000)

    // The documented Windows gap (`pnpm.cmd` is EINVAL for execFileSync): the
    // contract is that a real child either answers with a version or throws a
    // captured failure — it may never be swallowed as a silent success.
    let answeredWithVersion = false
    let threwAnError = false
    try {
      const version = String(runner(managerCommand('pnpm'), ['--version'], { cwd: tree, timeoutMs: 30_000 })).trim()
      answeredWithVersion = /^\d+\.\d+/u.test(version)
    } catch (error) {
      threwAnError = error instanceof Error
    }
    expect({ answeredWithVersion, threwAnError }).not.toEqual({ answeredWithVersion: false, threwAnError: false })
  })

  it('never calls a candidate tree whose install left nothing a pass', async () => {
    const { fixture: f, proposalDirectory } = await prepared()
    const calls: string[] = []
    // A runner that reports success for the install but materializes nothing: the
    // resolved engines are then unknown, which is a named gap and not a pass.
    const runner = (command: string, args: string[]) => {
      calls.push(command + ' ' + args.join(' '))
      return { exitCode: 0, stdout: '' }
    }
    const validated = await runValidate(f, ['--proposal', path.join(proposalDirectory, 'proposal.json'), '--now', VALIDATED_AT], runner)
    const value = validated.value as any
    expect(validated.code).toBe(EXIT.stopped)
    expect(value.verdict).not.toBe('candidate-verified')
    expect(value.statements.mayClaimSecondPhasePrecondition).toBe(false)
    expect(value.criticalUnknowns.length).toBeGreaterThan(0)
    // The two sides could not even be resolved, so the check is a GAP (unmeasured),
    // not a failure: an unresolved install never reads as a pass.
    expect(value.checks.find((check: any) => check.name === 'resolved-paths-and-shared-instance').status).toBe('gap')
    expect(value.verdict).toBe('candidate-incomplete')
    // Only the manager and node ever appear, whatever the tree looked like.
    for (const call of calls) expect(call.startsWith('pnpm') || call.startsWith('node')).toBe(true)
  })
})

/** A git fact about the maintenance worktree, for the includedInputs assertion. */
function git(repository: string, ...args: string[]): string {
  return runGit(repository, ...args).trim()
}
