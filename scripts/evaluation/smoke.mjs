/** Repeatable, zero-network wiring test over an installed disposable host. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureTools } from './host.mjs'
import { captureIdentity } from './identity.mjs'
import { freezeProtocol } from './protocol.mjs'
import { runEvaluation } from './run.mjs'
import { checkRunReport } from './report.mjs'

const [profileArg, outArg] = process.argv.slice(2)
if (!profileArg || !outArg) throw new Error('usage: smoke.mjs <disposable-profile> <new-output-directory>')
const profile = path.resolve(profileArg), out = path.resolve(outArg)
if (JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8')).name !== 'dsh-profile-acceptance') throw new Error('disposable acceptance profile required')
const fixture = path.join(profile, 'node_modules/evaluation-fixture-provider')
const fixtureSource = fileURLToPath(new URL('../../tests/fixtures/evaluation-provider', import.meta.url))
if (!fs.existsSync(fixture)) fs.cpSync(fixtureSource, fixture, { recursive: true, errorOnExist: true, force: false })
else if (fs.readFileSync(path.join(fixture, 'index.mjs'), 'utf8') !== fs.readFileSync(path.join(fixtureSource, 'index.mjs'), 'utf8')) throw new Error('fixture version differs; use a fresh disposable delivery profile')
const prior = process.env.EVAL_FIXTURE_KEY
process.env.EVAL_FIXTURE_KEY = 'offline-fixture-only'
try {
  const protocol = freezeProtocol({
    id: 'offline-host-fixture', kind: 'probe', limits: ['Deterministic fixture: zero real model requests; no benefit evidence.'], createdAt: new Date().toISOString(),
    comparison: ['stock-edit', 'hashline-default', 'hashline-fallback'],
    model: { provider: 'eval-fixture', model: 'fixture', parameters: {} },
    dependencies: captureIdentity(profile, 'evaluation-fixture-provider'), tools: await captureTools(profile, 'evaluation-fixture-provider', 'EVAL_FIXTURE_KEY'),
    samples: { repetitions: 1, seed: 7 }, order: 'interleaved', budget: { maxModelRequests: 60, maxTotalTokens: 200, timeoutMs: 20000 },
    passConditions: { minFirstCandidateCorrect: 1, maxTotalTokensPerTask: 100 },
    tasks: [
      { id: 'single', family: 'single-point', class: 'known-applicable', batchBoundary: 'first-edit-program', initial: { 'a.txt': 'x\n' }, expected: { 'a.txt': 'y\n' }, prompt: 'Change x to y in a.txt.' },
      { id: 'multi', family: 'multi-site', class: 'known-applicable', batchBoundary: 'first-edit-program', initial: { 'a.txt': 'x\n', 'b.txt': 'x\n' }, expected: { 'a.txt': 'y\n', 'b.txt': 'z\n' }, prompt: 'fixture:multi' },
      { id: 'child', family: 'single-point', class: 'known-applicable', batchBoundary: 'first-edit-program', initial: { 'a.txt': 'x\n' }, expected: { 'a.txt': 'y\n' }, prompt: 'fixture:delegate' },
      { id: 'drift', family: 'external-change', class: 'known-applicable', batchBoundary: 'first-edit-program', initial: { 'a.txt': 'x\n' }, expected: { 'a.txt': 'y\n' }, prompt: 'fixture:drift', stimuli: [{ id: 'competitor', path: 'a.txt', afterRead: 1, before: 'x\n', after: 'competitor\n' }] },
    ].map(task => ({ ...task, targets: Object.keys(task.expected).map(file => ({ id: file, path: file, goal: 'reach the independent expected bytes', class: 'known-applicable' })) })),
  })
  const report = await runEvaluation(protocol, { profile, out, execute: true })
  if (!report.runs) throw new Error('fixture preflight blocked: ' + report.gaps.join('; '))
  fs.writeFileSync(path.join(out, 'frozen.json'), JSON.stringify(protocol, null, 2) + '\n', { flag: 'wx' })
  const problems = checkRunReport(protocol, report, out)
  console.log(JSON.stringify({ status: report.status, realModelRequests: 0, runs: report.runs.map(r => ({ arm: r.arm, status: r.status })), problems }, null, 2))
  process.exitCode = report.status === 'PASS' && !problems.length ? 0 : 1
} finally {
  if (prior === undefined) delete process.env.EVAL_FIXTURE_KEY; else process.env.EVAL_FIXTURE_KEY = prior
}
