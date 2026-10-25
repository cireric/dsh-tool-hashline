/** Freeze authored conditions or independently check the runner's evidence. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { freezeProtocol, loadFrozenProtocol } from './protocol.mjs'
import { checkRunReport } from './report.mjs'
const [command, a, b, c] = process.argv.slice(2)
try {
  if (command === 'freeze' && a && (!b || (b === '--out' && c))) {
    const frozen = freezeProtocol(JSON.parse(readFileSync(a, 'utf8')))
    if (c) writeFileSync(c, JSON.stringify(frozen, null, 2) + '\n', { flag: 'wx' })
    else console.log(JSON.stringify(frozen, null, 2))
  } else if (command === 'check' && a && b && !c) {
    const problems = checkRunReport(loadFrozenProtocol(a), JSON.parse(readFileSync(b, 'utf8')), dirname(resolve(b)))
    if (problems.length) throw new Error(problems.join('; '))
    console.log('report accepted (evidence integrity only); this does not imply model benefit or promotion')
  } else {
    console.error('usage: driver.mjs freeze <protocol.json> [--out <new-frozen.json>] | check <frozen.json> <report.json>')
    process.exitCode = 3
  }
} catch (e) { console.error('refused: ' + e.message); process.exitCode = 2 }
