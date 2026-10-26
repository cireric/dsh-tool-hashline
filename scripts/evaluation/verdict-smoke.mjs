/** Actual installed-host condition checks, with a fixed zero-network provider. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { captureIdentity } from './identity.mjs'
import { captureTools } from './host.mjs'
import { freezeProtocol } from './protocol.mjs'
import { runEvaluation } from './run.mjs'
import { CONDITION_SEMANTICS, COHORT_CONDITION_SEMANTICS } from './verdict.mjs'

const [profileArg, outArg] = process.argv.slice(2)
if (!profileArg || !outArg) throw new Error('usage: verdict-smoke.mjs <disposable-profile-with-matching-fixture> <new-output-directory>')
const profile = path.resolve(profileArg), out = path.resolve(outArg)
assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8')).name, 'dsh-profile-acceptance')
assert.equal(fs.readFileSync(path.join(profile, 'node_modules/evaluation-fixture-provider/index.mjs'), 'utf8'), fs.readFileSync(new URL('../../tests/fixtures/evaluation-provider/index.mjs', import.meta.url), 'utf8'), 'run smoke.mjs on a fresh disposable installation first')
fs.mkdirSync(out)
const prior = process.env.EVAL_FIXTURE_KEY, results = []
process.env.EVAL_FIXTURE_KEY = 'offline-fixture-only'
try {
  const dependencies = captureIdentity(profile, 'evaluation-fixture-provider')
  const tools = await captureTools(profile, 'evaluation-fixture-provider', 'EVAL_FIXTURE_KEY')
  const target = (classification = 'known-applicable') => [{ id: 'goal', path: 'a.txt', class: classification, goal: 'match independent expected bytes' }]
  const single = { id: 'single', family: 'single-point', class: 'known-applicable', batchBoundary: 'first-edit-program', initial: { 'a.txt': 'x\n' }, expected: { 'a.txt': 'y\n' }, prompt: 'Change x to y in a.txt.', targets: target() }
  const noop = { id: 'noop', family: 'already-satisfied', class: 'no-change-needed', batchBoundary: 'task-end', initial: { 'a.txt': 'x\n' }, expected: { 'a.txt': 'x\n' }, prompt: 'fixture:noop', targets: target('no-change-needed') }
  const write = { id: 'write', family: 'creation', class: 'declared-exception', batchBoundary: 'task-end', initial: {}, expected: { 'a.txt': 'y\n' }, prompt: 'fixture:write-only', targets: target('declared-exception') }
  const exclusions = [{ taskId: 'noop', reason: 'No edits required by the task.' }, { taskId: 'write', reason: 'Write-only task has no edit-program candidate.' }]
  const v1 = { semantics: CONDITION_SEMANTICS, minFirstCandidateCorrect: 1, maxTotalTokensPerTask: 100 }
  const v2 = { ...v1, semantics: COHORT_CONDITION_SEMANTICS, maxTotalTokensPerTask: 4, firstCandidateScope: { include: ['single'], exclude: exclusions } }
  const cases = [
    { id: 'pass', tasks: [single], conditions: v1 },
    { id: 'token-fail', tasks: [single], conditions: { ...v1, maxTotalTokensPerTask: 0 }, expectedConditions: 'FAIL', expectedJudge: 'FAIL' },
    { id: 'first-unknown', tasks: [{ ...single, batchBoundary: 'task-end' }], conditions: v1, expectedConditions: 'GAP', expectedJudge: 'GAP' },
    { id: 'cohort-pass', tasks: [single, noop, write], conditions: v2 },
    { id: 'cohort-unscoped', tasks: [single, noop, write], conditions: v1, expectedConditions: 'GAP', expectedJudge: 'GAP' },
    { id: 'excluded-token-fail', tasks: [single, noop, { ...write, prompt: 'fixture:write-only-expensive' }], conditions: v2, expectedConditions: 'FAIL', expectedJudge: 'FAIL' },
    { id: 'excluded-final-fail', tasks: [single, noop, { ...write, prompt: 'fixture:write-only-wrong' }], conditions: v2, expectedTask: 'FAIL', expectedJudge: 'FAIL' },
    { id: 'empty-cohort', tasks: [noop, write], conditions: { ...v2, minFirstCandidateCorrect: 0, firstCandidateScope: { include: [], exclude: exclusions } } },
    { id: 'selected-unknown', tasks: [{ ...single, batchBoundary: 'task-end' }, noop, write], conditions: v2, expectedConditions: 'GAP', expectedJudge: 'GAP' },
  ]
  for (const item of cases) {
    const scenario = { expectedTask: 'PASS', expectedConditions: 'PASS', expectedJudge: 'PASS', ...item }
    const protocol = freezeProtocol({
      id: 'offline-verdict-' + scenario.id, kind: 'probe', limits: ['Fixed provider only; no real model or promotion evidence.'], createdAt: new Date().toISOString(),
      comparison: ['stock-edit', 'hashline-fallback'], model: { provider: 'eval-fixture', model: 'fixture', parameters: {} }, dependencies, tools,
      samples: { repetitions: 1, seed: 2 }, order: 'interleaved', budget: { maxModelRequests: 30, maxTotalTokens: 200, timeoutMs: 20000 },
      passConditions: scenario.conditions, tasks: scenario.tasks,
    })
    const directory = path.join(out, scenario.id), report = await runEvaluation(protocol, { profile, out: directory, execute: true })
    assert.equal(report.status, scenario.expectedTask)
    assert.equal(report.conditions.status, scenario.expectedConditions)
    for (const arm of protocol.comparison) {
      const first = report.conditions.arms[arm].firstCandidateCorrect
      if (scenario.id === 'cohort-pass') { assert.equal(first.denominator, 1); assert.equal(first.unknown, 0); assert.equal(report.coverage.arms[arm].firstCandidateCorrect.unknown, 2); assert.equal(first.cohort.excludedSamples, 2) }
      if (scenario.id === 'empty-cohort') { assert.equal(first.status, 'NOT_APPLICABLE'); assert.equal(first.denominator, 0); assert.equal(first.rateOnMeasured, null) }
      if (scenario.id === 'excluded-token-fail') assert.deepEqual(report.conditions.arms[arm].totalTokens.violations.map(v => v.taskId), ['write'])
      if (scenario.id === 'selected-unknown') assert.equal(first.unknown, 1)
    }
    const driver = fileURLToPath(new URL('./driver.mjs', import.meta.url))
    const args = [path.join(directory, 'protocol.json'), path.join(directory, 'report.json')]
    const checked = spawnSync(process.execPath, [driver, 'check', ...args], { encoding: 'utf8' })
    assert.equal(checked.status, 0, checked.stderr)
    const judged = spawnSync(process.execPath, [driver, 'judge', ...args], { encoding: 'utf8' })
    const expectedExit = scenario.expectedJudge === 'PASS' ? 0 : 2
    assert.equal(judged.status, expectedExit, judged.stderr)
    assert.equal(JSON.parse(judged.stdout).status, scenario.expectedJudge)
    results.push({ scenario: scenario.id, assertions: 'PASS', taskEvidenceStatus: report.status, conditionStatus: report.conditions.status, judgeStatus: scenario.expectedJudge, accounting: report.accounting, coverage: report.coverage, conditions: report.conditions, checkExit: checked.status, judgeExit: judged.status, expectedJudgeExit: expectedExit })
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ realModelRequests: 0, results }, null, 2) + '\n')
  }
  console.log(JSON.stringify({ realModelRequests: 0, results }, null, 2))
} finally {
  if (prior === undefined) delete process.env.EVAL_FIXTURE_KEY; else process.env.EVAL_FIXTURE_KEY = prior
}
