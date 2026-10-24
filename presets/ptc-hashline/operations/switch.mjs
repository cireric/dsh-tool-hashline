/**
 * Target switch and its failure rollback — the spec's 「获同意后的升级阶段」 #4/#5
 * (ticket 07: UPG-05/06/07/10/12/13, D10/D11/D15/D16).
 *
 * One boundary shapes this module: it changes the ONE profile install tree the
 * user approved, plus the maintenance worktree's own dependencies and patches,
 * and nothing else. Four rules follow.
 *
 * - Every precondition is re-verified BEFORE the first write and the first
 *   process: the LAST consent record must approve THIS proposalHash with
 *   'scope.switch === true', the re-collected baseline (committed AND uncommitted
 *   input) must still equal 'baselineHash', the proposal must sit inside this
 *   workflow's evidence tree, the target must be the exact profile install tree
 *   that record named, the candidate must be candidate-verified (read from the
 *   sibling result.json — never from a claim), and no affected file may carry the
 *   user's own edits (UPG-10). Any mismatch stops with zero writes and zero
 *   commands, and names the next step.
 * - The order is fixed: backup, then the write list (switch.json), then the
 *   maintenance worktree's dependencies and patches, the build, the target
 *   install, and finally the target's own re-collected evidence. A backup that
 *   cannot be taken stops the switch BEFORE anything changes — "could not back
 *   it up, so I changed it anyway" is exactly what this rule prevents.
 * - A partial failure restores THIS round only, and only when the target is
 *   still this round's result: the current digests and versions are compared with
 *   the "after" values switch.json recorded. An external change, an incomplete
 *   backup or an unmeasurable state is a hand-over — stop, keep the evidence, and
 *   never overwrite the user's work or unrelated changes.
 * - Live dependencies are not hot-swapped: nothing here kills a process, restarts
 *   or stops DSH, touches another profile, or modifies the official DSH install.
 *   The user arranges the stop window (D11).
 *
 * switch.json is append-only in the sense that matters: each write GROWS the step
 * and write lists and never rewrites an entry that is already there, and
 * proposal.json / consent.json / validation.md are never touched at all. The
 * header lands before the first change (so an interrupted run still leaves the
 * write list behind) and the completed record lands at the end. rollback.json
 * carries the restore (or the hand-over) on its own.
 *
 * What this module does NOT do: it does not decide whether an upstream release
 * implements a local patch (that is the proposal's source judgement, UPG-02), it
 * does not retry a partial failure, and it does not widen its own repair scope.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/switch
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  DEFAULT_TIMEOUT_MIN,
  applyDependencyUpdates,
  applyPatchDecisions,
  authorizationBasis,
  candidateCommandProblem,
  candidateVersionCheck,
  createDefaultRunner,
  digestOfFile,
  interruptPredicate,
  managerCommand,
  managerOf,
  namesIn,
  parseDriverOutcome,
  resolvedCandidateEngines,
  resolvedPatchItem,
  shortLinkDriver,
  splitDeclared,
} from './candidates.mjs'
import { consentDrift, proposalPlacementProblem, textOf } from './proposals.mjs'
import { clip } from './text.mjs'
/** The markdown code tick, spelled without a raw backtick in this file. */
const TICK = '\u0060'

/** Identity written into every switch record. */
export const SWITCH_TOOL = 'ptc-hashline-operations-target-switch'
/** Record schema version. */
export const SWITCH_VERSION = 1
/** The only three conclusions. There is no fourth "probably fine". */
export const SWITCH_VERDICTS = ['switch-applied', 'switch-failed-restored', 'switch-failed-handover']
/** The bundle a switch target must already carry (this run refreshes, never adopts). */
export const TARGET_BUNDLE = 'dsh-tool-hashline'
/** Where this run's own short-link driver lives, relative to the proposal directory. */
export const SWITCH_DRIVER_PATH = ['switch', 'short-link.mjs']
/** The directory holding the backup, relative to the proposal directory. */
export const BACKUP_DIRECTORY = 'backup'
/** The files an approved switch may change on each side. */
export const AFFECTED_MANIFEST_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']
/** The maintenance worktree's patch directory prefix. */
export const AFFECTED_PATCH_PREFIX = 'patches/'
/** The two sides, in the order the report lists them. */
export const SIDES = ['maintenance', 'target']

// ── the preconditions (spec: 同意范围与执行规则) ────────────────────────────

/**
 * The gate an approved proposal must pass before this module writes or spawns.
 *
 * Every refusal names the next step and none of them writes anything: a switch
 * that starts on a stale approval, a moved target or an unverified candidate
 * would be executing an authorization the user never gave (UPG-05/06/07/10).
 * @param {object} options the facts
 * @returns {{ok: boolean, rule?: string, reason?: string, next?: string, basis?: object, drift?: object[], targetPath?: string}} the verdict
 */
export function switchAuthorization(options) {
  const proposal = options.proposal ?? {}
  const refuse = (rule, reason, next) => ({ ok: false, rule, reason, next })
  if (options.consentProblem !== undefined) {
    return refuse('UPG-03', options.consentProblem + '; no target was switched', 'upgrade consent')
  }
  const records = Array.isArray(options.records) ? options.records : []
  const last = records.length > 0 ? records[records.length - 1] : undefined
  if (last === undefined) {
    return refuse('UPG-03', 'the consent file at ' + options.consentPath + ' holds no record: approval is never the default, so no target was switched', 'upgrade consent --scope validation-and-switch')
  }
  if (last.decision !== 'approve') {
    return refuse('UPG-03', 'the last consent record for this proposal is ' + JSON.stringify(last.decision ?? null) + ', not "approve": the user did not authorize a switch, so no target was switched', 'upgrade consent')
  }
  if (last.proposalHash !== proposal.proposalHash) {
    return refuse('UPG-05', 'the last consent record approves proposalHash ' + String(last.proposalHash) + ', but this proposal is ' + String(proposal.proposalHash) + ': an approval never covers another payload, so no target was switched', 'upgrade propose')
  }
  if (last.scope?.switch !== true) {
    return refuse('UPG-07', 'the last consent record approves the candidate phase only (scope: ' + JSON.stringify(last.scope ?? {}) + '): the second phase was never granted, and a switch needs scope.switch === true', 'ask the user whether to switch this exact target, then record the answer with "upgrade consent --scope validation-and-switch"')
  }
  const drift = consentDrift({ proposal, baseline: options.baseline, maintenancePath: options.maintenancePath })
  if (drift.length > 0) {
    return {
      ...refuse('UPG-05', 'the approval basis moved since the proposal was written (' + drift.map((entry) => entry.field + ': ' + String(entry.recorded) + ' -> ' + String(entry.now)).join('、') + '); no target was switched — re-run "upgrade assess" and "upgrade propose" for a new answer', 'upgrade assess'),
      drift,
    }
  }
  const placement = proposalPlacementProblem({ directory: options.proposalDirectory, evidenceDirectory: options.evidenceDirectory })
  if (placement !== undefined) return refuse('B15', placement, 'upgrade propose')
  const target = proposal.target ?? {}
  if (target.role !== 'upgrade-target') {
    return refuse('UPG-05', 'this proposal names the target role ' + JSON.stringify(target.role ?? 'unknown') + ', not "upgrade-target": a switch needs the exact profile install tree the user approved, so no target was switched', 'upgrade propose --target upgrade-target --target-path <absolute profile directory>')
  }
  if (typeof target.path !== 'string' || target.path === '' || target.path === 'unknown' || !isAbsolute(target.path)) {
    return refuse('UPG-05', 'this proposal names no resolvable target path (' + String(target.path ?? 'unknown') + '): "unknown" is never a switch target (D12/UPG-11), so no target was switched', 'upgrade propose --target upgrade-target --target-path <absolute profile directory>')
  }
  if (target.profile !== undefined && options.targetState !== undefined) {
    const recordedManifest = textOf(target.profile?.manifestSha256)
    const recordedLockfile = textOf(target.profile?.lockfileSha256)
    const nowManifest = textOf(options.targetState?.manifestSha256)
    const nowLockfile = textOf(options.targetState?.lockfileSha256)
    if (recordedManifest !== nowManifest || recordedLockfile !== nowLockfile) {
      return refuse('UPG-10', 'the approved target has its own edits: since the proposal was written its package.json / lockfile went from (manifest ' + recordedManifest + ', lockfile ' + recordedLockfile + ') to (manifest ' + nowManifest + ', lockfile ' + nowLockfile
        + '), and both are files an approved switch would change; nothing was switched, and those edits are kept exactly as they are (no stash, no commit, no revert)', 'ask the user to settle those edits, then re-run "upgrade propose" to bind the new target state')
    }
  }
  if (last.target?.path !== target.path) {
    return refuse('UPG-05', 'the consent record authorized the target ' + String(last.target?.path ?? 'unknown') + ', but this proposal names ' + target.path + ': an approval never covers another target, so no target was switched', 'upgrade propose')
  }
  if (options.delegation?.mayApproveUpgrade !== true) {
    return refuse('SCOPE-06', 'SCOPE-06: this is an assisted (subagent) session (parent ' + String(options.delegation?.parentSession ?? 'unknown') + '), and a target switch belongs to the user in the main session; no target was switched', 'hand the proposal back to the main session')
  }
  return { ok: true, basis: authorizationBasis(last), targetPath: resolve(target.path) }
}

/**
 * The candidate gate: a switch needs a candidate-verified run of THIS payload.
 *
 * The verdict is READ from the result.json the validation wrote beside the
 * candidate tree — a message, a summary or a version number is no substitute
 * (UPG-06). 'pendingVerification' (any critical baseline unknown) is never a
 * switch basis (D12).
 * @param {{proposal: object, candidateDirectory: string}} options the proposal and its candidate directory
 * @returns {{ok: boolean, path: string, verdict?: string, pendingVerification?: boolean, reason?: string, next?: string}} the verdict
 */
export function candidateVerdictOf(options) {
  const path = join(options.candidateDirectory, 'result.json')
  const refuse = (reason, next) => ({ ok: false, path, reason, next })
  if (!existsSync(path)) {
    return refuse('the candidate result at ' + path + ' is missing: a switch needs a candidate-verified run of THIS proposalHash, and the record is read rather than taken from a claim', 'upgrade validate')
  }
  let result
  try {
    result = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return refuse('the candidate result at ' + path + ' is not valid JSON: ' + (error instanceof Error ? error.message : String(error)), 'upgrade validate')
  }
  if (result?.proposalHash !== options.proposal.proposalHash) {
    return refuse('the candidate result at ' + path + ' validates proposalHash ' + String(result?.proposalHash) + ', but this proposal is ' + String(options.proposal.proposalHash) + ': another payload\'s verification never authorizes this switch', 'upgrade validate')
  }
  if (result?.pendingVerification === true) {
    return refuse('the candidate result at ' + path + ' is marked pendingVerification: a critical baseline is unknown, and D12 forbids a switch on an unconfirmed baseline', 'upgrade validate (or re-collect the missing baseline first)')
  }
  if (result?.verdict !== 'candidate-verified') {
    return refuse('the candidate result at ' + path + ' concluded ' + JSON.stringify(result?.verdict ?? null) + ', not "candidate-verified": a failed or incomplete candidate is never switched (UPG-06)', 'upgrade propose (a new candidate needs a new proposal and a new answer)')
  }
  if (Array.isArray(result?.criticalUnknowns) && result.criticalUnknowns.length > 0) {
    return refuse('the candidate result at ' + path + ' carries ' + result.criticalUnknowns.length + ' critical unknown(s): an unmeasured candidate is never a switch basis', 'upgrade validate')
  }
  return { ok: true, path, verdict: String(result.verdict), pendingVerification: false }
}

/**
 * Whether the approved target is one this run may install into.
 *
 * A switch REFRESHES a profile install tree that already carries this bundle; it
 * never adopts an unrelated directory and never adds this bundle to another
 * profile (D11's scope is 「指定 profile 安装树更新」).
 * @param {{path: string, bundle?: string}} options the target
 * @returns {string | undefined} the refusal reason, or undefined
 */
export function targetProfileProblem(options) {
  const path = resolve(options.path)
  if (!existsSync(path)) {
    return 'the approved target ' + path + ' does not exist: a profile install tree has to be prepared by the user before a switch'
  }
  let entries
  try {
    entries = readdirSync(path)
  } catch (error) {
    return 'the approved target ' + path + ' cannot be listed: ' + (error instanceof Error ? error.message : String(error))
  }
  if (entries.length === 0) {
    return 'the approved target ' + path + ' is empty: a switch refreshes an existing profile install tree, it does not create one'
  }
  const manifestPath = join(path, 'package.json')
  if (!existsSync(manifestPath)) {
    return 'the approved target ' + path + ' carries no package.json: it is not a profile install tree, so nothing may be installed there'
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return 'the target manifest at ' + manifestPath + ' is unreadable (' + (error instanceof Error ? error.message : String(error)) + '): the target cannot be verified, so no target was switched'
  }
  const bundle = options.bundle ?? TARGET_BUNDLE
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  const declared = bundles.includes(bundle) || Object.hasOwn(manifest?.dependencies ?? {}, bundle) || Object.hasOwn(manifest?.devDependencies ?? {}, bundle)
  if (!declared) {
    return 'the approved target ' + path + ' does not carry ' + bundle + ' in dsh.profile.bundles or its dependencies: a switch only updates the profile install tree the user named, it never adopts another profile'
  }
  return undefined
}

/**
 * The two manifest bytes an approved target is bound to.
 *
 * A profile install tree has no VCS, so "did the user edit it?" can only be
 * answered against a recorded reference: the proposal records these two digests,
 * hashes them into its payload, and the switch compares them again. A change
 * means the approval named bytes that no longer exist (UPG-05/UPG-10).
 * @param {{path: string}} options the target
 * @returns {{manifestSha256: string, lockfileSha256: string}} the digests ('missing' when absent)
 */
export function targetStateOf(options) {
  const root = resolve(options.path)
  return {
    manifestSha256: digestOfFile(join(root, 'package.json')).digest,
    lockfileSha256: digestOfFile(join(root, 'pnpm-lock.yaml')).digest,
  }
}

/**
 * Whether the target is still what THIS round wrote.
 *
 * Two independent comparisons, because they fail independently: the bytes of every
 * file this round wrote, and the version each engine resolves to. A difference
 * means the state is no longer ours to restore, so nothing is overwritten
 * (UPG-12: an external change is the user's, and a restore that overwrites it is
 * exactly what the stop rule forbids).
 * @param {{writtenFiles: object[], engines?: {component: string, expected: unknown, now: unknown}[]}} options the recorded and current facts
 * @returns {{path: string, expected: unknown, now: unknown}[]} one entry per difference
 */
export function externalChangesOf(options) {
  const changes = []
  for (const entry of Array.isArray(options.writtenFiles) ? options.writtenFiles : []) {
    const now = digestOfFile(entry.path).digest
    if (now !== entry.afterSha256) changes.push({ path: entry.path, expected: entry.afterSha256, now })
  }
  for (const entry of Array.isArray(options.engines) ? options.engines : []) {
    if (entry.expected === undefined || entry.expected === null || entry.expected === 'unknown') continue
    if (entry.now !== entry.expected) changes.push({ path: 'target engine ' + entry.component, expected: entry.expected, now: entry.now })
  }
  return changes
}

/**
 * The user's own edits among the files an approved switch would change.
 *
 * HEAD equality cannot prove a file did not change, so the porcelain path list is
 * what gets intersected with the affected set (UPG-10, D10). Everything else in
 * that list is unrelated and stays exactly as it is: nothing here stashes,
 * commits or reverts.
 * @param {{changedPaths: string[], patchPrefix?: string}} options the worktree facts
 * @returns {{affected: string[], unrelated: string[]}} the two groups
 */
export function affectedUserChanges(options) {
  const affected = []
  const unrelated = []
  const prefix = options.patchPrefix ?? AFFECTED_PATCH_PREFIX
  for (const entry of Array.isArray(options.changedPaths) ? options.changedPaths.map(String) : []) {
    const normalized = entry.replaceAll('\\', '/').replace(/^\.\//u, '')
    const hit = AFFECTED_MANIFEST_FILES.includes(normalized) || normalized.startsWith(prefix)
    if (hit) affected.push(entry)
    else unrelated.push(entry)
  }
  return { affected, unrelated }
}

// ── the backup and the watched file set ────────────────────────────────────

/**
 * Digest every file an approved switch may change, on both sides.
 *
 * 'missing' and 'unreadable' stay different facts: a file that is not there is
 * backed up as absent, while a file that cannot be read makes the backup
 * incomplete — and an incomplete backup stops the switch before it changes
 * anything.
 * @param {{maintenanceRepository: string, targetDirectory: string}} options the two roots
 * @returns {object} one entry per watched file, per side
 */
export function watchedSnapshot(options) {
  const snapshot = { maintenance: [], target: [] }
  for (const side of SIDES) {
    const root = side === 'maintenance' ? options.maintenanceRepository : options.targetDirectory
    for (const name of AFFECTED_MANIFEST_FILES) {
      const path = join(root, name)
      const facts = digestOfFile(path)
      snapshot[side].push({ side, root, relative: name, path, sha256: facts.digest, ...facts.problem === undefined ? {} : { problem: facts.problem } })
    }
  }
  const patchDirectory = join(options.maintenanceRepository, 'patches')
  const patchListing = namesIn(patchDirectory)
  // An unlistable patches directory is a REASON the backup cannot be complete, not
  // "there are no patches": the two must never collapse into the same answer.
  snapshot.problems = patchListing.problem === undefined ? [] : [patchListing.problem]
  for (const name of patchListing.names.filter((entry) => entry.endsWith('.patch')).sort()) {
    const path = join(patchDirectory, name)
    const facts = digestOfFile(path)
    snapshot.maintenance.push({
      side: 'maintenance',
      root: options.maintenanceRepository,
      relative: AFFECTED_PATCH_PREFIX + name,
      path,
      sha256: facts.digest,
      ...facts.problem === undefined ? {} : { problem: facts.problem },
    })
  }
  return snapshot
}

/**
 * Whether the backup the spec requires can actually be taken.
 *
 * The two manifests are required (a switch without them is not a switch), and an
 * unreadable watched file makes the backup incomplete. Nothing is written here:
 * the answer decides whether the switch may start at all.
 * @param {object} snapshot a watchedSnapshot result
 * @returns {string[]} one reason per problem, empty when the backup is complete
 */
export function backupProblems(snapshot) {
  const problems = [...Array.isArray(snapshot.problems) ? snapshot.problems : []]
  for (const side of SIDES) {
    const manifest = snapshot[side].find((entry) => entry.relative === 'package.json')
    if (manifest === undefined || manifest.sha256 === 'missing') {
      problems.push('the ' + side + ' package.json is missing, so the pre-switch state cannot be backed up')
    }
  }
  for (const side of SIDES) {
    for (const entry of snapshot[side]) {
      if (entry.sha256 === 'unreadable') {
        problems.push('the file at ' + entry.path + ' cannot be read' + (entry.problem === undefined ? '' : ' (' + entry.problem + ')') + ', so the backup would be incomplete')
      }
    }
  }
  return problems
}

/**
 * Copy every watched file that exists into the backup directory, and prove it.
 *
 * A copy whose digest does not equal its source is a failed backup, not a detail:
 * a restore that later reads different bytes is exactly the silent corruption a
 * backup exists to prevent.
 * @param {{snapshot: object, directory: string}} options the snapshot and where to write
 * @returns {Promise<{directory: string, files: object[], problems: string[]}>} the backup
 */
export async function writeBackup(options) {
  const files = []
  const problems = []
  for (const side of SIDES) {
    for (const entry of options.snapshot[side]) {
      if (entry.sha256 === 'missing') {
        files.push({ path: entry.path, side, relative: entry.relative, backup: null, sha256: 'missing' })
        continue
      }
      const target = join(options.directory, side, ...entry.relative.split('/'))
      try {
        await mkdir(dirname(target), { recursive: true })
        await copyFile(entry.path, target)
      } catch (error) {
        problems.push('the file at ' + entry.path + ' could not be backed up: ' + (error instanceof Error ? error.message : String(error)))
        continue
      }
      const copied = digestOfFile(target).digest
      if (copied !== entry.sha256) {
        problems.push('the backup of ' + entry.path + ' does not match its source (' + entry.sha256 + ' -> ' + copied + '): an unverified backup is not a backup')
        continue
      }
      files.push({ path: entry.path, side, relative: entry.relative, backup: target, sha256: entry.sha256 })
    }
  }
  await writeFile(join(options.directory, 'manifest.json'), JSON.stringify({ files }, null, 2) + '\n', 'utf8')
  return { directory: options.directory, files, problems }
}

/**
 * The files this round actually changed, with their before/after digests.
 *
 * The comparison is between two digests of the same watched path list, so a file
 * a command rewrote (a lockfile, a manifest) is recorded exactly like one this
 * module wrote itself. 'node_modules' is deliberately NOT watched: it is an
 * installation artifact, and the resolved versions are what the evidence reports.
 * @param {{before: object, after: object}} options the two snapshots
 * @returns {{path: string, relative: string, side: string, beforeSha256: string, afterSha256: string}[]} the changes
 */
export function writtenFilesOf(options) {
  const before = new Map()
  const after = new Map()
  for (const side of SIDES) {
    for (const entry of options.before[side]) before.set(entry.path, entry)
    for (const entry of options.after[side]) after.set(entry.path, entry)
  }
  const written = []
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const pre = before.get(path)
    const post = after.get(path)
    const beforeSha256 = pre?.sha256 ?? 'missing'
    const afterSha256 = post?.sha256 ?? 'missing'
    if (beforeSha256 === afterSha256) continue
    const sample = post ?? pre
    written.push({ path, relative: sample.relative, side: sample.side, beforeSha256, afterSha256 })
  }
  return written.sort((left, right) => left.path.localeCompare(right.path))
}

// ── execution: the allowlist, the runner and its record ────────────────────

/**
 * Whether a command may run in an approved switch.
 *
 * This allowlist is the switch's own and is narrower than a shell: the manager
 * must be pnpm/npm/node, the verb install/build/test/run/exec — or the exact name
 * of a script the PROPOSAL declared. A 'node' call is confined to this run's own
 * driver INSIDE the evidence tree, so no script is ever executed out of a target
 * the run has just changed.
 * @param {{command: string, args: string[], evidenceDirectory: string, declaredScripts?: string[]}} options the call
 * @returns {string | undefined} the refusal reason, or undefined
 */
/** One normalized outcome, whatever the runner returned or threw. */
function normalizeOutcome(value) {
  if (typeof value === 'string') return { exitCode: 0, stdout: value, stderr: '' }
  if (value === undefined || value === null) return { exitCode: 0, stdout: '', stderr: '' }
  const exitCode = typeof value.exitCode === 'number' ? value.exitCode
    : typeof value.status === 'number' ? value.status : null
  return { exitCode, stdout: String(value.stdout ?? ''), stderr: String(value.stderr ?? ''), timedOut: value.timedOut === true }
}

/** The outcome shape a thrown runner gives us. */
function failureOf(error) {
  const record = error ?? {}
  return {
    exitCode: typeof record.status === 'number' ? record.status : typeof record.code === 'number' ? record.code : null,
    stdout: String(record.stdout ?? ''),
    stderr: String(record.stderr ?? record.message ?? String(error)),
    timedOut: record.code === 'ETIMEDOUT' || record.signal === 'SIGKILL' || record.signal === 'SIGTERM',
  }
}

/** A file-name-safe form of one step's name. */
function logNameOf(name) {
  return String(name).replace(/[^A-Za-z0-9._-]+/gu, '_')
}

/**
 * Run one command and record it, whatever happens.
 *
 * Nothing is retried: a retry would hide the failing state UPG-12 asks us to keep
 * as evidence. Every command writes its own full log beside the record, because
 * the record's text is clipped.
 * @param {object} state the run's mutable state
 * @param {{name: string, command: string, args: string[], cwd: string, source: string}} spec the call
 * @returns {Promise<object>} the recorded step
 */
async function runStep(state, spec, options = {}) {
  // The candidate run's own allowlist, confined to THIS run's tree: the only script
  // a switch may execute is the driver it wrote under the evidence tree.
  const problem = candidateCommandProblem({ command: spec.command, args: spec.args, tree: state.evidenceDirectory, declaredScripts: state.declaredScripts, label: 'evidence tree' })
  if (problem !== undefined) {
    const refused = { name: spec.name, status: 'refused', command: spec.command, args: [...spec.args], cwd: spec.cwd, exitCode: null, durationMs: 0, detail: problem }
    state.steps.push(refused)
    state.failures.push({ name: spec.name, reason: problem })
    return refused
  }
  const startedAt = Date.now()
  let outcome
  try {
    outcome = normalizeOutcome(await Promise.resolve(state.runner(spec.command, spec.args, { cwd: spec.cwd, timeoutMs: state.timeoutMs })))
  } catch (error) {
    outcome = failureOf(error)
  }
  const passed = outcome.exitCode === 0 && outcome.timedOut !== true
  // A step whose own output classifies the outcome (the generated driver) is
  // recorded as executed: its exit code is evidence, and its JSON result decides
  // whether that evidence is a pass, a GAP or a failure.
  const classified = options.classify === false
  const entry = {
    name: spec.name,
    status: passed || classified ? 'executed' : 'failed',
    ...classified && !passed ? { detail: 'exit code ' + String(outcome.exitCode) + ' (classified by the driver\'s own result)' } : {},
    source: spec.source,
    command: spec.command,
    args: [...spec.args],
    cwd: spec.cwd,
    exitCode: outcome.exitCode,
    durationMs: Date.now() - startedAt,
    timedOut: outcome.timedOut === true,
    stdout: clip(outcome.stdout, 4000),
    stderr: clip(outcome.stderr, 4000),
  }
  const log = join(state.logsDirectory, String(state.steps.length).padStart(2, '0') + '-' + logNameOf(spec.name) + '.log')
  try {
    await writeFile(log, ['# ' + spec.name, '# ' + spec.command + ' ' + spec.args.join(' '), '# cwd ' + spec.cwd, '# exit ' + String(entry.exitCode), '', '--- stdout ---', String(outcome.stdout ?? ''), '--- stderr ---', String(outcome.stderr ?? '')].join('\n') + '\n', 'utf8')
    entry.log = log
  } catch (error) {
    state.gaps.push('the log of ' + spec.name + ' could not be written to ' + log + ': ' + (error instanceof Error ? error.message : String(error)))
  }
  state.steps.push(entry)
  if (!passed && !classified) state.failures.push({ name: spec.name, reason: outcome.timedOut === true ? 'timed out' : 'exit code ' + String(entry.exitCode) })
  return entry
}

/** A step that changed files rather than running a command. */
function recordStep(state, entry) {
  state.steps.push(entry)
  return entry
}

// ── the target's own evidence ──────────────────────────────────────────────

/**
 * The patch decisions' expected marker state in the TARGET's build.
 *
 * The mechanical rule is ticket 06's own (keep/redo expect the marker, delete
 * expects its absence); whether upstream now owns the behaviour is the proposal's
 * judgement and stays 'not-measured' here too.
 * @param {{proposal: object, engines: object}} options the proposal and the target's engines
 * @returns {object[]} one entry per decided patch item
 */
export function targetPatchResults(options) {
  return (Array.isArray(options.proposal?.patchDecisions) ? options.proposal.patchDecisions : [])
    .map((item) => resolvedPatchItem(item, options.engines, '目标 profile'))
}

// ── the run ────────────────────────────────────────────────────────────────

/**
 * Apply an approved switch: backup, write list, dependencies, patches, build,
 * target install, target evidence.
 *
 * @param {object} options the run's facts
 * @returns {Promise<object>} the record written to switch.json
 */
export async function switchTarget(options) {
  const proposal = options.proposal ?? {}
  const maintenanceRepository = resolve(options.maintenanceRepository)
  const targetDirectory = resolve(options.targetPath)
  const proposalDirectory = resolve(options.proposalDirectory)
  const evidenceDirectory = resolve(options.evidenceDirectory)
  const backupDirectory = join(proposalDirectory, BACKUP_DIRECTORY)
  const state = {
    steps: [],
    checks: [],
    gaps: [],
    skipped: [],
    failures: [],
    writtenFiles: [],
    restorePlan: [],
    evidenceDirectory,
    proposalDirectory,
    declaredScripts: (Array.isArray(proposal?.changes?.verification) ? proposal.changes.verification : [])
      .map((entry) => entry?.name)
      .filter((name) => typeof name === 'string'),
    logsDirectory: join(proposalDirectory, 'switch', 'logs'),
    runner: options.runner ?? createDefaultRunner(),
    timeoutMs: (options.timeoutMin ?? DEFAULT_TIMEOUT_MIN) * 60_000,
  }
  const runnerSource = options.runner === undefined ? 'default' : 'injected'
  const interrupt = options.cancel === undefined ? interruptPredicate() : undefined
  const cancel = options.cancel ?? interrupt.cancelled
  const before = watchedSnapshot({ maintenanceRepository, targetDirectory })
  const record = {
    tool: SWITCH_TOOL,
    version: SWITCH_VERSION,
    proposalId: proposal?.proposalId ?? 'unknown',
    proposalHash: proposal?.proposalHash ?? 'unknown',
    baselineHash: proposal?.baselineHash ?? 'unknown',
    phase: 'switching',
    conclusion: null,
    startedAt: textOf(options.now),
    finishedAt: null,
    sessionId: textOf(options.sessionId),
    runner: {
      source: runnerSource,
      note: runnerSource === 'injected'
        ? '本次命令结果来自注入的 runner（测试夹具），不是真实子进程；记录如实标注来源。'
        : '本次命令由真实子进程执行（win32 走 shell: true，见 scripts/test-profile.mjs 的 run()）。',
    },
    authorization: {
      ...(options.basis ?? {}),
      rule: '最后一条同意记录必须对本 proposalHash 为 approve 且 scope.switch === true；基线重新采集后未漂移；方案位于证据树内；目标就是记录里那个 profile 安装树；候选必须是 candidate-verified 且无 pendingVerification；调用会话不是子 agent。',
    },
    candidate: { path: textOf(options.candidateResultPath), verdict: textOf(options.candidateVerdict) },
    target: { role: proposal?.target?.role ?? 'unknown', path: targetDirectory, before: targetStateOf({ path: targetDirectory }) },
    maintenanceRepository,
    plannedWrites: [],
    versionsBefore: {
      dsh: textOf(proposal?.baseline?.versions?.dsh),
      hashline: textOf(proposal?.baseline?.versions?.hashline),
      toolEdit: textOf(proposal?.baseline?.versions?.toolEdit),
    },
    versionsAfter: null,
    engineEvidence: null,
    backup: null,
    steps: state.steps,
    writtenFiles: state.writtenFiles,
    checks: state.checks,
    gaps: state.gaps,
    skipped: state.skipped,
    failures: state.failures,
    scope: {
      switchedTargets: [targetDirectory],
      maintenanceFiles: 'the maintenance worktree\'s own package.json / lockfile / patches, as the proposal declares',
      dailyProfileTouched: false,
      officialInstallTouched: false,
      restarted: false,
      note: '只改目标 profile 安装树与维护仓库的依赖/补丁/构建产物；不碰其它 profile、不动官方 DSH 安装、不杀进程、不重启或关闭 DSH。',
    },
    next: null,
    nextNote: null,
  }
  try {
    // 0) a backup that cannot be taken stops the switch BEFORE the first change.
    const prepareProblems = backupProblems(before)
    if (prepareProblems.length > 0) {
      state.failures.push(...prepareProblems.map((reason) => ({ name: 'backup', reason })))
      return await stopBeforeChange({ state, record, reasons: prepareProblems, now: options.now })
    }
    await mkdir(state.logsDirectory, { recursive: true })
    await mkdir(backupDirectory, { recursive: true })
    const backup = await writeBackup({ snapshot: before, directory: backupDirectory })
    record.backup = { directory: backup.directory, files: backup.files.map((entry) => ({ path: entry.path, sha256: entry.sha256 })) }
    if (backup.problems.length > 0) {
      state.failures.push(...backup.problems.map((reason) => ({ name: 'backup', reason })))
      return await stopBeforeChange({ state, record, reasons: backup.problems, now: options.now })
    }
    // 1) the write list lands BEFORE the first change.
    // The write list is DERIVED from the watched set, so it cannot drift from what
    // this run can actually change and restore. The one entry it cannot enumerate
    // is a patch file a rename creates, which is named by its pattern.
    record.plannedWrites = [
      ...before.maintenance.map((entry) => entry.path),
      ...before.target.map((entry) => entry.path),
      join(maintenanceRepository, 'patches') + '/*.patch (any file a rename creates)',
    ]
    await writeJournal(proposalDirectory, record)

    // 2) the maintenance worktree's dependencies and patches.
    const dependencies = await applyDependencyUpdates({ tree: maintenanceRepository, proposal })
    state.gaps.push(...dependencies.gaps)
    recordStep(state, {
      name: 'maintenance-dependencies',
      status: 'executed',
      detail: dependencies.updates.length === 0
        ? 'the maintenance manifest declares none of the approved engine packages, so no dependency version was pinned'
        : dependencies.updates.map((entry) => entry.package + ' ' + entry.from + ' -> ' + entry.to).join('; '),
      updates: dependencies.updates,
    })
    const patches = await applyPatchDecisions({ tree: maintenanceRepository, proposal })
    state.gaps.push(...patches.gaps)
    for (const item of patches.items) {
      if (item.apply === 'undecided') state.gaps.push('the ' + item.component + ' patch item ' + item.marker + ' is still pending-verification: a switch never turns an undecided item into keep')
    }
    recordStep(state, {
      name: 'maintenance-patches',
      status: 'executed',
      detail: patches.items.map((item) => item.component + '/' + item.file + ' ' + item.decision + ' -> ' + item.apply).join('; ') || 'the proposal carries no patch decision',
      files: patches.files,
      workspaceChanges: patches.changed,
      items: patches.items,
    })

    // 3) the maintenance worktree's own install and build.
    // A directory that declares no packageManager gets pnpm, and that choice is
    // RECORDED on the step. It is not a gap: what the switch proves — the resolved
    // versions, the markers, the shared instance and the link — does not depend on
    // which manager installed the tree.
    const repositoryManager = managerOf(maintenanceRepository, 'the maintenance repository')
    if (!cancel('maintenance-install')) {
      const step = await runStep(state, { name: 'maintenance-install', source: 'switch-own', command: managerCommand(repositoryManager.manager), args: ['install'], cwd: maintenanceRepository })
      if (repositoryManager.problem !== undefined) step.detail = repositoryManager.problem
    } else {
      state.skipped.push({ name: 'maintenance-install', reason: 'cancelled before this step started' })
    }
    const verification = Array.isArray(proposal?.changes?.verification) ? proposal.changes.verification : []
    const buildEntry = verification.find((entry) => entry?.name === 'build' && typeof entry?.run === 'string' && entry.run.trim() !== '')
    const declaredScripts = scriptsOf(maintenanceRepository)
    if (state.failures.length > 0) {
      state.skipped.push({ name: 'maintenance-build', reason: 'an earlier step failed: the build was NOT executed' })
    } else if (buildEntry === undefined) {
      const declaredBuild = typeof declaredScripts.build === 'string'
      if (declaredBuild) {
        state.gaps.push('the maintenance repository declares a build script the proposal does not list, so the approved plan does not cover the build and this run did not execute one')
      }
      recordStep(state, {
        name: 'maintenance-build',
        status: 'n/a',
        detail: declaredBuild
          ? 'the repository declares a build script the proposal does not list: no build was executed (recorded as a gap)'
          : 'the proposal lists no build command and the repository declares none: there is nothing to build',
      })
    } else if (cancel('maintenance-build')) {
      state.skipped.push({ name: 'maintenance-build', reason: 'cancelled before this step started' })
    } else {
      const argv = splitDeclared(buildEntry)
      if (argv === undefined) {
        state.gaps.push('the proposal\'s build entry is not runnable by this switch (' + buildEntry.run + '): it was not executed')
        recordStep(state, { name: 'maintenance-build', status: 'n/a', detail: 'the declared build command is outside this run\'s allowlist: nothing was executed' })
      } else {
        await runStep(state, { name: 'maintenance-build', source: 'proposal-changes', command: argv.command, args: argv.args, cwd: maintenanceRepository })
      }
    }

    // 4) the approved target install tree.
    if (state.failures.length > 0) {
      state.skipped.push({ name: 'target-install', reason: 'an earlier step failed: the target was NOT installed' })
    } else if (cancel('target-install')) {
      state.skipped.push({ name: 'target-install', reason: 'cancelled before this step started' })
    } else {
      const targetManager = managerOf(targetDirectory, 'the target profile')
      const step = await runStep(state, { name: 'target-install', source: 'switch-own', command: managerCommand(targetManager.manager), args: ['install'], cwd: targetDirectory })
      if (targetManager.problem !== undefined) step.detail = targetManager.problem
    }

    // 5) the target's own evidence: versions, markers, shared instance, link.
    if (state.failures.length > 0) {
      state.skipped.push({ name: 'target-verification', reason: 'an earlier step failed: the target was NOT re-verified' })
    } else if (cancel('target-verification')) {
      state.skipped.push({ name: 'target-verification', reason: 'cancelled before this step started' })
    } else {
      await verifyTarget({ state, record, proposal, targetDirectory, cancel })
    }

    // 6) what actually changed, and the maintenance repository's own result.
    const after = watchedSnapshot({ maintenanceRepository, targetDirectory })
    state.writtenFiles.push(...writtenFilesOf({ before, after }))
    state.restorePlan = state.writtenFiles
      .map((entry) => ({ ...entry, backup: backup.files.find((file) => file.path === entry.path)?.backup ?? null }))
    const repositoryEngines = resolvedCandidateEngines({ tree: maintenanceRepository, label: '维护仓库' })
    // The maintenance side is evidence, not decoration: an engine the worktree
    // cannot resolve is a gap, so "both sides resolved" cannot be claimed while
    // one of them never did.
    for (const entry of repositoryEngines.unknown) {
      state.gaps.push('the maintenance repository does not resolve its own installed combination: ' + entry)
    }
    record.engineEvidence = {
      maintenance: { engines: repositoryEngines.engines, resolution: repositoryEngines.resolution, unknown: repositoryEngines.unknown },
      target: record.engineEvidence?.target ?? null,
      note: '两边各自解析：维护仓库证明依赖已装成候选组合，目标 profile 证明实际生效的组合与标记。',
    }

    return await conclude({ state, record, proposal, targetDirectory, maintenanceRepository, now: options.now, finishedAt: options.finishedAt })
  } finally {
    if (interrupt !== undefined) interrupt.dispose()
  }
}

/** Write the switch record (append-only: every call grows it, never rewrites an entry). */
async function writeJournal(proposalDirectory, record) {
  await mkdir(proposalDirectory, { recursive: true })
  await writeFile(join(proposalDirectory, 'switch.json'), JSON.stringify(record, null, 2) + '\n', 'utf8')
}

/** The 'scripts' block of one manifest, or an empty object. */
function scriptsOf(directory) {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    return manifest !== null && typeof manifest.scripts === 'object' && !Array.isArray(manifest.scripts) ? manifest.scripts : {}
  } catch {
    return {}
  }
}

/**
 * Record a switch that stopped before it changed anything.
 *
 * Nothing is restored because nothing changed; the record says so in as many
 * words, so a reader never has to infer "did it touch my files?" from the
 * absence of a rollback file.
 * @param {{state: object, record: object, reasons: string[], now: string}} options the facts
 * @returns {Promise<object>} the record
 */
async function stopBeforeChange(options) {
  const { state, record, reasons, now } = options
  record.phase = 'stopped'
  record.conclusion = 'switch-failed-handover'
  record.finishedAt = textOf(now)
  record.next = 'none (no target file was changed)'
  record.nextNote = '备份不完整：切换在改动任何目标文件之前就停下了。请修正上面列出的路径与权限，然后重新执行 upgrade switch（本轮不需要回退，因为没有改动）。'
  record.stoppedBecause = reasons
  await writeSwitchReport({ report: record, proposalDirectory: state.proposalDirectory })
  return record
}

/**
 * The target's checks: resolved versions, patch markers, shared instance, link.
 * @param {{state: object, record: object, proposal: object, targetDirectory: string, cancel: (name: string) => boolean}} options the facts
 * @returns {Promise<void>} the checks are recorded on the run
 */
async function verifyTarget(options) {
  const { state, record, proposal, targetDirectory } = options
  const resolved = resolvedCandidateEngines({ tree: targetDirectory, label: '目标 profile' })
  const patches = targetPatchResults({ proposal, engines: resolved.engines })
  // The comparison itself is ticket 06's rule (approved vs RESOLVED, never the
  // declared version): this run only asks it of the target instead of the tree.
  const versions = candidateVersionCheck({ proposal, engines: resolved.engines })
  record.engineEvidence = {
    ...record.engineEvidence ?? {},
    target: {
      engines: resolved.engines,
      resolution: resolved.resolution,
      patchResults: patches,
      unknown: resolved.unknown,
      note: '目标 profile 自己的解析结果：版本号不是补丁证据，标记文本才是（所以这里是 patchEvidence 的结论，不是 package.json 的版本）。',
    },
  }
  state.checks.push({
    name: 'target-versions-match-approved',
    status: versions.items.length === 0 ? 'n/a' : versions.items.every((entry) => entry.match) ? 'pass' : 'fail',
    detail: versions.items.length === 0
      ? 'this proposal names no in-repo candidate version to compare'
      : versions.items.map((entry) => entry.component + ' approved ' + String(entry.approved) + ', resolved ' + String(entry.resolved) + (entry.match ? ' (match)' : ' (MISMATCH)')).join('; '),
  })
  // Only a COMPARED mismatch is a failure: a version nobody could read stays an
  // unmeasured gap (it already landed in the unknowns below).
  for (const entry of versions.unknown) {
    state.gaps.push('the target does not measure its own version: ' + entry)
  }
  if (versions.items.some((entry) => entry.resolved !== 'unknown' && !entry.match)) {
    state.failures.push({ name: 'target-versions-match-approved', reason: 'the target does not resolve the approved candidate version' })
  }
  state.checks.push({
    name: 'target-patch-markers',
    status: patches.length === 0 ? 'n/a' : patches.some((item) => item.resolved === 'unknown') ? 'gap' : patches.every((item) => item.satisfied) ? 'pass' : 'fail',
    detail: patches.length === 0
      ? 'this proposal carries no patch decision'
      : patches.map((item) => item.component + '/' + basename(item.file) + ' ' + item.decision + ' expects ' + item.expected + ' resolved ' + item.resolved).join('; '),
  })
  if (patches.some((item) => item.resolved === 'unknown')) {
    state.gaps.push('a patch marker could not be read out of the target\'s resolved build, so that decision was NOT measured')
  }
  for (const item of patches.filter((entry) => entry.resolved !== 'unknown' && !entry.satisfied)) {
    state.failures.push({ name: 'patch:' + item.component + ':' + item.marker, reason: item.note })
  }
  const sidesResolved = resolved.resolution.readSideResolved && resolved.resolution.editSideResolved
  const resolutionOkay = sidesResolved && resolved.resolution.samePhysicalInstance && resolved.resolution.insideCandidateTree
  state.checks.push({
    name: 'target-resolved-paths-and-shared-instance',
    status: resolutionOkay ? 'pass' : sidesResolved ? 'fail' : 'gap',
    detail: sidesResolved
      ? 'read side ' + resolved.resolution.readSide + ', edit side ' + resolved.resolution.editSide
        + (resolutionOkay ? '' : resolved.resolution.insideCandidateTree ? ' — two physical hashline instances' : ' — the resolved hashline is not inside the target')
      : 'the two plugin packages are not installed in the target, so each side\'s own resolution could not be read: read side ' + String(resolved.resolution.readSide) + ', edit side ' + String(resolved.resolution.editSide),
  })
  if (!resolutionOkay && sidesResolved) {
    state.failures.push({ name: 'target-resolved-paths-and-shared-instance', reason: 'read and edit do not share one physical hashline instance inside the target' })
  }
  // The short link runs INSIDE the target, through the target's own engines.
  if (resolved.engines.hashline?.version === 'unknown') {
    state.skipped.push({ name: 'target-read-edit-short-link', reason: 'the target resolves no hashline engine, so the link was NOT executed' })
    state.checks.push({ name: 'target-read-edit-short-link', status: 'gap', detail: 'the target resolves no hashline engine: nothing to link' })
    return
  }
  if (options.cancel('target-read-edit-short-link')) {
    state.skipped.push({ name: 'target-read-edit-short-link', reason: 'cancelled before the short link started' })
    return
  }
  const driver = join(state.proposalDirectory, ...SWITCH_DRIVER_PATH)
  await mkdir(dirname(driver), { recursive: true })
  await writeFile(driver, shortLinkDriver(), 'utf8')
  const recorded = await runStep(state, { name: 'target-read-edit-short-link', source: 'own-check', command: managerCommand('node'), args: [driver, targetDirectory], cwd: targetDirectory }, { classify: false })
  const outcome = parseDriverOutcome(recorded)
  state.checks.push({ name: 'target-read-edit-short-link', status: outcome.status, detail: outcome.detail, ...recorded.exitCode === null ? {} : { exitCode: recorded.exitCode }, durationMs: recorded.durationMs })
  if (outcome.status === 'gap') state.gaps.push('read→edit short link in the target: ' + outcome.detail)
  if (outcome.status === 'fail') state.failures.push({ name: 'target-read-edit-short-link', reason: outcome.detail })
}

/**
 * Decide the conclusion, restore when the round failed, and finish the record.
 * @param {object} options the run's facts
 * @returns {Promise<object>} the finished record
 */
async function conclude(options) {
  const { state, record, proposal, targetDirectory, maintenanceRepository, now, finishedAt } = options
  record.finishedAt = textOf(finishedAt ?? now)
  record.versionsAfter = {
    dsh: textOf(proposal?.baseline?.versions?.dsh),
    hashline: textOf(record.engineEvidence?.target?.engines?.hashline?.version),
    toolEdit: textOf(record.engineEvidence?.target?.engines?.['tool-edit']?.version),
  }
  const targetChecks = state.checks.filter((check) => check.name.startsWith('target-'))
  const measured = state.failures.length === 0
    && targetChecks.length > 0
    && !state.checks.some((check) => check.status === 'fail' || check.status === 'gap')
    && !state.skipped.some((entry) => entry.name.startsWith('target-'))
    && state.gaps.length === 0
  if (measured) {
    record.phase = 'switched'
    record.conclusion = 'switch-applied'
    record.next = 'restart the host for this profile when the user has arranged the stop window (D11: this run never restarts or stops DSH)'
    record.nextNote = '切换已按批准方案落地并核验：目标 profile 解析到的引擎版本等于候选版本、补丁标记状态成立、目标内 read→edit 短链路通过。本步不重启 DSH、不碰其它 profile、不动官方 DSH 安装。'
    await writeSwitchReport({ report: record, proposalDirectory: state.proposalDirectory })
    return record
  }
  if (state.failures.length === 0) {
    // Nothing failed, but something was NOT measured (a gap, a skipped step, an
    // unmeasured check): the state is knowable but unproven, so the answer is a
    // hand-over — not a silent success, and not a destroy-and-restore either.
    record.phase = 'handover'
    record.conclusion = 'switch-failed-handover'
    record.next = 'read switch.md, then either re-run the missing measurement or restore <proposalId>/backup by hand'
    record.nextNote = '没有实测失败，但有项目没测到（缺项/跳过/GAP）：目标已写入，但不能当作成功。状态仍属本轮（未检测到外部改动），本步不自动回退，交用户确认下一步。'
    await writeSwitchReport({ report: record, proposalDirectory: state.proposalDirectory })
    return record
  }
  // A measured failure: restore THIS round when it is still this round's result.
  const rollback = await restoreRound({ state, record, proposal, targetDirectory, maintenanceRepository, now: record.finishedAt })
  await writeRollbackReport({ rollback, proposalDirectory: state.proposalDirectory })
  await writeSwitchReport({ report: record, proposalDirectory: state.proposalDirectory })
  return record
}

/**
 * Restore this round's changes, or hand the state over.
 *
 * Three questions, in this order: is the target still what THIS round wrote (the
 * digests and versions are compared with switch.json's after values)? If not,
 * nothing is touched — an external change is the user's. If it is, the backup is
 * copied back and the installation state is re-installed, and the restore only
 * counts as complete when the lockfile digest, the patch digests and the engines
 * are back at the proposal's baseline.
 * @param {object} options the run's facts
 * @returns {Promise<object>} the rollback record
 */
async function restoreRound(options) {
  const { state, record, proposal, targetDirectory, maintenanceRepository, now } = options
  const rollback = {
    tool: SWITCH_TOOL + '-rollback',
    version: SWITCH_VERSION,
    proposalId: proposal?.proposalId ?? 'unknown',
    proposalHash: proposal?.proposalHash ?? 'unknown',
    startedAt: now,
    trigger: state.failures.map((entry) => entry.name + ': ' + entry.reason),
    phase: null,
    externalChange: [],
    restoredFiles: [],
    steps: [],
    verification: null,
    kept: [],
    next: null,
    nextNote: null,
    note: '回退只覆盖本轮写入的依赖、补丁与安装状态；用户自己的改动（未提交输入、无关文件）不在此范围内，也不被覆盖。',
  }
  // 1) is it still this round's result?
  const enginesBeforeRestore = resolvedCandidateEngines({ tree: targetDirectory, label: '目标 profile' }).engines
  rollback.externalChange = externalChangesOf({
    writtenFiles: state.writtenFiles,
    engines: [['hashline', record.versionsAfter?.hashline], ['tool-edit', record.versionsAfter?.toolEdit]]
      .map(([component, expected]) => ({ component, expected, now: enginesBeforeRestore[component]?.version ?? 'unknown' })),
  })
  if (rollback.externalChange.length > 0) {
    rollback.phase = 'handover'
    rollback.next = 'inspect the paths listed in externalChange, then restore <proposalId>/backup by hand if that is what the user wants'
    rollback.nextNote = '目标已不再完全等于本轮写入的结果（外部改动）：本步不覆盖任何文件，留证交接。'
    record.phase = 'handover'
    record.conclusion = 'switch-failed-handover'
    record.next = rollback.next
    record.nextNote = '切换失败后检测到外部改动：不回退、不覆盖用户工作，留证交接。'
    return rollback
  }
  // 2) restore the files this round wrote.
  for (const entry of state.restorePlan) {
    try {
      if (entry.beforeSha256 === 'missing') {
        await rm(entry.path, { force: true })
        rollback.restoredFiles.push({ path: entry.path, action: 'removed' })
        continue
      }
      if (entry.backup === null) {
        rollback.restoredFiles.push({ path: entry.path, action: 'no-backup' })
        continue
      }
      await mkdir(dirname(entry.path), { recursive: true })
      await copyFile(entry.backup, entry.path)
      rollback.restoredFiles.push({ path: entry.path, action: 'restored', sha256: digestOfFile(entry.path).digest })
    } catch (error) {
      rollback.restoredFiles.push({ path: entry.path, action: 'failed', detail: error instanceof Error ? error.message : String(error) })
    }
  }
  // 3) the installation state, re-installed from the restored manifests.
  for (const [name, directory] of [['rollback-maintenance-install', maintenanceRepository], ['rollback-target-install', targetDirectory]]) {
    const manager = managerOf(directory, 'the ' + (name.includes('maintenance') ? 'maintenance repository' : 'target profile'))
    await runStep(state, { name, source: 'rollback-own', command: managerCommand(manager.manager), args: ['install'], cwd: directory })
  }
  rollback.steps = state.steps.map((entry) => ({ name: entry.name, status: entry.status, ...entry.exitCode === undefined || entry.exitCode === null ? {} : { exitCode: entry.exitCode } }))
  // 4) did the restore land on the proposal's baseline?
  const lockNow = digestOfFile(join(maintenanceRepository, 'pnpm-lock.yaml')).digest
  const patchDirectory = join(maintenanceRepository, 'patches')
  const patchesNow = namesIn(patchDirectory).names.filter((name) => name.endsWith('.patch')).sort()
    .map((name) => ({ path: join(patchDirectory, name), sha256: digestOfFile(join(patchDirectory, name)).digest }))
  const recordedPatches = Array.isArray(proposal?.rollback?.patchFiles) ? proposal.rollback.patchFiles : []
  const patchMatches = recordedPatches.map((entry) => {
    const wanted = basename(String(entry.path))
    const found = patchesNow.find((file) => basename(file.path) === wanted)
    return { path: wanted, recorded: String(entry.sha256), now: found?.sha256 ?? 'missing', match: found !== undefined && found.sha256 === String(entry.sha256) }
  })
  const enginesNow = resolvedCandidateEngines({ tree: maintenanceRepository, label: '维护仓库' }).engines
  const engineMatches = [
    { component: 'hashline', expected: textOf(proposal?.baseline?.versions?.hashline), now: enginesNow.hashline?.version ?? 'unknown' },
    { component: 'tool-edit', expected: textOf(proposal?.baseline?.versions?.toolEdit), now: enginesNow['tool-edit']?.version ?? 'unknown' },
  ].map((entry) => ({ ...entry, match: entry.expected !== 'unknown' && entry.expected === entry.now }))
  rollback.verification = {
    lockfile: { expected: textOf(proposal?.rollback?.lockfileSha256), now: lockNow, match: textOf(proposal?.rollback?.lockfileSha256) === lockNow },
    patchFiles: patchMatches,
    engines: engineMatches,
    note: '核对的是「恢复后是否回到方案的回退基线」：lockfile 摘要、patches/* 摘要与维护仓库解析到的引擎版本。',
  }
  const restoreIncomplete = rollback.restoredFiles.some((entry) => entry.action === 'failed' || entry.action === 'no-backup')
  const verified = !restoreIncomplete
    && rollback.verification.lockfile.match
    && patchMatches.every((entry) => entry.match)
    && engineMatches.every((entry) => entry.match)
  rollback.kept = [
    'the user\'s uncommitted input recorded in the proposal (rollback.userInputs) — never stashed, committed or reverted',
    'every file outside the declared change set, including unrelated worktree changes',
  ]
  if (verified) {
    rollback.phase = 'restored'
    rollback.next = 'none (the target and the worktree are back at the proposal\'s baseline; a new attempt needs a new proposal and a new answer)'
    rollback.nextNote = '已按方案声明的回退范围恢复本轮变动的依赖、补丁与安装状态，并核对回到 baseline；用户自己的改动与无关文件原样保留。'
    record.phase = 'restored'
    record.conclusion = 'switch-failed-restored'
    record.next = rollback.next
    record.nextNote = '切换部分失败：已自动恢复本轮的依赖、补丁与安装状态并核对回到 baseline（见 rollback.json）。没有重试，也不扩大修复范围。'
    return rollback
  }
  rollback.phase = 'handover'
  rollback.next = 'read rollback.json, then restore <proposalId>/backup by hand or re-run "upgrade switch" once the cause is fixed'
  rollback.nextNote = '恢复后没能核对回到方案的回退基线（见 verification）：状态不明，留证交接，不当作已回退。'
  record.phase = 'handover'
  record.conclusion = 'switch-failed-handover'
  record.next = rollback.next
  record.nextNote = '切换失败且回退无法核对：从哪一步开始不明见 rollback.json 的 verification 与 restoredFiles，请用户查看后再决定。'
  return rollback
}

// ── writing and rendering ──────────────────────────────────────────────────

/**
 * Write switch.json and switch.md beside the proposal.
 * @param {{report: object, proposalDirectory: string}} options the record
 * @returns {Promise<{record: string, report: string}>} the written paths
 */
export async function writeSwitchReport(options) {
  const rendered = renderSwitchReport(options.report)
  const files = { record: join(options.proposalDirectory, 'switch.json'), report: join(options.proposalDirectory, 'switch.md') }
  await mkdir(options.proposalDirectory, { recursive: true })
  await writeFile(files.record, JSON.stringify(options.report, null, 2) + '\n', 'utf8')
  await writeFile(files.report, rendered + '\n', 'utf8')
  return files
}

/**
 * Write rollback.json beside the proposal.
 * @param {{rollback: object, proposalDirectory: string}} options the record
 * @returns {Promise<{path: string}>} the written path
 */
export async function writeRollbackReport(options) {
  const path = join(options.proposalDirectory, 'rollback.json')
  await mkdir(options.proposalDirectory, { recursive: true })
  await writeFile(path, JSON.stringify(options.rollback, null, 2) + '\n', 'utf8')
  return { path }
}

/** The conclusion's one line, in the words the claim boundary allows. */
function conclusionLine(record) {
  if (record.conclusion === 'switch-applied') {
    return 'switch-applied：批准的目标已按方案切换并核验（目标解析到的引擎版本等于候选版本、补丁标记状态成立、目标内 read→edit 短链路通过）。本步不重启 DSH。'
  }
  if (record.conclusion === 'switch-failed-restored') {
    return 'switch-failed-restored：切换部分失败，本轮变动的依赖、补丁与安装状态已恢复并核对回到 baseline；用户改动与无关文件原样保留。'
  }
  if (record.phase === 'stopped') {
    return 'switch-failed-handover：切换在改动任何目标文件之前就停下了（备份不完整）。没有改动、也不需要回退。'
  }
  return 'switch-failed-handover：切换失败、状态不明或检测到外部改动。没有覆盖任何用户工作，证据留在本目录，交由用户确认下一步。'
}

/**
 * Render switch.md: the one human report this command writes.
 * @param {object} record the switch record
 * @returns {string} markdown
 */
export function renderSwitchReport(record) {
  const quoted = (value) => TICK + (value === undefined || value === null || value === '' ? 'unknown' : String(value)) + TICK
  const lines = []
  lines.push('# 目标切换 — ' + record.proposalId)
  lines.push('')
  lines.push('- 结论：**' + String(record.conclusion ?? record.phase) + '**')
  lines.push('- ' + conclusionLine(record))
  lines.push('- 生成时间：' + quoted(record.finishedAt ?? record.startedAt))
  lines.push('- proposalHash：' + quoted(record.proposalHash) + '，baselineHash：' + quoted(record.baselineHash))
  lines.push('- 命令来源：' + (record.runner?.source === 'injected' ? '注入的 runner（测试夹具，非真实子进程）' : '真实子进程（win32 走 shell: true）'))
  lines.push('')
  lines.push('## 授权依据')
  lines.push('')
  lines.push('- 决策：' + quoted(record.authorization?.decision) + '，授权范围：candidateValidation=' + String(record.authorization?.scope?.candidateValidation) + '、switch=' + String(record.authorization?.scope?.switch))
  lines.push('- 同意记录绑定 proposalHash ' + quoted(record.authorization?.proposalHash) + '、baselineHash ' + quoted(record.authorization?.baselineHash))
  lines.push('- 用户回复：seq ' + quoted(record.authorization?.reply?.seq) + '（来源 ' + quoted(record.authorization?.reply?.source) + '），记录时间 ' + quoted(record.authorization?.repliedAt) + '，记录者 ' + quoted(record.authorization?.recorder?.sessionId) + '/' + quoted(record.authorization?.recorder?.role))
  lines.push('- 候选结论：' + quoted(record.candidate?.verdict) + '（记录：' + quoted(record.candidate?.path) + '）')
  lines.push('- 闸门：' + String(record.authorization?.rule ?? ''))
  lines.push('')
  lines.push('## 目标')
  lines.push('')
  lines.push('- 角色：' + quoted(record.target?.role) + '，安装树：' + quoted(record.target?.path))
  lines.push('- 维护仓库：' + quoted(record.maintenanceRepository))
  lines.push('- 备案写入范围：' + (record.plannedWrites ?? []).map(quoted).join('、'))
  lines.push('- 备份：' + quoted(record.backup?.directory) + '（' + String((record.backup?.files ?? []).length) + ' 个文件，逐个核对摘要）')
  lines.push('')
  lines.push('## 步骤（按执行顺序）')
  lines.push('')
  if ((record.steps ?? []).length === 0) {
    lines.push('本次没有执行任何步骤（切换在写入之前就停下了）。')
  } else {
    lines.push('| 步骤 | 状态 | 命令 | 退出码 | 耗时(ms) | 说明 |')
    lines.push('|---|---|---|---|---|---|')
    for (const entry of record.steps) {
      const command = entry.command === undefined ? '—' : quoted(entry.command + ' ' + (entry.args ?? []).join(' '))
      lines.push('| ' + entry.name + ' | ' + String(entry.status) + ' | ' + command + ' | ' + (entry.exitCode === undefined || entry.exitCode === null ? '—' : String(entry.exitCode)) + ' | ' + (entry.durationMs === undefined ? '—' : String(entry.durationMs)) + ' | ' + String(entry.detail ?? '') + ' |')
    }
    lines.push('')
    lines.push('每条命令的完整输出在 switch/logs/ 下（一条命令一份）。')
  }
  lines.push('')
  lines.push('## 本轮写入')
  lines.push('')
  if ((record.writtenFiles ?? []).length === 0) {
    lines.push('本轮没有文件发生变化。')
  } else {
    for (const entry of record.writtenFiles) lines.push('- ' + quoted(entry.path) + '：' + quoted(entry.beforeSha256) + ' → ' + quoted(entry.afterSha256))
  }
  lines.push('')
  lines.push('## 目标核验')
  lines.push('')
  if ((record.checks ?? []).length === 0) {
    lines.push('没有核验项被执行：切换没有走到目标核验这一步。')
  } else {
    for (const check of record.checks) lines.push('- ' + check.name + '：' + check.status + ' — ' + check.detail)
  }
  lines.push('')
  lines.push('- 切换前版本：hashline ' + quoted(record.versionsBefore?.hashline) + '、tool-edit ' + quoted(record.versionsBefore?.toolEdit) + '、DSH ' + quoted(record.versionsBefore?.dsh))
  lines.push('- 切换后版本（目标解析）：hashline ' + quoted(record.versionsAfter?.hashline) + '、tool-edit ' + quoted(record.versionsAfter?.toolEdit) + '、DSH ' + quoted(record.versionsAfter?.dsh))
  lines.push('')
  lines.push('## 失败、跳过与缺项')
  lines.push('')
  const failures = record.failures ?? []
  const skipped = record.skipped ?? []
  const gaps = record.gaps ?? []
  if (failures.length === 0 && skipped.length === 0 && gaps.length === 0) {
    lines.push('无。')
  } else {
    for (const entry of failures) lines.push('- 失败 ' + entry.name + '：' + entry.reason)
    for (const entry of skipped) lines.push('- 跳过 ' + entry.name + '：' + entry.reason)
    for (const entry of gaps) lines.push('- 缺项/GAP：' + entry)
    lines.push('')
    lines.push('以上各项都**不计入通过**：跳过、缺项与 GAP 一律如实写出。')
  }
  lines.push('')
  lines.push('## 边界声明')
  lines.push('')
  lines.push('- 只改目标 profile 安装树与维护仓库的依赖/补丁/构建产物：' + (record.scope?.switchedTargets ?? []).map(quoted).join('、'))
  lines.push('- 未改其它 profile、未动官方 DSH 安装、未杀进程、未重启或关闭 DSH：dailyProfileTouched=' + String(record.scope?.dailyProfileTouched) + '、officialInstallTouched=' + String(record.scope?.officialInstallTouched) + '、restarted=' + String(record.scope?.restarted))
  lines.push('- 未改写 proposal.json / consent.json / validation.md：切换记录只追加在本目录的新文件里。')
  lines.push('- 语义回归是否已判定：false（本步只给机械证据；上游是否已实现该行为由方案依据来源申报判断）。')
  lines.push('')
  lines.push('## 下一步')
  lines.push('')
  lines.push('- ' + String(record.nextNote ?? record.next ?? ''))
  if (record.next !== null && record.next !== undefined) lines.push('- ' + String(record.next))
  lines.push('')
  return lines.join('\n')
}
