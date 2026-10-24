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
 *   upgrade assess   a read-only update assessment of the three components
 *                    with its sources, patch decisions and conclusion
 *                    (UPG-01/02/08/11)
 *   upgrade propose  the reviewable proposal built from that assessment: a
 *                    bound payload with its hash, sources, risks, stop
 *                    conditions and rollback; nothing is installed or switched
 *                    (UPG-03/05)
 *   upgrade consent  append the user's own reply to that proposal: the scope it
 *                    grants, or the rejection (UPG-03/05/07, SCOPE-06)
 *   upgrade validate the approved candidate, isolated in its own tree and store:
 *                    gates run, nothing switched (UPG-04/06/09/11/13)
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
import { validateCandidate, validationAuthorization, writeCandidateReport } from './candidates.mjs'
import { describeConfig, requireRole, saveConfig, stateDirectory } from './config.mjs'
import { verifyInvocationContext } from './context.mjs'
import { buildIncident, DEFAULT_FEATURE, incidentDirectory, registerNeedsTriageIssues, validateSeqBounds, writeIncidentBundle } from './incidents.mjs'
import { appendConsentRecord, AUTO_APPROVAL_FLAGS, bindingOf, buildProposal, candidateDirectoryProblem, CONSENT_SCOPES, consentDrift, consentStatus, DECISIONS, freshnessDrift, locateUserReply, makeConsentRecord, proposalEligibility, proposalHashOf, proposalPlacementProblem, readConsent, readProposal, readVerificationCommands, resolveAssessment, scopeFor, writeProposal } from './proposals.mjs'
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

/** The four words `upgrade` accepts after it. */
export const UPGRADE_SUBCOMMANDS = ['assess', 'propose', 'consent', 'validate']

/**
 * The flags each command accepts.
 *
 * One row per command, and a flag outside its row is a usage refusal (3) rather
 * than a silently ignored argument: an entry that accepts a shape it does not
 * honour is how a default acceptance sneaks in (UPG-03/07).
 */
export const FLAG_ALLOWLIST = {
  context: ['session', 'target-session', 'target-cwd', 'cwd', 'preset'],
  config: ['set-maintenance-repo', 'set-evidence-dir', 'create'],
  baseline: ['session', 'target-session', 'target-cwd', 'cwd', 'preset'],
  incident: ['session', 'target-session', 'target-cwd', 'cwd', 'seq-min', 'seq-max', 'now', 'feature', 'user-report', 'user-evidence', 'preset'],
  'upgrade assess': ['sources', 'now', 'target', 'preset'],
  'upgrade propose': ['assessment', 'now', 'target', 'preset'],
  'upgrade consent': ['proposal', 'decision', 'scope', 'reply', 'now', 'preset'],
  'upgrade validate': ['proposal', 'now', 'timeout-min', 'preset'],
}

/**
 * Refuse an unknown flag, and refuse the automatic-acceptance family outright.
 *
 * `--preset` is accepted everywhere because it is RECORDED and never trusted
 * (SCOPE-04/05); the approval flags are accepted nowhere, because a default
 * acceptance is never the user's own reply.
 * @param {Record<string, string | true>} flags the parsed flags
 * @param {string} key the command's row in {@link FLAG_ALLOWLIST}
 * @returns {void}
 * @throws {UsageError} when the flag is unknown to this command, or tries to approve
 */
export function assertFlagsAllowed(flags, key) {
  const allowed = FLAG_ALLOWLIST[key] ?? []
  for (const name of Object.keys(flags)) {
    if (AUTO_APPROVAL_FLAGS.includes(name)) {
      throw new UsageError('--' + name + ' is refused: an automatic-acceptance flag is never the user\'s own reply. A consent record quotes what the user wrote, and there is no default acceptance.')
    }
    if (!allowed.includes(name)) {
      throw new UsageError('unknown flag --' + name + ' for "' + key + '"; accepted: ' + (allowed.length === 0 ? 'none' : allowed.map((entry) => '--' + entry).join(', ')))
    }
  }
}

/**
 * An ISO timestamp from `--now`, defaulting to the current time.
 * @param {string | true | undefined} raw the flag value
 * @returns {string} the timestamp
 * @throws {UsageError} when the value is missing or unparsable
 */
export function timeFlag(raw) {
  if (raw === true) throw new UsageError('--now needs an ISO-8601 timestamp')
  const now = typeof raw === 'string' ? raw : new Date().toISOString()
  if (Number.isNaN(Date.parse(now))) throw new UsageError('--now must be an ISO-8601 timestamp')
  return now
}

/**
 * A target role from `--target`, or a usage refusal.
 * @param {string | true | undefined} raw the flag value
 * @param {string} fallback the default role
 * @returns {string} the role
 */
export function targetFlag(raw, fallback) {
  if (raw === true) throw new UsageError('--target needs a value (' + TARGET_ROLES.join(' | ') + ')')
  const role = typeof raw === 'string' ? raw : fallback
  if (!TARGET_ROLES.includes(role)) throw new UsageError('--target must be one of ' + TARGET_ROLES.join(', '))
  return role
}

/**
 * Validate one consent answer. There is no default: every field must be given,
 * and a rejection grants no scope at all.
 * @param {Record<string, string | true>} flags the parsed flags
 * @returns {{decision: string, scopeName?: string, quote: string, proposalValue: string, now: string}} the answer
 * @throws {UsageError} when the answer could be read as an automatic approval
 */
export function consentAnswer(flags) {
  const decision = flags.decision
  if (decision === undefined) throw new UsageError('--decision is required (' + DECISIONS.join(' | ') + '): there is no default answer')
  if (decision === true || !DECISIONS.includes(decision)) throw new UsageError('--decision must be one of ' + DECISIONS.join(', '))
  const scopeName = flags.scope
  if (scopeName === true) throw new UsageError('--scope needs a value (' + CONSENT_SCOPES.join(' | ') + ')')
  if (scopeName !== undefined && !CONSENT_SCOPES.includes(scopeName)) throw new UsageError('--scope must be one of ' + CONSENT_SCOPES.join(', '))
  if (scopeName !== undefined && decision === 'reject') throw new UsageError('--scope is meaningless with --decision reject: a rejection grants nothing')
  const quote = typeof flags.reply === 'string' ? flags.reply : ''
  if (quote.trim() === '') {
    throw new UsageError('--reply must quote the user\'s own words: an empty quotation is not a consent, and --yes / approved:true are refused outright')
  }
  const proposalValue = flags.proposal
  if (proposalValue === undefined) throw new UsageError('--proposal is required: the proposal.json (or its directory) being answered')
  if (proposalValue === true) throw new UsageError('--proposal needs a value')
  return {
    decision,
    ...scopeName === undefined ? {} : { scopeName },
    quote,
    proposalValue,
    now: timeFlag(flags.now),
  }
}

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
 * @property {(command: string, args: string[], options: object) => unknown} [runner]
 *   process runner override for `upgrade validate`: the default is a real child
 *   process, and a fixture supplies its own so no real command is started
 * @property {(name: string) => boolean} [cancel]
 *   cancellation override for `upgrade validate`: the default is the process's
 *   own SIGINT/SIGTERM predicate, and a fixture supplies a deterministic one
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
 * The CLI-shaped answer for one written proposal.
 *
 * A projection, exactly like {@link upgradeValue}: the whole record lives in the
 * written files and this narrows it to what a skill body relays, so a new
 * proposal field is added in ONE place.
 * @param {object} proposal the written proposal
 * @returns {object} the value to print
 */
function proposalValue(proposal) {
  return {
    proposalId: proposal.proposalId,
    proposalHash: proposal.proposalHash,
    baselineHash: proposal.baselineHash,
    conclusion: proposal.assessment?.conclusion ?? null,
    summary: proposal.assessment?.summary ?? null,
    target: proposal.target,
    candidates: proposal.candidates,
    reasons: proposal.reasons,
    patchDecisions: proposal.patchDecisions,
    changes: proposal.changes,
    scope: proposal.scope,
    risks: proposal.risks,
    stopConditions: proposal.stopConditions,
    rollback: proposal.rollback,
    execution: proposal.execution,
    gaps: proposal.gaps,
  }
}

/**
 * The CLI-shaped answer for one candidate validation.
 *
 * A projection, exactly like {@link proposalValue}: the whole record lives in
 * result.json beside the candidate tree and in validation.md beside the
 * proposal, and this narrows it to what a skill body relays — so a new report
 * field is added in ONE place.
 * @param {object} report the written candidate report
 * @returns {object} the value to print
 */
function candidateValue(report) {
  return {
    verdict: report.verdict,
    proposalId: report.proposalId,
    proposalHash: report.proposalHash,
    baselineHash: report.baselineHash,
    runner: report.runner,
    includedInputs: {
      commit: report.includedInputs.commit,
      dirty: report.includedInputs.dirty,
      files: report.includedInputs.files,
      lockfileSha256: report.includedInputs.lockfileSha256,
    },
    dependencyUpdates: report.dependencyUpdates,
    candidateBaseline: report.candidateBaseline,
    patchResults: report.patchResults.map((item) => ({
      component: item.component,
      file: item.file,
      decision: item.decision,
      apply: item.apply,
      expected: item.expected,
      resolved: item.resolved,
      satisfied: item.satisfied,
      requiresRecut: item.requiresRecut,
    })),
    checks: report.checks,
    commands: report.commands.map((entry) => ({
      name: entry.name,
      source: entry.source,
      command: entry.command,
      args: entry.args,
      exitCode: entry.exitCode,
      durationMs: entry.durationMs,
      ...entry.timedOut === undefined ? {} : { timedOut: entry.timedOut },
      ...entry.refused === undefined ? {} : { refused: entry.refused },
    })),
    skipped: report.skipped,
    gaps: report.gaps,
    criticalUnknowns: report.criticalUnknowns,
    pendingVerification: report.pendingVerification,
    failures: report.failures,
    stop: report.stop,
    versions: report.versions,
    scope: report.scope,
    statements: report.statements,
    next: report.next,
    nextNote: report.nextNote,
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
  // The word after `upgrade` is validated BEFORE anything else: a bogus
  // subcommand is a usage refusal (3) whatever the session state is.
  if (command === 'upgrade' && !UPGRADE_SUBCOMMANDS.includes(upgradeSubcommand)) {
    throw new UsageError('unknown upgrade command ' + JSON.stringify(upgradeSubcommand ?? '') + '; expected ' + UPGRADE_SUBCOMMANDS.join(', '))
  }
  const facts = resolveEnvironment(environment)
  const flags = parseFlags(upgradeSubcommand === undefined ? rest : rest.slice(1))
  // Every command has exactly one row of legal flags, checked before any host
  // fact is read: an unknown flag (or an approval flag) never reaches a write.
  assertFlagsAllowed(flags, command === 'upgrade' ? 'upgrade ' + upgradeSubcommand : command)
  /** A numeric flag, or a usage refusal (never a silent NaN). */
  const numberFlag = (name) => {
    const raw = flags[name]
    if (raw === undefined) return undefined
    if (raw === true) throw new UsageError('--' + name + ' needs a value')
    const number = Number(raw)
    if (Number.isNaN(number)) throw new UsageError('--' + name + ' must be a number')
    return number
  }
  /** The one-line context report every command carries (never a verdict by itself). */
  const contextOf = (verdict) => ({ eligible: verdict.eligible, status: verdict.status, ...verdict.reason === undefined ? {} : { reason: verdict.reason } })
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
    // ── upgrade propose: the reviewable proposal (UPG-03/05) ──────────────────
    // The flag values are validated first: a usage error is a usage error
    // whatever the session state is. No assessment, no proposal file.
    if (upgradeSubcommand === 'propose') {
      if (flags.assessment === true) throw new UsageError('--assessment needs a directory or a JSON file path')
      const now = timeFlag(flags.now)
      const targetRole = targetFlag(flags.target, 'maintenance-repository')
      const verdict = await verdictFor()
      const context = contextOf(verdict)
      // SCOPE-06: an assisted session MAY build the proposal (that is analysis);
      // only the consent has to come from the user in the main session.
      if (!verdict.eligible) {
        return { code: EXIT.stopped, value: { command: 'upgrade', status: 'stopped', reason: verdict.reason, delegation: verdict.delegation, context } }
      }
      const described = await describeConfig(facts.stateDir)
      const roleStatus = roleResolver(described)
      const maintenance = roleStatus('maintenanceRepository')
      const evidence = roleStatus('evidenceDirectory')
      // D9: an unusable evidence directory stops ITS write and names the fix.
      if (evidence.path === undefined) {
        return { code: EXIT.stopped, value: { command: 'upgrade', status: 'read-only', reason: evidence.reason, context } }
      }
      const resolved = await resolveAssessment({ value: flags.assessment, evidenceDirectory: evidence.path })
      if (resolved.reason !== undefined) {
        return { code: EXIT.stopped, value: { command: 'upgrade', status: 'stopped', reason: resolved.reason, next: resolved.next ?? 'upgrade assess', context } }
      }
      // UPG-03: only a recommendation with at least one recommended component can
      // become a proposal; defer / insufficient-evidence / no-upgrade stop here.
      const eligibility = proposalEligibility(resolved.assessment)
      if (!eligibility.eligible) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'stopped',
            reason: eligibility.reason,
            next: eligibility.next,
            assessment: { path: resolved.path, conclusion: resolved.assessment?.conclusion ?? null },
            context,
          },
        }
      }
      // Freshness: the combination must still be the one the assessment measured.
      // A drift here means the check and the proposal disagree, so the answer is
      // another assessment, never a proposal over a stale combination.
      const baseline = collectRunBaseline({ verdict, maintenance })
      const drift = freshnessDrift(resolved.assessment, baseline)
      if (drift.length > 0) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'stopped',
            reason: 'the baseline drifted between the assessment and this proposal: ' + drift.map((entry) => entry.component + ' ' + entry.recorded + ' -> ' + entry.now).join('、')
              + '; nothing was written — re-run "upgrade assess" before proposing',
            next: 'upgrade assess',
            drift,
            context,
          },
        }
      }
      // Verification commands are READ from the repository's own scripts and never
      // executed: a missing list is a named gap, not an invented command.
      const verification = await readVerificationCommands(maintenance.path)
      const target = {
        role: targetRole,
        path: targetRole === 'maintenance-repository' && maintenance.path !== undefined ? maintenance.path : 'unknown',
        note: 'The target is named and bound, never switched: this command writes a proposal only.',
      }
      const built = buildProposal({ assessment: resolved.assessment, baseline, verification, target, now, evidenceDirectory: evidence.path, assessmentDirectory: resolved.directory })
      // A4: the candidate directory is named under the evidence directory, and it
      // must not land inside the worktree an upgrade is about to change.
      const candidateProblem = candidateDirectoryProblem({
        candidateDirectory: built.proposal.changes.candidateDirectory,
        evidenceDirectory: evidence.path,
        maintenanceRepository: maintenance.path,
      })
      if (candidateProblem !== undefined) {
        return { code: EXIT.stopped, value: { command: 'upgrade', status: 'stopped', reason: candidateProblem, context } }
      }
      const directory = built.proposal.directory
      let files
      try {
        files = await writeProposal({ directory, proposal: built.proposal })
      } catch (error) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'incomplete',
            reason: 'the proposal could not be written to ' + directory + ': ' + (error instanceof Error ? error.message : String(error)),
            context,
          },
        }
      }
      const consentFile = await readConsent(files.consent)
      const records = consentFile.consent?.records ?? []
      return {
        code: EXIT.ok,
        value: {
          command: 'upgrade',
          status: 'proposed',
          ...proposalValue(built.proposal),
          evidence: { directory, files },
          // A pre-existing approval for the SAME bound inputs stays; a consent file
          // this run cannot read is reported rather than read as 'pending'.
          consent: {
            status: consentStatus(records),
            records: records.length,
            path: files.consent,
            ...consentFile.reason === undefined ? {} : { problem: consentFile.reason },
          },
          next: 'show proposal.md to the user, ask explicitly whether to proceed, and record the answer with "upgrade consent" (no reply, a rejection and an ambiguous reply all mean: do not start)',
          context,
        },
      }
    }
    // ── upgrade validate: the approved candidate, isolated (UPG-04/06/09/11/13) ─
    if (upgradeSubcommand === 'validate') {
      // Usage errors first: they are usage errors whatever the session state is.
      if (flags.proposal === undefined) throw new UsageError('--proposal is required: the proposal.json (or its directory) the user approved')
      if (flags.proposal === true) throw new UsageError('--proposal needs a value')
      const now = timeFlag(flags.now)
      const timeoutMin = numberFlag('timeout-min')
      if (timeoutMin !== undefined && (!Number.isFinite(timeoutMin) || timeoutMin <= 0)) {
        throw new UsageError('--timeout-min must be a positive number of minutes')
      }
      const verdict = await verdictFor()
      const context = contextOf(verdict)
      if (!verdict.eligible) {
        return { code: EXIT.stopped, value: { command: 'upgrade', status: 'stopped', reason: verdict.reason, delegation: verdict.delegation, context } }
      }
      const described = await describeConfig(facts.stateDir)
      const roleStatus = roleResolver(described)
      const evidence = roleStatus('evidenceDirectory')
      const maintenance = roleStatus('maintenanceRepository')
      // D9: an unusable evidence directory stops ITS write before anything is
      // created — a candidate tree needs a directory nobody else owns.
      if (evidence.path === undefined) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'stopped',
            reason: 'the evidence directory is unusable (' + evidence.reason + '), so the candidate tree has nowhere to go; nothing was created',
            next: 'config --set-evidence-dir <absolute path>',
            context,
          },
        }
      }
      const loaded = await readProposal(flags.proposal)
      if (loaded.reason !== undefined) {
        return { code: EXIT.stopped, value: { command: 'upgrade', status: 'stopped', reason: loaded.reason, context } }
      }
      const proposal = loaded.proposal
      const recomputed = proposalHashOf(bindingOf(proposal))
      if (recomputed !== proposal.proposalHash) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'stopped',
            reason: 'the proposal at ' + loaded.path + ' no longer hashes to its recorded proposalHash (' + proposal.proposalHash + ' recorded, ' + recomputed
              + ' recomputed): a bound input changed after it was written, so the answer it carries covers another payload; nothing was validated',
            next: 'upgrade propose',
            context,
          },
        }
      }
      const consentPath = join(loaded.directory, 'consent.json')
      const consentFile = await readConsent(consentPath)
      // The gate runs BEFORE any write and any candidate command: an unapproved,
      // drifted or misplaced proposal never gets a tree, let alone a process.
      const baseline = collectRunBaseline({ verdict, maintenance })
      const authorization = validationAuthorization({
        proposal,
        proposalDirectory: loaded.directory,
        consentPath,
        records: consentFile.consent?.records ?? [],
        ...consentFile.reason === undefined ? {} : { consentProblem: consentFile.reason },
        evidenceDirectory: evidence.path,
        baseline,
        ...maintenance.path === undefined ? {} : { maintenancePath: maintenance.path },
        delegation: verdict.delegation,
      })
      if (!authorization.ok) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'stopped',
            reason: authorization.reason,
            rule: authorization.rule,
            next: authorization.next,
            ...authorization.drift === undefined ? {} : { drift: authorization.drift },
            delegation: verdict.delegation,
            context,
          },
        }
      }
      if (maintenance.path === undefined) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'stopped',
            reason: 'the maintenance repository role is unusable (' + maintenance.reason + '), so there is no snapshot to copy into a candidate tree; nothing was created',
            next: 'config --set-maintenance-repo <absolute path>',
            context,
          },
        }
      }
      // The gate above proved changes.candidateDirectory is exactly <proposalDir>/candidate.
      const candidateDirectory = resolve(proposal.changes.candidateDirectory)
      let report
      try {
        report = await validateCandidate({
          proposal,
          proposalDirectory: loaded.directory,
          candidateDirectory,
          evidenceDirectory: evidence.path,
          maintenanceRepository: maintenance.path,
          baseline,
          basis: authorization.basis,
          now,
          ...timeoutMin === undefined ? {} : { timeoutMin },
          // The runner is a seam: the default is a real child process (win32 uses
          // a shell, see scripts/test-profile.mjs), and a fixture supplies its own.
          ...environment.runner === undefined ? {} : { runner: environment.runner },
          ...environment.cancel === undefined ? {} : { cancel: environment.cancel },
        })
      } catch (error) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'incomplete',
            reason: 'the candidate run could not be completed, and the tree it left is NOT a pass: ' + (error instanceof Error ? error.message : String(error)),
            candidate: { directory: candidateDirectory },
            context,
          },
        }
      }
      let files
      try {
        files = await writeCandidateReport({ report, proposalDirectory: loaded.directory })
      } catch (error) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'incomplete',
            reason: 'the candidate result could not be written to ' + candidateDirectory + ': ' + (error instanceof Error ? error.message : String(error)),
            ...candidateValue(report),
            context,
          },
        }
      }
      return {
        // 0 only when every declared gate ACTUALLY ran and passed: skipped steps,
        // gaps and a pending candidate are all "not verified" (exit 2).
        code: report.verdict === 'candidate-verified' ? EXIT.ok : EXIT.stopped,
        value: {
          command: 'upgrade',
          status: report.verdict === 'candidate-verified' ? 'validated' : report.verdict === 'candidate-failed' ? 'failed' : 'incomplete',
          ...candidateValue(report),
          evidence: { directory: candidateDirectory, files },
          context,
        },
      }
    }
    // ── upgrade consent: the user's own answer, recorded (UPG-03/05/07) ───────
    if (upgradeSubcommand === 'consent') {
      // There is no default answer: the decision, the scope and non-empty quote
      // are validated before anything is read, and an automatic-acceptance flag
      // never even reaches here (assertFlagsAllowed refused it).
      const answer = consentAnswer(flags)
      const verdict = await verdictFor()
      const context = contextOf(verdict)
      if (!verdict.eligible) {
        return { code: EXIT.stopped, value: { command: 'upgrade', status: 'stopped', reason: verdict.reason, delegation: verdict.delegation, context } }
      }
      // SCOPE-06: the execution branch belongs to the main session. An assisted
      // session may analyze the evidence; its message is never the user's approval.
      if (verdict.delegation?.mayApproveUpgrade !== true) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'stopped',
            reason: 'SCOPE-06: this is an assisted (subagent) session (parent ' + String(verdict.delegation?.parentSession ?? 'unknown')
              + '), and an upgrade approval belongs to the user in the main session; nothing was recorded',
            delegation: verdict.delegation,
            context,
          },
        }
      }
      const described = await describeConfig(facts.stateDir)
      const roleStatus = roleResolver(described)
      const evidence = roleStatus('evidenceDirectory')
      // B15: the record is written BESIDE the proposal, so the proposal has to sit
      // inside the evidence tree already. An unusable evidence role cannot be
      // checked at all, which is the same refusal.
      if (evidence.path === undefined) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'stopped',
            reason: 'the evidence directory is unusable (' + evidence.reason + '), so the write boundary cannot be checked; nothing was recorded',
            context,
          },
        }
      }
      const loaded = await readProposal(answer.proposalValue)
      if (loaded.reason !== undefined) {
        return { code: EXIT.stopped, value: { command: 'upgrade', status: 'stopped', reason: loaded.reason, context } }
      }
      const placement = proposalPlacementProblem({ directory: loaded.directory, evidenceDirectory: evidence.path })
      if (placement !== undefined) {
        return { code: EXIT.stopped, value: { command: 'upgrade', status: 'stopped', reason: placement, context } }
      }
      const proposal = loaded.proposal
      // The proposal must still hash to what it records: a bound input changed
      // after it was written is a new payload, and this answer was given to the
      // old one (UPG-05).
      const recomputed = proposalHashOf(bindingOf(proposal))
      if (recomputed !== proposal.proposalHash) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'stopped',
            reason: 'the proposal at ' + loaded.path + ' no longer hashes to its recorded proposalHash (' + proposal.proposalHash + ' recorded, ' + recomputed
              + ' recomputed): a bound input changed after it was written, so it must be re-issued before it can be answered; nothing was recorded',
            next: 'upgrade propose',
            context,
          },
        }
      }
      const maintenance = roleStatus('maintenanceRepository')
      const baseline = collectRunBaseline({ verdict, maintenance })
      // Both halves of the bind: the baseline (committed AND uncommitted input)
      // and the target it names.
      const drift = consentDrift({ proposal, baseline, maintenancePath: maintenance.path })
      if (drift.length > 0) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'stopped',
            reason: 'the approval basis moved since the proposal was written (' + drift.map((entry) => entry.field + ': ' + String(entry.recorded) + ' -> ' + String(entry.now)).join('、')
              + '); nothing was recorded — re-run "upgrade assess" and "upgrade propose" for a new answer',
            drift,
            next: 'upgrade assess',
            context,
          },
        }
      }
      // The reply must be quotable from THIS session's own user messages. It is a
      // workflow trace, and this record does not claim to defend against a local
      // operator who forges their own log.
      const artifact = await readSessionArtifact({ sessionsRoot: facts.sessionsRoot, cwd: facts.cwd, sessionId: facts.sessionId })
      if (artifact.status !== 'read') {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'stopped',
            reason: 'this session\'s own log is ' + artifact.status + ' (' + artifact.detail + '), so the quoted reply cannot be verified; nothing was recorded',
            context,
          },
        }
      }
      const located = locateUserReply(artifact.records, answer.quote)
      if (located === undefined) {
        return {
          code: EXIT.stopped,
          value: {
            command: 'upgrade',
            status: 'stopped',
            reason: 'the quoted reply was not found in this session\'s own user messages: a consent record quotes what the user wrote here, and nothing was recorded.'
              + ' (This record is workflow traceability; it does not claim to defend against a local operator who forges their own log.)',
            context,
          },
        }
      }
      const record = makeConsentRecord({
        proposal,
        decision: answer.decision,
        scope: scopeFor(answer.scopeName),
        reply: { quote: answer.quote, source: 'user', seq: located.seq },
        recorder: { sessionId: facts.sessionId, role: verdict.delegation?.role ?? 'main' },
        now: answer.now,
      })
      const consentPath = join(loaded.directory, 'consent.json')
      const appended = await appendConsentRecord({ path: consentPath, proposal, record })
      if (appended.reason !== undefined) {
        return { code: EXIT.stopped, value: { command: 'upgrade', status: 'stopped', reason: appended.reason, context } }
      }
      return {
        code: EXIT.ok,
        value: {
          command: 'upgrade',
          status: 'recorded',
          proposalId: proposal.proposalId,
          proposalHash: proposal.proposalHash,
          baselineHash: proposal.baselineHash,
          decision: record.decision,
          scope: record.scope,
          target: record.target,
          repliedAt: record.repliedAt,
          reply: record.reply,
          // More than one match means the quote is not unique in this session: the
          // record keeps the last seq, and the skill must ask more precisely.
          replyMatches: located.matches,
          recorder: record.recorder,
          consent: { path: consentPath, status: consentStatus(appended.consent.records), records: appended.consent.records.length },
          // Recording an answer is not executing it: the boundary is the proposal's.
          execution: proposal.execution ?? null,
          context,
        },
      }
    }
    // ── upgrade assess: the read-only assessment (UPG-01/02/08/11) ────────────
    const verdict = await verdictFor()
    const context = contextOf(verdict)
    // A wrong or unverifiable mode stops before any file, network or install
    // action (SCOPE-04/05): the analyzed session never authorizes this one.
    if (!verdict.eligible) {
      return { code: EXIT.stopped, value: { command: 'upgrade', status: 'stopped', reason: verdict.reason, context } }
    }
    if (flags.sources === true) throw new UsageError('--sources needs a value')
    // The same two rules every command follows; only the DEFAULT role differs:
    // an assessment reports an upgrade TARGET, while a proposal binds the
    // maintenance repository whose files an approved candidate would change.
    const now = timeFlag(flags.now)
    const targetRole = targetFlag(flags.target, 'upgrade-target')
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

  throw new UsageError('unknown command ' + JSON.stringify(command ?? '') + '; expected context, config, baseline, incident or upgrade assess|propose|consent|validate')
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