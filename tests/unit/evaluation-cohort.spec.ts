import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
// @ts-expect-error plain ESM module
import { COHORT_CONDITION_SEMANTICS, CONDITION_SEMANTICS, firstCandidateScopeGaps, evaluateConditions, summarizeCoverage } from '../../scripts/evaluation/verdict.mjs'
// @ts-expect-error plain ESM module
import { buildExperiment } from '../../scripts/evaluation/prepare.mjs'
// @ts-expect-error plain ESM module
import { REQUIRED_TASK_FAMILIES, assertFrozenProtocol } from '../../scripts/evaluation/protocol.mjs'

const task = (id: string, family = 'single-point') => ({ id, family, prompt: 'fixture', class: 'known-applicable', batchBoundary: 'first-edit-program', initial: { 'a.txt': 'x' }, expected: { 'a.txt': 'y' } })
const config = () => {
  const c = JSON.parse(readFileSync(new URL('../../scripts/evaluation/experiment.example.json', import.meta.url), 'utf8'))
  c.model.model = 'fixture'; c.budget.maxModelRequests = 30; c.budget.maxTotalTokens = 100
  c.samples.repetitions = 2
  c.tasks = [task('edit'), { ...task('noop', 'already-satisfied'), batchBoundary: 'task-end', class: 'no-change-needed', expected: { 'a.txt': 'x' } }, { ...task('write', 'creation'), batchBoundary: 'task-end', class: 'declared-exception', initial: {} }]
  c.passConditions = { semantics: COHORT_CONDITION_SEMANTICS, minFirstCandidateCorrect: 2, maxTotalTokensPerTask: 4, firstCandidateScope: { include: ['edit'], exclude: [{ taskId: 'noop', reason: 'No edits required.' }, { taskId: 'write', reason: 'Write-only task.' }] } }
  return c
}
const freeze = (c = config()) => buildExperiment(c, {
  dependencies: { packages: {}, patches: {}, resources: {}, inputs: {}, profileInputs: {}, driverInputs: {}, environment: {}, readEngine: 'fixture', editEngine: 'fixture' },
  tools: { presetHash: 'fixture', arms: Object.fromEntries(c.comparison.map((arm: string) => [arm, 'fixture'])), providerPlugin: c.provider.plugin, credentialEnv: c.provider.credentialEnv, providerConfig: c.provider.config },
})
const runs = (p = freeze()) => p.comparison.flatMap((arm: string) => p.tasks.flatMap((t: { id: string }) => Array.from({ length: p.samples.repetitions }, (_, repeat) => ({ taskId: t.id, arm, repeat, status: 'PASS', finalCorrect: true, trace: { firstCandidateCorrect: t.id === 'edit' ? true : 'unknown', costs: { totalTokens: t.id === 'noop' ? 2 : 4 } } }))))

describe('frozen first-candidate cohort', () => {
  it('measures the frozen cohort across every repetition and arm, retaining whole-task coverage', () => {
    const p = freeze(), data = runs(p), result = evaluateConditions(p, data)
    expect(result.version).toBe(2); expect(result.status).toBe('PASS')
    for (const arm of p.comparison) {
      expect(result.arms[arm].firstCandidateCorrect).toMatchObject({ correct: 2, measured: 2, unknown: 0, denominator: 2, cohort: { include: ['edit'], excludedSamples: 4 } })
      expect(result.arms[arm].firstCandidateCorrect.cohort.exclude).toEqual(p.passConditions.firstCandidateScope.exclude)
      expect(result.arms[arm].totalTokens).toMatchObject({ measured: 6, unknown: 0, denominator: 6, knownSum: 20 })
      expect(summarizeCoverage(data, p.comparison).arms[arm].firstCandidateCorrect).toMatchObject({ denominator: 6, measured: 2, unknown: 4 })
    }
  })
  it('never promotes an excluded success into the selected first-correct numerator', () => {
    const p = freeze(), data = runs(p)
    for (const run of data) run.trace.firstCandidateCorrect = run.taskId !== 'edit'
    const result = evaluateConditions(p, data)
    expect(result.status).toBe('FAIL')
    expect(result.arms[p.comparison[0]].firstCandidateCorrect.correct).toBe(0)
  })
  it('keeps an included unknown in its denominator', () => {
    const p = freeze(), data = runs(p)
    data[0].trace.firstCandidateCorrect = 'unknown'
    const result = evaluateConditions(p, data)
    expect(result.status).toBe('GAP')
    expect(result.arms[p.comparison[0]].firstCandidateCorrect).toMatchObject({ measured: 1, unknown: 1, denominator: 2 })
  })
  it.each(['over-limit', 'missing-usage'])('does not exclude %s Token evidence', kind => {
    const p = freeze(), data = runs(p), outside = data.find((r: { taskId: string }) => r.taskId === 'write')
    outside.trace.costs.totalTokens = kind === 'over-limit' ? 5 : 'unknown'
    const result = evaluateConditions(p, data)
    expect(result.status).toBe(kind === 'over-limit' ? 'FAIL' : 'GAP')
    expect(result.arms[p.comparison[0]].firstCandidateCorrect.status).toBe('PASS')
  })
  it('does not remove excluded tasks from the required schedule', () => {
    const p = freeze(), data = runs(p).filter((r: { taskId: string }) => r.taskId !== 'write')
    expect(evaluateConditions(p, data)).toMatchObject({ status: 'GAP', reason: 'schedule-mismatch' })
  })
  it('marks an explicitly empty probe metric NOT_APPLICABLE with null rates', () => {
    const c = config(); c.passConditions.minFirstCandidateCorrect = 0
    c.passConditions.firstCandidateScope = { include: [], exclude: c.tasks.map((t: { id: string }) => ({ taskId: t.id, reason: 'Not measured in this probe.' })) }
    const p = freeze(c), result = evaluateConditions(p, runs(p))
    expect(result.status).toBe('PASS')
    expect(result.arms[p.comparison[0]].firstCandidateCorrect).toMatchObject({ status: 'NOT_APPLICABLE', measured: 0, denominator: 0, rateOnMeasured: null, rateBounds: { lower: null, upper: null } })
    expect(result.arms[p.comparison[0]].totalTokens.denominator).toBe(6)
  })
  it('preserves v1 all-task semantics and its serialized condition shape', () => {
    const c = config(); c.passConditions = { semantics: CONDITION_SEMANTICS, minFirstCandidateCorrect: 2, maxTotalTokensPerTask: 4 }
    const p = freeze(c), result = evaluateConditions(p, runs(p))
    expect(result.version).toBe(1); expect(result.status).toBe('GAP')
    expect(result.arms[p.comparison[0]].firstCandidateCorrect.denominator).toBe(6)
    expect(result.arms[p.comparison[0]].firstCandidateCorrect).not.toHaveProperty('cohort')
  })
  it.each(['missing', 'null', 'array', 'include-shape', 'exclude-shape', 'omitted-task', 'duplicate', 'overlap', 'unknown-include', 'unknown-exclude', 'reason', 'extra-field', 'extra-entry', 'too-large', 'empty-min', 'v1-scope', 'legacy-scope'])('refuses %s before execution', kind => {
    const c = config(), scope = c.passConditions.firstCandidateScope
    if (kind === 'missing') delete c.passConditions.firstCandidateScope
    if (kind === 'null') c.passConditions.firstCandidateScope = null
    if (kind === 'array') c.passConditions.firstCandidateScope = []
    if (kind === 'include-shape') scope.include = 'edit'
    if (kind === 'exclude-shape') scope.exclude = {}
    if (kind === 'omitted-task') scope.exclude.pop()
    if (kind === 'duplicate') scope.include.push('edit')
    if (kind === 'overlap') scope.exclude.push({ taskId: 'edit', reason: 'Overlap.' })
    if (kind === 'unknown-include') scope.include[0] = 'unknown'
    if (kind === 'unknown-exclude') scope.exclude[0].taskId = 'unknown'
    if (kind === 'reason') scope.exclude[0].reason = ' '
    if (kind === 'extra-field') scope.automatic = true
    if (kind === 'extra-entry') scope.exclude[0].automatic = true
    if (kind === 'too-large') c.passConditions.minFirstCandidateCorrect = 3
    if (kind === 'empty-min') scope.include = []
    if (kind === 'v1-scope') c.passConditions.semantics = CONDITION_SEMANTICS
    if (kind === 'legacy-scope') delete c.passConditions.semantics
    expect(firstCandidateScopeGaps(c).length).toBeGreaterThan(0)
    expect(() => freeze(c)).toThrow()
  })
  it('allows a nonempty scoped formal configuration but refuses all-excluded formal', () => {
    const c = config(); c.kind = 'formal'
    c.tasks = REQUIRED_TASK_FAMILIES.map((family: string) => task(family, family))
    c.passConditions.firstCandidateScope = { include: [c.tasks[0].id], exclude: c.tasks.slice(1).map((t: { id: string }) => ({ taskId: t.id, reason: 'Outside this explicitly frozen metric.' })) }
    expect(() => freeze(c)).not.toThrow()
    c.passConditions.firstCandidateScope.include = []
    c.passConditions.firstCandidateScope.exclude = c.tasks.map((t: { id: string }) => ({ taskId: t.id, reason: 'Excluded.' }))
    c.passConditions.minFirstCandidateCorrect = 0
    expect(firstCandidateScopeGaps(c).join()).toContain('formal requires a nonempty')
    expect(() => freeze(c)).toThrow()
  })
  it('rejects a reason changed after freeze even when the partition remains valid', () => {
    const p = freeze(); p.passConditions.firstCandidateScope.exclude[0].reason = 'Rewritten after observing the results.'
    expect(() => assertFrozenProtocol(p)).toThrow('DRIFTED')
  })
})
