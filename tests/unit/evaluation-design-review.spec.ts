import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
// @ts-expect-error plain ESM module
import { reviewDesign } from '../../scripts/evaluation/review-design.mjs'
// @ts-expect-error plain ESM module
import { armRows } from '../../scripts/evaluation/identity.mjs'
// @ts-expect-error plain ESM module
import { buildExperiment } from '../../scripts/evaluation/prepare.mjs'
// @ts-expect-error plain ESM module
import { protocolHash, freezeProtocol } from '../../scripts/evaluation/protocol.mjs'
// @ts-expect-error plain ESM module
import { CONDITION_SEMANTICS } from '../../scripts/evaluation/verdict.mjs'

const rows = () => [
  { id: 'tool-fs', name: 'fs', config: { read: false, edit: false, readMaxLineLength: 2000 } },
  { id: 'tool-read', name: 'read', config: { maxLineLength: 2000, snapshotMaxBytes: 4194304 } },
  { id: 'tool-edit', name: 'edit', config: { mode: 'auto', unrelated: 'do-not-export-fixture' } },
  { id: 'watchdog', name: 'gate', config: { enabled: true } },
]
const config = () => {
  const c = JSON.parse(readFileSync(new URL('../../scripts/evaluation/experiment.example.json', import.meta.url), 'utf8'))
  c.model.model = 'schema-only'; c.budget.maxModelRequests = 30; c.budget.maxTotalTokens = 1000
  c.passConditions.minFirstCandidateCorrect = 1; c.passConditions.maxTotalTokensPerTask = 10
  return c
}
const freeze = (c = config(), base = rows()) => buildExperiment(c, {
  dependencies: { packages: {}, patches: {}, resources: {}, inputs: {}, profileInputs: {}, driverInputs: {}, environment: {}, readEngine: 'fixture', editEngine: 'fixture' },
  tools: { providerPlugin: c.provider.plugin, credentialEnv: c.provider.credentialEnv, providerConfig: c.provider.config, presetHash: protocolHash(base), arms: Object.fromEntries(c.comparison.map((arm: string) => [arm, protocolHash(armRows(base, arm))])) },
})
describe('frozen design review facts', () => {
  it('identifies actual plugin differences while retaining shared rows', () => {
    const result = reviewDesign(freeze(), rows())
    expect(result.status).toBe('GAP')
    expect(result.comparison.pairs).toEqual([
      { left: 'stock-edit', right: 'hashline-default', changedPlugins: ['tool-edit', 'tool-fs', 'tool-read'] },
      { left: 'stock-edit', right: 'hashline-fallback', changedPlugins: ['tool-edit', 'tool-fs', 'tool-read'] },
      { left: 'hashline-default', right: 'hashline-fallback', changedPlugins: ['tool-edit'] },
    ])
    expect(result.comparison.plugins.find((p: { id: string }) => p.id === 'watchdog').identical).toBe(true)
    expect(result.comparison.purePolicyCausality).toBe('not-established')
  })
  it('shows whitelisted filesystem settings without exporting arbitrary row data', () => {
    const result = reviewDesign(freeze(), rows()), edit = result.comparison.plugins.find((p: { id: string }) => p.id === 'tool-edit')
    expect(edit.configurations['hashline-default'].settings).toEqual({ mode: 'hashline' })
    expect(edit.configurations['hashline-fallback'].settings).toEqual({ mode: 'auto' })
    expect(edit.configurations['stock-edit']).toEqual({ present: false })
    expect(JSON.stringify(result)).not.toContain('do-not-export-fixture')
  })
  it('respects selected arms, seed-independent counts and all repetitions', () => {
    const c = config(); c.comparison = ['hashline-default', 'hashline-fallback']; c.samples.repetitions = 3
    const result = reviewDesign(freeze(c), rows())
    expect(result.comparison.pairs).toHaveLength(1)
    expect(result.tasks).toMatchObject({ count: 1, repetitions: 3, scheduledSamples: 6, perArmFirstDenominator: 3, perArmFinalAndTokenDenominator: 3 })
  })
  it('retains excluded tasks in final and token counts and labels authored scope', () => {
    const c = config(); c.samples.repetitions = 2
    c.tasks.push({ ...c.tasks[0], id: 'noop', family: 'already-satisfied', class: 'no-change-needed', targets: [], expected: c.tasks[0].initial, batchBoundary: 'task-end' })
    c.passConditions.firstCandidateScope.exclude.push({ taskId: 'noop', reason: 'No edit required.' })
    const result = reviewDesign(freeze(c), rows())
    expect(result.tasks).toMatchObject({ count: 2, scheduledSamples: 12, firstCandidateScopeStatus: 'frozen-v2', perArmFirstDenominator: 2, perArmFinalAndTokenDenominator: 4 })
    expect(result.tasks.firstCandidateExclude).toEqual(c.passConditions.firstCandidateScope.exclude)
    expect(result.evidenceLimits.some((g: { id: string }) => g.id === 'authored-first-scope')).toBe(true)
  })
  it('preserves all-task v1 and does not infer historical condition semantics', () => {
    const c = config(); delete c.passConditions.firstCandidateScope
    c.passConditions.semantics = CONDITION_SEMANTICS
    expect(reviewDesign(freeze(c), rows()).tasks.firstCandidateScopeStatus).toBe('all-tasks-v1')
    delete c.passConditions.semantics
    const result = reviewDesign(freeze(c), rows())
    expect(result.tasks.perArmFirstDenominator).toBeNull()
    expect(result.tasks.firstCandidateInclude).toEqual([])
    expect(result.evidenceLimits.some((g: { id: string }) => g.id === 'condition-semantics')).toBe(true)
  })
  it('flags the possible multistage first-program confound without claiming behavior was observed', () => {
    const c = config(); c.tasks[0].family = 'consecutive-edits'
    const result = reviewDesign(freeze(c), rows())
    expect(result.evidenceLimits.some((g: { id: string }) => g.id === 'multi-stage-first-candidate')).toBe(true)
    expect(result.tasks.families['consecutive-edits']).toEqual(['status-update'])
    expect(result.tasks.families['creation']).toEqual([])
    c.tasks[0].batchBoundary = 'task-end'
    expect(reviewDesign(freeze(c), rows()).evidenceLimits.some((g: { id: string }) => g.id === 'multi-stage-first-candidate')).toBe(false)
  })
  it('rejects changed actual composition and frozen arm hashes', () => {
    const p = freeze(), changed = rows(); changed[3].config.enabled = false
    expect(() => reviewDesign(p, changed)).toThrow('EVAL_PRESET_DRIFT')
    const c = config(), invalidIdentity = rows()
    // The input protocol itself must remain valid; freeze a deliberately mismatched captured arm identity.
    const q = freeze(c, invalidIdentity)
    const body = JSON.parse(JSON.stringify(q)); delete body.protocolHash; delete body.frozenAt
    body.tools.arms['stock-edit'] = 'wrong'
    expect(() => reviewDesign(freezeProtocol(body), rows())).toThrow('EVAL_ARM_DRIFT')
  })
  it('rejects duplicate plugin ids and modified frozen task data', () => {
    const base = rows(); base.push({ ...base[3] })
    expect(() => reviewDesign(freeze(config(), base), base)).toThrow('distinct plugin ids')
    const p = freeze(); p.tasks[0].expected['account.txt'] = 'changed'
    expect(() => reviewDesign(p, rows())).toThrow()
  })
})
