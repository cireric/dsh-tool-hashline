/**
 * UPG-01/02/08/11: the read-only upgrade assessment of the three components.
 *
 * The seams are the ones tickets 02/03 established: the operations CLI
 * (`run(['upgrade', 'assess', ...])`) plus the three files it writes under
 * `<evidence>/upgrades/<stamp>/`, and — for the conclusion RULES themselves —
 * the assessment module's own assessUpgrade / aggregateConclusion entry points.
 *
 * Two boundaries are stated once here:
 * - Whether THIS checkout can resolve the official DSH host depends on the
 *   surrounding workspace (a sibling checkout may provide it), so no test lets
 *   that decide its result: the rule-level cases use a synthetic baseline, and
 *   the complete / unknown-baseline cases run against bundle fixtures that
 *   really do (or really do not) carry the host, through a real child process.
 * - Nothing in this suite touches a network: every metadata answer is a fixture
 *   (a --sources file / an injected query) or a failing runner.
 */
import { execFile, execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { HASHLINE_PATCH_MARKERS, TOOL_EDIT_PATCH_MARKERS } from '../../presets/ptc-hashline/operations/baseline.mjs'
import { EXIT, run } from '../../presets/ptc-hashline/operations/cli.mjs'
import { saveConfig } from '../../presets/ptc-hashline/operations/config.mjs'
import { encodeSegment, projectKey } from '../../presets/ptc-hashline/operations/session-log.mjs'
import {
  aggregateConclusion,
  assertReadOnly,
  assessUpgrade,
  compareVersions,
  createMetadataQueries,
  DSH_MANUAL_ACTIONS,
  IMPACT_SURFACE,
} from '../../presets/ptc-hashline/operations/upgrades.mjs'

const SESSION = 'session-upgrade-0001'
const WORKSPACE = '/work/upgrade-project'
const NOW = '2026-10-23T09:30:00.000Z'
/** upgradeDirectory's stamp for NOW (UTC). */
const STAMP = '20261023-093000'
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

/** Write one session's log under a sessions root (a fixture home for a child run). */
async function writeSession(root: string, preset: string | undefined): Promise<string> {
  const directory = path.join(root, projectKey(WORKSPACE), encodeSegment(SESSION))
  await mkdir(directory, { recursive: true })
  const header = { type: 'session', version: 4, id: SESSION, cwd: WORKSPACE, createdAt: 1, isSeeded: false, delegationDepth: 0, ...preset === undefined ? {} : { agentPreset: preset } }
  await writeFile(path.join(directory, 'session.v4.jsonl'), JSON.stringify(header) + '\n', 'utf8')
  return root
}

/** A fresh sessions root holding one session with the given preset projection. */
async function sessionsRoot(preset: string | undefined): Promise<string> {
  return writeSession(await temp('upgrade-sessions-'), preset)
}

interface Configured {
  state: string
  repository: string
  evidence: string
}

/** One maintenance worktree plus one evidence directory, saved as roles. */
async function configured(): Promise<Configured> {
  const state = await temp('upgrade-state-')
  const repository = await temp('upgrade-repo-')
  const evidence = await temp('upgrade-evidence-')
  execFileSync('git', ['init', '-q', repository])
  await writeFile(path.join(repository, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0' }, null, 2), 'utf8')
  await writeFile(path.join(repository, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')
  await mkdir(path.join(repository, 'patches'), { recursive: true })
  await writeFile(path.join(repository, 'patches', 'hashline.patch'), 'fixture patch\n', 'utf8')
  execFileSync('git', ['-C', repository, 'add', '.'])
  execFileSync('git', ['-C', repository, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'])
  await saveConfig({ directory: state, maintenanceRepository: repository, evidenceDirectory: evidence })
  return { state, repository, evidence }
}

/** One source record, verified unless the case says otherwise. */
function source(component: string, kind: 'release' | 'prerelease' | 'commit', fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { component, kind, status: 'verified', queriedAt: NOW, source: 'fixture:' + component, version: null, commit: null, url: null, ...fields }
}

/**
 * The three channels of one component: a stable release, no pre-release, and a
 * released branch head. Every one of them VERIFIED, which is what the
 * no-upgrade rule needs.
 */
function stableChannels(component: string, version: string, extra: Record<string, unknown> = {}): Record<string, unknown>[] {
  return [
    source(component, 'release', { version, url: 'https://example.invalid/' + component, ...extra }),
    source(component, 'prerelease', { version: null, detail: 'no pre-release dist-tag is published' }),
    source(component, 'commit', { commit: 'c0ffee0'.repeat(5), url: 'https://example.invalid/' + component, unreleased: false }),
  ]
}

/** Write a metadata fixture and return the file a --sources flag names. */
async function sourcesFile(records: Record<string, unknown>[]): Promise<string> {
  const dir = await temp('upgrade-sources-')
  const file = path.join(dir, 'sources.json')
  await writeFile(file, JSON.stringify({ note: 'pinned metadata fixture', records }, null, 2) + '\n', 'utf8')
  return file
}

function runAssess(root: string, state: string, argv: string[] = [], extra: Record<string, unknown> = {}) {
  return run(['upgrade', 'assess', ...argv], {
    env: { DSH_SESSION_ID: SESSION, PWD: WORKSPACE },
    sessionsRoot: root,
    stateDir: state,
    ...extra,
  })
}

type UpgradeRun = Awaited<ReturnType<typeof runAssess>>

/** The files one assessment wrote, or a loud failure: a test never passes silently. */
function filesOf(report: UpgradeRun): { directory: string; assessment: string; report: string; sources: string } {
  const evidence = report.value.evidence
  if (evidence === undefined) throw new Error('the upgrade command wrote no assessment: ' + String(report.value.status))
  return { directory: evidence.directory, ...evidence.files }
}

/** The per-component verdicts, or a loud failure. */
function componentsOf(report: UpgradeRun): NonNullable<UpgradeRun['value']['components']> {
  const components = report.value.components
  if (components === undefined) throw new Error('the upgrade command reported no components')
  return components
}

/** One component's verdict, by id. */
function componentOf(report: UpgradeRun, component: string): ReturnType<typeof componentsOf>[number] {
  const found = componentsOf(report).find(entry => entry.component === component)
  if (found === undefined) throw new Error('the assessment has no "' + component + '" component')
  return found
}

/** The aggregate and per-component conclusions, or a loud failure. */
function conclusionsOf(report: UpgradeRun): NonNullable<UpgradeRun['value']['conclusions']> {
  const conclusions = report.value.conclusions
  if (conclusions === undefined) throw new Error('the upgrade command reported no conclusions')
  return conclusions
}

/** One component of a module-level assessment, by id (a fixture failure must be loud). */
function assessedComponent(assessment: { components: { component: string }[] }, component: string): any {
  const found = assessment.components.find(entry => entry.component === component)
  if (found === undefined) throw new Error('the assessment has no "' + component + '" component')
  return found
}

/** A synthetic baseline with all three components resolved. */
function baselineFixture(versions: { dsh: string; hashline: string; toolEdit: string }, patchStatus = 'patched'): Record<string, unknown> {
  return {
    tool: 'ptc-hashline-operations-baseline',
    version: 1,
    collectedAt: NOW,
    roles: {
      installation: { root: '/install', packagePath: '/install/package.json' },
      maintenanceRepository: '/repo',
      upgradeTarget: 'unknown',
      note: 'fixture',
    },
    versions: { bundle: '0.0.0', dsh: versions.dsh },
    resolvedPaths: { dsh: '/install/node_modules/@deepseek-ai/dsh/package.json' },
    engines: {
      hashline: { version: versions.hashline, patch: { status: patchStatus } },
      toolEdit: { version: versions.toolEdit, patch: { status: patchStatus } },
    },
    realpaths: { hashline: '/install/node_modules/hashline', toolEdit: '/install/node_modules/tool-edit' },
    repository: { commit: 'abc1234', dirty: 'clean', changedPaths: [], lockfileSha256: 'unknown', patchFiles: [] },
    session: { provider: 'test', model: 'test', preset: 'ptc-hashline', presetSource: 'fixture' },
    unknown: [],
  }
}

/** One stable-release candidate that carries package text, so items can be decided. */
function candidate(component: string, version: string, files: Record<string, string>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return source(component, 'release', { version, url: 'https://example.invalid/' + component + '/' + version, files, ...extra })
}

/** The candidate package text in which only the named markers survive. */
function fileWith(markers: { file: string[]; marker: string }[], keep: string[]): Record<string, string> {
  const files: Record<string, string> = {}
  for (const entry of markers) {
    const key = entry.file.join('/')
    files[key] = files[key] ?? ''
    if (keep.includes(entry.marker)) files[key] += entry.marker + '\n'
  }
  return files
}

/** The entries of <evidence>/upgrades, sorted; empty when nothing was written. */
async function upgradeDirs(evidence: string): Promise<string[]> {
  try {
    return (await readdir(path.join(evidence, 'upgrades'))).sort()
  } catch {
    return []
  }
}

describe('UPG-01: sources, query time, and the three states of a version', () => {
  it('records every query with its time, its channel and its status', async () => {
    const { state, evidence } = await configured()
    const root = await sessionsRoot('ptc-hashline')
    const file = await sourcesFile([
      ...stableChannels('hashline', '0.2.1-alpha.5'),
      ...stableChannels('tool-edit', '0.2.1-alpha.5'),
      source('dsh', 'release', { version: '0.2.1-rc.2', url: 'https://example.invalid/dsh' }),
      source('dsh', 'prerelease', { version: '0.3.0-rc.1' }),
      source('dsh', 'commit', { commit: 'deadbeef'.repeat(5), unreleased: true }),
    ])
    const result = await runAssess(root, state, ['--sources', file, '--now', NOW])
    expect(result.value.status).toBe('assessed')
    // The exit code IS the completeness answer: 0 only when the evidence is complete.
    expect(result.code).toBe(result.value.complete === true ? EXIT.ok : EXIT.stopped)
    expect(await upgradeDirs(evidence)).toEqual([STAMP])
    const directory = path.join(evidence, 'upgrades', STAMP)
    expect((await readdir(directory)).sort()).toEqual(['assessment.json', 'report.md', 'sources.json'])

    const sources = await readJson(path.join(directory, 'sources.json'))
    expect(sources.records).toHaveLength(9)
    for (const record of sources.records) {
      expect(record.queriedAt).toBe(NOW)
      expect(['release', 'prerelease', 'commit']).toContain(record.kind)
      expect(['verified', 'unverified', 'unknown']).toContain(record.status)
      expect(typeof record.source).toBe('string')
    }
    // The stable release, the pre-release and the branch head are kept apart.
    const hashline = sources.records.filter((record: any) => record.component === 'hashline')
    expect(hashline.map((record: any) => record.kind).sort()).toEqual(['commit', 'prerelease', 'release'])
    expect(hashline.find((record: any) => record.kind === 'release').version).toBe('0.2.1-alpha.5')
    expect(hashline.find((record: any) => record.kind === 'prerelease').version).toBeNull()
    expect(hashline.find((record: any) => record.kind === 'commit').commit).toBe('c0ffee0'.repeat(5))
    // The channel reports keep the same three apart.
    const assessment = await readJson(path.join(directory, 'assessment.json'))
    const channels = assessment.components.find((component: any) => component.component === 'hashline').channels
    expect(Object.keys(channels).sort()).toEqual(['commit', 'prerelease', 'release'])
    expect(channels.release.status).toBe('verified')
    // A newer pre-release plus an unreleased commit can never be no-upgrade.
    expect(['recommend-candidate', 'defer']).toContain(conclusionsOf(result).dsh)
    const report = await readFile(path.join(directory, 'report.md'), 'utf8')
    expect(report).toContain('每次查询都留痕')
    expect(report).toContain('0.3.0-rc.1')
  })

  it('never writes "latest" when a query fails, and cannot conclude no-upgrade then', async () => {
    const { state, evidence } = await configured()
    const root = await sessionsRoot('ptc-hashline')
    // The provider fails the way an offline machine does.
    const failing = async () => {
      throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org')
    }
    const result = await runAssess(root, state, ['--now', NOW], { query: failing })
    expect(result.code).toBe(EXIT.stopped)
    expect(result.value.conclusion).toBe('insufficient-evidence')
    expect(result.value.verified).toBe(false)
    const directory = path.join(evidence, 'upgrades', STAMP)
    const sources = await readJson(path.join(directory, 'sources.json'))
    expect(sources.records).toHaveLength(9)
    for (const record of sources.records) {
      expect(record.status).toBe('unverified')
      expect(record.version).toBeNull()
      expect(String(record.detail)).toContain('metadata query failed')
    }
    const report = await readFile(path.join(directory, 'report.md'), 'utf8')
    expect(report).toContain('insufficient-evidence')
    expect(report).toContain('unverified')
    // No channel claims a version at all: an unavailable source never becomes
    // "the latest", neither in the data nor in the human report.
    const assessment = await readJson(path.join(directory, 'assessment.json'))
    for (const component of assessment.components) {
      expect(component.channels.release.version).toBeNull()
      expect(component.channels.prerelease.version).toBeNull()
      expect(component.latest.stable).toBeNull()
    }
    expect(await upgradeDirs(evidence)).toEqual([STAMP])
  })

  it('concludes no-upgrade only when all three verified stable channels did not move', () => {
    const baseline = baselineFixture({ dsh: '0.2.1-rc.2', hashline: '0.2.1-alpha.4', toolEdit: '0.2.1-alpha.4' })
    const records = [
      ...stableChannels('dsh', '0.2.1-rc.2'),
      ...stableChannels('hashline', '0.2.1-alpha.4'),
      ...stableChannels('tool-edit', '0.2.1-alpha.4'),
    ]
    const assessment = assessUpgrade({ baseline, records, now: NOW })
    expect(assessment.conclusion).toBe('no-upgrade')
    expect(assessment.complete).toBe(true)
    expect(assessment.verified).toBe(true)
    expect(assessment.components.every(component => component.recommended === false)).toBe(true)

    // One unavailable stable channel downgrades the same evidence to defer: an
    // absent source can never be overruled into "no update".
    const broken = records.filter(record => !(record.component === 'tool-edit' && record.kind === 'release'))
    broken.push(source('tool-edit', 'release', { status: 'unverified', detail: 'registry timeout' }))
    const downgraded = assessUpgrade({ baseline, records: broken, now: NOW })
    expect(downgraded.conclusion).toBe('defer')
    expect(downgraded.verified).toBe(false)
  })

  it('keeps the override order: insufficient-evidence beats defer, which beats a recommendation', () => {
    const at = (conclusion: string, channelsVerified = true) => ({ conclusion, channelsVerified }) as any
    expect(aggregateConclusion([at('no-upgrade'), at('recommend-candidate')])).toBe('recommend-candidate')
    expect(aggregateConclusion([at('recommend-candidate'), at('defer')])).toBe('defer')
    expect(aggregateConclusion([at('defer'), at('insufficient-evidence')])).toBe('insufficient-evidence')
    // The structural guard: a confident neighbour cannot rescue no-upgrade.
    expect(aggregateConclusion([at('no-upgrade'), at('no-upgrade', false)])).toBe('defer')
    // Pre-release precedence, so "the stable channel did not move" is expressible.
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1)
    expect(compareVersions('0.2.1-alpha.5', '0.2.1-alpha.4')).toBe(1)
  })

  it('defers when only a pre-release moved, and when a bound dependency is not ready', () => {
    const baseline = baselineFixture({ dsh: '0.2.1-rc.2', hashline: '0.2.1-alpha.4', toolEdit: '0.2.1-alpha.4' })
    const prereleaseOnly = [
      ...stableChannels('dsh', '0.2.1-rc.2'),
      source('hashline', 'release', { version: '0.2.1-alpha.4' }),
      source('hashline', 'prerelease', { version: '0.3.0-beta.1' }),
      source('hashline', 'commit', { commit: 'a'.repeat(40), unreleased: false }),
      ...stableChannels('tool-edit', '0.2.1-alpha.4'),
    ]
    const deferred = assessUpgrade({ baseline, records: prereleaseOnly, now: NOW })
    expect(deferred.conclusions.hashline).toBe('defer')
    expect(deferred.conclusion).toBe('defer')

    const bound = [
      ...stableChannels('dsh', '0.2.1-rc.2'),
      ...stableChannels('hashline', '0.2.1-alpha.5'),
      ...stableChannels('tool-edit', '0.2.1-alpha.5', { boundDependencies: [{ name: '@hy-sde-org/dsh-hashline', version: '0.2.1-alpha.5', ready: false }] }),
    ]
    const blocked = assessUpgrade({ baseline, records: bound, now: NOW })
    expect(blocked.conclusions['tool-edit']).toBe('defer')
    expect(assessedComponent(blocked, 'tool-edit').reason).toContain('绑定依赖未就绪')
  })

  it('caps a component at defer while any of its three channels is unverified', () => {
    const baseline = baselineFixture({ dsh: '0.2.1-rc.2', hashline: '0.2.1-alpha.4', toolEdit: '0.2.1-alpha.4' })
    // The stable channel is verified and did not move, but the pre-release
    // channel was never checked: an unchecked channel could still hide a newer
    // candidate, so the component may not claim "no update".
    const records = [
      ...stableChannels('dsh', '0.2.1-rc.2'),
      source('hashline', 'release', { version: '0.2.1-alpha.4' }),
      source('hashline', 'prerelease', { status: 'unverified', detail: 'registry timeout' }),
      source('hashline', 'commit', { commit: 'a'.repeat(40), unreleased: false }),
      ...stableChannels('tool-edit', '0.2.1-alpha.4'),
    ]
    const assessment = assessUpgrade({ baseline, records, now: NOW })
    const hashline = assessedComponent(assessment, 'hashline')
    expect(hashline.conclusion).toBe('defer')
    expect(hashline.reason).toContain('未核实')
    expect(assessment.conclusion).not.toBe('no-upgrade')
  })

  it('caps a recommendation at defer when the commit channel was never checked', () => {
    const baseline = baselineFixture({ dsh: '0.2.1-rc.2', hashline: '0.2.1-alpha.4', toolEdit: '0.2.1-alpha.4' })
    const records = [
      ...stableChannels('dsh', '0.2.1-rc.2'),
      candidate('hashline', '0.2.1-alpha.5', fileWith(HASHLINE_PATCH_MARKERS, HASHLINE_PATCH_MARKERS.map(entry => entry.marker))),
      source('hashline', 'prerelease', { version: null }),
      source('hashline', 'commit', { status: 'unverified', detail: 'git ls-remote failed' }),
      ...stableChannels('tool-edit', '0.2.1-alpha.4'),
    ]
    const assessment = assessUpgrade({ baseline, records, now: NOW })
    const hashline = assessedComponent(assessment, 'hashline')
    // The items themselves are decidable, but "keep" means "not replaced
    // upstream", and that evidence lives in the unchecked commit channel.
    expect(hashline.patches.every((item: any) => item.decision === 'keep')).toBe(true)
    expect(hashline.conclusion).toBe('defer')
    expect(hashline.recommended).toBe(false)
    expect(assessment.conclusion).toBe('defer')
  })

  it('defers on an unready bound dependency even when the baseline cannot be compared', () => {
    const baseline = baselineFixture({ dsh: '0.2.1-rc.2', hashline: 'unknown', toolEdit: '0.2.1-alpha.4' })
    const records = [
      ...stableChannels('dsh', '0.2.1-rc.2'),
      ...stableChannels('hashline', '0.2.1-alpha.5', { boundDependencies: [{ name: '@hy-sde-org/dsh-hashline', ready: false }] }),
      ...stableChannels('tool-edit', '0.2.1-alpha.4'),
    ]
    const assessment = assessUpgrade({ baseline, records, now: NOW })
    const hashline = assessedComponent(assessment, 'hashline')
    expect(hashline.pendingVerification).toBe(false)
    expect(hashline.conclusion).toBe('defer')
    expect(hashline.reason).toContain('绑定依赖未就绪')
  })
})

describe('UPG-02: the impact surface and the per-item patch decisions', () => {
  it('maps each component surface and decides every patch item from the candidate bytes', async () => {
    const { state } = await configured()
    const root = await sessionsRoot('ptc-hashline')
    const hashlineKept = HASHLINE_PATCH_MARKERS[0].marker
    const hashlineDeleted = HASHLINE_PATCH_MARKERS[1].marker
    const toolRedone = TOOL_EDIT_PATCH_MARKERS[3].marker
    const toolKept = TOOL_EDIT_PATCH_MARKERS.map(entry => entry.marker).filter(marker => marker !== toolRedone)
    const file = await sourcesFile([
      source('dsh', 'release', { version: '0.2.1-rc.2', areas: ['ptc', 'cancellation'] }),
      source('dsh', 'prerelease', { version: null }),
      source('dsh', 'commit', { commit: 'b'.repeat(40), unreleased: false }),
      // hashline: one marker survives, the other is now upstream's.
      candidate('hashline', '0.2.1-alpha.5', fileWith(HASHLINE_PATCH_MARKERS, [hashlineKept]), { areas: ['seen', 'commit'] }),
      source('hashline', 'prerelease', { version: null }),
      { ...source('hashline', 'commit', { commit: 'd'.repeat(40), unreleased: false }), covers: [hashlineDeleted], detail: 'upstream reworked the snapshot commit path' },
      // tool-edit: everything survives except one hunk, which must be re-cut.
      candidate('tool-edit', '0.2.1-alpha.5', fileWith(TOOL_EDIT_PATCH_MARKERS, toolKept), { areas: ['mv', 'bom'] }),
      source('tool-edit', 'prerelease', { version: null }),
      source('tool-edit', 'commit', { commit: 'e'.repeat(40), unreleased: false }),
    ])
    const result = await runAssess(root, state, ['--sources', file, '--now', NOW])
    const hashline = componentOf(result, 'hashline')
    const toolEdit = componentOf(result, 'tool-edit')

    // Every patch item carries a decision, per component.
    expect(hashline.patches).toEqual([
      { file: 'dist/patcher.js', decision: 'keep' },
      { file: 'dist/patcher.js', decision: 'delete' },
    ])
    expect(toolEdit.patches.map(item => item.decision)).toEqual(['keep', 'keep', 'keep', 'redo', 'keep'])
    expect(result.value.conclusion).toBe('recommend-candidate')
    expect(hashline.recommended).toBe(true)
    expect(toolEdit.recommended).toBe(true)

    const written = await readJson(filesOf(result).assessment)
    const assessedHashline = written.components.find((component: any) => component.component === 'hashline')
    const keep = assessedHashline.patches.find((item: any) => item.decision === 'keep')
    const remove = assessedHashline.patches.find((item: any) => item.decision === 'delete')
    // The literal marker text is pinned, so a drifted marker list fails here.
    expect(keep.marker).toBe('authorizes the snapshot migration')
    expect(keep.reason).toContain('仍含该标记')
    expect(remove.marker).toBe('bookkeeping did not complete')
    expect(remove.reason).toContain('已实现同一行为')
    const redo = written.components.find((component: any) => component.component === 'tool-edit').patches.find((item: any) => item.decision === 'redo')
    expect(redo.reason).toContain('重做')
    // Every item states a reason, so a decision is never bare.
    for (const component of written.components) {
      for (const item of component.patches) expect(item.reason.length).toBeGreaterThan(10)
    }

    // The impact surface is mapped from the spec, not from the diff alone.
    expect(assessedHashline.impact.surface).toEqual(IMPACT_SURFACE.hashline)
    expect(assessedHashline.impact.affected).toEqual(['seen', 'commit'])
    expect(written.components.find((component: any) => component.component === 'dsh').impact.surface).toEqual(IMPACT_SURFACE.dsh)
    expect(written.components.find((component: any) => component.component === 'tool-edit').impact.surface).toEqual(IMPACT_SURFACE['tool-edit'])

    const report = await readFile(filesOf(result).report, 'utf8')
    expect(report).toContain('逐项补丁决策')
    expect(report).toContain('keep = ')
  })

  it('defers when a newer release cannot have its patch items decided', () => {
    const baseline = baselineFixture({ dsh: '0.2.1-rc.2', hashline: '0.2.1-alpha.4', toolEdit: '0.2.1-alpha.4' })
    // A newer stable release, but no candidate package text: the items cannot be
    // decided, and "a newer version exists" alone is not a recommendation.
    const withoutFiles = [
      ...stableChannels('dsh', '0.2.1-rc.2'),
      ...stableChannels('hashline', '0.2.1-alpha.5'),
      ...stableChannels('tool-edit', '0.2.1-alpha.4'),
    ]
    const assessment = assessUpgrade({ baseline, records: withoutFiles, now: NOW })
    const hashline = assessedComponent(assessment, 'hashline')
    expect(hashline.patches.every((item: any) => item.decision === 'pending-verification')).toBe(true)
    expect(hashline.conclusion).toBe('defer')
    expect(assessment.conclusion).toBe('defer')
  })
})

describe('UPG-08: the official DSH receives advice, never an action', () => {
  it('reports impact and manual steps, and leaves a real official install byte-identical', async () => {
    const { state, repository, evidence } = await configured()
    const root = await sessionsRoot('ptc-hashline')
    // A stand-in for the user's own official DSH installation.
    const official = await temp('upgrade-official-')
    await writeFile(path.join(official, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0' }, null, 2), 'utf8')
    await mkdir(path.join(official, 'apps', 'web'), { recursive: true })
    await writeFile(path.join(official, 'apps', 'web', 'index.js'), 'console.log("official")\n', 'utf8')
    const beforeOfficial = await snapshot(official)
    const beforeRepository = await snapshot(repository)

    const file = await sourcesFile([
      source('dsh', 'release', { version: '0.3.0', url: 'https://example.invalid/dsh/0.3.0', areas: ['ptc', 'session'] }),
      source('dsh', 'prerelease', { version: null }),
      source('dsh', 'commit', { commit: 'f'.repeat(40), unreleased: false }),
      ...stableChannels('hashline', '0.2.1-alpha.4'),
      ...stableChannels('tool-edit', '0.2.1-alpha.4'),
    ])
    const result = await runAssess(root, state, ['--sources', file, '--now', NOW])
    expect(conclusionsOf(result).dsh).toBe('recommend-candidate')
    const assessment = await readJson(filesOf(result).assessment)
    const dsh = assessment.components.find((component: any) => component.component === 'dsh')
    expect(dsh.execution).toBe('manual')
    expect(dsh.manualActions).toEqual(DSH_MANUAL_ACTIONS)
    expect(dsh.patches).toEqual([])
    const report = await readFile(filesOf(result).report, 'utf8')
    expect(report).toContain('官方 DSH：影响与人工处理建议')
    expect(report).toContain('不 checkout、不 install、不修改官方 DSH 的全局安装')
    // The official installation and the maintenance worktree are untouched.
    expect(await snapshot(official)).toEqual(beforeOfficial)
    expect(await snapshot(repository)).toEqual(beforeRepository)
    expect((await readdir(evidence)).sort()).toEqual(['upgrades'])
    expect(await upgradeDirs(evidence)).toEqual([STAMP])
  })
})

describe('UPG-11: a key baseline that is unknown still yields a report', () => {
  it('delivers a pending candidate and never calls itself verified', async () => {
    // A bundle install that genuinely does NOT carry the official host: its
    // version is honestly unknown, which is exactly UPG-11's key-baseline gap.
    const bundle = await bundleFixture({ dsh: null, hashline: '0.2.1-alpha.4', toolEdit: '0.2.1-alpha.4' })
    const home = await temp('upgrade-home-')
    const evidence = await temp('upgrade-evidence-')
    const state = path.join(home, 'state', 'ptc-hashline-operations')
    await mkdir(state, { recursive: true })
    await writeFile(path.join(state, 'config.json'), JSON.stringify({ evidenceDirectory: evidence }, null, 2), 'utf8')
    await writeSession(path.join(home, 'sessions'), 'ptc-hashline')
    const file = await sourcesFile([
      source('dsh', 'release', { version: '0.3.0' }),
      source('dsh', 'prerelease', { version: null }),
      source('dsh', 'commit', { commit: 'a'.repeat(40), unreleased: false }),
      ...stableChannels('hashline', '0.2.1-alpha.4'),
      ...stableChannels('tool-edit', '0.2.1-alpha.4'),
    ])
    const result = await runBundleChild(bundle, ['upgrade', 'assess', '--sources', file, '--now', NOW], {
      DSH_HOME: home,
      DSH_SESSION_ID: SESSION,
      PWD: WORKSPACE,
    })
    expect(result.code).toBe(EXIT.stopped)
    expect(result.json.pendingVerification).toBe(true)
    expect(result.json.verified).toBe(false)
    const directory = path.join(evidence, 'upgrades', STAMP)
    const assessment = await readJson(path.join(directory, 'assessment.json'))
    const dsh = assessedComponent(assessment, 'dsh')
    expect(dsh.baseline.version).toBe('unknown')
    expect(dsh.conclusion).toBe('recommend-candidate')
    expect(dsh.pendingVerification).toBe(true)
    expect(dsh.verified).toBe(false)
    expect(dsh.recommended).toBe(false)
    // Nothing is marked verified, nothing is switched, no success is announced.
    expect(assessment.conclusion).not.toBe('no-upgrade')
    expect(assessment.verified).toBe(false)
    expect(assessment.complete).toBe(false)
    expect(assessment.scope.switched).toBe(false)
    expect(assessment.scope.announcedSuccess).toBe(false)
    expect(assessment.scope.installed).toBe(false)
    expect(assessment.target.path).toBe('unknown')
    const report = await readFile(path.join(directory, 'report.md'), 'utf8')
    expect(report).toContain('待验证')
    expect(report).not.toContain('已核实：是')
    expect(report).not.toContain('已升级')
  })

  it('keeps the per-item decisions when the patch evidence itself is unknown', () => {
    const baseline = baselineFixture({ dsh: '0.2.1-rc.2', hashline: 'unknown', toolEdit: '0.2.1-alpha.4' }, 'unknown')
    const records = [
      ...stableChannels('dsh', '0.2.1-rc.2'),
      candidate('hashline', '0.2.1-alpha.5', fileWith(HASHLINE_PATCH_MARKERS, HASHLINE_PATCH_MARKERS.map(entry => entry.marker))),
      source('hashline', 'prerelease', { version: null }),
      source('hashline', 'commit', { commit: 'a'.repeat(40), unreleased: false }),
      ...stableChannels('tool-edit', '0.2.1-alpha.4'),
    ]
    const assessment = assessUpgrade({ baseline, records, now: NOW })
    const hashline = assessedComponent(assessment, 'hashline')
    expect(hashline.baseline.version).toBe('unknown')
    expect(hashline.pendingVerification).toBe(true)
    expect(hashline.patches.map((item: any) => item.decision)).toEqual(['keep', 'keep'])
    expect(assessment.verified).toBe(false)
  })
})

describe('the consent boundary: only local evaluation files, no upgrade side effects', () => {
  it('writes exactly three files and leaves the maintenance worktree untouched', async () => {
    const { state, repository, evidence } = await configured()
    const root = await sessionsRoot('ptc-hashline')
    const before = await snapshot(repository)
    const statusBefore = execFileSync('git', ['-C', repository, 'status', '--porcelain=v1'], { encoding: 'utf8' })
    const file = await sourcesFile([
      ...stableChannels('dsh', '0.2.1-rc.2'),
      candidate('hashline', '0.2.1-alpha.5', fileWith(HASHLINE_PATCH_MARKERS, HASHLINE_PATCH_MARKERS.map(entry => entry.marker))),
      source('hashline', 'prerelease', { version: null }),
      source('hashline', 'commit', { commit: 'a'.repeat(40), unreleased: false }),
      ...stableChannels('tool-edit', '0.2.1-alpha.5'),
    ])
    const result = await runAssess(root, state, ['--sources', file, '--now', NOW])
    expect(result.value.status).toBe('assessed')
    expect(result.code).toBe(result.value.complete === true ? EXIT.ok : EXIT.stopped)
    expect(await snapshot(repository)).toEqual(before)
    expect(execFileSync('git', ['-C', repository, 'status', '--porcelain=v1'], { encoding: 'utf8' })).toBe(statusBefore)
    // Only the assessment directory appeared, and it holds exactly three files.
    expect((await readdir(evidence)).sort()).toEqual(['upgrades'])
    expect((await readdir(filesOf(result).directory)).sort()).toEqual(['assessment.json', 'report.md', 'sources.json'])
    const assessment = await readJson(filesOf(result).assessment)
    expect(assessment.scope).toMatchObject({
      wrote: 'local-evaluation-report-only',
      mutated: [],
      installed: false,
      built: false,
      switched: false,
      announcedSuccess: false,
    })
    const report = await readFile(filesOf(result).report, 'utf8')
    expect(report).toContain('未修改 manifest / lockfile / patch / dist / profile')
    expect(report).toContain('未获用户同意前不进入方案、候选安装与目标切换')
    // No candidate package text is copied into the evidence.
    const sources = await readFile(filesOf(result).sources, 'utf8')
    expect(sources).not.toContain('authorizes the snapshot migration')
    expect(sources).toContain('candidateFiles')
  })

  it('answers complete with exit 0 through a real bundle that carries all three components', async () => {
    const bundle = await bundleFixture({ dsh: '0.3.0', hashline: '0.2.1-alpha.4', toolEdit: '0.2.1-alpha.4' })
    const home = await temp('upgrade-home-')
    const evidence = await temp('upgrade-evidence-')
    const state = path.join(home, 'state', 'ptc-hashline-operations')
    await mkdir(state, { recursive: true })
    await writeFile(path.join(state, 'config.json'), JSON.stringify({ evidenceDirectory: evidence }, null, 2), 'utf8')
    // The child verifies the invocation context from the host-managed facts, so
    // the fixture home must hold this session's own ptc-hashline projection.
    await writeSession(path.join(home, 'sessions'), 'ptc-hashline')
    const file = await sourcesFile([
      ...stableChannels('dsh', '0.3.0'),
      ...stableChannels('hashline', '0.2.1-alpha.4'),
      ...stableChannels('tool-edit', '0.2.1-alpha.4'),
    ])
    const result = await runBundleChild(bundle, ['upgrade', 'assess', '--sources', file, '--now', NOW], {
      DSH_HOME: home,
      DSH_SESSION_ID: SESSION,
      PWD: WORKSPACE,
    })
    expect(result.code).toBe(EXIT.ok)
    expect(result.json.conclusion).toBe('no-upgrade')
    expect(result.json.complete).toBe(true)
    expect(result.json.verified).toBe(true)
    expect(await upgradeDirs(evidence)).toEqual([STAMP])
  })

  it('stops before anything is queried or written when the mode is wrong', async () => {
    const { state, evidence } = await configured()
    const root = await sessionsRoot('standard')
    let queried = 0
    const result = await runAssess(root, state, ['--now', NOW], {
      query: async () => {
        queried += 1
        return []
      },
    })
    expect(result.code).toBe(EXIT.stopped)
    expect(result.value.status).toBe('stopped')
    expect(result.value.reason).toContain('wrong-preset')
    expect(queried).toBe(0)
    expect(await upgradeDirs(evidence)).toEqual([])
  })

  it('writes nothing when the evidence directory is not configured', async () => {
    const state = await temp('upgrade-state-')
    const root = await sessionsRoot('ptc-hashline')
    const file = await sourcesFile([...stableChannels('hashline', '0.2.1-alpha.5')])
    const result = await runAssess(root, state, ['--sources', file, '--now', NOW])
    expect(result.code).toBe(EXIT.stopped)
    expect(result.value.status).toBe('read-only')
    expect(result.value.reason).toContain('evidenceDirectory')
    // The read-only analysis still answered, and nothing was written.
    expect(result.value.conclusion).toBeDefined()
    expect(result.value.evidence).toBeUndefined()
    expect(await readdir(state)).toEqual([])
  })

  it('names an unusable maintenance role in the gaps instead of dropping its cause', async () => {
    const state = await temp('upgrade-state-')
    const evidence = await temp('upgrade-evidence-')
    // Only the evidence directory is configured; the maintenance role is not.
    await saveConfig({ directory: state, evidenceDirectory: evidence })
    const root = await sessionsRoot('ptc-hashline')
    const file = await sourcesFile([...stableChannels('hashline', '0.2.1-alpha.5')])
    const result = await runAssess(root, state, ['--sources', file, '--now', NOW])
    expect((result.value.gaps ?? []).join(' ')).toContain('maintenance repository:')
    const report = await readFile(filesOf(result).report, 'utf8')
    expect(report).toContain('maintenance repository: configuration role')
  })

  it('reports a write failure as incomplete, not as a usage error', async () => {
    const { state, evidence } = await configured()
    const root = await sessionsRoot('ptc-hashline')
    // A FILE where the upgrades directory has to be: the write cannot succeed.
    await writeFile(path.join(evidence, 'upgrades'), 'not a directory\n', 'utf8')
    const file = await sourcesFile([...stableChannels('hashline', '0.2.1-alpha.5')])
    const result = await runAssess(root, state, ['--sources', file, '--now', NOW])
    expect(result.code).toBe(EXIT.stopped)
    expect(result.value.status).toBe('incomplete')
    expect(String(result.value.reason)).toContain('could not be written')
    // Nothing was invented in place of the report, and no claim of success.
    expect(result.value.evidence).toBeUndefined()
    expect(result.value.complete).not.toBe(true)
  })

  it('does not start an upgrade, or query anything, from an incident run', async () => {
    const { state, evidence } = await configured()
    const root = await sessionsRoot('ptc-hashline')
    let queried = 0
    const incident = await run(['incident', '--target-session', SESSION, '--now', NOW], {
      env: { DSH_SESSION_ID: SESSION, PWD: WORKSPACE },
      sessionsRoot: root,
      stateDir: state,
      query: async () => {
        queried += 1
        return []
      },
    })
    expect(incident.value.status).toBeDefined()
    expect(queried).toBe(0)
    expect(await upgradeDirs(evidence)).toEqual([])
    expect((await readdir(evidence)).sort()).toEqual(['incidents'])
    // The upgrade path is only reachable through its own explicit command.
    const file = await sourcesFile([...stableChannels('hashline', '0.2.1-alpha.5')])
    await runAssess(root, state, ['--sources', file, '--now', NOW])
    expect(await upgradeDirs(evidence)).toEqual([STAMP])
  })
})

describe('usage and the read-only query provider', () => {
  it('refuses an unknown subcommand, a bare flag and an unknown target', async () => {
    const { state } = await configured()
    const root = await sessionsRoot('ptc-hashline')
    await expect(run(['upgrade'], { env: { DSH_SESSION_ID: SESSION, PWD: WORKSPACE }, sessionsRoot: root, stateDir: state }))
      .rejects.toThrow(/expected assess/u)
    await expect(runAssess(root, state, ['--sources'])).rejects.toThrow(/needs a value/u)
    await expect(runAssess(root, state, ['--target', 'nonsense'])).rejects.toThrow(/--target must be one of/u)
    await expect(runAssess(root, state, ['--sources', '{"records":[{"component":"nope"}]}'])).rejects.toThrow(/unknown component/u)
    // One channel has one answer: a duplicated channel is refused, not half-read.
    await expect(runAssess(root, state, ['--sources', JSON.stringify({ records: [
      source('hashline', 'release', { version: '0.2.1-alpha.5' }),
      source('hashline', 'release', { version: '0.2.1-alpha.6' }),
    ] })])).rejects.toThrow(/same channel/u)
  })

  it('reads records inline as well as from a file', async () => {
    const { state } = await configured()
    const root = await sessionsRoot('ptc-hashline')
    const inline = JSON.stringify({ records: [...stableChannels('hashline', '0.2.1-alpha.5')] })
    const result = await runAssess(root, state, ['--sources', inline, '--now', NOW])
    const written = await readJson(filesOf(result).sources)
    expect(written.records.find((record: any) => record.component === 'hashline' && record.kind === 'release').version).toBe('0.2.1-alpha.5')
    // The inline records were read; a newer release without candidate text still
    // cannot have its patch items decided, so this component defers.
    expect(conclusionsOf(result).hashline).toBe('defer')
  })

  it('runs only read-only metadata commands and records a failure as unverified', async () => {
    const commands: string[] = []
    const failing = createMetadataQueries({
      now: NOW,
      packages: { hashline: '@hy-sde-org/dsh-hashline' },
      repositories: { hashline: 'https://example.invalid/hashline.git' },
      runner: (command, args) => {
        commands.push(command + ' ' + args.join(' '))
        throw new Error('offline')
      },
    })
    const records = await failing('hashline')
    expect(records.map(record => record.kind).sort()).toEqual(['commit', 'prerelease', 'release'])
    for (const record of records) {
      expect(record.status).toBe('unverified')
      expect(record.queriedAt).toBe(NOW)
      expect(String(record.detail)).toContain('offline')
    }
    // Only the npm view and git ls-remote verbs were ever attempted.
    const allowed = commands.every(command => (command.startsWith('npm') && command.includes(' view ')) || (command.startsWith('git') && command.includes(' ls-remote ')))
    expect(allowed).toBe(true)
    expect(commands.length).toBeGreaterThan(0)
    // The allow-list refuses an install before any process is started.
    expect(() => assertReadOnly('npm', 'install')).toThrow(/read-only allow-list/u)

    const answered = createMetadataQueries({
      now: NOW,
      packages: { hashline: '@hy-sde-org/dsh-hashline' },
      repositories: { hashline: 'https://example.invalid/hashline.git' },
      runner: (command, args) => {
        if (command.startsWith('npm') && args.includes('dist-tags')) return JSON.stringify({ latest: '0.2.1-alpha.5', next: '0.3.0-beta.1' })
        return 'a'.repeat(40) + '\trefs/heads/main\n'
      },
    })
    const verified = await answered('hashline')
    expect(verified.find(record => record.kind === 'release')?.version).toBe('0.2.1-alpha.5')
    expect(verified.find(record => record.kind === 'prerelease')?.version).toBe('0.3.0-beta.1')
    expect(verified.find(record => record.kind === 'commit')?.commit).toBe('a'.repeat(40))
    // A head is reported; whether it is released stays 'unknown', never guessed.
    expect(verified.find(record => record.kind === 'commit')?.unreleased).toBe('unknown')
  })

  it('decides whether the branch head is a published release from the tag listing', async () => {
    const head = 'a'.repeat(40)
    const other = 'b'.repeat(40)
    const queryFrom = (refs: string) => createMetadataQueries({
      now: NOW,
      packages: { hashline: '@hy-sde-org/dsh-hashline' },
      repositories: { hashline: 'https://example.invalid/hashline.git' },
      runner: (command, args) => (command.startsWith('npm') && args.includes('dist-tags')
        ? JSON.stringify({ latest: '0.2.1-alpha.5' })
        : refs),
    })('hashline')
    // The head IS the release tag's commit: the head is a published release.
    const published = await queryFrom([head + '\trefs/heads/main', head + '\trefs/tags/v0.2.1-alpha.5'].join('\n'))
    expect(published.find(record => record.kind === 'commit')?.unreleased).toBe(false)
    expect(published.find(record => record.kind === 'release')?.commit).toBe(head)
    // The head is AHEAD of the release tag: unreleased commits exist.
    const ahead = await queryFrom([head + '\trefs/heads/main', other + '\trefs/tags/v0.2.1-alpha.5'].join('\n'))
    expect(ahead.find(record => record.kind === 'commit')?.unreleased).toBe(true)
    expect(String(ahead.find(record => record.kind === 'commit')?.detail)).toContain('v0.2.1-alpha.5')
    // No matching tag: published or not stays unknown, never guessed.
    const untagged = await queryFrom([head + '\trefs/heads/main'].join('\n'))
    expect(untagged.find(record => record.kind === 'commit')?.unreleased).toBe('unknown')
    expect(untagged.find(record => record.kind === 'release')?.commit).toBeNull()
  })

  it('refuses an unknown channel status instead of reading it as unqueried', async () => {
    const { state } = await configured()
    const root = await sessionsRoot('ptc-hashline')
    await expect(runAssess(root, state, ['--sources', JSON.stringify({ records: [
      { component: 'hashline', kind: 'release', status: 'verifed', version: '0.2.1-alpha.5' },
    ] })])).rejects.toThrow(/unknown status/u)
  })
})

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

/**
 * A bundle install that really carries all three components.
 *
 * The baseline collector resolves every component through the bundle's own
 * location, so this fixture is what makes a COMPLETE assessment possible at the
 * CLI seam -- and it exercises the real resolution path, marker reading included.
 */
async function bundleFixture(versions: { dsh: string | null; hashline: string; toolEdit: string }): Promise<string> {
  const root = await temp('upgrade-bundle-')
  await cp(path.resolve(process.cwd(), 'presets', 'ptc-hashline', 'operations'), path.join(root, 'presets', 'ptc-hashline', 'operations'), { recursive: true })
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'dsh-tool-hashline',
    version: '0.0.0',
    type: 'module',
    exports: { './package.json': './package.json', './presets/*': './presets/*' },
  }, null, 2), 'utf8')
  // A null dsh version means the bundle does NOT carry the official host, which
  // is how "a key baseline is unknown" is reproduced deterministically.
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

/**
 * Run the copied bundle's CLI as a real child process.
 *
 * NODE_PATH is dropped on purpose: pnpm injects its own store into it, and a
 * package that only exists in that store must not decide whether the FIXTURE
 * bundle carries the official host. The fixture's own resolution is the answer
 * under test, exactly as in a real install.
 */
async function runBundleChild(bundle: string, argv: string[], env: Record<string, string>): Promise<{ code: number; json?: any; stderr: string }> {
  const cli = path.join(bundle, 'presets', 'ptc-hashline', 'operations', 'cli.mjs')
  const { NODE_PATH: _nodePath, ...inherited } = process.env
  try {
    const { stdout } = await execFileAsync(process.execPath, [cli, ...argv], { env: { ...inherited, ...env }, encoding: 'utf8' })
    return { code: 0, json: JSON.parse(stdout), stderr: '' }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    const stdout = (failure.stdout ?? '').trim()
    return { code: failure.code ?? -1, json: stdout === '' ? undefined : JSON.parse(stdout), stderr: failure.stderr ?? '' }
  }
}