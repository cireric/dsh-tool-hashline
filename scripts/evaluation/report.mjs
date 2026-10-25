/** Check evidence against frozen inputs; a valid BLOCKED report is still not a pass. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { schedule } from './run.mjs'
import { protocolHash } from './protocol.mjs'
import { traceSummary, verifyTree, treeState, candidateSummary } from './evidence.mjs'
import { validateCost, summarizeRuns } from './counting.mjs'

export function checkRunReport(protocol, report, directory) {
  const problems = []
  if (report.protocolHash !== protocol.protocolHash || report.kind !== protocol.kind) problems.push('protocol identity/kind mismatch')
  const expected = schedule(protocol)
  if (!Array.isArray(report.runs) || report.runs.length !== expected.length) return [...problems, 'missing scheduled runs; failures must remain in denominator']
  if (report.summary && protocolHash(report.summary) !== protocolHash(summarizeRuns(report.runs, protocol.comparison))) problems.push('summary recomputation mismatch')
  const sessions = new Set()
  report.runs.forEach((run, i) => {
    const item = expected[i]
    for (const field of ['taskId', 'repeat', 'arm']) if (run[field] !== item[field]) problems.push('schedule mismatch at ' + i)
    if (!['PASS', 'FAIL', 'GAP', 'BLOCKED', 'CANCELLED'].includes(run.status)) problems.push('invalid run status at ' + i)
    if (!run.sessionId) {
      if (!['BLOCKED', 'CANCELLED'].includes(run.status) || run.finalCorrect !== 'unknown') problems.push('unexecuted run claims result at ' + i)
      return
    }
    if (!/^eval-[a-zA-Z0-9-]+$/u.test(run.sessionId) || sessions.has(run.sessionId)) { problems.push('unsafe/reused session at ' + i); return }
    sessions.add(run.sessionId)
    const task = protocol.tasks.find(t => t.id === item.taskId)
    if (run.initialHash !== protocolHash(task.initial)) problems.push('initial identity mismatch at ' + i)
    try {
      const final = verifyTree(task.initial, task.expected, treeState(join(directory, run.sessionId)))
      const initial = JSON.parse(readFileSync(join(directory, run.sessionId + '.initial.json'), 'utf8'))
      const wantedInitial = verifyTree({}, task.initial, Object.fromEntries(Object.entries(task.initial).map(([name, text]) => [name, Buffer.from(text)])))
      if (protocolHash(initial) !== protocolHash(wantedInitial)) problems.push('actual initial file mismatch at ' + i)
      if (protocolHash(final) !== protocolHash(run.final) || run.finalCorrect !== final.correct) problems.push('independent final tree mismatch at ' + i)
      const events = readFileSync(join(directory, run.sessionId + '.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
      const receipts = JSON.parse(readFileSync(join(directory, run.sessionId + '.receipts.json'), 'utf8'))
      const trace = traceSummary(events, { receipts, arm: item.arm, complete: run.status !== 'CANCELLED' })
      const batches = JSON.parse(readFileSync(join(directory, run.sessionId + '.batches.json'), 'utf8'))
      for (const [index, batch] of batches.entries()) {
        if (batch.final?.correct === 'unknown') continue
        const actual = verifyTree(task.initial, task.expected, treeState(join(directory, run.sessionId + '.checkpoint-' + index)))
        if (protocolHash(actual) !== protocolHash(batch.final)) problems.push('candidate checkpoint mismatch at ' + i)
      }
      Object.assign(trace, candidateSummary(trace, batches, task.batchBoundary))
      // Wall clock is live measurement, not reconstructed from file timestamps.
      trace.costs.wallMs = run.trace?.costs?.wallMs
      validateCost(run.trace?.costs)
      if (protocolHash(trace) !== protocolHash(run.trace)) problems.push('trace recomputation mismatch at ' + i)
      if (run.status === 'PASS' && (!final.correct || trace.status !== 'PASS' || trace.candidateStatus === 'GAP' || trace.turnOutcome !== 'completed')) problems.push('unsupported PASS at ' + i)
    } catch { problems.push('missing/unreadable independent evidence at ' + i) }
  })
  return problems
}
