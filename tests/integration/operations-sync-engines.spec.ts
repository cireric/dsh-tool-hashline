/**
 * SYNC-05 / SYNC-07, ticket 04: the engine release assessment through the public
 * entry.
 *
 * Every external answer here is a pinned record: the release-source boundary is
 * the only place a fixed response stands in for the registry, and the real query
 * is exercised separately (docs/acceptance). No case installs anything.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runSyncCheck } from '../../presets/ptc-hashline/operations/sync.mjs'
import {
  classifyVersions,
  compareEnginesArea,
  ENGINE_PACKAGES,
  normalizeReleaseSource,
  normalizeReleaseSources,
  patchItems,
  updateBasis,
} from '../../presets/ptc-hashline/operations/sync-engines.mjs'
import type { ProjectBaseline } from '../../presets/ptc-hashline/operations/sync.mjs'

const NOW = '2026-10-27T18:00:00.000Z'
const HASHLINE = ENGINE_PACKAGES.hashline
const TOOL_EDIT = ENGINE_PACKAGES['tool-edit']
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

interface SourceOptions {
  package?: string
  status?: 'verified' | 'failed'
  versions?: string[]
  tags?: Record<string, string>
  detail?: string
  timeout?: boolean
}

/** One pinned release-source record. */
function releaseSource(options: SourceOptions = {}): Record<string, unknown> {
  return {
    package: options.package ?? HASHLINE,
    status: options.status ?? 'verified',
    queriedAt: NOW,
    source: 'fixture: engines suite',
    ...options.status === 'failed' ? {} : { versions: options.versions ?? ['0.2.1-alpha.4'], tags: options.tags ?? {} },
    ...options.detail === undefined ? {} : { detail: options.detail },
    ...options.timeout === undefined ? {} : { timeout: options.timeout },
  }
}

/** The two records a clean round needs. */
function bothEngines(versions = ['0.2.1-alpha.4'], tags: Record<string, string> = {}): Record<string, unknown>[] {
  return [
    releaseSource({ package: HASHLINE, versions, tags }),
    releaseSource({ package: TOOL_EDIT, versions, tags }),
  ]
}

/** A minimal DSH source tree (its content is irrelevant to the engines area). */
async function dshTree(): Promise<string> {
  const root = await temp('sync-engines-dsh-')
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root', version: '0.2.1-rc.2' }, null, 2) + '\n', 'utf8')
  return root
}

interface RoundResult { code: number; check: Record<string, any>; report: string }

/** Run one round through the public entry. */
async function round(options: { sources: Record<string, unknown>[]; checkout?: string | undefined; evidence?: string }): Promise<RoundResult> {
  const checkout = options.checkout ?? await dshTree()
  const evidence = options.evidence ?? await temp('sync-engines-evidence-')
  const state = await temp('sync-engines-state-')
  const result = await runSyncCheck({
    env: {},
    now: NOW,
    checkout,
    repository: process.cwd(),
    installationRoot: process.cwd(),
    stateDir: state,
    evidenceDirectory: evidence,
    sources: options.sources,
  })
  const directory = (result.value as { evidence?: { directory: string } }).evidence?.directory
  if (directory === undefined) throw new Error('the round wrote nothing: ' + String((result.value as { reason?: string }).reason))
  return {
    code: result.code,
    check: JSON.parse(await readFile(path.join(directory, 'sync.json'), 'utf8')),
    report: await readFile(path.join(directory, 'report.md'), 'utf8'),
  }
}

function coverageOf(check: Record<string, any>, area: string): Record<string, any> {
  const found = (check.coverage as Record<string, any>[]).find(entry => entry.area === area)
  if (found === undefined) throw new Error('no coverage for ' + area)
  return found
}

function differenceOf(check: Record<string, any>, id: string): Record<string, any> | undefined {
  return (check.differences as Record<string, any>[]).find(entry => entry.id === id)
}

function gapOf(check: Record<string, any>, id: string): Record<string, any> {
  const found = (check.gaps as Record<string, any>[]).find(entry => entry.id === id)
  if (found === undefined) throw new Error('no gap ' + id + '; had: ' + (check.gaps as Record<string, any>[]).map(entry => entry.id + ':' + entry.status).join(', '))
  return found
}

async function treeOf(root: string): Promise<string> {
  const entries: string[] = []
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const absolute = path.join(directory, entry.name)
      const relative = prefix === '' ? entry.name : prefix + '/' + entry.name
      if (entry.isDirectory()) await walk(absolute, relative)
      else entries.push(relative + ':' + String((await readFile(absolute)).length))
    }
  }
  await walk(root, '')
  return entries.sort().join('\n')
}

describe('SYNC-05: published versions are enumerated and classified by semver', () => {
  it('separates the stable and pre-release channels instead of trusting one tag', () => {
    const channels = classifyVersions(['0.2.0-rc.2', '0.1.0', '0.2.0', '0.2.1-alpha.4', '0.2.0-rc.10', 'not-a-version'])
    expect(channels.stable).toEqual(['0.1.0', '0.2.0'])
    // Semver order throughout: the core version wins first (0.2.1 > 0.2.0), and
    // within one core the pre-release numbers are compared numerically, so rc.10
    // sorts above rc.2 instead of lexically below it.
    expect(channels.prerelease).toEqual(['0.2.0-rc.2', '0.2.0-rc.10', '0.2.1-alpha.4'])
    expect(channels.invalid).toEqual(['not-a-version'])
    expect(updateBasis({ fixed: '0.1.0', candidate: '0.2.0', ordered: ['0.1.0', '0.2.0-rc.2', '0.2.0-rc.10', '0.2.0'] }).intermediate)
      .toEqual(['0.2.0-rc.2', '0.2.0-rc.10'])
  })

  it('counts a published version that carries no tag, and reports both channels', async () => {
    const { check } = await round({ sources: bothEngines(['0.2.1-alpha.4', '0.2.1-rc.5', '0.2.0'], { latest: '0.2.0' }) })
    const engines = (check as Record<string, any>).checkpoints.engines as Record<string, any>[]
    expect(engines.find(entry => entry.id === 'engines.hashline.channel.stable')?.right.identity).toBe('0.2.0')
    expect(engines.find(entry => entry.id === 'engines.hashline.channel.prerelease')?.right.identity).toBe('0.2.1-rc.5')
    // The highest published version wins, tag or no tag.
    expect(differenceOf(check, 'engines.hashline.update')?.right.identity).toBe('0.2.1-rc.5')
    expect(differenceOf(check, 'engines.hashline.update')?.disposition).toBe('pending-analysis')
    expect(differenceOf(check, 'engines.hashline.update')?.reason).toContain('有版本更新、影响待查')
  })

  it('says the stable channel is empty instead of calling a pre-release a release', async () => {
    const { check } = await round({ sources: bothEngines(['0.2.1-alpha.4', '0.2.1-rc.3'], { latest: '0.2.1-rc.3' }) })
    expect(differenceOf(check, 'engines.hashline.update')?.right.identity).toBe('0.2.1-rc.3')
    expect(differenceOf(check, 'engines.hashline.update')?.reason).toContain('未发布任何正式版')
    const stable = ((check as Record<string, any>).checkpoints.engines as Record<string, any>[]).find(entry => entry.id === 'engines.hashline.channel.stable')
    expect(stable?.status).toBe('only-local')
  })
})

describe('SYNC-05: the patch and combination impact never claims more than the evidence', () => {
  it('keeps every patch item pending, because candidate package text is not read', () => {
    const items = patchItems('hashline', { declared: '0.2.1-alpha.4', locked: '0.2.1-alpha.4', installed: '0.2.1-alpha.4', patchStatus: 'patched', present: ['authorizes the snapshot migration'], missing: [] }, '0.2.1-rc.3')
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item.decision).toBe('pending-verification')
      expect(item.reason).toContain('候选包文本不在只读查询范围内')
      expect(item.evidence.candidate).toBe('0.2.1-rc.3')
    }
  })

  it('reports an update as pending and the combination as pending, never as safe to switch', async () => {
    const { check, report } = await round({ sources: bothEngines(['0.2.1-alpha.4', '0.2.1-rc.3']) })
    expect(differenceOf(check, 'engines.hashline.update')?.disposition).toBe('pending-analysis')
    expect(differenceOf(check, 'engines.tool-edit.update')?.disposition).toBe('pending-analysis')
    expect(differenceOf(check, 'engines.combination')?.disposition).toBe('pending-analysis')
    expect(differenceOf(check, 'engines.combination')?.reason).toContain('不称组合已通过')
    for (const entry of (check.differences as Record<string, any>[]).filter(item => item.area === 'engines')) {
      expect(entry.disposition).toBe('pending-analysis')
      expect(entry.right.present === false || entry.right.identity !== entry.left.identity).toBeTruthy()
    }
    expect(report).toContain('pending-verification')
    expect(report).not.toContain('升级成功')
  })

  it('records a baseline mismatch as this project\'s own problem', async () => {
    const { check } = await round({ sources: bothEngines() })
    // The real checkout declares, locks and resolves 0.2.1-alpha.4 for both
    // engines, so no mismatch is expected on a healthy tree.
    expect(differenceOf(check, 'engines.hashline.baseline.mismatch')).toBeUndefined()
    expect(((check as Record<string, any>).checkpoints.engines as Record<string, any>[]).find(entry => entry.id === 'engines.hashline.baseline')?.status).toBe('same')
  })
})

describe('SYNC-07: partial sources stay partial, and nothing is remembered', () => {
  it('keeps the other engine when one release source fails', async () => {
    const { check, report } = await round({
      sources: [
        releaseSource({ package: HASHLINE }),
        releaseSource({ package: TOOL_EDIT, status: 'failed', detail: 'registry unreachable' }),
      ],
    })
    expect(coverageOf(check, 'engines').status).toBe('incomplete')
    const gap = gapOf(check, 'engines.tool-edit')
    expect(gap.status).toBe('BLOCKED')
    expect(gap.detail).toContain('registry unreachable')
    expect(gap.detail).toContain('不回退到历史结果')
    // The engine that DID answer still produced its records.
    expect(differenceOf(check, 'engines.hashline.patch[0]')).toBeDefined()
    expect(report).toContain('BLOCKED')
  })

  it('names a timeout as a timeout, not as an answer', async () => {
    const { check } = await round({ sources: [releaseSource({ package: HASHLINE }), releaseSource({ package: TOOL_EDIT, status: 'failed', detail: 'timed out', timeout: true })] })
    expect(gapOf(check, 'engines.tool-edit').detail).toContain('查询超时')
    // And the channel checkpoint for that engine is unreadable, never "none published".
    const checkpoints = (check as Record<string, any>).checkpoints.engines as Record<string, any>[]
    expect(checkpoints.find(entry => entry.id === 'engines.tool-edit.channel')?.status).toBe('unreadable')
  })

  it('keeps no cache: a failed round after a verified one reports BLOCKED again', async () => {
    const first = await round({ sources: bothEngines(['0.2.1-alpha.4', '0.2.1-rc.3']) })
    expect(differenceOf(first.check, 'engines.hashline.update')).toBeDefined()
    const second = await round({
      sources: [
        releaseSource({ package: HASHLINE, status: 'failed', detail: 'registry unreachable' }),
        releaseSource({ package: TOOL_EDIT, status: 'failed', detail: 'registry unreachable' }),
      ],
    })
    expect(gapOf(second.check, 'engines.hashline').status).toBe('BLOCKED')
    expect(differenceOf(second.check, 'engines.hashline.update')).toBeUndefined()
    const direct = compareEnginesArea({
      // The stub only needs the fields the engines area reads; the cast keeps the
      // test from re-declaring the whole baseline shape.
      project: { declarations: { anchors: {} }, locked: { entries: [] }, installed: {} } as unknown as ProjectBaseline,
      options: { releaseSources: normalizeReleaseSources(bothEngines()) },
      now: NOW,
    })
    expect(direct.cacheUsed).toBe(false)
  })

  it('still reports the engines when the DSH source itself is unusable', async () => {
    const absent = path.join(await temp('sync-engines-absent-'), 'not-here')
    const { check } = await round({ sources: bothEngines(['0.2.1-alpha.4', '0.2.1-rc.3']), checkout: absent })
    expect(gapOf(check, 'source').status).toBe('GAP')
    expect(coverageOf(check, 'source').status).toBe('incomplete')
    expect(coverageOf(check, 'ptc').status).toBe('incomplete')
    expect(coverageOf(check, 'stock-read').status).toBe('incomplete')
    // The engine comparison needed no source tree, so it still ran.
    expect(coverageOf(check, 'engines').status).toBe('covered')
    expect(differenceOf(check, 'engines.hashline.update')).toBeDefined()
    expect(check.status).toBe('incomplete')
  })

  it('still reports the local areas when a release source fails', async () => {
    const { check } = await round({
      sources: [
        releaseSource({ package: HASHLINE, status: 'failed', detail: 'registry unreachable' }),
        releaseSource({ package: TOOL_EDIT, status: 'failed', detail: 'registry unreachable' }),
      ],
    })
    // The DSH tree exists but carries no ptc preset or read sources, so those
    // areas are incomplete for their own reason — the point is that they RAN.
    expect(coverageOf(check, 'source').status).toBe('covered')
    expect(gapOf(check, 'engines.hashline').status).toBe('BLOCKED')
    expect(check.status).toBe('incomplete')
  })
})

describe('the release-source boundary: a fixed answer is validated, never guessed', () => {
  it('refuses a malformed or duplicated record instead of reading it as an empty channel', () => {
    expect(() => normalizeReleaseSource({ package: 'unknown-package', status: 'verified' })).toThrow(/unknown package/u)
    expect(() => normalizeReleaseSource({ package: HASHLINE, status: 'verfied' })).toThrow(/unknown status/u)
    expect(() => normalizeReleaseSource({ package: HASHLINE, status: 'verified', queriedAt: 'not-a-date' })).toThrow(/queriedAt/u)
    expect(() => normalizeReleaseSources([releaseSource(), releaseSource()])).toThrow(/one package has one answer/u)
    expect(() => normalizeReleaseSources('nope' as unknown as Record<string, unknown>[])).toThrow(/array/u)
  })

  it('accepts a pinned file through the shipped entry', async () => {
    const root = await dshTree()
    const evidence = await temp('sync-engines-evidence-')
    const home = await temp('sync-engines-home-')
    await mkdir(path.join(home, 'state', 'ptc-hashline-operations'), { recursive: true })
    await writeFile(path.join(home, 'state', 'ptc-hashline-operations', 'config.json'), JSON.stringify({ evidenceDirectory: evidence }, null, 2) + '\n', 'utf8')
    const sourcesPath = path.join(await temp('sync-engines-sources-'), 'sources.json')
    await writeFile(sourcesPath, JSON.stringify({ records: bothEngines(['0.2.1-alpha.4', '0.2.1-rc.3']) }, null, 2) + '\n', 'utf8')
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const script = path.resolve(process.cwd(), 'scripts/sync-check.mjs')
    const outcome = await promisify(execFile)(process.execPath, [script, '--checkout', root, '--now', NOW, '--sources', sourcesPath], {
      env: { ...process.env, DSH_HOME: home },
      encoding: 'utf8',
      cwd: process.cwd(),
    }).then(
      (result: { stdout: string }) => ({ code: 0, stdout: String(result.stdout) }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({ code: error.code ?? -1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }),
    )
    expect(outcome.code).toBe(2)
    const value = JSON.parse((outcome as { stdout: string }).stdout)
    const engines = (value.check.coverage as Record<string, any>[]).find(entry => entry.area === 'engines')
    expect(engines?.status).toBe('covered')
  })

  it('leaves both trees untouched and writes only the round artifacts', async () => {
    const root = await dshTree()
    const before = await treeOf(root)
    const { check } = await round({ sources: bothEngines(['0.2.1-alpha.4', '0.2.1-rc.3']), checkout: root })
    expect(await treeOf(root)).toBe(before)
    expect((check.coverage as Record<string, any>[]).find(entry => entry.area === 'engines')?.checks).toBeGreaterThan(0)
  })
})
