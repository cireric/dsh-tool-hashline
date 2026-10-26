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
import { CONDITION_SEMANTICS } from './verdict.mjs'

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
  for (const scenario of ['pass', 'token-fail', 'first-unknown']) {
    const protocol = freezeProtocol({
      id: 'offline-verdict-' + scenario, kind: 'probe', limits: ['Fixed provider only; no real model or promotion evidence.'], createdAt: new Date().toISOString(),
      comparison: ['stock-edit', 'hashline-fallback'], model: { provider: 'eval-fixture', model: 'fixture', parameters: {} }, dependencies, tools,
      samples: { repetitions: 1, seed: 2 }, order: 'interleaved', budget: { maxModelRequests: 10, maxTotalTokens: 40, timeoutMs: 20000 },
      passConditions: { semantics: CONDITION_SEMANTICS, minFirstCandidateCorrect: 1, maxTotalTokensPerTask: scenario === 'token-fail' ? 0 : 100 },
      tasks: [{ id: 'single', family: 'single-point', class: 'known-applicable', batchBoundary: scenario === 'first-unknown' ? 'task-end' : 'first-edit-program', initial: { 'a.txt': 'x\n' }, expected: { 'a.txt': 'y\n' }, prompt: 'Change x to y in a.txt.', targets: [{ id: 'goal', path: 'a.txt', class: 'known-applicable', goal: 'match the independent expected bytes' }] }],
    })
    const directory = path.join(out, scenario), report = await runEvaluation(protocol, { profile, out: directory, execute: true })
    const expected = scenario === 'pass' ? 'PASS' : scenario === 'token-fail' ? 'FAIL' : 'GAP'
    assert.equal(report.status, 'PASS')
    assert.equal(report.conditions.status, expected)
    const driver = fileURLToPath(new URL('./driver.mjs', import.meta.url))
    const args = [path.join(directory, 'protocol.json'), path.join(directory, 'report.json')]
    const checked = spawnSync(process.execPath, [driver, 'check', ...args], { encoding: 'utf8' })
    assert.equal(checked.status, 0, checked.stderr)
    const judged = spawnSync(process.execPath, [driver, 'judge', ...args], { encoding: 'utf8' })
    const expectedExit = expected === 'PASS' ? 0 : 2
    assert.equal(judged.status, expectedExit, judged.stderr)
    assert.equal(JSON.parse(judged.stdout).status, expected)
    results.push({ scenario, assertions: 'PASS', taskEvidenceStatus: report.status, conditionStatus: report.conditions.status, accounting: report.accounting, coverage: report.coverage, checkExit: checked.status, judgeExit: judged.status, expectedJudgeExit: expectedExit })
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ realModelRequests: 0, results }, null, 2) + '\n')
  }
  console.log(JSON.stringify({ realModelRequests: 0, results }, null, 2))
} finally {
  if (prior === undefined) delete process.env.EVAL_FIXTURE_KEY; else process.env.EVAL_FIXTURE_KEY = prior
}
