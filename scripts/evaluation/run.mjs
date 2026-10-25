/** Default is preflight only. --execute is an explicit, potentially paid maintainer action. */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { summarizeRuns } from './counting.mjs'
import { loadFrozenProtocol, protocolHash, assertFrozenProtocol } from './protocol.mjs'
import { captureIdentity, assertIdentity } from './identity.mjs'
import { traceSummary, treeState, verifyTree, writeExpectedDiff, candidateSummary } from './evidence.mjs'

export function schedule(protocol) {
  const result = []
  for (let repeat = 0; repeat < protocol.samples.repetitions; repeat++) {
    for (const task of protocol.tasks) {
      const offset = (protocol.samples.seed + repeat + protocol.tasks.indexOf(task)) % protocol.comparison.length
      for (let i = 0; i < protocol.comparison.length; i++) result.push({ taskId: task.id, repeat, arm: protocol.comparison[(offset + i) % protocol.comparison.length] })
    }
  }
  return result
}

export function preflight(protocol, profile, env = process.env) {
  const gaps = []
  try {
    if (JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8')).name !== 'dsh-profile-acceptance') gaps.push('requires disposable dsh-profile-acceptance; daily profile refused')
    const req = createRequire(path.join(profile, 'package.json'))
    try { req.resolve(protocol.tools.providerPlugin) } catch { gaps.push('provider package unavailable') }
    assertIdentity(protocol.dependencies, captureIdentity(profile, protocol.tools.providerPlugin))
  } catch (e) { gaps.push(e.message) }
  if (!env[protocol.tools.credentialEnv]) gaps.push('credential environment variable unavailable')
  return { status: gaps.length ? 'BLOCKED' : 'PASS', gaps }
}

export async function runEvaluation(protocol, { profile, out, execute = false, signal, hostFactory, skipPreflight = false } = {}) {
  assertFrozenProtocol(protocol)
  const ready = skipPreflight ? { status: 'PASS', gaps: [] } : preflight(protocol, profile)
  if (!execute || ready.status !== 'PASS') return { ...ready, executed: false, realModelRequests: 0, schedule: schedule(protocol) }
  fs.mkdirSync(out, { recursive: false }) // existing evidence is never overwritten
  fs.writeFileSync(path.join(out, 'protocol.json'), JSON.stringify(protocol, null, 2) + '\n', { flag: 'wx' })
  const originalCwd = process.cwd(), originalHome = process.env.DSH_HOME, originalTelemetry = process.env.DSH_TELEMETRY_DISABLED
  process.env.DSH_HOME = path.join(out, 'dsh-home')
  process.env.DSH_TELEMETRY_DISABLED = '1'
  const report = { protocolHash: protocol.protocolHash, kind: protocol.kind, runs: [], requests: [], status: 'GAP', claims: 'No promotion conclusion; first candidate and unmeasured costs remain unknown.' }
  let host
  const budget = { requests: 0, tokens: 0, unknown: false }
  try {
    host = await (hostFactory ?? (await import('./host.mjs')).openHost)(profile, out, protocol)
    // Streaming middleware sees every call, including failed/retried attempts and children.
    host.ctx.on('llm/stream', async function* (options, next) {
      if (signal?.aborted || budget.unknown || budget.requests >= protocol.budget.maxModelRequests || budget.tokens >= protocol.budget.maxTotalTokens) throw new Error('EVAL_BUDGET_STOP')
      if (options.provider !== protocol.model.provider || options.model !== protocol.model.model || Object.entries(protocol.model.parameters).some(([key, value]) => options[key] !== value)) throw new Error('EVAL_MODEL_DRIFT')
      budget.requests++
      report.requests.push({ provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort ?? 'unknown', maxTokens: options.maxTokens ?? 'unknown' })
      let usage
      try {
        for await (const chunk of next()) {
          if (chunk.type === 'usage') usage = chunk.usage
          yield chunk
        }
      } finally {
        if (Number.isSafeInteger(usage?.totalTokens) && usage.totalTokens >= 0) budget.tokens += usage.totalTokens
        else budget.unknown = true // fail closed before another paid request
      }
    }, { global: true })
    for (const item of schedule(protocol)) {
      const started = Date.now()
      const task = protocol.tasks.find(t => t.id === item.taskId)
      if (signal?.aborted || budget.unknown || budget.requests >= protocol.budget.maxModelRequests || budget.tokens >= protocol.budget.maxTotalTokens) {
        report.runs.push({ ...item, status: signal?.aborted ? 'CANCELLED' : 'BLOCKED', reason: 'cancelled or budget exhausted/unknown', finalCorrect: 'unknown' }); continue
      }
      if (!skipPreflight) assertIdentity(protocol.dependencies, captureIdentity(profile, protocol.tools.providerPlugin))
      const id = 'eval-' + randomUUID(), cwd = path.join(out, id)
      fs.mkdirSync(cwd)
      for (const [name, content] of Object.entries(task.initial)) { const file = path.join(cwd, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content) }
      const initial = verifyTree({}, task.initial, treeState(cwd))
      if (!initial.correct) throw new Error('EVAL_INITIAL_DRIFT')
      fs.writeFileSync(path.join(out, id + '.initial.json'), JSON.stringify(initial))
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(abort, protocol.budget.timeoutMs)
      let evidence, failure
      try { evidence = await host.execute(id, item.arm, cwd, task, controller.signal) }
      catch { failure = 'host execution failed; inspect restricted local evidence' }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      let final, diffHash = 'unknown'
      try { final = verifyTree(task.initial, task.expected, treeState(cwd)) } catch { final = { correct: 'unknown', changed: 'unknown', files: [] } }
      try { diffHash = writeExpectedDiff(task.initial, task.expected, cwd, path.join(out, id + '.verification')) } catch { /* byte verdict above remains independent; diff is explicitly unknown */ }
      const trace = traceSummary(evidence?.events ?? [], { receipts: evidence?.receipts ?? [], arm: item.arm, complete: !!evidence && !controller.signal.aborted })
      Object.assign(trace, candidateSummary(trace, evidence?.batches ?? [], task.batchBoundary))
      trace.costs.wallMs = Date.now() - started
      report.runs.push({ ...item, sessionId: id, initialHash: protocolHash(task.initial), status: controller.signal.aborted || trace.turnOutcome === 'aborted' ? 'CANCELLED' : failure || trace.turnOutcome === 'error' ? 'FAIL' : trace.status === 'GAP' || trace.candidateStatus === 'GAP' || final.correct === 'unknown' ? 'GAP' : final.correct ? 'PASS' : 'FAIL', failure, finalCorrect: final.correct, final, diffHash, trace, promptHash: evidence?.promptHash ?? 'unknown', ptc: evidence?.ptc ?? 'unknown', partialTask: trace.failures > 0 && final.changed === true })
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    }
    report.status = report.runs.some(r => r.status === 'FAIL') ? 'FAIL' : report.runs.every(r => r.status === 'PASS') ? 'PASS' : 'GAP'
  } catch {
    for (const item of schedule(protocol).slice(report.runs.length)) report.runs.push({ ...item, status: 'BLOCKED', reason: 'host initialization/execution failed', finalCorrect: 'unknown' })
    report.status = 'GAP'
  } finally {
    try { await host?.dispose() } finally {
      report.summary = summarizeRuns(report.runs, protocol.comparison)
      report.budget = { requests: budget.requests, boundary: 'llm/stream', providerHttpRequests: 'unknown', totalTokens: budget.unknown ? 'unknown' : budget.tokens, knownTokens: budget.tokens, unknown: budget.unknown }
      process.chdir(originalCwd)
      if (originalHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome
      if (originalTelemetry === undefined) delete process.env.DSH_TELEMETRY_DISABLED; else process.env.DSH_TELEMETRY_DISABLED = originalTelemetry
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    }
  }
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [frozen, profile, out, flag] = process.argv.slice(2)
  try {
    if (!frozen || !profile || !out || (flag && flag !== '--execute')) throw new Error('usage: run.mjs <frozen.json> <disposable-profile> <new-output-directory> [--execute]')
    const controller = new AbortController()
    process.once('SIGINT', () => controller.abort())
    const result = await runEvaluation(loadFrozenProtocol(frozen), { profile: path.resolve(profile), out: path.resolve(out), execute: flag === '--execute', signal: controller.signal })
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.status === 'PASS' ? 0 : 2
  } catch { console.error('evaluation refused/failed; check protocol, disposable profile and local evidence (no credential values exported)'); process.exitCode = 2 }
}
