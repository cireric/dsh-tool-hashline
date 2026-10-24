/**
 * Operations CLI: the entry point the two skills call (D1, D9, SCOPE-04/05,
 * CONFIG-01, and the baseline slice of the ticket).
 *
 * Everything here is read-only unless the caller explicitly assigns a
 * configuration role. The commands are deliberately small and composable so a
 * skill body states the order instead of re-implementing the checks in prose:
 *
 *   context   verify THIS session's preset projection (exit 2 when it is not
 *             the target preset — the workflow must then stop)
 *   config    read or save the maintenance repository and evidence directory
 *   baseline  report the actual running combination
 *   incident  assemble a redacted evidence bundle for one session/seq range
 *             and register suspected anomalies for triage (INC-01..06)
 *   upgrade   ASSESS only: a read-only update assessment of the three
 *             components with its sources, patch decisions and conclusion
 *             (UPG-01/02/08/11)
 * Only Node builtins: the shipped bundle must run from any working directory
 * with no checkout, no `.scratch` and no root `scripts/` beside it.
 *
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/cli
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { collectBaseline } from './baseline.mjs'
import { describeConfig, requireRole, saveConfig, stateDirectory } from './config.mjs'
import { verifyInvocationContext } from './context.mjs'
import { buildIncident, DEFAULT_FEATURE, incidentDirectory, registerNeedsTriageIssues, validateSeqBounds, writeIncidentBundle } from './incidents.mjs'
import { readSessionArtifact } from './session-log.mjs'
import { assessUpgrade, COMPONENTS, createMetadataQueries, offlineSources, prepareSources, TARGET_ROLES, upgradeDirectory, upstreamRepositories, writeUpgradeAssessment } from './upgrades.mjs'

/** Exit codes: 0 answered, 2 stopped by the workflow guard, 3 refused usage. */
export const EXIT = { ok: 0, stopped: 2, refused: 3 }

/** The bundle's installation root, derived from this file's own location. */
export function installationRoot() {
  // .../presets/ptc-hashline/operations/cli.mjs -> the bundle root.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

class UsageError extends Error {}

/**
 * Parse `--flag value` and bare `--flag` arguments.
 * @param {string[]} argv arguments after the command
 * @returns {Record<string, string | true>} the parsed flags
 */
export function parseFlags(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!flag.startsWith('--')) throw new UsageError('unexpected argument: ' + flag)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      flags[flag.slice(2)] = true
      continue
    }
    flags[flag.slice(2)] = value
    index += 1
  }
  return flags
}

/**
 * The host facts this CLI reads, all injected so a test never touches a real home.
 * @typedef {object} Environment
 * @property {NodeJS.ProcessEnv} env the process environment (host-managed values)
 * @property {string} [sessionsRoot] override of the sessions root
 * @property {string} [stateDir] override of the operations state directory
 * @property {(component: string) => Promise<object[]>} [query] metadata provider
 *   override: the default is the real read-only registry/ref query, and a
 *   fixture (or an offline run) supplies its own
 */

/**
 * Resolve the host facts the CLI needs.
 * @param {Environment} environment injected environment
 * @returns {{sessionsRoot: string, stateDir: string, dshHome: string, sessionId?: string, cwd: string}}
 */
export function resolveEnvironment(environment) {
  const env = environment.env ?? {}
  const dshHome = env.DSH_HOME ?? join(homedir(), '.dsh')
  const sessionsRoot = environment.sessionsRoot ?? join(dshHome, 'sessions')
  const stateDir = environment.stateDir ?? stateDirectory(dshHome)
  // DSH_SESSION_ID is a host-managed shell fact. The CLI takes it from the
  // environment the SHELL was given; a run_code program cannot read it, which
  // is why the skill invokes this through the shell tool.
  const sessionId = typeof env.DSH_SESSION_ID === 'string' && env.DSH_SESSION_ID.trim() !== '' ? env.DSH_SESSION_ID : undefined
  const cwd = typeof env.PWD === 'string' && env.PWD !== '' ? env.PWD : process.cwd()
  return { sessionsRoot, stateDir, dshHome, ...sessionId === undefined ? {} : { sessionId }, cwd }
}

/**
 * Read the injected metadata records for `upgrade assess`.
 *
 * `--sources` exists so a run can be driven by a pinned metadata fixture (and by
 * a test) instead of a network: it takes a JSON file path or an inline JSON
 * object with a `records` array. A malformed record is refused rather than
 * skipped, because a silently dropped record would read as an empty channel.
 * @param {string | true | undefined} value the flag value
 * @returns {Promise<{injected: boolean, records: object[]}>} the records, when supplied
 */
async function readSourceRecords(value) {
  if (value === undefined) return { injected: false, records: [] }
  if (typeof value !== 'string' || value === '') throw new UsageError('--sources needs a JSON file path or an inline JSON object')
  const trimmed = value.trim()
  const inline = trimmed.startsWith('{') || trimmed.startsWith('[')
  let text
  try {
    text = inline ? value : await readFile(value, 'utf8')
  } catch (error) {
    throw new UsageError('--sources could not be read: ' + (error instanceof Error ? error.message : String(error)))
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new UsageError('--sources is not valid JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
  const records = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.records) ? parsed.records : undefined)
  if (records === undefined) throw new UsageError('--sources must be an array of records, or an object with a "records" array')
  return { injected: true, records }
}

/**
 * The CLI-shaped answer for one upgrade assessment.
 *
 * The whole report lives in the written files; this narrows the assessment to
 * the verdict, the per-component results and the boundaries, so a skill body can
 * relay them without parsing markdown.
 * @param {object} assessment the assessment
 * @returns {{conclusion: string, summary: string, complete: boolean, verified: boolean, pendingVerification: boolean, conclusions: Record<string, string>, components: object[], target: object, scope: object, manualActions: string[], gaps: string[]}} the value to print
 */
function upgradeValue(assessment) {
  return {
    conclusion: assessment.conclusion,
    summary: assessment.summary,
    complete: assessment.complete,
    verified: assessment.verified,
    pendingVerification: assessment.pendingVerification,
    conclusions: assessment.conclusions,
    components: assessment.components.map((component) => ({
      component: component.component,
      conclusion: component.conclusion,
      recommended: component.recommended,
      verified: component.verified,
      pendingVerification: component.pendingVerification,
      baseline: component.baseline.version,
      patches: component.patches.map((item) => ({ file: item.file, decision: item.decision })),
    })),
    target: assessment.target,
    scope: assessment.scope,
    manualActions: assessment.manualActions,
    gaps: assessment.gaps,
  }
}
/**
 * Resolve each configuration role once, so every command reports an unusable
 * role the SAME way: a path when it resolves, otherwise the reason it does not.
 * @param {object} described the described configuration
 * @returns {(role: 'maintenanceRepository' | 'evidenceDirectory') => {path?: string, reason?: string}} the resolver
 */
function roleResolver(described) {
  return (role) => {
    try {
      return { path: requireRole(described, role) }
    } catch (error) {
      return { reason: error instanceof Error ? error.message : String(error) }
    }
  }
}

/**
 * The running combination for one command.
 *
 * The maintenance role's own reason joins the baseline's gaps when it is
 * unusable: an absent role must name its cause, exactly as the `baseline`
 * command does, so nobody has to read 'unknown' without a reason.
 * @param {{verdict: object, maintenance: {path?: string, reason?: string}}} options the run's facts
 * @returns {object} the baseline report
 */
function collectRunBaseline(options) {
  const verdict = options.verdict
  const maintenance = options.maintenance
  const baseline = collectBaseline({
    installationRoot: installationRoot(),
    // A configured role is reported as itself; an unconfigured or unusable one
    // stays 'unknown' rather than falling back to any working directory.
    ...maintenance.path === undefined ? {} : { maintenanceRepository: maintenance.path },
    // Provider/model come from the host's own request record for THIS session;
    // a session that never sent a request leaves them unknown.
    ...typeof verdict.evidence?.provider !== 'string' ? {} : { provider: verdict.evidence.provider },
    ...typeof verdict.evidence?.model !== 'string' ? {} : { model: verdict.evidence.model },
    presetId: verdict.evidence?.effectivePreset ?? undefined,
    presetSource: verdict.evidence?.source,
  })
  return maintenance.reason === undefined
    ? baseline
    : { ...baseline, unknown: [...baseline.unknown, 'maintenance repository: ' + maintenance.reason] }
}

/**
 * Run one command.
 * @param {string[]} argv command plus arguments
 * @param {Environment} [environment] injected host facts (tests pass fixtures)
 * @returns {Promise<{code: number, value: object}>} the exit code and the report
 */
export async function run(argv, environment = { env: {} }) {
  const [command, ...rest] = argv
  // `upgrade` is the one two-word command: its subcommand belongs to the verb,
  // so it is taken out before the flag parser ever sees a positional argument.
  const upgradeSubcommand = command === 'upgrade' ? rest[0] : undefined
  const facts = resolveEnvironment(environment)
  const flags = parseFlags(upgradeSubcommand === undefined ? rest : rest.slice(1))
  /** A numeric flag, or a usage refusal (never a silent NaN). */
  const numberFlag = (name) => {
    const raw = flags[name]
    if (raw === undefined) return undefined
    if (raw === true) throw new UsageError('--' + name + ' needs a value')
    const number = Number(raw)
    if (Number.isNaN(number)) throw new UsageError('--' + name + ' must be a number')
    return number
  }
  // ELIGIBILITY comes from the INVOKING session only — the host-managed
  // DSH_SESSION_ID. No flag can substitute for it (SCOPE-05): a caller naming
  // a historical ptc-hashline session must not thereby authorize this one.
  const verdictFor = () => verifyInvocationContext({
    sessionsRoot: facts.sessionsRoot,
    cwd: facts.cwd,
    sessionId: facts.sessionId,
    // A hand-typed preset is recorded, never trusted.
    presetArgument: typeof flags.preset === 'string' ? flags.preset : undefined,
  })
  // The TARGET is the session being analyzed, which the spec explicitly allows
  // to be a different, historical ptc-hashline session. It is reported
  // separately and never feeds the eligibility decision.
  const target = {
    session: typeof flags['target-session'] === 'string' ? flags['target-session']
      : typeof flags.session === 'string' ? flags.session : facts.sessionId ?? 'unknown',
    cwd: typeof flags['target-cwd'] === 'string' ? flags['target-cwd']
      : typeof flags.cwd === 'string' ? flags.cwd : facts.cwd,
    note: 'Reported only: the analyzed session never authorizes this one.',
  }
  if (command === 'context') {
    const verdict = await verdictFor()
    return { code: verdict.eligible ? EXIT.ok : EXIT.stopped, value: { ...verdict, target } }
  }
  if (command === 'config') {
    // `flags` is parsed once above; this command only reads assignments.
    const assignments = {
      ...typeof flags['set-maintenance-repo'] === 'string' ? { maintenanceRepository: flags['set-maintenance-repo'] } : {},
      ...typeof flags['set-evidence-dir'] === 'string' ? { evidenceDirectory: flags['set-evidence-dir'] } : {},
    }
    if (Object.keys(assignments).length === 0) {
      const described = await describeConfig(facts.stateDir)
      return { code: EXIT.ok, value: { command: 'config', stateDirectory: facts.stateDir, ...described } }
    }
    const saved = await saveConfig({
      directory: facts.stateDir,
      ...assignments,
      create: flags.create === true,
    })
    return { code: EXIT.ok, value: { command: 'config', stateDirectory: facts.stateDir, ...saved } }
  }
  if (command === 'baseline') {
    const described = await describeConfig(facts.stateDir)
    // An unusable role is reported, not silently dropped: the reason travels
    // into the baseline's `unknown` gaps so the skill body can relay it.
    const roleStatus = roleResolver(described)
    const context = await verdictFor()
    const value = {
      command: 'baseline',
      baseline: collectRunBaseline({ verdict: context, maintenance: roleStatus('maintenanceRepository') }),
      // The analyzed target is reported beside the eligibility verdict, never
      // folded into it.
      target,
      context: { eligible: context.eligible, status: context.status, ...context.reason === undefined ? {} : { reason: context.reason } },
    }
    return { code: EXIT.ok, value }
  }
  if (command === 'incident') {
    const verdict = await verdictFor()
    const context = { eligible: verdict.eligible, status: verdict.status, ...verdict.reason === undefined ? {} : { reason: verdict.reason } }
    // A wrong or unverifiable mode stops before any file or network action
    // (SCOPE-04/05): the analyzed session never authorizes this one.
    if (!verdict.eligible) {
      return { code: EXIT.stopped, value: { command: 'incident', status: 'stopped', reason: verdict.reason, context } }
    }
    const described = await describeConfig(facts.stateDir)
    const roleStatus = roleResolver(described)
    // D9: a role that is unconfigured or unusable stops ITS write and names the
    // fix. The read-only analysis below still runs, so the user sees counts and
    // gaps instead of nothing.
    const evidence = roleStatus('evidenceDirectory')
    const evidenceDirectory = evidence.path
    const evidenceProblem = evidence.reason
    const maintenance = roleStatus('maintenanceRepository')
    const targetSession = typeof flags['target-session'] === 'string' ? flags['target-session']
      : typeof flags.session === 'string' ? flags.session : facts.sessionId
    if (typeof targetSession !== 'string' || targetSession.trim() === '') {
      throw new UsageError('the incident command needs a target session (--target-session) or a host-provided DSH_SESSION_ID')
    }
    const targetCwd = typeof flags['target-cwd'] === 'string' ? flags['target-cwd']
      : typeof flags.cwd === 'string' ? flags.cwd : facts.cwd
    const seq = validateSeqBounds(numberFlag('seq-min'), numberFlag('seq-max'))
    const generatedAt = typeof flags.now === 'string' ? flags.now : new Date().toISOString()
    if (Number.isNaN(Date.parse(generatedAt))) throw new UsageError('--now must be an ISO-8601 timestamp')
    const feature = typeof flags.feature === 'string' ? flags.feature : DEFAULT_FEATURE
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(feature)) throw new UsageError('--feature must be a lowercase slug (a-z, 0-9 and -)')
    // Scope narrowing: only the named session's own directory is read; the
    // workflow never scans the sessions root for another session to analyze.
    const artifact = await readSessionArtifact({ sessionsRoot: facts.sessionsRoot, cwd: targetCwd, sessionId: targetSession })
    if (artifact.status !== 'read') {
      return {
        code: EXIT.stopped,
        value: {
          command: 'incident',
          status: artifact.status,
          reason: 'the target session\'s own log is ' + artifact.status + ' (' + artifact.detail + '); nothing was written',
          context,
          target: { session: targetSession, cwd: targetCwd },
        },
      }
    }
    const incident = buildIncident({
      artifact,
      targetSessionId: targetSession,
      targetCwd,
      seqMin: seq?.min,
      seqMax: seq?.max,
      userReport: typeof flags['user-report'] === 'string' ? flags['user-report'] : undefined,
      userEvidence: typeof flags['user-evidence'] === 'string' ? flags['user-evidence'] : undefined,
      generatedAt,
      invocation: verdict,
    })
    if (evidenceProblem !== undefined) {
      // D9 keeps the WRITE stopped, not the analysis: counts and gaps still come
      // back so the user can act without a configured evidence directory.
      return {
        code: EXIT.stopped,
        value: {
          command: 'incident',
          status: 'read-only',
          reason: evidenceProblem,
          counts: incident.counts,
          gaps: incident.integrity.issues,
          findings: incident.events.filter((event) => event.kind === 'suspected-implementation-defect' || event.kind === 'partial-success').map((event) => ({ kind: event.kind, name: event.name, seq: event.seq })),
          context,
          target: { session: targetSession, cwd: incident.target.cwd },
        },
      }
    }
    const directory = incidentDirectory(evidenceDirectory, targetSession, generatedAt)
    // The analyzed session's own route, not this one's: an incident bundle
    // carries the combination IT happened under.
    const baseline = collectRunBaseline({
      verdict: { ...verdict, evidence: { ...verdict.evidence, provider: incident.route.provider, model: incident.route.model } },
      maintenance,
    })
    // The bundle is written BEFORE any issue: a triage ticket must never cite a
    // package that does not exist (ADR-0004's partial-success lesson).
    await writeIncidentBundle({ directory, incident, baseline })
    incident.issues = maintenance.path === undefined
      ? { configured: false, directory: null, written: [], associated: [], recoveries: [], skipped: [{ reason: maintenance.reason }] }
      // The baseline travels with the registration: every occurrence record
      // keeps the combination IT happened under (INC-07), so a later run under
      // another commit or route cannot rewrite the earlier record.
      : await registerNeedsTriageIssues({ maintenanceRepository: maintenance.path, feature, incident, directory, baseline })
    // Rewrite the two files that embed the registration record.
    const files = await writeIncidentBundle({ directory, incident, baseline })
    return {
      code: incident.integrity.status === 'complete' ? EXIT.ok : EXIT.stopped,
      value: {
        command: 'incident',
        status: incident.integrity.status,
        counts: incident.counts,
        gaps: incident.integrity.issues,
        issues: incident.issues,
        evidence: { directory, files },
        context,
        target: { session: targetSession, cwd: incident.target.cwd },
      },
    }
  }
  if (command === 'upgrade') {
    if (upgradeSubcommand !== 'assess') {
      throw new UsageError('unknown upgrade command ' + JSON.stringify(upgradeSubcommand ?? '') + '; expected assess')
    }
    const verdict = await verdictFor()
    const context = { eligible: verdict.eligible, status: verdict.status, ...verdict.reason === undefined ? {} : { reason: verdict.reason } }
    // A wrong or unverifiable mode stops before any file, network or install
    // action (SCOPE-04/05): the analyzed session never authorizes this one.
    if (!verdict.eligible) {
      return { code: EXIT.stopped, value: { command: 'upgrade', status: 'stopped', reason: verdict.reason, context } }
    }
    for (const name of ['now', 'target', 'sources']) {
      if (flags[name] === true) throw new UsageError('--' + name + ' needs a value')
    }
    const now = typeof flags.now === 'string' ? flags.now : new Date().toISOString()
    if (Number.isNaN(Date.parse(now))) throw new UsageError('--now must be an ISO-8601 timestamp')
    const targetRole = typeof flags.target === 'string' ? flags.target : 'upgrade-target'
    if (!TARGET_ROLES.includes(targetRole)) throw new UsageError('--target must be one of ' + TARGET_ROLES.join(', '))
    const described = await describeConfig(facts.stateDir)
    const roleStatus = roleResolver(described)
    const maintenance = roleStatus('maintenanceRepository')
    // The target is REPORTED, never switched: a configured role names where a
    // consented upgrade could later land, and an unconfigured one stays
    // 'unknown' rather than being guessed from the working directory.
    const target = {
      role: targetRole,
      path: targetRole === 'maintenance-repository' && maintenance.path !== undefined ? maintenance.path : 'unknown',
      note: 'Reported only: an assessed target is not a switch target, and nothing here installs or switches.',
    }
    // An unusable maintenance role is named among the gaps, so the report never
    // says 'unknown' without a cause.
    const baseline = collectRunBaseline({ verdict, maintenance })
    const injected = await readSourceRecords(flags.sources)
    let raw
    if (injected.injected) {
      raw = injected.records
    } else {
      // The query is a seam: the DEFAULT provider is the real read-only
      // registry/ref query, and a caller (or an offline run) may inject another.
      const query = environment.query ?? createMetadataQueries({ now, repositories: await upstreamRepositories(baseline) })
      raw = []
      for (const component of COMPONENTS) {
        try {
          raw.push(...await query(component))
        } catch (error) {
          // A failed query is recorded as unverified, never as "no update": an
          // unavailable source caps the conclusion at defer.
          raw.push(...offlineSources(now, 'the metadata query failed: ' + (error instanceof Error ? error.message : String(error))).filter((record) => record.component === component))
        }
      }
    }
    const records = prepareSources(raw, now)
    const assessment = assessUpgrade({ baseline, records, now, target })
    const evidence = roleStatus('evidenceDirectory')
    if (evidence.path === undefined) {
      // D9: an unconfigured or unusable evidence directory stops ITS write, not
      // the read-only analysis. Nothing at all is written in that case.
      return { code: EXIT.stopped, value: { command: 'upgrade', status: 'read-only', reason: evidence.reason, ...upgradeValue(assessment), context } }
    }
    const directory = upgradeDirectory(evidence.path, now)
    let files
    try {
      files = await writeUpgradeAssessment({ directory, assessment, records })
    } catch (error) {
      // A write failure is neither a usage error (3) nor a completed assessment:
      // it is "not written" (2), and the reason names the directory to fix.
      return {
        code: EXIT.stopped,
        value: {
          command: 'upgrade',
          status: 'incomplete',
          reason: 'the assessment could not be written to ' + directory + ': ' + (error instanceof Error ? error.message : String(error)),
          ...upgradeValue(assessment),
          context,
        },
      }
    }
    return {
      // Incomplete evidence was still delivered, and says so (exit 2 is the same
      // semantics the incident command uses): a pending candidate is not success.
      code: assessment.complete ? EXIT.ok : EXIT.stopped,
      value: { command: 'upgrade', status: 'assessed', ...upgradeValue(assessment), evidence: { directory, files }, context },
    }
  }

  throw new UsageError('unknown command ' + JSON.stringify(command ?? '') + '; expected context, config, baseline, incident or upgrade assess')
}

/**
 * CLI entry point.
 * @param {string[]} argv arguments after the executable
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv) {
  let result
  try {
    result = await run(argv, { env: process.env })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(message + '\n')
    return EXIT.refused
  }
  process.stdout.write(JSON.stringify(result.value, null, 2) + '\n')
  return result.code
}

/* istanbul ignore next -- CLI entry, exercised through the tests as a child process. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}