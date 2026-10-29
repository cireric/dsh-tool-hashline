/**
 * One table per candidate: identity, each gate's verdict, and the delivery run — so a claim can
 * name the thing it measured.
 *
 * Why this exists: four artifacts already record parts of the same story —
 *   `installation.json`  (which disposable profile/bundle the run installed),
 *   `host-result.json`   (installed-host cases + the two asset digests),
 *   `surface-result.json`(controller-frame cases + the same two digests),
 *   `<date>-delivery-acceptance-summary.json` (pack/install/gates/workflow rows + verdicts).
 * Reading them side by side is where "the version is the same, so the patch is in" comes from.
 * This module reads them together and REFUSES the combination when they do not describe one
 * candidate, and it never promotes a gap or a blocked item to PASS.
 *
 * It only reads JSON. It installs nothing, runs no gate and calls no model.
 * @module dsh-tool-hashline/scripts/candidate-evidence
 */
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

/** Verdict ordering: a worse axis wins; PASS is last. */
export const VERDICT_ORDER = Object.freeze(['PASS', 'GAP', 'BLOCKED', 'FAIL'])

/** The worst verdict among the given ones. */
export function worstVerdict(verdicts) {
  let worst = 'PASS'
  for (const verdict of verdicts) {
    if (!VERDICT_ORDER.includes(verdict)) return 'BLOCKED'
    if (VERDICT_ORDER.indexOf(verdict) > VERDICT_ORDER.indexOf(worst)) worst = verdict
  }
  return worst
}

/** Count the verdicts of one delivery summary's id map. */
export function tallyDelivery(summary) {
  const tally = { PASS: 0, FAIL: 0, GAP: 0, BLOCKED: 0, unknown: 0 }
  for (const verdict of Object.values(summary?.verdicts ?? {})) {
    if (verdict in tally) tally[verdict] += 1
    else tally.unknown += 1
  }
  return tally
}

/** The identity each artifact claims, normalised. */
function identityOf(installation, hostResult, surfaceResult, deliverySummary) {
  const hostInstalled = hostResult?.installed ?? {}
  const surfaceInstalled = surfaceResult?.installed ?? {}
  return {
    profile: installation?.profile ?? null,
    bundleRoot: installation?.bundleRoot ?? hostInstalled.bundleRoot ?? null,
    deliveryBundleRoot: deliverySummary?.install?.bundleRoot ?? null,
    gateModuleSha256: hostInstalled.gateModuleSha256 ?? surfaceInstalled.gateModuleSha256 ?? null,
    personaSha256: hostInstalled.personaSha256 ?? surfaceInstalled.personaSha256 ?? null,
    hostDigests: { gate: hostInstalled.gateModuleSha256 ?? null, persona: hostInstalled.personaSha256 ?? null },
    surfaceDigests: { gate: surfaceInstalled.gateModuleSha256 ?? null, persona: surfaceInstalled.personaSha256 ?? null },
  }
}

/**
 * Build the candidate table.
 * @param input - { installation, hostResult, surfaceResult, deliverySummary, expected? }.
 * @returns { candidate, axes, verdict, findings, table }
 */
export function candidateEvidence(input = {}) {
  const { installation, hostResult, surfaceResult, deliverySummary, expected } = input
  const findings = []
  const identity = identityOf(installation, hostResult, surfaceResult, deliverySummary)

  // 1. One candidate, or no claim.
  // A conflict needs TWO recorded values; one side missing is a missing gate (BLOCKED below),
  // not a disagreement.
  if (identity.hostDigests.gate !== null && identity.surfaceDigests.gate !== null && identity.hostDigests.gate !== identity.surfaceDigests.gate) {
    findings.push({ axis: 'identity', verdict: 'FAIL', detail: 'host and surface evidence name different gate modules' })
  }
  if (identity.hostDigests.persona !== null && identity.surfaceDigests.persona !== null && identity.hostDigests.persona !== identity.surfaceDigests.persona) {
    findings.push({ axis: 'identity', verdict: 'FAIL', detail: 'host and surface evidence name different personas' })
  }
  if (identity.bundleRoot !== null && identity.deliveryBundleRoot !== null
    && !String(identity.deliveryBundleRoot).endsWith(String(identity.bundleRoot).replace(/^.*[\\/]/u, ''))) {
    findings.push({ axis: 'identity', verdict: 'FAIL', detail: 'the delivery run installed a different bundle than the gates measured' })
  }
  if (expected !== undefined) {
    for (const [asset, want] of Object.entries(expected)) {
      const got = asset.includes('personas') ? identity.personaSha256 : identity.gateModuleSha256
      if (got !== null && got !== want) findings.push({ axis: 'identity', verdict: 'FAIL', detail: 'evidence names a different ' + asset + ' than this tree' })
    }
  }

  // 2. Each gate's own verdict.
  const gateAxis = (name, result, extra = {}) => {
    if (result === undefined || result === null) {
      findings.push({ axis: name, verdict: 'BLOCKED', detail: 'no artifact for this gate' })
      return { gate: name, verdict: 'BLOCKED', cases: 0, pass: 0, fail: 0, ...extra }
    }
    const cases = Array.isArray(result.cases) ? result.cases : []
    const pass = cases.filter(entry => entry?.status === 'PASS').length
    const fail = cases.filter(entry => entry?.status === 'FAIL').length
    const verdict = result.status === 'FAIL' || fail > 0 ? 'FAIL' : result.status === 'PASS' ? 'PASS' : 'GAP'
    if (verdict !== 'PASS') findings.push({ axis: name, verdict, detail: String(result.status ?? 'unknown') + ' with ' + String(fail) + ' failing case(s)' })
    return { gate: name, verdict, cases: cases.length, pass, fail, ...extra }
  }
  const host = gateAxis('host', hostResult)
  const surface = gateAxis('surface', surfaceResult, { browser: surfaceResult?.browserScreenshot === true })
  if (surfaceResult !== undefined && surfaceResult !== null && surfaceResult.browserScreenshot !== true) {
    findings.push({ axis: 'surface', verdict: 'GAP', detail: 'browser-not-verified: the frames are proven, the page is not' })
  }

  // 3. The delivery run, if any.
  let delivery = null
  if (deliverySummary !== undefined && deliverySummary !== null) {
    const tally = tallyDelivery(deliverySummary)
    const verdict = tally.FAIL > 0 ? 'FAIL' : (tally.GAP > 0 || tally.BLOCKED > 0 || tally.unknown > 0) ? 'GAP' : 'PASS'
    delivery = { gate: 'delivery', verdict, tally, gates: (deliverySummary.gates ?? []).length, cases: (deliverySummary.rows ?? []).length }
    if (verdict !== 'PASS') findings.push({ axis: 'delivery', verdict: verdict === 'FAIL' ? 'FAIL' : 'GAP', detail: 'delivery ids: FAIL ' + String(tally.FAIL) + ', GAP ' + String(tally.GAP) + ', BLOCKED ' + String(tally.BLOCKED) })
  } else {
    delivery = { gate: 'delivery', verdict: 'BLOCKED', tally: null, gates: 0, cases: 0 }
    findings.push({ axis: 'delivery', verdict: 'BLOCKED', detail: 'the delivery acceptance summary is absent' })
  }

  // An artifact set that records no digest at all cannot name its candidate: that is BLOCKED,
  // not a pass with "no conflicts found".
  if (identity.gateModuleSha256 === null && identity.personaSha256 === null) {
    findings.push({ axis: 'identity', verdict: 'BLOCKED', detail: 'no artifact recorded an asset digest: the evidence cannot name the candidate it measured' })
  }
  const axes = { identity: worstVerdict(findings.filter(finding => finding.axis === 'identity').map(finding => finding.verdict)), host, surface, delivery }
  const verdict = worstVerdict([axes.identity, host.verdict, surface.verdict, delivery.verdict])

  const table = [
    ['axis', 'verdict', 'detail'],
    ['identity', axes.identity, identity.gateModuleSha256 === null ? 'no digest recorded' : 'gate ' + String(identity.gateModuleSha256).slice(0, 12) + '… persona ' + String(identity.personaSha256).slice(0, 12) + '…'],
    ['host', host.verdict, String(host.pass) + '/' + String(host.cases) + ' cases pass'],
    ['surface', surface.verdict, String(surface.pass) + '/' + String(surface.cases) + ' cases pass' + (surface.browser ? ' (browser verified)' : ' (browser not verified)')],
    ['delivery', delivery.verdict, delivery.tally === null ? 'no summary' : 'ids PASS ' + String(delivery.tally.PASS) + ' / GAP ' + String(delivery.tally.GAP) + ' / BLOCKED ' + String(delivery.tally.BLOCKED) + ' / FAIL ' + String(delivery.tally.FAIL)],
  ]
  return { candidate: identity, axes, verdict, findings, table }
}

/**
 * CLI: `node scripts/candidate-evidence.mjs --installation <json> [--host <json>] [--surface <json>]
 *      [--delivery <summary.json>] [--out <file>]`
 * Exit codes: 0 = PASS, 2 = GAP or BLOCKED, 3 = FAIL, 1 = unusable input.
 */
export async function main(argv) {
  const { writeFile } = await import('node:fs/promises')
  const option = name => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const load = async value => (value === undefined ? undefined : JSON.parse(await readFile(value, 'utf8')))
  const result = candidateEvidence({
    installation: await load(option('--installation')),
    hostResult: await load(option('--host')),
    surfaceResult: await load(option('--surface')),
    deliverySummary: await load(option('--delivery')),
  })
  const text = result.table.map(row => row.join(' | ')).join('\n') + '\nverdict: ' + result.verdict + '\n'
    + result.findings.map(finding => '- [' + finding.verdict + '] ' + finding.axis + ': ' + finding.detail).join('\n') + '\n'
  const out = option('--out')
  if (out === undefined) process.stdout.write(text)
  else await writeFile(out, text, 'utf8')
  return result.verdict === 'PASS' ? 0 : result.verdict === 'FAIL' ? 3 : 2
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    console.error('candidate-evidence: ' + String(error?.message ?? error))
    process.exitCode = 1
  })
}
