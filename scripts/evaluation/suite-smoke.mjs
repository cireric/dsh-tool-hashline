/** All candidate tasks through a disposable installed host. Synthetic provider only. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildTaskSuiteConfig } from './task-suite.mjs'
import { buildExperiment } from './prepare.mjs'
import { captureIdentity } from './identity.mjs'
import { captureTools } from './host.mjs'
import { runEvaluation } from './run.mjs'
import { checkRunReport } from './report.mjs'
import { readSessionEvidence } from './session-tree.mjs'

const [profileArg, outArg, ...extra] = process.argv.slice(2)
if (!profileArg || !outArg || extra.length) throw new Error('usage: suite-smoke.mjs <fresh-disposable-profile> <new-output-directory>')
const profile = path.resolve(profileArg), out = path.resolve(outArg)
assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8')).name, 'dsh-profile-acceptance')
const source = fileURLToPath(new URL('../../tests/fixtures/evaluation-suite-provider', import.meta.url))
const fixture = path.join(profile, 'node_modules/evaluation-suite-provider')
if (!fs.existsSync(fixture)) fs.cpSync(source, fixture, { recursive: true, force: false, errorOnExist: true })
else for (const file of ['package.json', 'index.mjs', 'programs.mjs']) assert.equal(fs.readFileSync(path.join(source, file), 'utf8'), fs.readFileSync(path.join(fixture, file), 'utf8'), 'fixture differs; use a fresh disposable profile')
const prior = process.env.EVAL_SUITE_KEY
process.env.EVAL_SUITE_KEY = 'offline-fixture-only'
try {
  const config = buildTaskSuiteConfig()
  config.id = 'offline-full-candidate-suite'
  config.provider = { plugin: 'evaluation-suite-provider', credentialEnv: 'EVAL_SUITE_KEY', config: {} }
  config.model = { provider: 'eval-suite', model: 'fixture-suite', parameters: {} }
  config.budget = { maxModelRequests: 300, maxTotalTokens: 1000, timeoutMs: 30000 }
  config.passConditions.minFirstCandidateCorrect = 1
  config.passConditions.maxTotalTokensPerTask = 20
  const protocol = buildExperiment(config, { dependencies: captureIdentity(profile, config.provider.plugin), tools: await captureTools(profile, config.provider.plugin, config.provider.credentialEnv, {}) })
  const report = await runEvaluation(protocol, { profile, out, execute: true })
  assert(report.runs, 'preflight blocked: ' + JSON.stringify(report.gaps))
  const problems = checkRunReport(protocol, report, out), assertions = []
  const check = (label, fn) => { try { fn(); assertions.push({ label, status: 'PASS' }) } catch (error) { assertions.push({ label, status: 'FAIL', detail: error.message }) } }
  check('complete schedule and accounting', () => { assert.equal(report.runs.length, 39); assert.equal(report.accounting.status, 'PASS') })
  for (const run of report.runs) {
    check(run.arm + '/' + run.taskId + '/final', () => assert.equal(run.finalCorrect, !(run.arm === 'hashline-default' && ['target-long', 'snapshot-limit', 'override'].includes(run.taskId))))
    check(run.arm + '/' + run.taskId + '/trace', () => assert.equal(run.trace?.status, 'PASS'))
    if (run.taskId === 'drift') check(run.arm + '/peer retained', () => assert.equal(run.stimuli.status, 'PASS'))
    if (run.taskId === 'consecutive') check(run.arm + '/intermediate checkpoint', () => {
      assert.equal(run.trace.batches.length, 2)
      assert.equal(run.trace.firstCandidateCorrect, false)
      assert.equal(fs.readFileSync(path.join(out, run.sessionId + '.checkpoint-0/sequence.txt'), 'utf8'), 'start=yes\nmiddle=ready\ntail=pending\n')
      const edits = run.trace.calls.filter(c => c.name === 'edit')
      assert.equal(new Set(edits.map(c => c.rootCallId)).size, 2)
      assert(run.trace.calls.some(c => c.name === 'read' && c.startOrder > edits[0].endOrder && c.endOrder < edits[1].startOrder))
    })
    if (run.taskId === 'generator') check(run.arm + '/actual generator call', () => {
      const evidence = readSessionEvidence(out, run.sessionId)
      const shell = process.platform === 'win32' ? 'pwsh' : 'bash'
      const event = evidence.sources.flatMap(s => s.events).find(e => e.type === 'tool/ptc-dispatch-start' && e.data.name === shell)
      const args = typeof event?.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event?.data.arguments
      assert.equal(args?.command, 'node generate.mjs')
      const call = run.trace.calls.find(c => c.id === event.data.subCallId)
      assert.equal(call.isError, false)
      assert.equal(run.trace.calls.find(c => c.id === call.rootCallId && c.layer === 'outer').isError, false)
      assert.equal(run.targetEvaluation.status, 'GAP')
    })
  }
  check('independent report checker', () => assert.deepEqual(problems, []))
  const driver = fileURLToPath(new URL('./driver.mjs', import.meta.url)), args = [path.join(out, 'protocol.json'), path.join(out, 'report.json')]
  const checked = spawnSync(process.execPath, [driver, 'check', ...args], { encoding: 'utf8' })
  const judged = spawnSync(process.execPath, [driver, 'judge', ...args], { encoding: 'utf8' })
  check('CLI preserves limitations', () => { assert.equal(checked.status, 0, checked.stderr); assert.equal(judged.status, 2); assert.equal(JSON.parse(judged.stdout).status, 'FAIL') })
  const summary = { realModelRequests: 0, assertions, taskEvidenceStatus: report.status, conditionStatus: report.conditions.status, accounting: report.accounting, checkExit: checked.status, judgeExit: judged.status,
    runs: report.runs.map(r => ({ taskId: r.taskId, arm: r.arm, status: r.status, finalCorrect: r.finalCorrect, firstCandidateCorrect: r.trace?.firstCandidateCorrect, totalTokens: r.trace?.costs?.totalTokens, targetStatus: r.targetEvaluation.status })) }
  fs.writeFileSync(path.join(out, 'suite-summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ ...summary, runs: undefined }, null, 2))
  process.exitCode = assertions.some(a => a.status === 'FAIL') ? 1 : 0
} finally {
  if (prior === undefined) delete process.env.EVAL_SUITE_KEY; else process.env.EVAL_SUITE_KEY = prior
}
