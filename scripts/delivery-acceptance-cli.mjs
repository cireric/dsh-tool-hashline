/**
 * The CLI entry: `node scripts/delivery-acceptance-run.mjs [--no-gates] [--keep] [--out <dir>]`.
 *
 * A run without gates is useful while iterating; a delivered report must have
 * been produced by a run WITH gates, and the report records each one's exit code.
 * @module dsh-tool-hashline/scripts/delivery-acceptance-cli
 */
import * as path from 'node:path'
import { runAcceptance } from './delivery-acceptance-run.mjs'

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const value = (flag) => {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}
const result = await runAcceptance({
  gates: !has('--no-gates'),
  keep: has('--keep'),
  ...value('--out') === undefined ? {} : { out: value('--out') },
})
const verdicts = result.summary.verdicts
const failed = Object.entries(verdicts).filter(([, verdict]) => verdict === 'FAIL').map(([id]) => id)
const blocked = Object.entries(verdicts).filter(([, verdict]) => verdict === 'BLOCKED').map(([id]) => id)
const gapped = Object.entries(verdicts).filter(([, verdict]) => verdict === 'GAP').map(([id]) => id)
console.log('')
console.log('delivery acceptance → ' + result.report)
console.log('  PASS ' + Object.values(verdicts).filter((verdict) => verdict === 'PASS').length
  + ' / FAIL ' + failed.length + ' / GAP ' + gapped.length + ' / BLOCKED ' + blocked.length)
if (failed.length > 0) console.log('  FAIL: ' + failed.join(', '))
if (gapped.length > 0) console.log('  GAP: ' + gapped.join(', '))
if (blocked.length > 0) console.log('  BLOCKED (no case ran): ' + blocked.join(', '))
const gateFailures = result.summary.gates.filter((gate) => gate.exitCode !== 0)
if (gateFailures.length > 0) console.log('  gate failures: ' + gateFailures.map((gate) => gate.command + ' (exit ' + gate.exitCode + ')').join(', '))
console.log('  report: ' + path.basename(result.report))
process.exitCode = failed.length > 0 || gateFailures.length > 0 ? 1 : 0
