/**
 * SYNC-03, ticket 02: the PTC comparison through the public entry.
 *
 * The left end is THIS repository's real preset, so the "kept difference" cases
 * are asserted against the file that actually ships. The right end is a fixture
 * DSH source tree: it makes every case reproducible without pinning a moving
 * upstream, and the real-source run is recorded separately in docs/acceptance.
 *
 * Every case that is not about a broken source goes through runSyncCheck — the
 * function the shipped entry calls — so a comparator that only works when called
 * directly cannot pass here.
 */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runSyncCheck } from '../../presets/ptc-hashline/operations/sync.mjs'
import { parseYamlSubset, YamlSubsetError } from '../../presets/ptc-hashline/operations/sync-yaml.mjs'
import { PTC_CONTRACTS, PTC_KEEP_LIST, PTC_UPSTREAM_PRESET } from '../../presets/ptc-hashline/operations/sync-ptc.mjs'
import type { RawReleaseSource } from '../../presets/ptc-hashline/operations/sync.mjs'

const NOW = '2026-10-27T08:00:00.000Z'
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** The engine answers every round in this file uses; the engines area has its own suite. */
const ENGINE_SOURCES: RawReleaseSource[] = [
  { package: '@hy-sde-org/dsh-hashline', status: 'verified', queriedAt: '2026-10-27T18:00:00.000Z', source: 'fixture: ptc suite', versions: ['0.2.1-alpha.4'], tags: { latest: '0.2.1-alpha.4' } },
  { package: '@hy-sde-org/dsh-tool-edit', status: 'verified', queriedAt: '2026-10-27T18:00:00.000Z', source: 'fixture: ptc suite', versions: ['0.2.1-alpha.4'], tags: { latest: '0.2.1-alpha.4' } },
]

/** A minimal but faithful stock-ptc preset, shaped like the real one. */
function upstreamPreset(options: { extraRows?: string; omitRows?: string[]; section?: string } = {}): string {
  const omit = new Set(options.omitRows ?? [])
  const rows = [
    '          - id: persona',
    "            name: '@deepseek-ai/dsh-persona'",
    '            config:',
    '              prefix: You are a coding agent powered by the {{model}} model.',
    omit.has('tool-fs') ? '' : "          - id: tool-fs\n            name: '@deepseek-ai/dsh-tool-fs'",
    omit.has('tool-schedule') ? '' : "          - id: tool-schedule\n            name: '@deepseek-ai/dsh-tool-schedule'",
    omit.has('tool-bash') ? '' : "          - id: tool-bash\n            name: '@deepseek-ai/dsh-tool-bash'\n            disabled: !!js process.platform === 'win32'",
    '          - id: planning',
    '            name: cordis:group',
    '            group: true',
    '            isolate:',
    '              planMode: true',
    '            config:',
    '              - id: plan-mode',
    "                name: '@deepseek-ai/dsh-plan-mode'",
    '                config:',
    '                  section: |',
    ...String(options.section ?? 'Upstream plan-mode guidance.').split('\n').map(line => '                    ' + line),
    options.extraRows ?? '',
  ].filter(line => line !== '')
  return [
    '- insert:',
    '    - id: preset-ptc',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: ptc',
    '        order: 2',
    '        plugins:',
    ...rows,
    '',
  ].join('\n')
}

/** The token text each contract file must carry, so the fixture starts complete. */
const CONTRACT_BODIES: Record<string, string> = {
  'packages/subagent/tool-subagent/src/index.ts': "export interface Config { provider: string; toolName?: string; maxDepth?: number; modelSelectionSettings?: boolean; backgroundMode?: string }\n",
  'packages/ptc-runtime/ptc-runtime/src/types.ts': 'export interface PtcBindingNamespace { }\nexport interface PtcRunResult { }\nexport type PtcJsonValue = unknown\n',
  'packages/core/agent-tool-presentation/src/index.ts': "const modes = ['native', 'ptc'] as const\nfunction presentAs(mode: string): void { void mode }\n",
  'packages/core/system-prompt/src/index.ts': '// A complete {{variable}} reference group\nconst note = "prompt variable"\n',
  'packages/preset/persona/src/index.ts': 'export interface Config { prefix: string; suffix?: string }\n',
}

/** Build one fixture DSH source tree. */
async function dshTree(options: { preset?: string; contracts?: Record<string, string>; omitContracts?: string[]; fixture?: { extraRows?: string; omitRows?: string[]; section?: string } } = {}): Promise<string> {
  const root = await temp('sync-ptc-dsh-')
  const presetPath = path.join(root, ...PTC_UPSTREAM_PRESET.split('/'))
  await mkdir(path.dirname(presetPath), { recursive: true })
  await writeFile(presetPath, options.preset ?? upstreamPreset(options.fixture ?? {}), 'utf8')
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root', version: '0.2.1-rc.2' }, null, 2) + '\n', 'utf8')
  const omit = new Set(options.omitContracts ?? [])
  for (const contract of PTC_CONTRACTS) {
    if (omit.has(contract.source)) continue
    const absolute = path.join(root, ...contract.source.split('/'))
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, options.contracts?.[contract.source] ?? CONTRACT_BODIES[contract.source], 'utf8')
  }
  return root
}

/** Every file under a tree, with its digest (VCS internals excluded). */
async function treeOf(root: string): Promise<string> {
  const entries: string[] = []
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const { readdir } = await import('node:fs/promises')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const absolute = path.join(directory, entry.name)
      const relative = prefix === '' ? entry.name : prefix + '/' + entry.name
      if (entry.isDirectory()) await walk(absolute, relative)
      else entries.push(relative + ':' + createHash('sha256').update(await readFile(absolute)).digest('hex'))
    }
  }
  await walk(root, '')
  return entries.sort().join('\n')
}

interface RoundResult {
  code: number
  check: Record<string, any>
}

/** Run one round through the public entry over a fixture source. */
async function round(source: string): Promise<RoundResult> {
  const evidence = await temp('sync-ptc-evidence-')
  const state = await temp('sync-ptc-state-')
  const result = await runSyncCheck({
    env: {},
    now: NOW,
    checkout: source,
    repository: process.cwd(),
    installationRoot: process.cwd(),
    stateDir: state,
    evidenceDirectory: evidence,
    // Pinned engine answers: this suite compares the ptc area, and a pinned
    // record keeps it off the network (the engines area has its own suite).
    sources: ENGINE_SOURCES,
  })
  const directory = (result.value as { evidence?: { directory: string } }).evidence?.directory
  if (directory === undefined) throw new Error('the round wrote nothing: ' + String((result.value as { reason?: string }).reason))
  const check = JSON.parse(await readFile(path.join(directory, 'sync.json'), 'utf8'))
  return { code: result.code, check }
}

/** The one difference with this id; a missing id is a test failure, with the list. */
function differenceOf(check: Record<string, any>, id: string): Record<string, any> {
  const found = maybeDifferenceOf(check, id)
  if (found === undefined) {
    throw new Error('no difference ' + id + '; had: ' + (check.differences as Record<string, any>[]).map(entry => entry.id).join(', '))
  }
  return found
}

/** The one difference with this id, or undefined when the assertion is about absence. */
function maybeDifferenceOf(check: Record<string, any>, id: string): Record<string, any> | undefined {
  return (check.differences as Record<string, any>[]).find(entry => entry.id === id)
}

/** The one checkpoint with this id; a missing one is a test failure, with the list. */
function checkpointOf(check: Record<string, any>, id: string): Record<string, any> {
  const items = (check.checkpoints?.ptc ?? []) as Record<string, any>[]
  const found = items.find(entry => entry.id === id)
  if (found === undefined) throw new Error('no checkpoint ' + id + '; had: ' + items.map(entry => entry.id).join(', '))
  return found
}

/** The one area's coverage entry; a missing area is a test failure. */
function coverageOf(check: Record<string, any>, area: string): Record<string, any> {
  const found = (check.coverage as Record<string, any>[]).find(entry => entry.area === area)
  if (found === undefined) throw new Error('no coverage for ' + area)
  return found
}

/** The one gap with this id; a missing one is a test failure, with the list. */
function gapOf(check: Record<string, any>, id: string): Record<string, any> {
  const found = (check.gaps as Record<string, any>[]).find(entry => entry.id === id)
  if (found === undefined) throw new Error('no gap ' + id + '; had: ' + (check.gaps as Record<string, any>[]).map(entry => entry.id).join(', '))
  return found
}

describe('SYNC-03: the ptc area is compared object by object', () => {
  it('covers the area and reports the intentional differences as kept, with their basis', async () => {
    const { code, check } = await round(await dshTree())
    const coverage = coverageOf(check, 'ptc')
    expect(coverage.status).toBe('covered')
    expect(coverage.checks).toBeGreaterThan(20)
    expect(code).toBe(2)

    // Our own read replaces the stock one: kept, and it cites an authority.
    const read = differenceOf(check, 'ptc.row.tool-read')
    expect(read.disposition).toBe('keep')
    expect(read.basis).toContain('docs/')
    expect(read.recheckWhen.length).toBeGreaterThan(0)
    expect(read.left.identity).not.toBe(read.right.identity)

    // A row the upstream has and we do not: reported, not silenced, and not
    // decided for the maintainer.
    const schedule = differenceOf(check, 'ptc.row.tool-schedule')
    expect(schedule).toBeDefined()
    expect(schedule.disposition).toBe('pending-analysis')
    expect(schedule.change).toBe('added')
    expect(schedule.reason).toContain('待分析')
  })

  it('localises a nested configuration change and a prompt change to their own objects', async () => {
    const clean = await round(await dshTree())
    const changed = await round(await dshTree({ fixture: { section: 'Upstream plan-mode guidance.\nAn added upstream sentence.' } }))
    const sectionId = 'ptc.config.planning>plan-mode.section'
    expect(differenceOf(clean.check, sectionId).impact).toBe('prompt')
    // The row's own shape did not change, so its checkpoint stays "same": this is
    // what keeps a prompt edit from being reported as a rewritten row.
    expect(checkpointOf(changed.check, 'ptc.row.planning>plan-mode').status).toBe('same')
    const before = differenceOf(clean.check, sectionId).right.identity
    const after = differenceOf(changed.check, sectionId).right.identity
    expect(after).not.toBe(before)
    // And nothing else moved with it.
    expect((changed.check.differences as Record<string, any>[]).length).toBe((clean.check.differences as Record<string, any>[]).length)
  })

  it('reports an added upstream tool and a removed one', async () => {
    const added = await round(await dshTree({ fixture: { extraRows: "          - id: tool-brand-new\n            name: '@deepseek-ai/dsh-tool-brand-new'" } }))
    const addedDifference = differenceOf(added.check, 'ptc.row.tool-brand-new')
    expect(addedDifference.change).toBe('added')
    expect(addedDifference.disposition).toBe('pending-analysis')

    const removed = await round(await dshTree({ fixture: { omitRows: ['tool-schedule'] } }))
    expect(maybeDifferenceOf(removed.check, 'ptc.row.tool-schedule')).toBeUndefined()
    expect(((removed.check.checkpoints?.ptc ?? []) as Record<string, any>[]).some(entry => entry.id === 'ptc.row.tool-schedule')).toBe(false)
  })

  it('treats a contract checkpoint that disappeared as a named gap, not as no change', async () => {
    const { check } = await round(await dshTree({ omitContracts: ['packages/core/system-prompt/src/index.ts'] }))
    expect(coverageOf(check, 'ptc').status).toBe('incomplete')
    const gap = gapOf(check, 'ptc.contract.system-prompt')
    expect(gap.status).toBe('GAP')
    expect(gap.detail).toContain('契约检查点缺失')
    // The rest of the comparison still ran.
    expect(differenceOf(check, 'ptc.row.tool-read')).toBeDefined()
  })

  it('reports a missing or unparsable upstream preset as a gap that names the end', async () => {
    const missing = await round(await dshTree({ preset: '' }).then(async root => {
      await rm(path.join(root, ...PTC_UPSTREAM_PRESET.split('/')))
      return root
    }))
    expect((missing.check.gaps as Record<string, any>[]).some(entry => entry.id === 'ptc.right')).toBe(true)
    expect(coverageOf(missing.check, 'ptc').status).toBe('incomplete')

    const broken = await round(await dshTree({ preset: '- insert:\n    - id: preset-ptc\n      config:\n        plugins:\n        - id: a\n       name: broken\n' }))
    expect(gapOf(broken.check, 'ptc.right').detail).toContain('subset reader')
  })

  it('never executes an upstream custom tag: !!js is read as data', async () => {
    // If the checker evaluated this tag, the sentinel file would exist afterwards.
    const sentinel = path.join(await temp('sync-ptc-sentinel-'), 'executed.txt')
    const expression = "process.getBuiltinModule('node:fs').writeFileSync(" + JSON.stringify(sentinel) + ", 'executed')"
    // The row carries the tag at ROW level, which is also how a row-level field
    // nobody expected stays visible: the row's own identity changes.
    const preset = upstreamPreset().replace("name: '@deepseek-ai/dsh-tool-fs'", "name: '@deepseek-ai/dsh-tool-fs'\n            marker: !!js " + expression)
    const { check } = await round(await dshTree({ preset }))
    await expect(readFile(sentinel, 'utf8')).rejects.toThrow()
    // The expression is only ever content: a digest on the right, nothing executed.
    const row = checkpointOf(check, 'ptc.row.tool-fs')
    expect(row).toBeDefined()
    expect(row.status).toBe('changed')
    expect(row.right.identity).toMatch(/^[0-9a-f]{64}$/u)
    expect(JSON.stringify(row)).not.toContain('executed.txt')
  })

  it('keeps the record and the report consistent and leaves the source untouched', async () => {
    const source = await dshTree()
    const before = await treeOf(source)
    const evidence = await temp('sync-ptc-evidence-')
    const state = await temp('sync-ptc-state-')
    const result = await runSyncCheck({
      env: {}, now: NOW, checkout: source, repository: process.cwd(), installationRoot: process.cwd(), stateDir: state, evidenceDirectory: evidence,
      sources: ENGINE_SOURCES,
    })
    expect(await treeOf(source)).toBe(before)
    const directory = (result.value as { evidence: { directory: string } }).evidence.directory
    const check = JSON.parse(await readFile(path.join(directory, 'sync.json'), 'utf8'))
    const report = await readFile(path.join(directory, 'report.md'), 'utf8')
    const coverage = coverageOf(check, 'ptc')
    expect(check.checkpoints.ptc).toHaveLength(coverage.checks)
    for (const entry of check.differences as Record<string, any>[]) {
      expect(report).toContain(entry.id)
    }
    expect(report).toContain('## 检查点')
    expect(report).toContain('待分析')
    expect(report).toContain('不证明行为兼容')
  })

  it('stops calling a difference kept when the named object appears or disappears', async () => {
    // The upstream gains a row a keep entry names ("自有 read 取代 stock read"):
    // the object's presence changed, so the keep reason no longer describes it.
    const gained = await round(await dshTree({ fixture: { extraRows: "          - id: tool-read\n            name: '@deepseek-ai/dsh-tool-read'" } }))
    const record = differenceOf(gained.check, 'ptc.row.tool-read')
    expect(record.disposition).toBe('pending-analysis')
    expect(record.reason).toContain('对象在场情况变了')
    // An entry whose basis says both ends carry the row loses its keep when the
    // source end has no such row (the minimal fixture models exactly that).
    expect(differenceOf(gained.check, 'ptc.row.delegation>workflow-ptc').disposition).toBe('pending-analysis')
  })

  it('refuses duplicate row ids instead of collapsing them into one checkpoint', async () => {
    const preset = upstreamPreset({ extraRows: "          - id: tool-fs\n            name: '@deepseek-ai/dsh-tool-fs-copy'" })
    const { check } = await round(await dshTree({ preset }))
    expect(gapOf(check, 'ptc.right').detail).toContain('duplicate row id')
    expect(coverageOf(check, 'ptc').status).toBe('incomplete')
  })

  it('names every kept difference with a citation and a re-check trigger', () => {
    for (const entry of PTC_KEEP_LIST) {
      expect(entry.basis.length).toBeGreaterThan(0)
      expect(entry.reason.length).toBeGreaterThan(0)
      expect(entry.recheckWhen.length).toBeGreaterThan(0)
      // A keep entry binds the presence of BOTH ends: that is what turns a keep
      // back into review when the named object appears or disappears.
      expect(typeof entry.expect?.left).toBe('boolean')
      expect(typeof entry.expect?.right).toBe('boolean')
      // A keep entry must name one object, never a prefix that covers a region.
      expect(entry.id.startsWith('ptc.')).toBe(true)
    }
    expect(new Set(PTC_KEEP_LIST.map(entry => entry.id)).size).toBe(PTC_KEEP_LIST.length)
  })
})

describe('the YAML subset reader: data only, and honest about what it cannot read', () => {
  it('reads the dialect both preset files use', () => {
    const document = parseYamlSubset([
      '- insert:',
      '    - id: preset-x',
      '      config:',
      '        id: x',
      '        order: 2',
      '        description: >-',
      '          folded prose that',
      '          continues here',
      '        plugins:',
      '          - id: a',
      "            name: '@scope/a'",
      '            disabled: !!js process.platform === "win32"',
      '            config:',
      '              section: |',
      '                line one',
      '',
      '                line three',
      '              list:',
      '                - !!js some.expression()',
      '                - plain',
    ].join('\n'))
    const preset = (document as Record<string, any>[])[0].insert[0]
    expect(preset.config.id).toBe('x')
    expect(preset.config.order).toBe(2)
    expect(preset.config.description).toBe('folded prose that continues here')
    const row = preset.config.plugins[0]
    expect(row.name).toBe('@scope/a')
    // A custom tag is captured, never evaluated.
    expect(row.disabled).toEqual({ __tag: 'js', value: 'process.platform === "win32"' })
    expect(row.config.section).toBe('line one\n\nline three\n')
    expect(row.config.list).toEqual([{ __tag: 'js', value: 'some.expression()' }, 'plain'])
  })

  it('refuses an ambiguous structure instead of guessing', () => {
    expect(() => parseYamlSubset('a:\n  b: 1\n   c: 2\n')).toThrow(YamlSubsetError)
    expect(() => parseYamlSubset('a: 1\na: 2\n')).toThrow(/duplicate key/u)
    expect(() => parseYamlSubset('a:\n\t- 1\n')).toThrow(/tab indentation/u)
  })

  it('keeps a __proto__ key as data and never lets it touch the prototype', () => {
    const parsed = parseYamlSubset('__proto__:\n  polluted: 1\nb: 2\n') as Record<string, unknown>
    expect(Object.keys(parsed)).toContain('__proto__')
    expect(parsed['__proto__']).toEqual({ polluted: 1 })
    expect(parsed.b).toBe(2)
  })

  it('reads a quoted scalar with a trailing comment, and a comment-only value as null', () => {
    expect(parseYamlSubset('a: "v" # note\n')).toEqual({ a: 'v' })
    expect(parseYamlSubset("b: 'w' # note\n")).toEqual({ b: 'w' })
    expect(parseYamlSubset('c: # note\n')).toEqual({ c: null })
    // A # inside quotes stays content.
    expect(parseYamlSubset('d: "a # b"\n')).toEqual({ d: 'a # b' })
    expect(parseYamlSubset('e: v # note\n')).toEqual({ e: 'v' })
  })
})
