import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { run } from '../../presets/ptc-hashline/operations/cli.mjs'
import { compareWithHistory } from '../../presets/ptc-hashline/operations/sync-history.mjs'
import { PTC_LOCAL_PRESET, PTC_UPSTREAM_PRESET } from '../../presets/ptc-hashline/operations/sync-ptc.mjs'
import { STOCK_READ_FILES } from '../../presets/ptc-hashline/operations/sync-read.mjs'
import { runSyncCheck } from '../../presets/ptc-hashline/operations/sync.mjs'

const dirs: string[] = []
const NOW = '2026-10-27T08:00:00Z'
const SOURCES = ['@hy-sde-org/dsh-hashline', '@hy-sde-org/dsh-tool-edit'].map(pkg => ({
  package: pkg, status: 'verified' as const, queriedAt: NOW, source: 'fixture', versions: ['0.2.1-alpha.4'], tags: {},
}))

afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

async function temp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sync-review-'))
  dirs.push(dir)
  return dir
}

async function put(root: string, file: string, text: string): Promise<void> {
  const target = path.join(root, file)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, text, 'utf8')
}

function preset(row: string): string {
  return '- insert:\n    - id: preset-ptc\n      name: example\n      config:\n        id: ptc\n        plugins:\n' + row + '\n'
}

async function fixture() {
  const source = await temp()
  const project = await temp()
  const state = await temp()
  const evidence = await temp()
  await put(source, 'package.json', JSON.stringify({ name: '@deepseek-ai/dsh-root', version: '0.2.1-rc.2' }))
  await cp(path.join(process.cwd(), 'packages/tool-read/src'), path.join(project, 'packages/tool-read/src'), { recursive: true })
  await put(source, PTC_UPSTREAM_PRESET, preset('          - id: tool-fs\n            name: example'))
  await put(project, PTC_LOCAL_PRESET, preset('          - id: tool-fs\n            name: example'))
  for (const [file, text] of Object.entries({
    [STOCK_READ_FILES.args]: 'const READ_LIMIT = 2000\nconst STREAM_MIN_SIZE = 10 * 1024 * 1024\nfunction parseReadArgs(offset, limit) { return { offset, limit } }',
    [STOCK_READ_FILES.render]: 'const READ_MAX_LINE_LENGTH = 2000\nconst READ_MAX_BYTES = 51200\nfunction truncateLine() {}\nfunction buildWindow() {}\nfunction formatReadOutput() { return "before" }\ninterface WindowResult {}',
    [STOCK_READ_FILES.config]: 'readLimit readMaxLineLength readMaxBytes',
    [STOCK_READ_FILES.errors]: 'function remediateFsError() {}',
    [STOCK_READ_FILES.image]: 'function applyReadImageTool() {}',
  })) await put(source, file, text)
  const round = async (options: Record<string, unknown> = {}) => {
    const result = await runSyncCheck({ env: {}, now: NOW, checkout: source, repository: project, installationRoot: project,
      stateDir: state, evidenceDirectory: evidence, sources: SOURCES, ...options })
    const files = (result.value as { evidence: { files: { record: string; report: string } } }).evidence.files
    return { check: JSON.parse(await readFile(files.record, 'utf8')), report: await readFile(files.report, 'utf8') }
  }
  return { source, project, round }
}

function review(before: any, after: any) {
  return compareWithHistory({ differences: [after], decisions: new Map([[before.id, {
    id: before.id, disposition: 'keep', identity: { left: before.left.identity, right: before.right.identity },
    reason: 'reviewed contents', recheckWhen: 'either side changes', basis: 'sync specification', evidence: [], decidedAt: NOW, reviewer: 'fixture',
  }]]), history: { status: 'absent', previous: null, detail: '' } })
}

describe('sync review regressions', () => {
  it.each(['upstream', 'local'])('invalidates a decision when a %s-only plugin config changes', async side => {
    const { source, project, round } = await fixture()
    const root = side === 'upstream' ? source : project
    const file = side === 'upstream' ? PTC_UPSTREAM_PRESET : PTC_LOCAL_PRESET
    const text = preset('          - id: tool-only\n            name: example\n            config:\n              allowed: true')
    await put(root, file, text)
    const before = (await round()).check.differences.find((x: any) => x.id === 'ptc.row.tool-only')
    await put(root, file, text.replace('allowed: true', 'allowed: false'))
    const after = (await round()).check.differences.find((x: any) => x.id === before.id)
    expect(review(before, after).entries[0].status).toBe('stale-decision')
  })

  it.each(['upstream', 'local'])('invalidates a read decision when %s behavior changes without renaming tokens', async side => {
    const { source, project, round } = await fixture()
    const before = (await round()).check.differences.find((x: any) => x.id === 'read.difference.canonical-tag')
    const file = side === 'upstream' ? path.join(source, STOCK_READ_FILES.render) : path.join(project, 'packages/tool-read/src/index.ts')
    const text = await readFile(file, 'utf8')
    const updated = side === 'upstream' ? text.replace('return "before"', 'return "after"') : text.replaceAll('tagged: tag !== null', 'tagged: false')
    expect(updated).not.toBe(text)
    await writeFile(file, updated, 'utf8')
    const after = (await round()).check.differences.find((x: any) => x.id === before.id)
    expect(review(before, after).entries[0].status).toBe('stale-decision')
  })

  it.each([false, true])('leaves configuration and directories untouched on a combined refusal (existing=%s)', async existing => {
    const root = await temp()
    const state = path.join(root, 'state')
    if (existing) await run(['config', '--set-evidence-dir', root], { env: {}, stateDir: state })
    const filesBefore = await readdir(root, { recursive: true })
    const config = path.join(state, 'config.json')
    const before = existing ? await readFile(config, 'utf8') : null
    await expect(run(['config', '--set-evidence-dir', path.join(root, 'new-evidence'), '--create', '--set-dsh-checkout', 'relative'],
      { env: {}, stateDir: state })).rejects.toThrow(/absolute/u)
    expect(await readdir(root, { recursive: true })).toEqual(filesBefore)
    if (existing) expect(await readFile(config, 'utf8')).toBe(before)
  })

  it('reports fixed responses and does not falsely deny networking for default queries', async () => {
    const { round } = await fixture()
    const fixed = await round()
    expect(fixed.report).toContain('固定响应')
    const calls: string[][] = []
    const queried = await round({ sources: undefined, deps: { runner: (_command: string, args: string[]) => {
      calls.push(args)
      return JSON.stringify({ versions: ['0.2.1-alpha.4'], 'dist-tags': {} })
    } } })
    expect(calls).toHaveLength(2)
    expect(queried.report).not.toContain('未发网络请求')
    expect(queried.report).toContain('发布查询')
  })
})
