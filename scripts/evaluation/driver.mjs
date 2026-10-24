#!/usr/bin/env node
/**
 * Evaluation driver: freeze a protocol, then validate a run against it.
 *
 * The driver deliberately does NOT call a model. SRS §7.1 makes the run a
 * maintainer action with an explicit budget; what this script enforces is that
 * the CONDITIONS were frozen first and that the REPORT obeys the counting rules.
 * It imports only Node builtins.
 *
 *   node scripts/evaluation/driver.mjs freeze <protocol.json> [--out <frozen.json>]
 *   node scripts/evaluation/driver.mjs check  <frozen.json> <report.json>
 *
 * Exit codes: 0 accepted, 2 refused (with the reason), 3 usage.
 * @module dsh-tool-hashline/scripts/evaluation/driver
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { freezeProtocol, loadFrozenProtocol, ProtocolError } from './protocol.mjs'
import { CountingError, adoption, COST_FIELDS, OUTCOMES, TARGET_CLASSES, validateBatch, validateCost } from './counting.mjs'

const EXIT = { ok: 0, refused: 2, usage: 3 }

const usage = () => {
  console.error('usage: driver.mjs freeze <protocol.json> [--out <frozen.json>]')
  console.error('       driver.mjs check  <frozen.json> <report.json>')
  return EXIT.usage
}

/** Read JSON, or refuse with the path. */
const readJson = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new ProtocolError('EVAL_PROTOCOL_UNREADABLE', 'cannot read ' + path + ': ' + (error instanceof Error ? error.message : String(error)))
  }
}

/** Freeze one authored protocol and write it. */
const freeze = args => {
  const input = args[0]
  if (input === undefined) return usage()
  const outIndex = args.indexOf('--out')
  const out = outIndex >= 0 ? args[outIndex + 1] : undefined
  const frozen = freezeProtocol(readJson(input))
  if (out === undefined) {
    console.log(JSON.stringify(frozen, null, 2))
  } else {
    writeFileSync(out, JSON.stringify(frozen, null, 2) + '\n')
    console.log('frozen ' + out + ' (' + frozen.protocolHash.slice(0, 12) + ')')
  }
  return EXIT.ok
}

/** Validate one report against its frozen protocol and the counting rules. */
const check = args => {
  const [protocolPath, reportPath] = args
  if (protocolPath === undefined || reportPath === undefined) return usage()
  const protocol = loadFrozenProtocol(protocolPath)
  const report = readJson(reportPath)
  const problems = []

  if (report?.protocolHash !== protocol.protocolHash) {
    problems.push('the report does not name the frozen protocol (' + String(report?.protocolHash) + ' vs ' + protocol.protocolHash + ')')
  }
  if (!Array.isArray(report?.targets)) {
    problems.push('the report must list its targets')
  } else {
    try {
      const rates = adoption(report.targets)
      // The report's own numbers must equal the recomputation: a report cannot
      // report a friendlier denominator than its data supports.
      if (report.rates?.knownApplicable !== rates.knownApplicable) {
        problems.push('knownApplicable is ' + String(report.rates?.knownApplicable) + ' but the targets give ' + rates.knownApplicable)
      }
      if (report.rates?.adoptionRate !== rates.adoptionRate) {
        problems.push('adoptionRate is ' + String(report.rates?.adoptionRate) + ' but the targets give ' + String(rates.adoptionRate))
      }
    } catch (error) {
      if (error instanceof CountingError) problems.push(error.message)
      else throw error
    }
  }
  if (!Array.isArray(report?.batches)) problems.push('the report must list its first-candidate batches')
  else {
    for (const batch of report.batches) {
      try {
        validateBatch(batch)
      } catch (error) {
        if (error instanceof CountingError) problems.push(error.message)
        else throw error
      }
    }
  }
  if (report?.costs === undefined) problems.push('the report must carry a costs record')
  else {
    try {
      validateCost(report.costs)
    } catch (error) {
      if (error instanceof CountingError) problems.push(error.message)
      else throw error
    }
  }
  for (const field of ['outcomes', 'exceptions', 'unknowns']) {
    if (report?.[field] === undefined) problems.push('the report must carry "' + field + '"')
  }
  if (problems.length > 0) {
    console.error('report REFUSED:')
    for (const problem of problems) console.error('  - ' + problem)
    return EXIT.refused
  }
  console.log('report accepted: ' + report.targets.length + ' targets, ' + report.batches.length + ' batches, protocol ' + protocol.protocolHash.slice(0, 12))
  return EXIT.ok
}

const main = argv => {
  const [command, ...rest] = argv
  try {
    if (command === 'freeze') return freeze(rest)
    if (command === 'check') return check(rest)
    return usage()
  } catch (error) {
    if (error instanceof ProtocolError || error instanceof CountingError) {
      console.error('refused: ' + error.message)
      return EXIT.refused
    }
    console.error('failed: ' + (error instanceof Error ? error.message : String(error)))
    return EXIT.refused
  }
}

process.exit(main(process.argv.slice(2)))
