/**
 * Pre-check for the installed-host intent-gate evidence (`test:host-gate` → `host-result.json`).
 *
 * Why this exists: P5 asks for a whole-host run on a disposable installation, and reading its
 * artifact by eye is exactly where a claim drifts from its evidence. This reader states, in
 * code, what that artifact must contain before anyone may call it PASS:
 *
 *   1. SHAPE      — the run's own status, a non-empty case list with unique ids, and a finish time;
 *   2. IDENTITY   — the gate module and persona digests the run recorded must equal the digests of
 *                   the assets in THIS tree, so evidence from an older candidate cannot be
 *                   presented as evidence for the current one;
 *   3. PROVENANCE — the fixed adapter answered (`scriptedLlmRequests > 0`) and no real model was
 *                   called (`realModelRequests === 0`);
 *   4. COVERAGE   — every case id the caller requires is present AND passed (a missing case is a
 *                   GAP, a failed one is a FAIL — never "not applicable").
 *
 * It reads a file and returns a verdict. It never runs the host, never installs anything, and
 * never turns an absent case into a pass.
 * @module dsh-tool-hashline/scripts/host-gate-evidence
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

/** The fields a host-gate artifact must carry, beyond its case list. */
export const REQUIRED_EVIDENCE_FIELDS = Object.freeze([
  'status',
  'cases',
  'installed',
  'scriptedLlmRequests',
  'realModelRequests',
  'finishedAt',
])

/** The two assets whose digest proves WHICH candidate produced the evidence. */
export const IDENTITY_ASSETS = Object.freeze([
  'presets/ptc-hashline/intent-gate-watchdog.mjs',
  'presets/ptc-hashline/personas/orchestrator.md',
])

/** The presentation-surface case ids this repository's script produces today. */
export const SURFACE_CASE_IDS = Object.freeze(['IG07-S1', 'IG07-S2', 'IG07-S3'])

/**
 * Invariants each surface case must carry IN ITS OWN EVIDENCE, not only in its PASS label:
 * a passing label with no payload is exactly the kind of claim this reader exists to stop.
 */
export const SURFACE_CASE_RULES = Object.freeze({
  'IG07-S1': entry => {
    const problems = []
    if (entry?.withheldDispatch !== false) problems.push('IG07-S1 must report withheldDispatch=false (the withheld program never ran)')
    if (entry?.declarationFirst !== true) problems.push('IG07-S1 must report declarationFirst=true (the declaration is what the client saw first)')
    if (typeof entry?.clientVisibleText !== 'string' || entry.clientVisibleText === '') problems.push('IG07-S1 must record the client-visible text it compared')
    return problems
  },
  'IG07-S2': entry => {
    const problems = []
    if (typeof entry?.clientVisibleText !== 'string') problems.push('IG07-S2 must record the client-visible text')
    if (typeof entry?.clientVisibleText === 'string' && entry.clientVisibleText === '') problems.push('IG07-S2 must show the accepted text reached the client')
    return problems
  },
  'IG07-S3': entry => {
    const problems = []
    if (entry?.clientVisibleText !== '') problems.push('IG07-S3 must report an empty client-visible text for a fully withheld request')
    if (entry?.assistantMessages !== 0) problems.push('IG07-S3 must report zero assistant messages in the client journal')
    return problems
  },
})

/** LF-normalised sha256, the same rule `check:preset` pins the asset digests with. */
export const assetDigest = text => createHash('sha256').update(String(text).replace(/\r\n/gu, '\n'), 'utf8').digest('hex')

/** The digests of the assets in one tree (defaults to this repository). */
export async function expectedIdentity(root) {
  const base = root ?? process.cwd()
  const identity = {}
  for (const relative of IDENTITY_ASSETS) {
    const text = await readFile(path.join(base, relative), 'utf8')
    identity[relative] = assetDigest(text)
  }
  return identity
}

/**
 * Check one artifact.
 * @param evidence - the parsed `host-result.json`.
 * @param options - { expected?: { '<asset path>': digest }, requiredCaseIds?: string[] }.
 * @returns { ok, errors, summary, coverage }
 */
export function checkHostGateEvidence(evidence, options = {}) {
  const errors = []
  if (evidence === null || typeof evidence !== 'object') {
    return { ok: false, errors: ['evidence is not an object'], summary: { cases: 0, pass: 0, fail: 0 }, coverage: { required: 0, present: 0, missing: [], failed: [] } }
  }
  for (const field of REQUIRED_EVIDENCE_FIELDS) {
    if (evidence[field] === undefined) errors.push('missing field: ' + field)
  }
  if (evidence.status !== undefined && evidence.status !== 'PASS' && evidence.status !== 'FAIL') {
    errors.push('status must be PASS or FAIL, got: ' + String(evidence.status))
  }
  const cases = Array.isArray(evidence.cases) ? evidence.cases : []
  if (cases.length === 0) errors.push('no cases in the artifact')
  const seen = new Set()
  for (const entry of cases) {
    const id = String(entry?.id ?? '')
    if (id === '') errors.push('case without id')
    if (seen.has(id)) errors.push('duplicate case id: ' + id)
    seen.add(id)
    if (entry?.status !== 'PASS' && entry?.status !== 'FAIL') errors.push('case ' + id + ' has an unusable status: ' + String(entry?.status))
    if (entry?.status === 'FAIL') errors.push('case ' + id + ' FAILED: ' + String(entry?.error ?? '(no error text)').slice(0, 200))
  }
  if (evidence.realModelRequests !== undefined && evidence.realModelRequests !== 0) {
    errors.push('the artifact reports real model requests (' + String(evidence.realModelRequests) + '); a host-gate run must use the fixed adapter only')
  }
  if (typeof evidence.scriptedLlmRequests === 'number' && evidence.scriptedLlmRequests <= 0) {
    errors.push('the artifact reports no scripted provider request; the fixed adapter never ran')
  }
  const installed = evidence.installed ?? {}
  if (installed.gateModuleSha256 === undefined) errors.push('installed.gateModuleSha256 is missing: the evidence does not name the gate it tested')
  if (installed.personaSha256 === undefined) errors.push('installed.personaSha256 is missing: the evidence does not name the persona it tested')
  if (options.expected !== undefined) {
    for (const relative of IDENTITY_ASSETS) {
      const want = options.expected[relative]
      const got = relative === IDENTITY_ASSETS[0] ? installed.gateModuleSha256 : installed.personaSha256
      if (want !== undefined && got !== undefined && got !== want) {
        errors.push('identity mismatch for ' + relative + ': evidence ' + String(got).slice(0, 12) + '… vs tree ' + String(want).slice(0, 12) + '…')
      }
    }
  }
  const required = Array.isArray(options.requiredCaseIds) ? options.requiredCaseIds.map(String) : []
  const byId = new Map(cases.map(entry => [String(entry?.id), entry]))
  const missing = required.filter(id => !byId.has(id))
  const failed = required.filter(id => byId.has(id) && byId.get(id)?.status !== 'PASS')
  if (missing.length > 0) errors.push('required cases are missing from the artifact: ' + missing.join(','))
  const summary = { cases: cases.length, pass: cases.filter(entry => entry?.status === 'PASS').length, fail: cases.filter(entry => entry?.status === 'FAIL').length }
  return {
    ok: errors.length === 0,
    errors,
    summary,
    coverage: { required: required.length, present: required.length - missing.length, missing, failed },
  }
}

/**
 * Check one PRESENTATION-SURFACE artifact (`surface-result.json`).
 *
 * The claim is narrower than the host tier's and must stay narrow: these are the controller
 * frames the browser would receive, not a screenshot. So the reader
 *   - requires the same provenance and identity fields as the host tier;
 *   - requires every case to carry its OWN payload and re-checks the three invariants above;
 *   - records `browser-not-verified` as a GAP whenever the artifact says no screenshot was taken
 *     ("the frames say so" is not "the page showed so").
 * @param evidence - the parsed `surface-result.json`.
 * @param options - { expected?: digests, requiredCaseIds?: string[] }.
 * @returns { ok, errors, gaps, summary, coverage }
 */
export function checkSurfaceGateEvidence(evidence, options = {}) {
  const errors = []
  const gaps = []
  if (evidence === null || typeof evidence !== 'object') {
    return { ok: false, errors: ['evidence is not an object'], gaps, summary: { cases: 0, pass: 0, fail: 0 }, coverage: { required: 0, present: 0, missing: [], failed: [] } }
  }
  for (const field of ['status', 'cases', 'finishedAt', 'scriptedLlmRequests', 'realModelRequests', 'surface', 'browserScreenshot']) {
    if (evidence[field] === undefined) errors.push('missing field: ' + field)
  }
  if (evidence.status !== undefined && !['PASS', 'FAIL', 'EMPTY'].includes(evidence.status)) {
    errors.push('status must be PASS, FAIL or EMPTY, got: ' + String(evidence.status))
  }
  if (evidence.fatal !== undefined) errors.push('the run ended fatally: ' + String(evidence.fatal).slice(0, 200))
  const cases = Array.isArray(evidence.cases) ? evidence.cases : []
  if (cases.length === 0) errors.push('no cases in the artifact')
  if (evidence.realModelRequests !== undefined && evidence.realModelRequests !== 0) {
    errors.push('the artifact reports real model requests (' + String(evidence.realModelRequests) + '); the surface tier must use the fixed adapter only')
  }
  if (typeof evidence.scriptedLlmRequests === 'number' && evidence.scriptedLlmRequests <= 0) {
    errors.push('the artifact reports no scripted provider request; the fixed adapter never ran')
  }
  if (typeof evidence.surface === 'string' && !evidence.surface.includes('assistant-stream')) {
    errors.push('the artifact does not name the assistant-stream frames as its surface')
  }
  const installed = evidence.installed ?? {}
  if (installed.gateModuleSha256 === undefined) errors.push('installed.gateModuleSha256 is missing: the evidence does not name the gate it tested')
  if (installed.personaSha256 === undefined) errors.push('installed.personaSha256 is missing: the evidence does not name the persona it tested')
  if (options.expected !== undefined) {
    for (const relative of IDENTITY_ASSETS) {
      const want = options.expected[relative]
      const got = relative === IDENTITY_ASSETS[0] ? installed.gateModuleSha256 : installed.personaSha256
      if (want !== undefined && got !== undefined && got !== want) {
        errors.push('identity mismatch for ' + relative + ': evidence ' + String(got).slice(0, 12) + '… vs tree ' + String(want).slice(0, 12) + '…')
      }
    }
  }
  const seen = new Set()
  for (const entry of cases) {
    const id = String(entry?.id ?? '')
    if (id === '') { errors.push('case without id'); continue }
    if (seen.has(id)) errors.push('duplicate case id: ' + id)
    seen.add(id)
    if (entry?.status !== 'PASS' && entry?.status !== 'FAIL') { errors.push('case ' + id + ' has an unusable status: ' + String(entry?.status)); continue }
    if (entry.status === 'FAIL') { errors.push('case ' + id + ' FAILED: ' + String(entry?.error ?? '(no error text)').slice(0, 200)); continue }
    const rule = SURFACE_CASE_RULES[id]
    if (rule !== undefined) errors.push(...rule(entry))
  }
  const required = Array.isArray(options.requiredCaseIds) ? options.requiredCaseIds.map(String) : [...SURFACE_CASE_IDS]
  const byId = new Map(cases.map(entry => [String(entry?.id), entry]))
  const missing = required.filter(id => !byId.has(id))
  const failed = required.filter(id => byId.has(id) && byId.get(id)?.status !== 'PASS')
  if (missing.length > 0) errors.push('required cases are missing from the artifact: ' + missing.join(','))
  if (evidence.browserScreenshot !== true) gaps.push('browser-not-verified: the artifact proves the controller frames, not what a page rendered')
  return {
    ok: errors.length === 0,
    errors,
    gaps,
    summary: { cases: cases.length, pass: cases.filter(entry => entry?.status === 'PASS').length, fail: cases.filter(entry => entry?.status === 'FAIL').length },
    coverage: { required: required.length, present: required.length - missing.length, missing, failed },
  }
}

/**
 * CLI: `node scripts/host-gate-evidence.mjs --kind host|surface --evidence <json> [--require a,b] [--repo <root>]`
 * Exit codes: 0 = the artifact passes this pre-check, 2 = it does not (nothing was run here).
 */
async function main(argv) {
  const option = name => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const evidencePath = option('--evidence')
  if (evidencePath === undefined) throw new Error('usage: --kind host|surface --evidence <json> [--require id1,id2] [--repo <root>]')
  const kind = option('--kind') ?? 'host'
  if (kind !== 'host' && kind !== 'surface') throw new Error('--kind must be host or surface')
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
  const requiredOption = option('--require')
  const required = requiredOption === undefined ? undefined : String(requiredOption).split(',').map(part => part.trim()).filter(part => part !== '')
  const expected = await expectedIdentity(option('--repo'))
  const result = kind === 'surface'
    ? checkSurfaceGateEvidence(evidence, { expected, ...required === undefined ? {} : { requiredCaseIds: required } })
    : checkHostGateEvidence(evidence, { expected, requiredCaseIds: required ?? [] })
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  return result.ok ? 0 : 2
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    console.error('host-gate-evidence: ' + String(error?.message ?? error))
    process.exitCode = 1
  })
}
