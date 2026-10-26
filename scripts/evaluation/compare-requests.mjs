/** Compare independently checked first-request surfaces without exporting raw prompts. */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadFrozenProtocol } from './protocol.mjs'
import { checkRunReport } from './report.mjs'
import { auditRequestEvidence } from './request-evidence.mjs'

export function compareRequestSurfaces(protocol, report, audit) {
  if (audit.problems.length) throw new Error('EVAL_REQUEST_EVIDENCE_INTEGRITY')
  const pairs = []
  const first = run => audit.captures?.find(c => c.sessionId === run?.sessionId && c.replay === 'PASS')
  const equal = (left, right, key) => left && right ? left[key] === right[key] : 'unknown'
  for (const task of protocol.tasks) for (let repeat = 0; repeat < protocol.samples.repetitions; repeat++) {
    for (const [i, left] of protocol.comparison.entries()) for (const right of protocol.comparison.slice(i + 1)) {
      const a = first(report.runs.find(r => r.taskId === task.id && r.repeat === repeat && r.arm === left))
      const b = first(report.runs.find(r => r.taskId === task.id && r.repeat === repeat && r.arm === right))
      pairs.push({ taskId: task.id, repeat, left, right, leftRequest: a?.ordinal ?? 'unknown', rightRequest: b?.ordinal ?? 'unknown',
        systemTextEqual: equal(a, b, 'systemHash'), toolDefinitionsEqual: equal(a, b, 'toolsHash'),
        sdkEqual: a?.sdk.status === 'known' && b?.sdk.status === 'known' ? a.sdk.hash === b.sdk.hash : 'unknown' })
    }
  }
  return { version: 1, status: audit.summary.status === 'PASS' && pairs.every(p => p.systemTextEqual !== 'unknown' && p.toolDefinitionsEqual !== 'unknown' && p.sdkEqual !== 'unknown') ? 'PASS' : 'GAP',
    scope: 'first-root-request-per-scheduled-sample', boundary: 'llm/stream-before-next', providerWire: 'unknown', normalization: 'none; exact text includes evaluator paths and other context',
    protocolHash: protocol.protocolHash, requestAudit: audit.summary, pairs,
    claims: 'PASS means captured comparison completeness only. Different text may include runtime context; equality is not model benefit or pure-policy causality.' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [frozen, reportFile, out, ...extra] = process.argv.slice(2)
  try {
    if (!frozen || !reportFile || !out || extra.length) throw new Error('usage: compare-requests.mjs <frozen.json> <report.json> <new-comparison.json>')
    const protocol = loadFrozenProtocol(frozen), report = JSON.parse(fs.readFileSync(reportFile, 'utf8')), directory = path.dirname(path.resolve(reportFile))
    if (checkRunReport(protocol, report, directory).length) throw new Error('independent report check failed')
    const comparison = compareRequestSurfaces(protocol, report, auditRequestEvidence(protocol, report, directory))
    fs.writeFileSync(out, JSON.stringify(comparison, null, 2) + '\n', { flag: 'wx' })
    console.log('request surface comparison written; no model requests made')
  } catch (error) { console.error('request comparison refused: ' + error.message); process.exitCode = 2 }
}
