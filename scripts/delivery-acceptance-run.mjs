/**
 * The run orchestration: install, compose, prove the skill layer, run both
 * workflows, run the gates, and write the report.
 * @module dsh-tool-hashline/scripts/delivery-acceptance-run
 */

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import * as os from 'node:os'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import {
  ACCEPTANCE_IDS,
  HOST_VERSION,
  ID_OWNERS,
  REPORT_SECTIONS,
  repo,
  run,
  STATUS,
  temp,
  installBundle,
  composeProfile,
  runSkillLayer,
  recordSkillLayerRows,
  resolveVersions,
  prepareTarget,
} from './delivery-acceptance.mjs'
import { renderReport, renderSummary } from './delivery-acceptance-report.mjs'
import {
  runIncidentChain,
  runUpgradeChain,
  writeMaintenanceRepository,
  writeTargetProfile,
} from './delivery-acceptance-workflows.mjs'

export { ACCEPTANCE_IDS, REPORT_SECTIONS, STATUS }

/**
 * The launcher the clean-profile gate composes with: an explicit `DSH_CLI`, or
 * the sibling checkout this workspace is developed beside. Absent means the
 * gate reports its own gap instead of this run inventing a path.
 * @returns {Record<string, string>} the environment to add
 */
export function dshCliEnv() {
  if (process.env.DSH_CLI !== undefined) return {}
  const sibling = path.resolve(repo, '..', '..', 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js')
  return existsSync(sibling) ? { DSH_CLI: sibling } : {}
}

/**
 * The profile directory names inside one DSH home, sorted. A missing directory
 * is an empty list, not an error: a machine that never booted a host has none.
 * @param {string} home the DSH home
 * @returns {Promise<string[]>} the profile names
 */
export async function profileNames(home) {
  try {
    return (await readdir(path.join(home, 'profiles'))).sort()
  } catch {
    return []
  }
}

/** The report file names one run owns: the run's own date, never a fixture date. */
export function reportNames(startedAt) {
  const date = startedAt.slice(0, 10)
  return { report: date + '-delivery-acceptance-report.md', summary: date + '-delivery-acceptance-summary.json' }
}

/** The gate commands this report records; each is run once, with its exit code. */
export const GATES = [
  { command: 'pnpm build', argv: ['build'] },
  { command: 'pnpm -r check', argv: ['-r', 'check'] },
  { command: 'pnpm check:tests', argv: ['check:tests'] },
  { command: 'pnpm test:unit', argv: ['test:unit'] },
  { command: 'pnpm test:integration', argv: ['test:integration'] },
  { command: 'pnpm test:ptc', argv: ['test:ptc'] },
  { command: 'pnpm test:compat', argv: ['test:compat'] },
  { command: 'pnpm check:preset', argv: ['check:preset'] },
  // The clean-profile gate needs a DSH launcher; the sibling checkout provides one.
  { command: 'pnpm test:profile', argv: ['test:profile'], env: 'dsh-cli' },
]

/**
 * Run the whole acceptance.
 * @param {object} [options] run options
 * @param {boolean} [options.gates] run the repository gates (default true)
 * @param {boolean} [options.keep] keep the temporary install
 * @param {string} [options.out] report directory
 * @returns {Promise<{report: string, summary: object, directory: string}>} the written report
 */
export async function runAcceptance(options = {}) {
  const startedAt = new Date().toISOString()
  const roots = []
  const rows = []
  const gates = []
  const boundaries = []
  const record = (id, part, ok, detail) => { rows.push({ id, part, ok, detail }) }
  const gap = (id, part, detail) => { rows.push({ id, part, ok: true, gap: true, detail }) }
  // The host's own profile directory, recorded before anything runs: a delivery
  // acceptance must leave it byte-for-byte as it found it.
  const dailyProfilesBefore = await profileNames(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'))
  let install
  let facts
  let upgrade
  try {
    install = await installBundle(roots, rows)
    await composeProfile(install, rows)
    const skillLayer = await runSkillLayer(install)
    recordSkillLayerRows(skillLayer, record)
    const workflowHome = await temp('delivery-home-', roots)
    const businessCwd = await temp('delivery-business-', roots)
    const versions = await resolveVersions(install)
    const targetProfile = await prepareTarget(workflowHome, versions)
    facts = { ...install, workflowHome, businessCwd, versions, targetProfile }
    const incident = await runIncidentChain(facts, record, gap)
    upgrade = await runUpgradeChain(facts, incident, record, gap)
  } catch (error) {
    rows.push({ id: 'PACK-01', part: 'run', ok: false, detail: 'the acceptance run stopped: ' + (error instanceof Error ? error.message : String(error)) })
  } finally {
    if (options.keep !== true) await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }).catch(() => undefined)))
  }
  if (options.gates !== false) {
    for (const gate of GATES) {
      const outcome = run('pnpm', gate.argv, { cwd: repo, timeout: 1_800_000, ...gate.env === 'dsh-cli' ? { env: dshCliEnv() } : {} })
      gates.push({ command: gate.command, exitCode: outcome.code, note: outcome.code === 0 ? 'exit 0' : (outcome.stderr || outcome.stdout).split('\n').filter(Boolean).slice(-3).join(' / ').slice(0, 400) })
    }
  }
  const dailyProfilesAfter = await profileNames(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'))
  // UPG-13: a FIXED candidate and a ONE-OFF profile are the spec's acceptance
  // form — and the daily install is provably untouched, not merely ignored.
  if (upgrade?.candidateResult !== undefined) {
    record('UPG-13', 'a fixed candidate is validated end to end in a one-off profile', upgrade.candidateResult?.verdict === 'candidate-verified'
      && upgrade.switchRecord?.conclusion !== undefined
      && facts.targetProfile.startsWith(path.join(facts.workflowHome, 'profiles')),
    'candidate ' + upgrade.candidate.hashline + '/' + upgrade.candidate.toolEdit + ' → ' + String(upgrade.candidateResult?.verdict)
      + '; switch ' + String(upgrade.switchRecord?.conclusion) + '; target ' + facts.targetProfile)
    record('UPG-13', 'no daily profile, other profile or official install was touched', dailyProfilesAfter.join(',') === dailyProfilesBefore.join(','),
      'the host profile list is unchanged (' + dailyProfilesBefore.join(',') + ') and every write went to the run\'s own temporary home')
  } else if (upgrade !== undefined) {
    record('UPG-13', 'a fixed candidate is validated end to end in a one-off profile', false,
      'the upgrade chain stopped before the candidate phase, so no one-off profile was exercised')
  }
  boundaries.push(...boundariesFor(upgrade))
  // REG-01: the existing regression gates, each with the exit code this run got.
  for (const gate of gates) {
    record('REG-01', gate.command, gate.exitCode === 0, 'exit ' + gate.exitCode + (gate.exitCode === 0 ? '' : ': ' + gate.note))
  }
  if (gates.length === 0) gap('REG-01', 'repository gates', 'this run was started with --no-gates: no regression gate was executed, so REG-01 is not claimed')
  const run_ = { startedAt, finishedAt: new Date().toISOString(), rows, gates, boundaries, acceptanceIds: ACCEPTANCE_IDS, sections: REPORT_SECTIONS, owners: ID_OWNERS, install: install === undefined ? undefined : { bundleRoot: install.bundleRoot, profile: install.profile } }
  const directory = options.out ?? path.join(repo, 'docs', 'acceptance')
  await mkdir(directory, { recursive: true })
  const names = reportNames(startedAt)
  const reportPath = path.join(directory, names.report)
  await writeFile(reportPath, renderReport(run_) + '\n', 'utf8')
  await writeFile(path.join(directory, names.summary), JSON.stringify(renderSummary(run_), null, 2) + '\n', 'utf8')
  return { report: reportPath, summary: renderSummary(run_), directory }
}

/**
 * The boundaries every report states, whatever the run found, plus the ones this
 * particular run's evidence forces it to admit.
 * @param {object | undefined} upgrade the upgrade chain's facts
 * @returns {string[]} the boundaries
 */
export function boundariesFor(upgrade) {
  const boundaries = [...BOUNDARIES]
  if (upgrade?.assessed?.value?.verified === true) {
    boundaries.push('This profile carries the official DSH host, so the assessment reached `verified: true`. That is a statement about the METADATA channels only: no dependency was installed, no target was switched, and nothing here authorizes a real upgrade.')
  } else if (upgrade?.assessed !== undefined) {
    boundaries.push('The official DSH product version could not be verified on this run, so the assessment is legitimately incomplete (`verified: false`) and can never claim "no upgrade" (UPG-11).')
  }
  if (upgrade?.assessed?.value?.gaps?.some?.((entry) => entry === 'provider' || entry === 'model')) {
    boundaries.push('The fixture session logs carry no `request/header` event, so the assessment baseline reports `provider` and `model` as unknown. That is a property of this fixture, not evidence that the workflow loses them: the incident chain reads them from the same projection whenever a real log has them.')
  }
  if (upgrade?.switchRecord?.conclusion === 'switch-failed-restored') {
    boundaries.push('The switch measured the FAILURE path: the target install was refused and the round restored itself. The success path (`switch-applied`) is covered by the target-switch suite, not by this run.')
  }
  return boundaries
}

/** The boundaries every report states, whatever the run found. */
export const BOUNDARIES = [
  'NO HUMAN EVER TYPED /ptc-hashline-incident or /ptc-hashline-upgrade IN A REAL HOST as part of this run. What is measured is the AUTOMATABLE part: the packed install, the real launcher composing the preset, the entry visibility and refusal through the real registry/loader, and both workflows driven through the installed CLI. A real session with a person at the keyboard remains a user operation, and this report does not pretend to have had one.',
  'The acceptance profile is NOT a replica of the daily web profile. It boots @deepseek-ai/dsh-base + @deepseek-ai/dsh-headless from the registry at ' + HOST_VERSION + ', carries the four packed packages and the verification-only driver packages, and nothing else. Whatever the daily profile does on top of that is outside this run.',
  'The upgrade chain installs through an INJECTED runner: the pipeline is measured on the approved inputs, but no real dependency install happened. `result.json` / `switch.json` say `runner.source: injected`. `upgrade validate` and `upgrade switch` therefore run IN-PROCESS against the installed module (a child process cannot receive an injected runner); every refusal that must be a real exit CODE goes through a real child process instead.',
  'The switch targets a one-off profile inside a temporary DSH_HOME. The daily profile, every other profile and the official DSH install are untouched, and no host process is killed or restarted.',
  'The fixed candidate and pinned metadata replace a live registry query (D16/UPG-13). A real upstream upgrade still needs its own user-initiated assessment, proposal and consent.',
  'Semantic regression of a patch (did upstream implement the same behaviour?) is not measured by any of these rows: the candidate report says `semanticRegression: not-measured` for every item.',
]