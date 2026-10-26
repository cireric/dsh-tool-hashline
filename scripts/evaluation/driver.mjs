/** Freeze authored conditions or independently check the runner's evidence. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { freezeProtocol, loadFrozenProtocol } from './protocol.mjs'
import { checkRunReport } from './report.mjs'
import { evaluateConditions, summarizeCoverage } from './verdict.mjs'
const [command, a, b, c] = process.argv.slice(2)
try {
  if (command === 'freeze' && a && (!b || (b === '--out' && c))) {
    const frozen = freezeProtocol(JSON.parse(readFileSync(a, 'utf8')))
    if (c) writeFileSync(c, JSON.stringify(frozen, null, 2) + '\n', { flag: 'wx' })
    else console.log(JSON.stringify(frozen, null, 2))
  } else if (['check', 'judge'].includes(command) && a && b && !c) {
    const protocol = loadFrozenProtocol(a), report = JSON.parse(readFileSync(b, 'utf8'))
    const problems = checkRunReport(protocol, report, dirname(resolve(b)))
    if (problems.length) throw new Error(problems.join('; '))
    if (command === 'check') console.log('report accepted (evidence integrity only); this does not imply model benefit or promotion')
    else {
      const conditions = evaluateConditions(protocol, report.runs)
      const status = report.status === 'FAIL' || conditions.status === 'FAIL' ? 'FAIL' : report.status === 'PASS' && conditions.status === 'PASS' ? 'PASS' : 'GAP'
      console.log(JSON.stringify({ status, taskEvidenceStatus: report.status, conditions, coverage: report.coverage ?? summarizeCoverage(report.runs, protocol.comparison), claims: 'Frozen absolute conditions only; no model benefit or promotion conclusion.' }, null, 2))
      process.exitCode = status === 'PASS' ? 0 : 2
    }
  } else {
    console.error('usage: driver.mjs freeze <protocol.json> [--out <new-frozen.json>] | check|judge <frozen.json> <report.json>')
    process.exitCode = 3
  }
} catch (e) { console.error('refused: ' + e.message); process.exitCode = 2 }
