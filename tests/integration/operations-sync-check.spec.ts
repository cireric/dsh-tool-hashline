/**
 * SYNC-01 / SYNC-02 / SYNC-08, ticket 01: the local-source check loop.
 *
 * Everything here goes through the PUBLIC entry (scripts/sync-check.mjs and the
 * exported runSyncCheck), never through an internal helper, because the claim
 * being made is "a maintainer can run this and trust what it writes".
 *
 * The fixtures are real directories with a real git repository, real files and a
 * real evidence tree; no git runner is stubbed except where a case is ABOUT a
 * source that has no VCS at all. External release sources are not touched in
 * this slice, so no network fixture appears here.
 */
import { createHash } from 'node:crypto'
import { execFile, execFileSync, spawnSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { RawReleaseSource } from '../../presets/ptc-hashline/operations/sync.mjs'
import {
  DEFAULT_RELEVANT_INPUTS,
  hashOf,
  inspectCheckout,
  probeCheckoutPath,
  resolveDshSource,
  runSyncCheck,
  saveDshCheckout,
  settingsOf,
  stableJson,
  SYNC_EXIT,
} from '../../presets/ptc-hashline/operations/sync.mjs'
import { run as runOperations } from '../../presets/ptc-hashline/operations/cli.mjs'
import { main as syncMain, parseArgs } from '../../scripts/sync-check.mjs'

const execFileAsync = promisify(execFile)
const SCRIPT = path.resolve(process.cwd(), 'scripts/sync-check.mjs')
const NOW = '2026-10-27T02:30:00.000Z'

/**
 * The engine release sources for every round in this file.
 *
 * Injected on purpose: this suite is about the SOURCE area, and an injected
 * answer keeps it off the network. The engine comparator's own cases (and its
 * real query) are exercised in operations-sync-engines.spec.ts.
 */
const ENGINE_SOURCES: RawReleaseSource[] = [
  { package: '@hy-sde-org/dsh-hashline', status: 'verified', queriedAt: NOW, source: 'fixture: this suite', versions: ['0.2.1-alpha.4'], tags: { latest: '0.2.1-alpha.4' } },
  { package: '@hy-sde-org/dsh-tool-edit', status: 'verified', queriedAt: NOW, source: 'fixture: this suite', versions: ['0.2.1-alpha.4'], tags: { latest: '0.2.1-alpha.4' } },
]
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/**
 * Run git and capture its output through a file descriptor.
 *
 * A piped stdio is refused by a confined sandbox, so the fixture setup uses the
 * same descriptor capture the module under test uses — this keeps the suite
 * runnable in the environment the check itself has to survive.
 */
function gitText(directory: string, args: string[]): string {
  const target = path.join(path.dirname(directory), 'git-capture-' + String(process.pid) + '.txt')
  const descriptor = openSync(target, 'w')
  try {
    const result = spawnSync('git', ['-C', directory, ...args], { stdio: ['ignore', descriptor, descriptor] })
    if (result.error !== undefined) throw result.error
    const text = readFileSync(target, 'utf8')
    if (result.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + text)
    return text
  } finally {
    closeSync(descriptor)
    rmSync(target, { force: true })
  }
}

/** Commit everything in one fixture repository, with a fixed identity. */
function commitAll(directory: string, message = 'fixture'): void {
  execFileSync('git', ['-C', directory, 'add', '.'], { stdio: 'ignore' })
  execFileSync('git', ['-C', directory, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', message], { stdio: 'ignore' })
}

interface CheckoutOptions {
  /** false leaves the fixture without a git repository at all. */
  git?: boolean
  /** Drops a relevant input, so the "missing path" branch is exercised. */
  omit?: string
  /** The package name in the fixture manifest. */
  name?: string
  /** Appends a byte to a covered file AFTER the commit. */
  dirty?: boolean
}

/** A minimal directory that looks like a DSH source tree. */
async function dshCheckout(options: CheckoutOptions = {}): Promise<string> {
  const root = await temp('sync-checkout-')
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: options.name ?? '@deepseek-ai/dsh-root', version: '0.2.1-rc.2', packageManager: 'pnpm@11.28.5' }, null, 2) + '\n', 'utf8')
  for (const relative of DEFAULT_RELEVANT_INPUTS) {
    if (relative === options.omit) continue
    const absolute = path.join(root, ...relative.split('/'))
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, '// fixture content for ' + relative + '\n', 'utf8')
  }
  if (options.git !== false) {
    execFileSync('git', ['init', '-q', root], { stdio: 'ignore' })
    commitAll(root)
    if (options.dirty === true) {
      const target = path.join(root, ...DEFAULT_RELEVANT_INPUTS[0].split('/'))
      await writeFile(target, (await readFile(target, 'utf8')) + '// local edit\n', 'utf8')
    }
  }
  return root
}

/** A minimal directory that looks like THIS project's maintenance worktree. */
async function projectTree(): Promise<string> {
  const root = await temp('sync-project-')
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'dsh-tool-hashline',
    version: '0.0.0',
    devDependencies: { '@deepseek-ai/dsh-tools': '0.2.1-rc.2', '@deepseek-ai/dsh-fs': '0.2.1-rc.2', '@deepseek-ai/cordis': '4.0.5-alpha.2' },
  }, null, 2) + '\n', 'utf8')
  await mkdir(path.join(root, 'packages', 'hashline'), { recursive: true })
  await mkdir(path.join(root, 'packages', 'tool-edit'), { recursive: true })
  await writeFile(path.join(root, 'packages', 'hashline', 'package.json'), JSON.stringify({ name: '@dsh-tool-hashline/hashline', dependencies: { '@hy-sde-org/dsh-hashline': '0.2.1-alpha.4' } }, null, 2) + '\n', 'utf8')
  await writeFile(path.join(root, 'packages', 'tool-edit', 'package.json'), JSON.stringify({ name: '@dsh-tool-hashline/tool-edit', dependencies: { '@hy-sde-org/dsh-tool-edit': '0.2.1-alpha.4' } }, null, 2) + '\n', 'utf8')
  await writeFile(path.join(root, 'pnpm-lock.yaml'), [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    devDependencies:',
    "      '@deepseek-ai/cordis': 4.0.5-alpha.2",
    "      '@deepseek-ai/dsh-fs': 0.2.1-rc.2",
    "      '@deepseek-ai/dsh-tools': 0.2.1-rc.2",
    '',
    '  packages/hashline:',
    '    dependencies:',
    "      '@hy-sde-org/dsh-hashline': 0.2.1-alpha.4",
    '',
    '  packages/tool-edit:',
    '    dependencies:',
    "      '@hy-sde-org/dsh-tool-edit': 0.2.1-alpha.4",
    '',
    'packages:',
    '',
    "  '@deepseek-ai/cordis@4.0.5-alpha.2': {}",
    '',
    "  '@deepseek-ai/dsh-fs@0.2.1-rc.2': {}",
    '',
    "  '@deepseek-ai/dsh-tools@0.2.1-rc.2': {}",
    '',
    "  '@hy-sde-org/dsh-hashline@0.2.1-alpha.4': {}",
    '',
    "  '@hy-sde-org/dsh-tool-edit@0.2.1-alpha.4': {}",
    '',
  ].join('\n'), 'utf8')
  await writeFile(path.join(root, 'pnpm-workspace.yaml'), [
    'packages:',
    '  - "packages/*"',
    '',
    'patchedDependencies:',
    "  '@hy-sde-org/dsh-hashline@0.2.1-alpha.4': patches/@hy-sde-org__dsh-hashline@0.2.1-alpha.4.patch",
    "  '@hy-sde-org/dsh-tool-edit@0.2.1-alpha.4': patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch",
    '',
  ].join('\n'), 'utf8')
  await mkdir(path.join(root, 'patches'), { recursive: true })
  await writeFile(path.join(root, 'patches', '@hy-sde-org__dsh-hashline@0.2.1-alpha.4.patch'), 'fixture patch one\n', 'utf8')
  await writeFile(path.join(root, 'patches', '@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch'), 'fixture patch two\n', 'utf8')
  execFileSync('git', ['init', '-q', root], { stdio: 'ignore' })
  commitAll(root, 'fixture project')
  return root
}

/** Write the machine-local configuration exactly as the config command would. */
async function writeState(stateDir: string, values: Record<string, unknown>): Promise<string> {
  await mkdir(stateDir, { recursive: true })
  await writeFile(path.join(stateDir, 'config.json'), JSON.stringify(values, null, 2) + '\n', 'utf8')
  return stateDir
}

interface TreeEntry { path: string; sha256: string }

/** Every file under a tree (VCS internals excluded), with its digest. */
async function treeOf(root: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = []
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const absolute = path.join(directory, entry.name)
      const relative = prefix === '' ? entry.name : prefix + '/' + entry.name
      if (entry.isDirectory()) await walk(absolute, relative)
      else entries.push({ path: relative, sha256: createHash('sha256').update(await readFile(absolute)).digest('hex') })
    }
  }
  await walk(root, '')
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

describe('SYNC-01: the source path is chosen by a documented priority', () => {
  it('picks explicit, then DSH_CHECKOUT, then the machine-local configuration', async () => {
    const explicit = await dshCheckout()
    const environment = await dshCheckout()
    const configured = await dshCheckout()
    expect(resolveDshSource({ explicit, environment, configured }).origin).toBe('explicit')
    expect(resolveDshSource({ environment, configured }).origin).toBe('environment')
    expect(resolveDshSource({ configured }).origin).toBe('config')
  })

  it('reports a missing configuration instead of scanning the disk', () => {
    const resolution = resolveDshSource({})
    expect(resolution.status).toBe('missing')
    expect(resolution.origin).toBeNull()
    expect(resolution.reason).toContain('does not scan the disk')
    // Every layer is named as absent, so the maintainer knows what to provide.
    expect(resolution.attempts.map((attempt: { layer: string; status: string }) => attempt.layer + ':' + attempt.status))
      .toEqual(['explicit:absent', 'environment:absent', 'config:absent'])
  })

  it('refuses an unusable high-priority path and never falls through to the next layer', async () => {
    const environment = await dshCheckout()
    const configured = await dshCheckout()
    const missing = path.join(await temp('sync-absent-'), 'not-here')
    const resolution = resolveDshSource({ explicit: missing, environment, configured })
    expect(resolution.status).toBe('missing-path')
    expect(resolution.origin).toBe('explicit')
    // The lower layers were NOT probed: a fallback is exactly what is forbidden.
    expect(resolution.attempts.filter((attempt: { status: string }) => attempt.status === 'usable')).toHaveLength(0)
  })

  it('refuses a relative path instead of letting it mean the current directory', () => {
    const probe = probeCheckoutPath('relative/source', 'explicit')
    expect(probe.status).toBe('not-absolute')
    expect(probe.reason).toContain('absolute path')
  })

  it('refuses a directory that is not a DSH source tree', async () => {
    const empty = await temp('sync-not-a-checkout-')
    expect(probeCheckoutPath(empty, 'explicit').status).toBe('not-a-dsh-checkout')
    const other = await dshCheckout({ name: 'some-other-project' })
    const probe = probeCheckoutPath(other, 'explicit')
    expect(probe.status).toBe('not-a-dsh-checkout')
    expect(probe.reason).toContain('@deepseek-ai/dsh')
  })

  it('names a broken link as a broken link, and repairs nothing', async () => {
    const parent = await temp('sync-broken-link-')
    const target = path.join(parent, 'target')
    const link = path.join(parent, 'dsh-link')
    await mkdir(target, { recursive: true })
    try {
      await symlink(target, link, 'junction')
    } catch (error) {
      // A platform that refuses to create the link cannot be asked to break one.
      console.warn('symlink unavailable on this platform: ' + (error instanceof Error ? error.message : String(error)))
      return
    }
    await rm(target, { recursive: true, force: true })
    const probe = probeCheckoutPath(link, 'config')
    expect(probe.status).toBe('broken-link')
    expect(probe.reason).toContain('never creates or repairs')
  })
})

describe('SYNC-02: ordinary directories and user links, with honest identities', () => {
  it('resolves a user-maintained link and records both ends', async () => {
    const real = await dshCheckout()
    const parent = await temp('sync-link-')
    const link = path.join(parent, 'dsh')
    try {
      await symlink(real, link, 'junction')
    } catch (error) {
      console.warn('symlink unavailable on this platform: ' + (error instanceof Error ? error.message : String(error)))
      return
    }
    const resolution = resolveDshSource({ explicit: link })
    expect(resolution.status).toBe('resolved')
    expect(resolution.link).toBe(true)
    expect(resolution.inputPath).toBe(path.resolve(link))
    expect(resolution.resolvedPath).toBe(path.resolve(realpathSync(real)))
    const identity = inspectCheckout({ source: resolution, now: NOW })
    expect(identity.inputPath).not.toBe(identity.resolvedPath)
    expect(identity.resolvedPath).toBe(path.resolve(realpathSync(real)))
  })

  it('records commit, working-tree state and a local snapshot for a dirty tree', async () => {
    const root = await dshCheckout({ dirty: true })
    const head = gitText(root, ['rev-parse', 'HEAD']).trim()
    const identity = inspectCheckout({ source: resolveDshSource({ explicit: root }), now: NOW })
    expect(identity.vcs.commit).toBe(head)
    expect(identity.vcs.dirty).toBe('dirty')
    expect(identity.snapshot).toBe('local-modified')
    expect(identity.snapshotNote).toContain('不是上游已发布版本')
    expect(identity.files.every((file: { state: string }) => file.state === 'present')).toBe(true)
    expect(identity.declaration.version).toBe('0.2.1-rc.2')
  })

  it('marks the commit unknown when the source has no VCS, and says why', async () => {
    const root = await dshCheckout({ git: false })
    const identity = inspectCheckout({ source: resolveDshSource({ explicit: root }), now: NOW })
    expect(identity.vcs.commit).toBe('unknown')
    expect(identity.snapshot).toBe('unknown')
    expect(identity.unknown.join(' ')).toContain('DSH commit')
    // The manifest declaration is still a fact: the tree was identified.
    expect(identity.declaration.name).toBe('@deepseek-ai/dsh-root')
  })

  it('records a missing relevant input as missing, never as unchanged', async () => {
    const omitted = DEFAULT_RELEVANT_INPUTS[2]
    const root = await dshCheckout({ omit: omitted })
    const identity = inspectCheckout({ source: resolveDshSource({ explicit: root }), now: NOW })
    const entry = identity.files.find((file: { path: string }) => file.path === omitted)
    expect(entry).toBeDefined()
    expect(entry?.state).toBe('missing')
    expect(entry?.sha256).toBe('missing')
    expect(identity.unknown.join(' ')).toContain(omitted)
  })
})

describe('the public entry: one report, one record, nothing else touched (SYNC-08)', () => {
  it('writes exactly report.md and sync.json, and leaves both trees byte-identical', async () => {
    const root = await dshCheckout()
    const project = await projectTree()
    const state = await temp('sync-state-')
    const evidence = await temp('sync-evidence-')
    const sourceBefore = await treeOf(root)
    const projectBefore = await treeOf(project)

    const result = await runSyncCheck({
      env: {},
      now: NOW,
      checkout: root,
      repository: project,
      installationRoot: project,
      stateDir: state,
      evidenceDirectory: evidence,
      sources: ENGINE_SOURCES,
    })

    expect(await treeOf(root)).toEqual(sourceBefore)
    expect(await treeOf(project)).toEqual(projectBefore)

    // The evidence root holds one round and nothing else.
    expect(await readdir(evidence)).toEqual(['sync'])
    const rounds = await readdir(path.join(evidence, 'sync'))
    expect(rounds).toHaveLength(1)
    expect((await readdir(path.join(evidence, 'sync', rounds[0]))).sort()).toEqual(['report.md', 'sync.json'])

    // Exit 2 is the honest answer while comparison areas remain uncovered.
    expect(result.code).toBe(SYNC_EXIT.incomplete)
    expect(result.value.status).toBe('incomplete')
    expect(result.value.written).toHaveLength(2)
    expect(path.basename(result.value.evidence!.directory)).toBe(rounds[0])
  })

  it('reports the recorded source, the baseline and the uncovered areas consistently', async () => {
    const root = await dshCheckout({ dirty: true })
    const project = await projectTree()
    const state = await temp('sync-state-')
    const evidence = await temp('sync-evidence-')
    const result = await runSyncCheck({
      env: {},
      now: NOW,
      checkout: root,
      repository: project,
      installationRoot: project,
      stateDir: state,
      evidenceDirectory: evidence,
      sources: ENGINE_SOURCES,
    })
    const record = JSON.parse(await readFile(path.join(result.value.evidence!.directory, 'sync.json'), 'utf8'))
    const report = await readFile(path.join(result.value.evidence!.directory, 'report.md'), 'utf8')

    // The structured record carries the whole round.
    expect(record.tool).toBe('ptc-hashline-operations-sync')
    expect(record.version).toBe(1)
    expect(record.reportFormat).toBe('ptc-hashline-upstream-sync/1')
    expect(record.checkedAt).toBe(NOW)
    expect(record.checkId).toBe(path.basename(result.value.evidence!.directory))
    expect(record.source.resolvedPath).toBe(path.resolve(root))
    expect(record.source.snapshot).toBe('local-modified')
    expect(record.project.path).toBe(path.resolve(project))

    // The project baseline distinguishes all four kinds of dependency evidence.
    expect(record.project.declarations.anchors.hashline.declaredVersion).toBe('0.2.1-alpha.4')
    expect(record.project.locked.entries.map((entry: { specifier: string }) => entry.specifier)).toContain('@hy-sde-org/dsh-hashline')
    expect(record.project.patches.files).toHaveLength(2)
    expect(record.project.patches.bound).toHaveLength(2)
    expect(record.project.patches.problems).toEqual([])
    expect(record.project.locked.problems).toEqual([])

    // Coverage names what was compared and what was not. This fixture source
    // carries neither an upstream ptc preset nor the tool-fs read sources, so
    // both areas report themselves as incomplete with a named gap — the opposite
    // of "no change" — while the engines area is covered from the pinned answers.
    expect(record.coverage.map((area: { area: string; status: string }) => area.area + ':' + area.status)).toEqual([
      'source:covered',
      'ptc:incomplete',
      'stock-read:incomplete',
      'engines:covered',
    ])
    expect(record.status).toBe('incomplete')
    // The pinned engine answer publishes exactly the pinned version, so no update
    // is reported; only the patch items remain, and they stay pending.
    expect((record.differences as { area: string; disposition: string }[]).every(entry => entry.area === 'engines' && entry.disposition === 'pending-analysis')).toBe(true)
    expect((record.gaps as { id: string }[]).some(entry => entry.id === 'ptc.right')).toBe(true)
    expect((record.gaps as { id: string }[]).some(entry => entry.id === 'read.contract.parameters.args')).toBe(true)
    expect(record.coverage[0].checks).toBeGreaterThan(0)

    // The readable report and the record agree on the same facts.
    expect(report).toContain(record.checkId)
    expect(report).toContain(path.resolve(root))
    expect(report).toContain('不完整')
    // Both unfinished areas print their own status; the report never claims the
    // whole range was covered while they are incomplete.
    expect(report).toContain('incomplete')
    expect(report).toContain('未覆盖区域')
    expect(report).not.toContain('全部比较区域已覆盖')
  })

  it('answers read-only when the evidence directory is unusable (nothing is written)', async () => {
    const root = await dshCheckout()
    const project = await projectTree()
    const state = await writeState(await temp('sync-state-'), {
      evidenceDirectory: path.join(await temp('sync-gone-'), 'evidence'),
    })
    const result = await runSyncCheck({ env: {}, now: NOW, checkout: root, repository: project, installationRoot: project, stateDir: state, sources: ENGINE_SOURCES })
    expect(result.code).toBe(SYNC_EXIT.incomplete)
    expect(result.value.status).toBe('read-only')
    expect(result.value.written).toEqual([])
    expect(result.value.reason).toContain('证据目录不可用')
    // The analysis itself still came back.
    expect(result.value.check!.source.resolvedPath).toBe(path.resolve(root))
  })

  it('uses the machine-local configuration when no flag or environment variable is given', async () => {
    const root = await dshCheckout()
    const project = await projectTree()
    const evidence = await temp('sync-evidence-')
    const state = await writeState(await temp('sync-state-'), { evidenceDirectory: evidence, sync: { dshCheckout: root } })
    const result = await runSyncCheck({ env: {}, now: NOW, repository: project, installationRoot: project, stateDir: state, sources: ENGINE_SOURCES })
    expect(result.code).toBe(SYNC_EXIT.incomplete)
    expect(result.value.check!.source.origin).toBe('config')
    expect(result.value.written).toHaveLength(2)
  })

  it('stops with a named reason and writes nothing when no source is configured', async () => {
    const evidence = await temp('sync-evidence-')
    const state = await writeState(await temp('sync-state-'), { evidenceDirectory: evidence })
    const result = await runSyncCheck({ env: {}, now: NOW, stateDir: state })
    expect(result.code).toBe(SYNC_EXIT.incomplete)
    expect(result.value.status).toBe('stopped')
    expect(result.value.reason).toContain('DSH_CHECKOUT')
    expect(await readdir(evidence)).toEqual([])
  })

  it('runs as a child process through the shipped entry', async () => {
    const root = await dshCheckout()
    const project = await projectTree()
    const evidence = await temp('sync-evidence-')
    const home = await temp('sync-home-')
    await writeState(path.join(home, 'state', 'ptc-hashline-operations'), { evidenceDirectory: evidence })
    const outcome = await execFileAsync(process.execPath, [SCRIPT, '--checkout', root, '--now', NOW], {
      env: { ...process.env, DSH_HOME: home },
      encoding: 'utf8',
      cwd: project,
    }).then(
      (result) => ({ code: 0, stdout: String(result.stdout), stderr: String(result.stderr) }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({ code: error.code ?? -1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
    )
    expect(outcome.code).toBe(SYNC_EXIT.incomplete)
    const value = JSON.parse(outcome.stdout)
    expect(value.command).toBe('sync check')
    expect(value.check.source.resolvedPath).toBe(path.resolve(root))
    const record = JSON.parse(await readFile(path.join(value.evidence.directory, 'sync.json'), 'utf8'))
    expect(record.status).toBe('incomplete')
    // The child process ran against the fixture project as its maintenance repo.
    expect(record.project.path).toBe(path.resolve(project))
  })
})

describe('the public entry: usage refusals are visible and write nothing', () => {
  it('refuses an unknown flag and a positional argument', async () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown flag/u)
    expect(() => parseArgs(['stray'])).toThrow(/unexpected argument/u)
    expect(() => parseArgs(['--checkout'])).toThrow(/needs a value/u)
    expect(await syncMain(['--nope'])).toBe(SYNC_EXIT.refused)
    expect(await syncMain(['stray'])).toBe(SYNC_EXIT.refused)
  })

  it('prints its usage without touching anything', async () => {
    expect(await syncMain(['--help'])).toBe(SYNC_EXIT.ok)
  })

  it('saves the source path only when it is absolute', async () => {
    const state = await temp('sync-state-')
    await expect(saveDshCheckout({ directory: state, dshCheckout: 'relative/path' })).rejects.toThrow(/absolute path/u)
    const saved = await saveDshCheckout({ directory: state, dshCheckout: path.resolve(state) })
    expect(settingsOf(saved).dshCheckout).toBe(path.resolve(state))
    // The two documented roles are untouched by this namespace write.
    expect(saved.roles.evidenceDirectory.configured).toBe(false)
  })

  it('saves the namespace through the shared config command', async () => {
    const state = await temp('sync-state-')
    const source = await dshCheckout()
    const result = await runOperations(['config', '--set-dsh-checkout', source], { env: {}, stateDir: state })
    expect(result.code).toBe(0)
    expect(result.value.values.sync.dshCheckout).toBe(path.resolve(source))
    expect(result.value.roles.evidenceDirectory.configured).toBe(false)
  })
})

describe('three platforms: path, configuration and report logic stay executable', () => {
  it('treats a platform-qualified path as a refusal with a reason, never as a silent success', () => {
    // On Windows this names a directory that does not exist; on POSIX it is not an
    // absolute path at all. Both are refusals that name the input, and this suite
    // runs on whatever platform executes it. Only Windows is actually run today;
    // the other two keep a GAP until they do.
    const probe = probeCheckoutPath('C:\\work\\dsh-source', 'explicit')
    expect(probe.status).not.toBe('usable')
    expect(['not-absolute', 'missing-path']).toContain(probe.status)
    expect(String(probe.reason)).toContain('dsh-source')
  })

  it('keeps the record content-addressed and independent of key order', async () => {
    expect(stableJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe(stableJson({ a: [2, { c: 3, d: 4 }], b: 1 }))
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }))
    expect(hashOf({ a: 1 })).not.toBe(hashOf({ a: 2 }))

    const root = await dshCheckout()
    const project = await projectTree()
    const state = await temp('sync-state-')
    const evidence = await temp('sync-evidence-')
    const options = { env: {}, now: NOW, checkout: root, repository: project, installationRoot: project, stateDir: state, evidenceDirectory: evidence, sources: ENGINE_SOURCES }
    const first = await runSyncCheck(options)
    const second = await runSyncCheck(options)
    expect(second.value.check!.checkId).toBe(first.value.check!.checkId)
    // Same content in the same second is the SAME round identity, so the second
    // run must not overwrite the first: each round keeps its own directory.
    expect(second.value.evidence!.directory).not.toBe(first.value.evidence!.directory)
    await writeFile(path.join(root, ...DEFAULT_RELEVANT_INPUTS[1].split('/')), '// changed stock read source\n', 'utf8')
    const third = await runSyncCheck(options)
    expect(third.value.check!.checkId).not.toBe(first.value.check!.checkId)
    expect(third.value.check!.contentHash).not.toBe(first.value.check!.contentHash)
  })

  it('builds the repeat-check paths with the platform separator, not a hard-coded one', async () => {
    const root = await dshCheckout()
    const project = await projectTree()
    const state = await temp('sync-state-')
    const evidence = await temp('sync-evidence-')
    const result = await runSyncCheck({ env: {}, now: NOW, checkout: root, repository: project, installationRoot: project, stateDir: state, evidenceDirectory: evidence, sources: ENGINE_SOURCES })
    const history = (result.value.check as { history?: { decisions?: { path?: string } } }).history
    // The default decision path is joined with the platform separator, so the same
    // logic addresses <evidence>/sync/decisions.json on every platform. Only
    // Windows is actually run today; the other two keep their GAP.
    expect(history?.decisions?.path).toBe(path.join(evidence, 'sync', 'decisions.json'))
    expect(history?.decisions?.path?.split(path.sep).slice(-2).join('/')).toBe('sync/decisions.json')
  })
})
