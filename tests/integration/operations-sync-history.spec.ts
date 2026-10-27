/**
 * SYNC-06, ticket 05: repeat checks and review decisions through the public entry.
 *
 * Every case runs the REAL entry against a fixture DSH tree and a real evidence
 * directory, so what is proven here is the observable behaviour of the shipped
 * command: the same round twice, an added difference, a changed end, a bad
 * decision file, a missing or unreadable history, and a source that is gone.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runSyncCheck } from '../../presets/ptc-hashline/operations/sync.mjs'
import {
  DECISIONS_FORMAT,
  normalizeDecisions,
  readDecisions,
  readPreviousRound,
} from '../../presets/ptc-hashline/operations/sync-history.mjs'
import { PTC_UPSTREAM_PRESET } from '../../presets/ptc-hashline/operations/sync-ptc.mjs'
import type { RawReleaseSource } from '../../presets/ptc-hashline/operations/sync.d.mts'

const NOW = '2026-10-27T22:00:00.000Z'
const LATER = '2026-10-27T23:00:00.000Z'
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** Pinned engine answers: this suite is about repeat rounds, not the registry. */
const ENGINE_SOURCES: RawReleaseSource[] = [
  { package: '@hy-sde-org/dsh-hashline', status: 'verified', queriedAt: NOW, source: 'fixture', versions: ['0.2.1-alpha.4'], tags: {} },
  { package: '@hy-sde-org/dsh-tool-edit', status: 'verified', queriedAt: NOW, source: 'fixture', versions: ['0.2.1-alpha.4'], tags: {} },
]

/** A fixture DSH tree whose ptc preset can be varied between rounds. */
async function dshTree(options: { row?: string; prefix?: string } = {}): Promise<string> {
  const root = await temp('sync-history-dsh-')
  const presetPath = path.join(root, ...PTC_UPSTREAM_PRESET.split('/'))
  await mkdir(path.dirname(presetPath), { recursive: true })
  const rows = [
    '- insert:',
    '    - id: preset-ptc',
    "      name: '@deepseek-ai/dsh-agent-preset'",
    '      config:',
    '        id: ptc',
    '        order: 2',
    '        plugins:',
    "          - id: persona",
    "            name: '@deepseek-ai/dsh-persona'",
    '            config:',
    '              prefix: ' + (options.prefix ?? 'You are a coding agent.'),
    options.row ?? "          - id: tool-fs\n            name: '@deepseek-ai/dsh-tool-fs'",
    '',
  ]
  await writeFile(presetPath, rows.join('\n'), 'utf8')
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root', version: '0.2.1-rc.2' }, null, 2) + '\n', 'utf8')
  return root
}

interface RoundResult { code: number; check: Record<string, any>; report: string; directory: string }

/** Run one round against a fixed evidence directory. */
async function round(options: {
  evidence: string
  checkout?: string
  decisions?: string
  now?: string
}): Promise<RoundResult> {
  const state = await temp('sync-history-state-')
  const result = await runSyncCheck({
    env: {},
    now: options.now ?? NOW,
    checkout: options.checkout ?? await dshTree(),
    repository: process.cwd(),
    installationRoot: process.cwd(),
    stateDir: state,
    evidenceDirectory: options.evidence,
    sources: ENGINE_SOURCES,
    ...options.decisions === undefined ? {} : { decisions: options.decisions },
  })
  const directory = (result.value as { evidence?: { directory: string } }).evidence?.directory
  if (directory === undefined) throw new Error('the round wrote nothing: ' + String((result.value as { reason?: string }).reason))
  return {
    code: result.code,
    check: JSON.parse(await readFile(path.join(directory, 'sync.json'), 'utf8')),
    report: await readFile(path.join(directory, 'report.md'), 'utf8'),
    directory,
  }
}

/** A decision document for one difference id and its identities. */
function decisionsFile(decisions: Record<string, unknown>[]): string {
  return JSON.stringify({ format: DECISIONS_FORMAT, decisions }, null, 2) + '\n'
}

function differenceOf(check: Record<string, any>, id: string): Record<string, any> {
  const found = (check.differences as Record<string, any>[]).find(entry => entry.id === id)
  if (found === undefined) throw new Error('no difference ' + id)
  return found
}

function historyOf(check: Record<string, any>): Record<string, any> {
  if (check.history === null || check.history === undefined) throw new Error('the record carries no history section')
  return check.history
}

function entryOf(check: Record<string, any>, id: string): Record<string, any> {
  const found = (historyOf(check).entries as Record<string, any>[]).find(entry => entry.id === id)
  if (found === undefined) throw new Error('no history entry ' + id + '; had: ' + (historyOf(check).entries as Record<string, any>[]).map(entry => entry.id).join(', '))
  return found
}

/** The newest round and everything under the evidence directory. */
async function roundsOf(evidence: string): Promise<string[]> {
  return (await readdir(path.join(evidence, 'sync'))).sort()
}

describe('SYNC-06: a first round and an identical repeat', () => {
  it('says the first round has no history instead of calling everything known', async () => {
    const evidence = await temp('sync-history-evidence-')
    const { check, report } = await round({ evidence })
    const history = historyOf(check)
    expect(history.historyStatus).toBe('absent')
    expect(history.verdict).toBe('first-check')
    expect(history.summary.new).toBe(check.differences.length)
    expect(history.summary.known).toBe(0)
    // No decision file is a normal state, and it never reads as "known".
    expect(history.decisions.status).toBe('absent')
    expect(report).toContain('与上一轮的比较')
    expect(report).toContain('首次检查')
    expect(report).toContain('没有决定记录')
  })

  it('keeps both rounds and reports no new changes on an identical repeat', async () => {
    const evidence = await temp('sync-history-evidence-')
    const first = await round({ evidence })
    const second = await round({ evidence, checkout: first.check.source.resolvedPath, now: LATER })
    const history = historyOf(second.check)
    expect(history.historyStatus).toBe('compared')
    expect(history.previous.checkId).toBe(first.check.checkId)
    expect(history.verdict).toBe('no-new-changes')
    expect(history.summary.new).toBe(0)
    // Every difference is unchanged but still undecided: "not new" is not "known".
    expect(history.summary.undecided).toBe(second.check.differences.length)
    expect(history.summary.known).toBe(0)
    // The earlier round is untouched and both directories exist.
    const rounds = await roundsOf(evidence)
    expect(rounds).toHaveLength(2)
    const firstAgain = JSON.parse(await readFile(path.join(evidence, 'sync', rounds[0], 'sync.json'), 'utf8'))
    expect(firstAgain.checkId).toBe(first.check.checkId)
    expect(firstAgain.history.historyStatus).toBe('absent')
    // Human and structured output agree.
    expect(second.report).toContain('没有新增变化')
    for (const entry of history.entries as Record<string, any>[]) expect(second.report).toContain(entry.id)
  })
})

describe('SYNC-06: a decision binds one object and its reviewed content', () => {
  it('turns a matching decision into a known difference and keeps it out of the new list', async () => {
    const evidence = await temp('sync-history-evidence-')
    const first = await round({ evidence })
    const target = differenceOf(first.check, 'ptc.config.persona.prefix')
    const decisions = path.join(await temp('sync-history-decisions-'), 'decisions.json')
    await writeFile(decisions, decisionsFile([{
      id: 'ptc.config.persona.prefix',
      disposition: 'keep',
      reason: '本项目的 persona 前缀有意与上游不同',
      identity: { left: target.left.identity, right: target.right.identity },
      recheckWhen: '上游 persona 前缀内容变化时重新评审',
      basis: 'docs/specs/2026-10-27-upstream-sync-requirements.md',
      decidedAt: '2026-10-27',
    }]), 'utf8')
    const second = await round({ evidence, decisions, checkout: first.check.source.resolvedPath, now: LATER })
    const history = historyOf(second.check)
    expect(history.decisions.status).toBe('loaded')
    expect(history.decisions.count).toBe(1)
    expect(entryOf(second.check, 'ptc.config.persona.prefix').status).toBe('known')
    expect(entryOf(second.check, 'ptc.config.persona.prefix').disposition).toBe('keep')
    expect(history.summary.known).toBe(1)
    expect(second.report).toContain('已知差异（决定有效）')
  })

  it('puts the decision back in review when either end changes', async () => {
    const evidence = await temp('sync-history-evidence-')
    const first = await round({ evidence })
    const target = differenceOf(first.check, 'ptc.config.persona.prefix')
    const decisions = path.join(await temp('sync-history-decisions-'), 'decisions.json')
    await writeFile(decisions, decisionsFile([{
      id: 'ptc.config.persona.prefix',
      disposition: 'keep',
      reason: '本项目的 persona 前缀有意与上游不同',
      identity: { left: target.left.identity, right: target.right.identity },
      recheckWhen: '上游 persona 前缀内容变化时重新评审',
    }]), 'utf8')
    // The upstream side of the SAME object moves: same id, different identity.
    const changed = await dshTree({ prefix: 'You are a different agent.' })
    const second = await round({ evidence, decisions, checkout: changed, now: LATER })
    const entry = entryOf(second.check, 'ptc.config.persona.prefix')
    expect(entry.note).toContain('决定绑定的内容已变化')
    expect(historyOf(second.check).verdict).toBe('decisions-need-review')
    expect(second.report).toContain('旧决定需复查')
  })

  it('reports a decision whose object disappeared instead of dropping it', async () => {
    const evidence = await temp('sync-history-evidence-')
    const decisions = path.join(await temp('sync-history-decisions-'), 'decisions.json')
    await writeFile(decisions, decisionsFile([{
      id: 'ptc.row.vanished',
      disposition: 'keep',
      reason: '一个已经不存在对象的旧决定',
      identity: { left: 'aaa', right: 'bbb' },
      recheckWhen: '对象重新出现时',
    }]), 'utf8')
    const { check, report } = await round({ evidence, decisions })
    const history = historyOf(check)
    expect(history.summary.orphans).toBe(1)
    expect(history.orphans[0].id).toBe('ptc.row.vanished')
    expect(history.verdict).toBe('decisions-need-review')
    expect(report).toContain('需要重新评审的旧决定')
    expect(report).toContain('ptc.row.vanished')
  })

  it('refuses to call an unreadable side not-applicable or still-settled', async () => {
    const evidence = await temp('sync-history-evidence-')
    const first = await round({ evidence })
    // A patch item's source side is always pending-verification: no content to
    // confirm a settled decision against.
    const patch = differenceOf(first.check, 'engines.hashline.patch[0]')
    expect(patch.right.identity).toBe('pending-verification')
    const decisions = path.join(await temp('sync-history-decisions-'), 'decisions.json')
    await writeFile(decisions, decisionsFile([{
      id: 'engines.hashline.patch[0]',
      disposition: 'not-applicable',
      reason: '以为补丁不需要再管',
      identity: { left: patch.left.identity, right: patch.right.identity },
      recheckWhen: '候选包文本取得时',
    }]), 'utf8')
    const second = await round({ evidence, decisions, checkout: first.check.source.resolvedPath, now: LATER })
    const entry = entryOf(second.check, 'engines.hashline.patch[0]')
    expect(entry.status).toBe('stale-decision')
    expect(entry.note).toContain('没有取得')
  })
})

describe('SYNC-06: new changes are never swallowed', () => {
  it('marks a difference that appears only in the new round as new', async () => {
    const evidence = await temp('sync-history-evidence-')
    const first = await round({ evidence })
    const changed = await dshTree({ row: "          - id: tool-fs\n            name: '@deepseek-ai/dsh-tool-fs'\n            extra-field: unexpected\n          - id: tool-new\n            name: '@deepseek-ai/dsh-tool-new'" })
    const second = await round({ evidence, checkout: changed, now: LATER })
    const history = historyOf(second.check)
    expect(history.verdict).toBe('new-changes')
    expect(history.summary.new).toBeGreaterThan(0)
    const newIds = (history.entries as Record<string, any>[]).filter(entry => entry.status === 'new').map(entry => entry.id)
    expect(newIds).toContain('ptc.row.tool-new')
    expect(second.report).toContain('有新增变化')
    // A new object is NOT covered by the existing decisions.
    expect(history.summary.known).toBe(0)
  })
})

describe('SYNC-06: a history that cannot be read is not a first check', () => {
  it('distinguishes a missing round from a corrupt one', async () => {
    const evidence = await temp('sync-history-evidence-')
    const first = await round({ evidence })
    // Corrupt the newest record: the round must say so, not "first check".
    await writeFile(path.join(first.directory, 'sync.json'), '{not json', 'utf8')
    const second = await round({ evidence, checkout: first.check.source.resolvedPath, now: LATER })
    const history = historyOf(second.check)
    expect(history.historyStatus).toBe('unreadable')
    expect(history.verdict).toBe('history-unavailable')
    expect(history.previous).toBeNull()
    expect(second.report).toContain('上一轮记录读不出')
    // The current round still produced its own differences.
    expect(second.check.differences.length).toBeGreaterThan(0)
  })

  it('refuses to compare against an unsupported record format', async () => {
    const evidence = await temp('sync-history-evidence-')
    const first = await round({ evidence })
    const record = JSON.parse(await readFile(path.join(first.directory, 'sync.json'), 'utf8'))
    record.reportFormat = 'ptc-hashline-upstream-sync/0'
    await writeFile(path.join(first.directory, 'sync.json'), JSON.stringify(record, null, 2) + '\n', 'utf8')
    const second = await round({ evidence, checkout: first.check.source.resolvedPath, now: LATER })
    expect(historyOf(second.check).historyStatus).toBe('unsupported')
    expect(second.report).toContain('格式不受支持')
  })
})

describe('SYNC-06: the decision file is validated, all or nothing', () => {
  it('refuses the whole file on one bad decision and applies none of it', async () => {
    const evidence = await temp('sync-history-evidence-')
    const first = await round({ evidence })
    const target = differenceOf(first.check, 'ptc.config.persona.prefix')
    const decisions = path.join(await temp('sync-history-decisions-'), 'decisions.json')
    // One valid decision and one that would let a wildcard swallow new objects.
    await writeFile(decisions, decisionsFile([
      { id: 'ptc.config.persona.prefix', disposition: 'keep', reason: '有效的一条决定', identity: { left: target.left.identity, right: target.right.identity }, recheckWhen: '上游变化时' },
      { id: 'ptc.row.*', disposition: 'keep', reason: '通配符决定', identity: { left: 'x', right: 'y' }, recheckWhen: '永远' },
    ]), 'utf8')
    const second = await round({ evidence, decisions, checkout: first.check.source.resolvedPath, now: LATER })
    const history = historyOf(second.check)
    expect(history.decisions.status).toBe('invalid')
    expect(history.decisions.count).toBe(0)
    expect(history.summary.known).toBe(0)
    expect(second.report).toContain('决定记录无效')
    // The valid first entry is NOT applied either: all or nothing.
    expect(entryOf(second.check, 'ptc.config.persona.prefix').status).toBe('undecided')
  })

  it('validates the fields a decision must carry', () => {
    const base = { format: DECISIONS_FORMAT, decisions: [] }
    expect(() => normalizeDecisions({ ...base, format: 'other/1' })).toThrow(/format must be/u)
    expect(() => normalizeDecisions({ format: DECISIONS_FORMAT, decisions: 'no' })).toThrow(/must be an array/u)
    expect(() => normalizeDecisions({ format: DECISIONS_FORMAT, decisions: [{ id: '', disposition: 'keep', reason: 'x', identity: { left: 'a', right: 'b' }, recheckWhen: 'y' }] })).toThrow(/non-empty string/u)
    expect(() => normalizeDecisions({ format: DECISIONS_FORMAT, decisions: [{ id: 'a*', disposition: 'keep', reason: 'x', identity: { left: 'a', right: 'b' }, recheckWhen: 'y' }] })).toThrow(/wildcards are refused/u)
    expect(() => normalizeDecisions({ format: DECISIONS_FORMAT, decisions: [{ id: 'a', disposition: 'maybe', reason: 'x', identity: { left: 'a', right: 'b' } }] })).toThrow(/disposition must be one of/u)
    expect(() => normalizeDecisions({ format: DECISIONS_FORMAT, decisions: [{ id: 'a', disposition: 'keep', reason: '这个决定说明了理由', identity: { left: 'a', right: 'b' } }] })).toThrow(/recheckWhen is required/u)
    expect(() => normalizeDecisions({ format: DECISIONS_FORMAT, decisions: [{ id: 'a', disposition: 'keep', reason: '这个决定说明了理由', identity: { left: 'a' }, recheckWhen: 'y' }] })).toThrow(/both sides/u)
    expect(() => normalizeDecisions({ format: DECISIONS_FORMAT, decisions: [
      { id: 'a', disposition: 'keep', reason: '这个决定说明了理由', identity: { left: 'a', right: 'b' }, recheckWhen: 'y' },
      { id: 'a', disposition: 'keep', reason: '这个决定说明了理由', identity: { left: 'a', right: 'b' }, recheckWhen: 'y' },
    ] })).toThrow(/repeats id/u)
    // A complete decision passes.
    const ok = normalizeDecisions({ format: DECISIONS_FORMAT, decisions: [{ id: 'a', disposition: 'pending-analysis', reason: '需要再看', identity: { left: 'a', right: 'b' } }] })
    expect(ok.get('a')?.disposition).toBe('pending-analysis')
  })

  it('reports a missing decision file as absent, never as known', async () => {
    const missing = path.join(await temp('sync-history-absent-'), 'decisions.json')
    const read = await readDecisions({ path: missing })
    expect(read.status).toBe('absent')
    expect(read.decisions.size).toBe(0)
    expect(read.detail).toContain('没有审阅决定记录')
  })
})

describe('SYNC-06: the history of the entry itself', () => {
  it('reads the newest round and skips nothing silently', async () => {
    const evidence = await temp('sync-history-evidence-')
    await round({ evidence })
    const read = readPreviousRound({ evidenceDirectory: evidence, format: 'ptc-hashline-upstream-sync/1' })
    expect(read.status).toBe('compared')
    expect(read.previous?.differences.size).toBeGreaterThan(0)
    // A format this build does not speak is a refusal, not an empty comparison.
    const other = readPreviousRound({ evidenceDirectory: evidence, format: 'something/else' })
    expect(other.status).toBe('unsupported')
    const empty = await temp('sync-history-empty-')
    expect(readPreviousRound({ evidenceDirectory: empty, format: 'ptc-hashline-upstream-sync/1' }).status).toBe('absent')
  })

  it('keeps the checkId content-addressed and independent of the decision file', async () => {
    const evidence = await temp('sync-history-evidence-')
    const first = await round({ evidence })
    // A decision file changes NOTHING about the round's identity.
    const decisions = path.join(await temp('sync-history-decisions-'), 'decisions.json')
    await writeFile(decisions, decisionsFile([]), 'utf8')
    const fresh = await temp('sync-history-evidence2-')
    const same = await round({ evidence: fresh, decisions, checkout: first.check.source.resolvedPath })
    expect(same.check.contentHash).toBe(first.check.contentHash)
    expect(same.check.checkId).toBe(first.check.checkId)
  })

  it('keeps two rounds of the same second instead of overwriting the first', async () => {
    const evidence = await temp('sync-history-evidence-')
    const checkout = await dshTree()
    const first = await round({ evidence, checkout, now: NOW })
    const firstBytes = await readFile(path.join(first.directory, 'sync.json'), 'utf8')
    // Identical inputs AND identical timestamp: the same checkId again, so the
    // second round has to take the collision suffix rather than overwrite.
    const second = await round({ evidence, checkout, now: NOW })
    expect(second.check.checkId).toBe(first.check.checkId)
    expect(second.directory).toBe(first.directory + '-2')
    expect(await roundsOf(evidence)).toHaveLength(2)
    expect(await readFile(path.join(first.directory, 'sync.json'), 'utf8')).toBe(firstBytes)
    expect(historyOf(second.check).previous.checkId).toBe(first.check.checkId)
  })
})
