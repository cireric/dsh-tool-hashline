/**
 * SYNC-04, ticket 03: the stock-read comparison through the public entry.
 *
 * The left end is this repository's REAL read package; the right end is a
 * fixture DSH source tree that carries the same symbols the real one does. That
 * makes each case reproducible, and the real-source run is recorded separately
 * in docs/acceptance.
 */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runSyncCheck } from '../../presets/ptc-hashline/operations/sync.mjs'
import type { RawReleaseSource } from '../../presets/ptc-hashline/operations/sync.mjs'
import {
  declaredConstant,
  numericValue,
  READ_DOCUMENTED_DIFFERENCES,
  STOCK_READ_FILES,
} from '../../presets/ptc-hashline/operations/sync-read.mjs'

const NOW = '2026-10-27T14:00:00.000Z'
const dirs: string[] = []


/** The engine answers every round in this file uses; the engines area has its own suite. */
const ENGINE_SOURCES: RawReleaseSource[] = [
  { package: '@hy-sde-org/dsh-hashline', status: 'verified', queriedAt: NOW, source: 'fixture: read suite', versions: ['0.2.1-alpha.4'], tags: { latest: '0.2.1-alpha.4' } },
  { package: '@hy-sde-org/dsh-tool-edit', status: 'verified', queriedAt: NOW, source: 'fixture: read suite', versions: ['0.2.1-alpha.4'], tags: { latest: '0.2.1-alpha.4' } },
]
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** The fixture bodies: the same symbols the real tool-fs sources carry. */
function stockReadSources(): Record<string, string> {
  return {
    [STOCK_READ_FILES.args]: [
      'export const READ_LIMIT = 2000',
      'export const STREAM_MIN_SIZE = 10 * 1024 * 1024',
      'export function parseReadArgs(args: { file_path: string; offset?: number; limit?: number }, maxLimit: number) {',
      '  return { file_path: args.file_path, offset: args.offset ?? 1, limit: args.limit ?? maxLimit }',
      '}',
      '',
    ].join('\n'),
    [STOCK_READ_FILES.render]: [
      'export const READ_MAX_LINE_LENGTH = 2000',
      'export const READ_MAX_BYTES = 50 * 1024',
      'export interface WindowResult { text: string }',
      'function truncateLine(line: string, maxLineLength: number) { return line.slice(0, maxLineLength) }',
      'export async function buildWindow(request: unknown) { return request }',
      'export function formatReadOutput(displayPath: string, outcome: unknown) { return displayPath }',
      '',
    ].join('\n'),
    [STOCK_READ_FILES.errors]: 'export function remediateFsError(error: unknown, displayPath: string): unknown { return error ?? displayPath }\n',
    [STOCK_READ_FILES.config]: [
      'export interface Config { readLimit?: number; readMaxLineLength?: number; readMaxBytes?: number }',
      'const resolved = { readLimit: 2000, readMaxLineLength: 2000, readMaxBytes: 51200 }',
      'export function applyReadTool() { return resolved }',
      '',
    ].join('\n'),
    [STOCK_READ_FILES.image]: 'export function applyReadImageTool() { return null }\n',
  }
}

/** Build one fixture DSH source tree, optionally overriding single files. */
async function dshTree(overrides: Record<string, string | null> = {}): Promise<string> {
  const root = await temp('sync-read-dsh-')
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root', version: '0.2.1-rc.2' }, null, 2) + '\n', 'utf8')
  const sources: Record<string, string> = stockReadSources()
  // A null override means "this file is absent", which is a case of its own.
  for (const [relative, body] of Object.entries(overrides)) {
    if (body === null) delete sources[relative]
    else sources[relative] = body
  }
  for (const [relative, body] of Object.entries(sources)) {
    const absolute = path.join(root, ...relative.split('/'))
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, String(body), 'utf8')
  }
  return root
}

interface RoundResult { code: number; check: Record<string, any>; report: string }

/** Run one round through the public entry over a fixture source. */
async function round(source: string): Promise<RoundResult> {
  const evidence = await temp('sync-read-evidence-')
  const state = await temp('sync-read-state-')
  const result = await runSyncCheck({
    env: {},
    now: NOW,
    checkout: source,
    repository: process.cwd(),
    installationRoot: process.cwd(),
    stateDir: state,
    evidenceDirectory: evidence,
    // Pinned engine answers: this suite compares the read area, and a pinned
    // record keeps it off the network (the engines area has its own suite).
    sources: ENGINE_SOURCES,
  })
  const directory = (result.value as { evidence?: { directory: string } }).evidence?.directory
  if (directory === undefined) throw new Error('the round wrote nothing: ' + String((result.value as { reason?: string }).reason))
  const check = JSON.parse(await readFile(path.join(directory, 'sync.json'), 'utf8'))
  const report = await readFile(path.join(directory, 'report.md'), 'utf8')
  return { code: result.code, check, report }
}

/** The stock-read coverage entry. */
function stockArea(check: Record<string, any>): Record<string, any> {
  const found = (check.coverage as Record<string, any>[]).find(entry => entry.area === 'stock-read')
  if (found === undefined) throw new Error('no stock-read coverage')
  return found
}

/** The stock-read differences, by id. */
function readDifferences(check: Record<string, any>): Map<string, Record<string, any>> {
  const entries = (check.differences as Record<string, any>[]).filter(entry => entry.area === 'stock-read')
  return new Map(entries.map(entry => [entry.id, entry]))
}

/** One record that must exist; a missing id is a test failure, with the list. */
function recordOf(records: Map<string, Record<string, any>>, id: string): Record<string, any> {
  const found = records.get(id)
  if (found === undefined) throw new Error('no record ' + id + '; had: ' + [...records.keys()].join(', '))
  return found
}

/** The stock-read checkpoints, by id. */
function readCheckpoints(check: Record<string, any>): Map<string, Record<string, any>> {
  const entries = ((check.checkpoints?.['stock-read'] ?? []) as Record<string, any>[])
  return new Map(entries.map(entry => [entry.id, entry]))
}

/** Every file under a tree, with its digest. */
async function treeOf(root: string): Promise<string> {
  const entries: string[] = []
  const walk = async (directory: string, prefix: string): Promise<void> => {
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

describe('SYNC-04: the stock read is compared point by point', () => {
  it('covers the area and pins the parameters, return value, truncation, large-file and error points', async () => {
    const { code, check, report } = await round(await dshTree())
    const area = stockArea(check)
    expect(area.status).toBe('covered')
    expect(area.checks).toBeGreaterThanOrEqual(14)
    expect(code).toBe(2)

    const checkpoints = readCheckpoints(check)
    // One checkpoint per declared dimension; every one names a file and a symbol.
    for (const id of [
      'read.contract.parameters.args',
      'read.contract.parameters.config',
      'read.contract.return-value.envelope',
      'read.contract.truncation.window',
      'read.contract.large-file.streaming',
      'read.contract.error-handling',
    ]) {
      expect(checkpoints.get(id)?.status).toBe('same')
      expect(String(checkpoints.get(id)?.right.source)).toContain('packages/fs/tool-fs/src/')
    }
    // The report names what was compared, and states the limit of that evidence.
    expect(report).toContain('## 检查点')
    expect(report).toContain('read.contract.truncation.window')
    expect(report).toContain('不证明行为兼容')
  })

  it('compares the declared caps by VALUE, so two spellings of 51200 are not a difference', async () => {
    const { check } = await round(await dshTree())
    const checkpoints = readCheckpoints(check)
    expect(checkpoints.get('read.value.caps.limit')?.left.identity).toBe('2000')
    expect(checkpoints.get('read.value.caps.limit')?.right.identity).toBe('2000')
    expect(checkpoints.get('read.value.caps.maxLineLength')?.status).toBe('same')
    // 51_200 (ours) and 50 * 1024 (theirs) are the same cap.
    expect(checkpoints.get('read.value.caps.maxBytes')?.left.identity).toBe('51200')
    expect(checkpoints.get('read.value.caps.maxBytes')?.right.identity).toBe('51200')
    expect(checkpoints.get('read.value.caps.maxBytes')?.status).toBe('same')
    expect(readDifferences(check).has('read.value.caps.maxBytes')).toBe(false)

    expect(numericValue('50 * 1024')).toBe(51200)
    expect(numericValue('51_200')).toBe(51200)
    expect(numericValue('4 * 1024 * 1024')).toBe(4194304)
    expect(numericValue('callSomething()')).toBeUndefined()
    expect(declaredConstant('export const A = 10 * 1024 * 1024\n', 'A')).toBe('10 * 1024 * 1024')
    expect(declaredConstant('let A = 1\n', 'A')).toBeUndefined()
  })

  it('reports a changed parameter, a changed truncation cap and a changed error entry', async () => {
    const sources = stockReadSources()
    const changed = await round(await dshTree({
      [STOCK_READ_FILES.args]: sources[STOCK_READ_FILES.args].replace('READ_LIMIT = 2000', 'READ_LIMIT = 4000'),
      [STOCK_READ_FILES.render]: sources[STOCK_READ_FILES.render].replace('READ_MAX_BYTES = 50 * 1024', 'READ_MAX_BYTES = 64 * 1024').replace('truncateLine', 'clipLine'),
      [STOCK_READ_FILES.errors]: sources[STOCK_READ_FILES.errors].replace('remediateFsError', 'describeFsFailure'),
    }))
    const differences = readDifferences(changed.check)
    expect(differences.get('read.value.caps.limit')?.disposition).toBe('pending-analysis')
    expect(differences.get('read.value.caps.limit')?.right.identity).toBe('4000')
    expect(differences.get('read.value.caps.maxBytes')?.right.identity).toBe('65536')
    // A renamed symbol is reported at THAT symbol, not as "the file changed".
    expect(differences.get('read.contract.truncation.window.truncateLine')?.disposition).toBe('pending-analysis')
    expect(differences.get('read.contract.error-handling.remediateFsError')?.disposition).toBe('pending-analysis')
    // The untouched points stay out of the difference list.
    expect(differences.get('read.contract.parameters.args')).toBeUndefined()
    expect(readCheckpoints(changed.check).get('read.contract.parameters.args')?.status).toBe('same')
  })

  it('reports a missing or unreadable checkpoint as a named gap, never as compatible', async () => {
    const { check } = await round(await dshTree({ [STOCK_READ_FILES.args]: null }))
    const area = stockArea(check)
    expect(area.status).toBe('incomplete')
    const gap = (check.gaps as Record<string, any>[]).find(entry => entry.id === 'read.contract.parameters.args')
    expect(gap?.status).toBe('GAP')
    expect(gap?.detail).toContain('读不出')
    // The other points still ran.
    expect(readCheckpoints(check).get('read.contract.error-handling')?.status).toBe('same')
  })

  it('names a regression on OUR side rather than blaming the upstream', async () => {
    // The left end is the real checkout; this case moves a token by pointing the
    // project baseline at a copy of the read package with one symbol removed.
    const project = await temp('sync-read-project-')
    await mkdir(path.join(project, 'packages', 'tool-read', 'src'), { recursive: true })
    const ourFiles = ['config.ts', 'window.ts', 'render.ts', 'index.ts', 'session.ts', 'next-action.ts']
    for (const name of ourFiles) {
      const text = await readFile(path.join(process.cwd(), 'packages', 'tool-read', 'src', name), 'utf8')
      await writeFile(path.join(project, 'packages', 'tool-read', 'src', name), name === 'session.ts' ? text.replace('snapshotKeys', 'unrelatedName') : text, 'utf8')
    }
    await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'dsh-tool-hashline', version: '0.0.0' }), 'utf8')
    await mkdir(path.join(project, 'packages', 'hashline'), { recursive: true })
    await mkdir(path.join(project, 'packages', 'tool-edit'), { recursive: true })
    for (const [name, specifier] of [['hashline', '@hy-sde-org/dsh-hashline'], ['tool-edit', '@hy-sde-org/dsh-tool-edit']]) {
      await writeFile(path.join(project, 'packages', name, 'package.json'), JSON.stringify({ name: '@dsh-tool-hashline/' + name, dependencies: { [specifier]: '0.2.1-alpha.4' } }), 'utf8')
    }
    const evidence = await temp('sync-read-evidence-')
    const state = await temp('sync-read-state-')
    const result = await runSyncCheck({
      env: {}, now: NOW, checkout: await dshTree(), repository: project, installationRoot: project, stateDir: state, evidenceDirectory: evidence, sources: ENGINE_SOURCES,
    })
    const check = JSON.parse(await readFile(path.join((result.value as { evidence: { directory: string } }).evidence.directory, 'sync.json'), 'utf8'))
    const difference = readDifferences(check).get('read.difference.seen-guard')
    // Our own token is gone, so the documented difference stops holding.
    expect(difference?.disposition).toBe('pending-analysis')
    expect(difference?.reason).toContain('已知差异不再成立')
  })

  it('turns a kept difference into review when the upstream gains the concept', async () => {
    const sources = stockReadSources()
    const changed = await round(await dshTree({
      [STOCK_READ_FILES.render]: sources[STOCK_READ_FILES.render] + '\nexport const contentTag = 1\n',
    }))
    const record = readDifferences(changed.check).get('read.difference.canonical-tag')
    expect(record?.disposition).toBe('pending-analysis')
    expect(record?.reason).toContain('上游出现了本应缺席的概念')
    // The keep whose probe did not trigger stays kept.
    expect(readDifferences(changed.check).get('read.difference.seen-guard')?.disposition).toBe('keep')
  })

  it('never claims compatibility: the documented differences are always on the record, with their basis', async () => {
    const { check, report } = await round(await dshTree())
    const differences = readDifferences(check)
    for (const item of READ_DOCUMENTED_DIFFERENCES) {
      const record = recordOf(differences, item.id)
      expect(record.disposition).toBe('keep')
      expect(record.basis).toContain('docs/')
      expect(record.recheckWhen.length).toBeGreaterThan(0)
    }
    // The image tool is excluded on the record, not silently dropped.
    const image = recordOf(differences, 'read.scope.image-tool')
    expect(image.disposition).toBe('not-applicable')
    expect(image.reason).toContain('不把独立图片读取工具混进')
    // The thresholds are compared by value and shown as they are.
    expect(differences.get('read.difference.large-file-threshold')?.left.identity).toBe('4194304')
    expect(differences.get('read.difference.large-file-threshold')?.right.identity).toBe('10485760')
    expect(report).toContain('待分析')
    expect(report).toContain('不适用')
    expect(report).not.toContain('已兼容')
  })

  it('leaves the source untouched and keeps the record and the report consistent', async () => {
    const source = await dshTree()
    const before = await treeOf(source)
    const { check, report } = await round(source)
    expect(await treeOf(source)).toBe(before)
    const area = stockArea(check)
    expect((check.checkpoints['stock-read'] as Record<string, any>[])).toHaveLength(area.checks)
    for (const [id] of readDifferences(check)) expect(report).toContain(id)
    // Every stock-read record sits in the shared difference shape ticket 05 consumes.
    for (const record of readDifferences(check).values()) {
      expect(record.area).toBe('stock-read')
      expect(typeof record.left?.identity).toBe('string')
      expect(typeof record.right?.identity).toBe('string')
      expect(['added', 'removed', 'changed']).toContain(record.change)
      expect(['follow-up', 'keep', 'pending-analysis', 'not-applicable']).toContain(record.disposition)
      expect(record.recheckWhen.length).toBeGreaterThan(0)
    }
  })
})
