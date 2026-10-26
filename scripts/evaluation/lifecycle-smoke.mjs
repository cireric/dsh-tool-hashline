/** Zero-network lifecycle checks. The injected follow-up/cancellation is fixture-only. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { captureTools, openHost } from './host.mjs'
import { captureIdentity } from './identity.mjs'
import { freezeProtocol } from './protocol.mjs'
import { runEvaluation } from './run.mjs'
import { checkRunReport } from './report.mjs'
import { readSessionEvidence } from './session-tree.mjs'

export async function lifecycleSmoke(profile, out) {
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8')).name, 'dsh-profile-acceptance')
  const fixture = path.join(profile, 'node_modules/evaluation-fixture-provider')
  const source = fileURLToPath(new URL('../../tests/fixtures/evaluation-provider', import.meta.url))
  if (!fs.existsSync(fixture)) fs.cpSync(source, fixture, { recursive: true, errorOnExist: true, force: false })
  else assert.equal(fs.readFileSync(path.join(fixture, 'index.mjs'), 'utf8'), fs.readFileSync(path.join(source, 'index.mjs'), 'utf8'), 'fixture differs: use a fresh disposable installation')
  fs.mkdirSync(out)
  const prior = process.env.EVAL_FIXTURE_KEY
  process.env.EVAL_FIXTURE_KEY = 'offline-fixture-only'
  const results = []
  try {
    const dependencies = captureIdentity(profile, 'evaluation-fixture-provider')
    const tools = await captureTools(profile, 'evaluation-fixture-provider', 'EVAL_FIXTURE_KEY')
    for (const scenario of ['fork', 'cancel-1', 'cancel-2', 'cancel-3']) {
      const cancelled = scenario.startsWith('cancel'), controller = new AbortController(), observations = []
      const task = { id: scenario, family: 'single-point', class: 'known-applicable', batchBoundary: 'first-edit-program', initial: { 'a.txt': 'x\n', ...(cancelled ? { 'b.txt': 'x\n' } : {}) }, expected: { 'a.txt': 'y\n', ...(cancelled ? { 'b.txt': 'z\n' } : {}) }, prompt: cancelled ? 'fixture:cancel-delegate' : 'fixture:fork-seed' }
      task.targets = Object.keys(task.expected).map(file => ({ id: file, path: file, goal: 'reach independent expected bytes', class: 'known-applicable' }))
      const protocol = freezeProtocol({
        id: 'offline-lifecycle-' + scenario, kind: 'probe', limits: ['Fixed adapter and fixture-driven follow-up/cancellation only; zero real model requests, no provider billing claims.'], createdAt: new Date().toISOString(),
        comparison: ['stock-edit', 'hashline-default', 'hashline-fallback'], model: { provider: 'eval-fixture', model: 'fixture', parameters: {} }, dependencies, tools,
        samples: { repetitions: 1, seed: cancelled ? Number(scenario.at(-1)) : 3 }, order: 'interleaved', budget: { maxModelRequests: 40, maxTotalTokens: 100, timeoutMs: 20000 },
        passConditions: { semantics: 'per-arm-count-and-per-run-tokens-v1', minFirstCandidateCorrect: 1, maxTotalTokensPerTask: 100 }, tasks: [task],
      })
      const directory = path.join(out, scenario)
      const report = await runEvaluation(protocol, { profile, out: directory, execute: true, signal: controller.signal,
        hostFactory: async (...args) => {
          const host = await openHost(...args), followed = new Set()
          host.ctx.on('session/event', (session, event) => {
            if (cancelled || session.header.parentSession || event.type !== 'turn/end' || followed.has(session.id)) return
            followed.add(session.id)
            observations.push({ kind: 'followup', sessionId: session.id, afterSeq: event.seq })
            // turn/end is committed before the driver becomes idle. Follow up at
            // the public idle boundary so its wake cannot be lost during cleanup.
            const agent = host.ctx.get('agents').get(session.id)
            void agent.whenIdle().then(() => agent.followup(host.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'fixture:fork-now' }] })))
          }, { global: true })
          host.ctx.on('evaluation-fixture/waiting', sessionId => {
            assert(cancelled && host.ownsSession(sessionId))
            observations.push({ kind: 'cancel', sessionId })
            controller.abort()
          }, { global: true })
          host.ctx.on('evaluation-fixture/aborted', sessionId => observations.push({ kind: 'aborted', sessionId }), { global: true })
          host.ctx.on('evaluation-fixture/request', sessionId => observations.push({ kind: 'request', sessionId, afterCancellation: controller.signal.aborted }), { global: true })
          const execute = host.execute.bind(host)
          host.execute = async (...inputs) => {
            const evidence = await execute(...inputs)
            const states = evidence.sources.map(s => ({ sessionId: s.id, status: host.ctx.get('agents').get(s.id)?.status ?? 'released' }))
            assert(states.every(s => s.status === 'idle' || s.status === 'released'))
            observations.push({ kind: 'settled', states })
            return evidence
          }
          return host
        },
      })
      fs.writeFileSync(path.join(directory, 'lifecycle.json'), JSON.stringify(observations, null, 2) + '\n', { flag: 'wx' })
      const problems = checkRunReport(protocol, report, directory)
      assert.deepEqual(problems, [])
      const requests = observations.filter(o => o.kind === 'request')
      assert.equal(requests.length, report.budget.requests)
      assert(requests.every(o => !o.afterCancellation))
      if (!cancelled) {
        assert.equal(report.status, 'PASS')
        assert.equal(report.conditions.status, 'PASS')
        assert.equal(report.accounting.status, 'PASS')
        assert.equal(observations.filter(o => o.kind === 'followup').length, 3)
        for (const run of report.runs) {
          const { sources } = readSessionEvidence(directory, run.sessionId)
          assert.equal(sources.length, 2)
          const root = sources.find(s => s.id === run.sessionId), child = sources.find(s => s.id !== run.sessionId)
          assert(child.inherited > 0)
          assert.deepEqual(child.events.slice(0, child.inherited), root.events.slice(0, child.inherited))
          assert.equal(child.events[child.inherited - 1].type, 'turn/end')
          assert(child.events.slice(0, child.inherited).some(e => e.type === 'assistant/message'))
          assert.equal(run.finalCorrect, true)
        }
      } else {
        assert.equal(report.status, 'GAP')
        assert.equal(report.conditions.status, 'GAP')
        assert(report.runs.every(r => r.status === 'CANCELLED'))
        assert.equal(report.runs.filter(r => r.sessionId).length, 1)
        assert.deepEqual(observations.filter(o => o.kind !== 'request').map(o => o.kind), ['cancel', 'aborted', 'settled'])
        assert.equal(report.budget.totalTokens, 'unknown')
        const run = report.runs[0]
        assert.equal(run.finalCorrect, false)
        assert.equal(run.final.changed, true)
        assert.equal(fs.readFileSync(path.join(directory, run.sessionId, 'a.txt'), 'utf8'), 'y\n')
        assert.equal(fs.readFileSync(path.join(directory, run.sessionId, 'b.txt'), 'utf8'), 'x\n')
        const { sources } = readSessionEvidence(directory, run.sessionId)
        assert.equal(sources.length, 2)
        assert(sources.every(s => s.events.some(e => e.type === 'turn/end')))
        const child = sources.find(s => s.id !== run.sessionId)
        assert.equal(child.events.findLast(e => e.type === 'turn/end').data.reason.kind, 'aborted')
        assert.equal(run.targetEvaluation.targets.length, 2)
      }
      results.push({ scenario, assertions: 'PASS', evaluationStatus: report.status, accounting: report.accounting, budget: report.budget, runs: report.runs.map(r => ({ arm: r.arm, status: r.status, finalCorrect: r.finalCorrect })), problems })
      fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ realModelRequests: 0, results }, null, 2) + '\n')
    }
    return results
  } finally {
    if (prior === undefined) delete process.env.EVAL_FIXTURE_KEY; else process.env.EVAL_FIXTURE_KEY = prior
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [profile, out] = process.argv.slice(2)
  if (!profile || !out) throw new Error('usage: lifecycle-smoke.mjs <disposable-profile> <new-output-directory>')
  console.log(JSON.stringify(await lifecycleSmoke(path.resolve(profile), path.resolve(out)), null, 2))
}
