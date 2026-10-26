import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { buildReadWindow } from '../../packages/tool-read/src/window.ts'
import { resolveConfig } from '../../packages/tool-read/src/config.ts'
// @ts-expect-error plain ESM module
import { defaultTasks, buildTaskSuiteConfig } from '../../scripts/evaluation/task-suite.mjs'
// @ts-expect-error plain ESM module
import { buildExperiment } from '../../scripts/evaluation/prepare.mjs'
// @ts-expect-error plain ESM module
import { REQUIRED_TASK_FAMILIES, assertFrozenProtocol } from '../../scripts/evaluation/protocol.mjs'
// @ts-expect-error plain ESM module
import { verifyTree, treeState } from '../../scripts/evaluation/evidence.mjs'
// @ts-expect-error plain ESM module
import { createStimulusController, stimulusSummary } from '../../scripts/evaluation/stimuli.mjs'
// @ts-expect-error plain ESM module
import { runEvaluation, schedule } from '../../scripts/evaluation/run.mjs'

const identity = (c: ReturnType<typeof buildTaskSuiteConfig>) => ({
  dependencies: { packages: {}, patches: {}, resources: {}, inputs: {}, profileInputs: {}, driverInputs: {}, environment: {}, readEngine: 'fixture', editEngine: 'fixture' },
  tools: { providerPlugin: c.provider.plugin, credentialEnv: c.provider.credentialEnv, providerConfig: c.provider.config, presetHash: 'fixture', arms: Object.fromEntries(c.comparison.map((arm: string) => [arm, 'fixture'])) },
})
const configured = () => {
  const c = buildTaskSuiteConfig()
  c.model.model = 'offline-schema-fixture'
  c.budget.maxModelRequests = 300; c.budget.maxTotalTokens = 100000
  c.passConditions.minFirstCandidateCorrect = 1; c.passConditions.maxTotalTokensPerTask = 10000
  return c
}
const temporary = (run: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'evaluation-suite-'))
  try { run(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}
const byId = (id: string) => defaultTasks().find((t: { id: string }) => t.id === id)

describe('reusable candidate task pack', () => {
  it('covers all thirteen families exactly once with stable independent objects', () => {
    const a = defaultTasks(), b = defaultTasks()
    expect(a.map((t: { family: string }) => t.family)).toEqual(REQUIRED_TASK_FAMILIES)
    expect(a).toEqual(b); expect(a).not.toBe(b)
    a[0].expected['account.txt'] = 'bad'
    expect(b[0].expected['account.txt']).toBe('status=active\nowner=example\n')
  })
  it('requires model, budgets and conditions and defaults to bounded probe claims', () => {
    const c = buildTaskSuiteConfig()
    expect(c.kind).toBe('probe'); expect(c.limits.length).toBeGreaterThan(0)
    expect(c.model.model).toBeNull(); expect(c.budget.maxModelRequests).toBeNull()
    expect(c.budget.maxTotalTokens).toBeNull(); expect(c.passConditions.minFirstCandidateCorrect).toBeNull()
    expect(c.passConditions.maxTotalTokensPerTask).toBeNull()
    expect(() => buildExperiment(c, identity(c))).toThrow()
  })
  it('freezes the full pack through the existing prepare path, including formal shape', () => {
    const c = configured(); c.kind = 'formal'
    const p = buildExperiment(c, identity(c), '2026-10-26T00:00:00Z')
    expect(assertFrozenProtocol(p)).toBe(p)
    expect(p.tasks).toHaveLength(13)
    expect(p.passConditions.firstCandidateScope.include).toHaveLength(10)
    expect(p.passConditions.firstCandidateScope.exclude.map((e: { taskId: string }) => e.taskId)).toEqual(['satisfied', 'create', 'generator'])
    p.tasks[0].expected['account.txt'] = 'tampered'
    expect(() => assertFrozenProtocol(p)).toThrow()
  })
  it('schedules identical task inputs for every arm and repetition', () => {
    const c = configured(); c.samples.repetitions = 2
    const p = buildExperiment(c, identity(c)), rows = schedule(p)
    expect(rows).toHaveLength(78)
    for (const t of p.tasks) for (let repeat = 0; repeat < 2; repeat++) {
      expect(rows.filter((r: { taskId: string; repeat: number }) => r.taskId === t.id && r.repeat === repeat).map((r: { arm: string }) => r.arm).sort()).toEqual([...c.comparison].sort())
    }
  })
  it('locates only the second repeated fragment and keeps cross-file goals', () => {
    expect(byId('repeated').expected['records.txt']).toBe('[first]\nstatus=pending\n[second]\nstatus=active\n')
    const multi = byId('multi')
    expect(multi.targets.map((t: { path: string }) => t.path)).toEqual(['a.txt', 'b.txt'])
    expect(verifyTree(multi.initial, multi.expected, { ...multi.expected, 'b.txt': multi.initial['b.txt'] }).correct).toBe(false)
  })
  it('exposes an unrelated truncated line while the complete target can be paged', () => {
    const caps = resolveConfig({}), text = byId('unrelated-long').initial['mixed.txt']
    const window = buildReadWindow(text, { ...caps, offset: 1, limit: 2 }, 'mixed.txt')
    expect(window.lines.map(l => l.complete)).toEqual([false, true])
    expect(buildReadWindow(text, { ...caps, offset: 2, limit: 1 }, 'mixed.txt').lines[0].text).toBe('status=pending')
  })
  it('keeps the target beyond the real default column window and snapshot input above the real default ceiling', () => {
    const caps = resolveConfig({}), long = byId('target-long')
    const window = buildReadWindow(long.initial['long.txt'], { ...caps, offset: 1, limit: 1 }, 'long.txt')
    expect(window.lines[0].complete).toBe(false)
    expect(window.lines[0].text).not.toContain('status=pending')
    expect(Buffer.byteLength(byId('snapshot-limit').initial['large.txt'])).toBeGreaterThanOrEqual(caps.snapshotMaxBytes)
    expect(byId('snapshot-limit').expected['large.txt'].startsWith('status=active\n')).toBe(true)
  })
  it('requires the complete large rewrite, not just a version header change', () => {
    const t = byId('rewrite'), text = t.expected['routes.txt']
    expect(text.split('\n')).toHaveLength(130)
    expect(text).toContain('/route/128=active\n'); expect(text).not.toContain('legacy')
    expect(verifyTree(t.initial, t.expected, { 'routes.txt': t.initial['routes.txt'].replace('version=1', 'version=2') }).correct).toBe(false)
  })
  it('keeps no-op unchanged, creation absent initially, and explicit mode scope in the actual user prompt', () => {
    const noop = byId('satisfied'), create = byId('create'), override = byId('override')
    expect(noop.expected).toEqual(noop.initial); expect(noop.targets).toEqual([])
    expect(create.initial).toEqual({}); expect(create.expected).toEqual({ 'new.txt': 'created=yes\n' })
    expect(override.prompt).toContain('replace mode with old_string/new_string')
  })
  it('applies the frozen read-triggered competitor change and independently requires preserving it', () => temporary(dir => {
    const t = byId('drift'); writeFileSync(join(dir, 'account.txt'), t.initial['account.txt'])
    const control = createStimulusController(t, dir, join(dir, 'evidence'))
    control.read('account.txt', { sessionId: 'fixture', callId: 'read-1' })
    expect(stimulusSummary(t, control.records).status).toBe('PASS')
    expect(readFileSync(join(dir, 'account.txt'), 'utf8')).toBe('status=pending\naudit=peer\n')
    expect(verifyTree(t.initial, t.expected, { 'account.txt': 'status=active\naudit=original\n' }).correct).toBe(false)
  }))
  it('runs the supplied project generator and matches a separately authored expected tree', () => temporary(dir => {
    const t = byId('generator')
    for (const [file, text] of Object.entries(t.initial)) writeFileSync(join(dir, file), text as string)
    const result = spawnSync(process.execPath, ['generate.mjs'], { cwd: dir, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(verifyTree(t.initial, t.expected, treeState(dir)).correct).toBe(true)
    writeFileSync(join(dir, 'source.json'), '{}\n')
    expect(verifyTree(t.initial, t.expected, treeState(dir)).correct).toBe(false)
  }))
  it('emits editable JSON without executing the embedded generator and refuses overwrite', () => temporary(dir => {
    const out = join(dir, 'experiment.json'), cli = fileURLToPath(new URL('../../scripts/evaluation/task-suite.mjs', import.meta.url))
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
    expect(run(out).status).toBe(0)
    const first = readFileSync(out, 'utf8')
    expect(JSON.parse(first).tasks).toHaveLength(13)
    expect(run(out).status).toBe(2); expect(readFileSync(out, 'utf8')).toBe(first)
    expect(run().status).toBe(2); expect(run(out, '--execute').status).toBe(2)
    expect(Object.keys(treeState(dir))).toEqual(['experiment.json'])
  }))
  it('blocks missing credentials/provider without opening a host for the full schedule', async () => {
    const c = configured(), p = buildExperiment(c, identity(c))
    const result = await runEvaluation(p, { profile: join(tmpdir(), 'evaluation-suite-profile-does-not-exist'), out: 'unused', hostFactory: () => { throw new Error('must not start') } })
    expect(result.status).toBe('BLOCKED')
    expect(result.runs).toBeUndefined()
  })
})
