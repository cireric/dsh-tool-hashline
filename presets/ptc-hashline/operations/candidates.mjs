/**
 * Isolated candidate validation — the seam the spec calls 「获同意后的升级阶段」
 * (UPG-04/06/09/11/13, D7/D10/D11/D15).
 *
 * One boundary shapes this module: a proposal may be VALIDATED here and nothing
 * else may happen. Four rules follow from it.
 *
 * - Only read-only probes run before the authorization gate. The gate is the
 *   last consent record approving THIS proposalHash with
 *   `candidateValidation: true`, a baseline re-collected now (committed AND
 *   uncommitted input) that still equals the proposal's `baselineHash`, a
 *   proposal inside this workflow's evidence tree, and a main (not assisted)
 *   session. Any mismatch stops with zero writes and zero candidate commands,
 *   and names the next step instead. (The baseline re-collection itself runs
 *   `git rev-parse`/`git status`, which are read-only probes, not candidate
 *   commands.)
 * - What is validated is the APPROVED combination, not the baseline one. The
 *   candidate versions are pinned into the candidate tree's own manifest before
 *   the install, and a check compares the version each engine ACTUALLY resolves
 *   to against the approved candidate: a tree that still runs the baseline can
 *   never reach `candidate-verified`.
 * - Every write lands inside `<evidenceDirectory>/upgrades/<proposalId>/`: the
 *   `candidate/` tree and `validation.md`. The maintenance worktree, the
 *   repository store and the global store are never written — the candidate
 *   tree takes its own copy, its own lockfile and its own store.
 * - Process execution is a SEAM. `options.runner` is injectable, so a test can
 *   pin the outcome of every command without pretending a real one ran; the
 *   default runner is a real child process with `shell: true` on Windows, the
 *   same shape `scripts/test-profile.mjs` uses (a bare `execFileSync('pnpm.cmd')`
 *   is EINVAL on this platform). The report records which runner produced the
 *   numbers, so an injected run never reads as a real one.
 *
 * The verdict is three-state and deliberately hard to earn: `candidate-verified`
 * needs every declared gate to have ACTUALLY run and passed, the resolved engines
 * to BE the approved candidate versions, every patch item to be decided and its
 * mechanical outcome confirmed, and no skipped step, no gap and no critical
 * baseline unknown. `candidate-failed` keeps the failure evidence and stops
 * (UPG-09: no assertion is relaxed, no scope is widened). `candidate-incomplete`
 * means something was not measured — it is never a pass.
 *
 * What this module does NOT claim: patch deletion/re-cut is judged on the
 * MECHANICAL outcome (the file and its registration moved or went away, and the
 * resolved build does or does not carry the marker). Whether upstream now
 * implements the behaviour — the semantic regression the spec asks for — is a
 * judgement the PROPOSAL carries from its sources (UPG-02), and this step does
 * not measure it. Every patch item says `semanticRegression: 'not-measured'`
 * for exactly that reason.
 *
 * This module never switches a target, never touches a daily profile and never
 * restarts DSH: those belong to ticket 07.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/candidates
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { HASHLINE_PATCH_MARKERS, patchEvidence, sha256File } from './baseline.mjs'
import { candidateDirectoryProblem, consentDrift, proposalPlacementProblem } from './proposals.mjs'
import { clip } from './text.mjs'
import { PATCH_MARKERS, compareVersions, parseVersion } from './upgrades.mjs'

/** Identity written into every candidate report. */
export const CANDIDATE_TOOL = 'ptc-hashline-operations-candidate-validation'
/** Report schema version. */
export const CANDIDATE_VERSION = 1
/** The only three verdicts, in decreasing strength. */
export const VERDICTS = ['candidate-verified', 'candidate-failed', 'candidate-incomplete']
/** The engine each component's patch belongs to. */
export const PACKAGE_OF_COMPONENT = { hashline: '@hy-sde-org/dsh-hashline', 'tool-edit': '@hy-sde-org/dsh-tool-edit' }
/** Managers this run may drive. */
export const MANAGERS = ['pnpm', 'npm', 'node']
/** The verbs a manager call may use (a declared script name is the only other shape). */
export const MANAGER_VERBS = ['install', 'build', 'test', 'run', 'exec']
/** The manifest fields a pinned candidate dependency may live in. */
export const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies']
/**
 * Path segments never copied into the candidate tree: the install tree, the VCS
 * metadata, the store and the temporary area. Copying the store would defeat the
 * "its own store" rule; copying `.git` would let the candidate touch the
 * maintenance index.
 */
export const SNAPSHOT_EXCLUDES = ['node_modules', '.git', '.pnpm-store', '.tmp']
/** Minutes a single candidate command may take before it is killed. */
export const DEFAULT_TIMEOUT_MIN = 15
/** Where the generated short-link driver lives, relative to the candidate tree. */
export const SHORT_LINK_DRIVER_PATH = ['.candidate', 'short-link.mjs']
/** The exit code the driver uses to say "this tree cannot run the link", never "it passed". */
export const SHORT_LINK_GAP_EXIT = 3

/** Digest one buffer or string. */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Digest one file, or say why it could not be read.
 *
 * `missing` and `unreadable` are different facts, and collapsing them would let a
 * permission error read as "the file is not there" (the sibling modules' rule).
 * @param {string} path the file
 * @returns {{digest: string, problem?: string}} the digest or the reason
 */
export function digestOfFile(path) {
  if (!existsSync(path)) return { digest: 'missing' }
  try {
    return { digest: sha256File(path) }
  } catch (error) {
    return { digest: 'unreadable', problem: 'the file at ' + path + ' cannot be read: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

/**
 * The entry names of one directory, or an empty list plus the reason.
 * @param {string} directory the directory
 * @returns {{names: string[], problem?: string}} the names or the reason
 */
export function namesIn(directory) {
  if (!existsSync(directory)) return { names: [] }
  try {
    return { names: readdirSync(directory) }
  } catch (error) {
    return { names: [], problem: 'the directory at ' + directory + ' cannot be listed: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

/**
 * Whether `child` resolves inside `parent` (and is not the directory itself).
 * @param {string} parent the directory
 * @param {string} child the candidate path
 * @returns {boolean} true when child is strictly inside parent
 */
export function inside(parent, child) {
  const step = relative(resolve(parent), resolve(child))
  return step !== '' && !step.startsWith('..') && !isAbsolute(step)
}

// ── the authorization gate (spec: 同意范围与执行规则) ────────────────────────

/**
 * The gate an approved proposal must pass before this module writes or spawns.
 *
 * Every refusal names the next step, and none of them writes anything: a
 * validation that starts on an unapproved, drifted or misplaced proposal would
 * be executing an approval the user never gave (UPG-03/05/07, SCOPE-06).
 * @param {object} options the facts
 * @returns {{ok: boolean, rule?: string, reason?: string, next?: string, basis?: object, drift?: object[]}} the verdict
 */
export function validationAuthorization(options) {
  const proposal = options.proposal
  if (options.consentProblem !== undefined) {
    return { ok: false, rule: 'UPG-03', reason: options.consentProblem + '; nothing was validated', next: 'upgrade consent' }
  }
  const records = Array.isArray(options.records) ? options.records : []
  const last = records.length > 0 ? records[records.length - 1] : undefined
  if (last === undefined) {
    return {
      ok: false,
      rule: 'UPG-03',
      reason: 'the consent file at ' + options.consentPath + ' holds no record: approval is never the default, so this proposal has not been approved and nothing was validated',
      next: 'upgrade consent',
    }
  }
  if (last.decision !== 'approve') {
    return {
      ok: false,
      rule: 'UPG-03',
      reason: 'the last consent record for this proposal is ' + JSON.stringify(last.decision ?? null) + ', not "approve": the user did not authorize candidate validation, so nothing was validated',
      next: 'upgrade consent',
    }
  }
  if (last.proposalHash !== proposal.proposalHash) {
    return {
      ok: false,
      rule: 'UPG-05',
      reason: 'the last consent record approves proposalHash ' + String(last.proposalHash) + ', but this proposal is ' + String(proposal.proposalHash) + ': an approval never covers another payload, so nothing was validated',
      next: 'upgrade propose',
    }
  }
  if (last.scope?.candidateValidation !== true) {
    return {
      ok: false,
      rule: 'UPG-07',
      reason: 'the last consent record does not carry scope.candidateValidation === true (scope: ' + JSON.stringify(last.scope ?? {}) + '): candidate validation was not granted, so nothing was validated',
      next: 'upgrade consent',
    }
  }
  const drift = consentDrift({ proposal, baseline: options.baseline, maintenancePath: options.maintenancePath })
  if (drift.length > 0) {
    return {
      ok: false,
      rule: 'UPG-05',
      reason: 'the approval basis moved since the proposal was written (' + drift.map((entry) => entry.field + ': ' + String(entry.recorded) + ' -> ' + String(entry.now)).join('、') + '); nothing was validated — re-run "upgrade assess" and "upgrade propose" for a new answer',
      next: 'upgrade assess',
      drift,
    }
  }
  const target = candidateTargetProblem({ proposal, proposalDirectory: options.proposalDirectory, evidenceDirectory: options.evidenceDirectory })
  if (target !== undefined) return { ok: false, rule: 'A4', reason: target, next: 'upgrade propose' }
  const placement = proposalPlacementProblem({ directory: options.proposalDirectory, evidenceDirectory: options.evidenceDirectory })
  if (placement !== undefined) return { ok: false, rule: 'B15', reason: placement, next: 'upgrade propose' }
  if (options.delegation?.mayApproveUpgrade !== true) {
    return {
      ok: false,
      rule: 'SCOPE-06',
      reason: 'SCOPE-06: this is an assisted (subagent) session (parent ' + String(options.delegation?.parentSession ?? 'unknown') + '), and candidate validation follows an upgrade approval that belongs to the user in the main session; nothing was validated',
      next: 'hand the proposal back to the main session',
    }
  }
  return { ok: true, basis: authorizationBasis(last) }
}

/**
 * The authorization facts a report cites, verbatim from the record.
 * @param {object} record the last consent record
 * @returns {object} the basis
 */
export function authorizationBasis(record) {
  return {
    decision: record.decision,
    proposalHash: record.proposalHash,
    baselineHash: record.baselineHash,
    scope: record.scope,
    repliedAt: record.repliedAt,
    reply: record.reply,
    recorder: record.recorder,
  }
}

/**
 * Refuse a candidate directory that is not the one this proposal named.
 *
 * `changes.candidateDirectory` is NOT part of the hashed payload, so a tampered
 * copy of the file could point at another directory without changing
 * `proposalHash`. The only directory this command may create is therefore the one
 * `upgrade propose` names for this exact proposal id — `<dir>/candidate` — inside
 * the evidence tree and outside the maintenance worktree.
 * @param {{proposal: object, proposalDirectory: string, evidenceDirectory: string, maintenanceRepository?: string}} options the paths
 * @returns {string | undefined} the refusal reason, or undefined
 */
export function candidateTargetProblem(options) {
  const named = options.proposal?.changes?.candidateDirectory
  if (typeof named !== 'string' || named === '') {
    return 'this proposal names no candidate directory (changes.candidateDirectory), so there is nowhere this run may build one'
  }
  const expected = join(resolve(options.proposalDirectory), 'candidate')
  if (resolve(named) !== expected) {
    return 'this proposal names the candidate directory ' + named + ', but the only directory this run may create for it is ' + expected
      + ' (changes.candidateDirectory is not part of proposalHash, so it is checked against the proposal id instead)'
  }
  // The placement rules themselves are the sibling module's, not a second copy.
  return candidateDirectoryProblem({
    candidateDirectory: expected,
    evidenceDirectory: options.evidenceDirectory,
    ...options.maintenanceRepository === undefined ? {} : { maintenanceRepository: options.maintenanceRepository },
  })
}

// ── the isolated tree ───────────────────────────────────────────────────────

/**
 * Copy the maintenance worktree into the candidate tree.
 *
 * The copy carries UNCOMMITTED input as well (D10): the candidate has to reflect
 * what actually runs here, not HEAD. The install tree, the VCS metadata, the
 * store and the temporary area are skipped, which is what keeps the maintenance
 * worktree, the repository store and the global store untouched.
 * @param {{from: string, to: string}} options the source worktree and the candidate tree
 * @returns {Promise<{root: string, topLevelEntries: number}>} the tree and its top-level entry count
 */
export async function copyCandidateTree(options) {
  const from = resolve(options.from)
  const to = resolve(options.to)
  if (inside(from, to) || from === to) {
    throw new Error('the candidate tree ' + to + ' would be inside the maintenance worktree ' + from + ': nothing was copied')
  }
  await mkdir(to, { recursive: true })
  await cp(from, to, {
    recursive: true,
    force: true,
    filter: (source) => !SNAPSHOT_EXCLUDES.includes(basename(source)),
  })
  return { root: to, topLevelEntries: (await readdir(to)).length }
}

/**
 * The inputs a candidate run actually includes.
 *
 * A commit hash alone cannot show what was validated, and a matching HEAD cannot
 * prove a file did not change (UPG-05, D10): every uncommitted path is digested
 * from the COPIED tree, so the report says which bytes were in scope. A path the
 * copy does not carry is recorded as `missing` AND reported as a critical
 * unknown — a file nobody read was not validated.
 * @param {{baseline: object, tree: string}} options the collected baseline and the copied tree
 * @returns {object} the included inputs
 */
export function includedInputsOf(options) {
  const repository = options.baseline?.repository ?? {}
  const changed = Array.isArray(repository.changedPaths) ? repository.changedPaths.map(String).sort() : []
  const patchDirectory = join(options.tree, 'patches')
  const listing = namesIn(patchDirectory)
  const patchFiles = listing.names.filter((name) => name.endsWith('.patch')).sort()
    .map((name) => ({ path: join(patchDirectory, name), sha256: digestOfFile(join(patchDirectory, name)).digest }))
  return {
    commit: typeof repository.commit === 'string' && repository.commit !== '' ? repository.commit : 'unknown',
    dirty: typeof repository.dirty === 'string' && repository.dirty !== '' ? repository.dirty : 'unknown',
    files: changed.map((path) => ({ path, ...digestOfFile(join(options.tree, path)) })).map((entry) => ({ path: entry.path, sha256: entry.digest, ...entry.problem === undefined ? {} : { problem: entry.problem } })),
    lockfileSha256: digestOfFile(join(options.tree, 'pnpm-lock.yaml')).digest,
    patchFiles,
    problems: [...listing.problem === undefined ? [] : [listing.problem],
      ...changed.map((path) => digestOfFile(join(options.tree, path))).map((entry) => entry.problem).filter((entry) => entry !== undefined)],
    note: 'commit 只说明已提交的部分；files 是维护仓库的未提交输入（含未跟踪文件），逐个从候选树读取 sha256，因此「HEAD 相同」不会被当作「文件没变」。',
  }
}

/**
 * Pin the APPROVED candidate versions into the candidate tree's own manifest.
 *
 * This is the half of the approval that would otherwise never land: without it
 * the install would resolve the maintenance repository's own dependency set and
 * the run would validate the baseline while claiming to validate the candidate
 * (spec 「获同意后的升级阶段」#2: use the package manager to update the exact
 * dependencies). Only a dependency the manifest ALREADY declares is re-pinned; a
 * package the manifest never mentions is a named gap, because adding one is a
 * manifest change the proposal has to list explicitly.
 * @param {{tree: string, proposal: object}} options the tree and the proposal
 * @returns {Promise<{updates: object[], gaps: string[], written: boolean}>} what was pinned
 */
export async function applyDependencyUpdates(options) {
  const manifestPath = join(options.tree, 'package.json')
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    return {
      updates: [],
      written: false,
      gaps: ['the candidate tree has no readable package.json (' + (error instanceof Error ? error.message : String(error)) + '), so no candidate dependency could be pinned'],
    }
  }
  const updates = []
  const gaps = []
  for (const candidate of Array.isArray(options.proposal?.candidates) ? options.proposal.candidates : []) {
    const specifier = PACKAGE_OF_COMPONENT[candidate?.component]
    if (specifier === undefined) continue
    if (candidate.execution === 'manual') {
      gaps.push('the ' + candidate.component + ' candidate is a manual component (D2/UPG-08): this run does not install it and cannot pin it')
      continue
    }
    if (typeof candidate.version !== 'string' || candidate.version === '') {
      gaps.push('the proposal names no exact candidate version for ' + candidate.component + ', so its dependency cannot be pinned to the approved combination')
      continue
    }
    let declared = false
    for (const field of DEPENDENCY_FIELDS) {
      const block = manifest[field]
      if (block === null || typeof block !== 'object' || Array.isArray(block)) continue
      if (!Object.hasOwn(block, specifier)) continue
      declared = true
      const from = String(block[specifier])
      block[specifier] = candidate.version
      updates.push({ package: specifier, field, from, to: candidate.version, changed: from !== candidate.version })
    }
    if (!declared) {
      gaps.push('the candidate tree manifest declares no ' + specifier + ' dependency, so the approved candidate version ' + candidate.version + ' could not be pinned: adding it is a manifest change the proposal must list')
    }
  }
  const written = updates.some((entry) => entry.changed)
  if (written) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return { updates, gaps, written }
}

// ── patch decisions and the version coupling ────────────────────────────────

/**
 * Decode a `patches/<owner>__<name>@<version>.patch` file name.
 *
 * The version is part of the FILE NAME and of the `patchedDependencies` key, so a
 * version bump has to rename both or pnpm silently stops applying the patch.
 * @param {string} name the file name
 * @returns {{file: string, package: string, version: string} | undefined} the parts
 */
export function decodePatchFileName(name) {
  if (!name.endsWith('.patch')) return undefined
  const base = name.slice(0, -'.patch'.length)
  const at = base.lastIndexOf('@')
  if (at <= 0) return undefined
  return { file: name, package: base.slice(0, at).replaceAll('__', '/'), version: base.slice(at + 1) }
}

/**
 * Encode the file name a patch for `specifier` at `version` must carry.
 * @param {string} specifier the package name
 * @param {string} version the exact version
 * @returns {string} the file name
 */
export function encodePatchFileName(specifier, version) {
  return specifier.replaceAll('/', '__') + '@' + version + '.patch'
}

/**
 * Rewrite the `patchedDependencies` block for the candidate versions.
 *
 * pnpm registers a patch by an EXACT `name@version` key, so renaming the file
 * without the key (or the reverse) leaves the patch registered for a version that
 * is no longer installed — the patch silently stops applying. Lines outside the
 * block are preserved byte for byte, because a whole-file rewrite of a workspace
 * file is exactly the kind of collateral change this workflow refuses.
 * @param {string} text the pnpm-workspace.yaml text
 * @param {{key: string, nextKey: string | null, nextPath: string}[]} plans one per entry
 * @returns {{text: string, changed: string[], missing: string[]}} the rewrite
 */
export function rewritePatchedDependencies(text, plans) {
  const lines = String(text).split('\n')
  const header = lines.findIndex((line) => /^patchedDependencies:\s*$/u.test(line))
  if (header < 0) return { text: String(text), changed: [], missing: plans.map((plan) => plan.key) }
  const changed = []
  const missing = []
  const seen = new Set()
  let index = header + 1
  const rewritten = []
  while (index < lines.length && /^\s+\S/u.test(lines[index])) {
    const line = lines[index]
    const match = /^(\s+)(['"]?)([^'":\s][^'"]*?)\2:\s*(\S+)\s*$/u.exec(line)
    if (match === null) {
      rewritten.push(line)
      index += 1
      continue
    }
    const indent = match[1]
    const key = match[3]
    const plan = plans.find((entry) => entry.key === key)
    if (plan === undefined) {
      rewritten.push(line)
      index += 1
      continue
    }
    seen.add(key)
    if (plan.nextKey === null) {
      changed.push('removed ' + key)
      index += 1
      continue
    }
    rewritten.push(indent + "'" + plan.nextKey + "': " + plan.nextPath)
    changed.push('renamed ' + key + ' -> ' + plan.nextKey)
    index += 1
  }
  for (const plan of plans) if (!seen.has(plan.key)) missing.push(plan.key)
  return { text: [...lines.slice(0, header + 1), ...rewritten, ...lines.slice(index)].join('\n'), changed, missing }
}

/**
 * Apply the proposal's per-item verdicts to the candidate tree.
 *
 * Nothing is invented here: each item is one of keep / redo / delete, taken from
 * the proposal as written, and a `pending-verification` item stays UNDECIDED —
 * this step must not quietly turn "unknown" into "keep". What this function does
 * is the MECHANICAL half — the patch file and its `patchedDependencies` key move
 * to the candidate version, or the patch is dropped when every item of its
 * component is deleted — and it reports the mechanical action, never a semantic
 * regression verdict (that one belongs to the proposal's sources, UPG-02).
 * @param {{tree: string, proposal: object}} options the tree and the proposal
 * @returns {Promise<{items: object[], files: object[], changed: string[], gaps: string[]}>} the result
 */
export async function applyPatchDecisions(options) {
  const items = []
  const files = []
  const changed = []
  const gaps = []
  const plans = []
  const decisions = Array.isArray(options.proposal?.patchDecisions) ? options.proposal.patchDecisions : []
  const candidates = Array.isArray(options.proposal?.candidates) ? options.proposal.candidates : []
  const patchDirectory = join(options.tree, 'patches')
  const listing = await readdir(patchDirectory).catch((error) => ({ error }))
  const present = Array.isArray(listing) ? listing.filter((name) => name.endsWith('.patch')).sort() : []
  if (!Array.isArray(listing)) {
    gaps.push('the candidate tree\'s patches directory cannot be listed (' + (listing.error instanceof Error ? listing.error.message : String(listing.error)) + '): no patch decision could be applied mechanically')
  }
  for (const [component, specifier] of Object.entries(PACKAGE_OF_COMPONENT)) {
    const componentItems = decisions.filter((item) => item?.component === component)
    if (componentItems.length === 0) continue
    const candidateVersion = candidates.find((entry) => entry?.component === component)?.version
    const file = present.map(decodePatchFileName).filter((entry) => entry !== undefined && entry.package === specifier)[0]
    const allDelete = componentItems.every((item) => item.decision === 'delete')
    if (file === undefined) {
      if (Array.isArray(listing)) {
        gaps.push('no patch file for ' + specifier + ' is in the candidate tree (' + patchDirectory + '): the ' + componentItems.length + ' patch decision(s) for this component could not be applied mechanically')
      }
      for (const item of componentItems) items.push({ ...itemFacts(item), apply: 'no-patch-file', requiresRecut: item.decision !== 'delete' })
      continue
    }
    if (allDelete) {
      await rm(join(patchDirectory, file.file), { force: true })
      files.push({ from: file.file, to: null, action: 'removed' })
      plans.push({ key: specifier + '@' + file.version, nextKey: null, nextPath: '' })
      for (const item of componentItems) items.push({ ...itemFacts(item), apply: 'patch-file-removed', requiresRecut: false })
      continue
    }
    let current = file
    if (typeof candidateVersion === 'string' && candidateVersion !== '' && candidateVersion !== file.version) {
      const next = encodePatchFileName(specifier, candidateVersion)
      await rename(join(patchDirectory, file.file), join(patchDirectory, next))
      files.push({ from: file.file, to: next, action: 'renamed' })
      plans.push({ key: specifier + '@' + file.version, nextKey: specifier + '@' + candidateVersion, nextPath: 'patches/' + next })
      current = { file: next, package: specifier, version: candidateVersion }
    }
    for (const item of componentItems) {
      const undecided = item.decision === 'pending-verification'
      items.push({
        ...itemFacts(item),
        apply: undecided ? 'undecided' : item.decision === 'delete' ? 'requires-recut' : item.decision === 'redo' ? 'registered-for-candidate-version' : 'patch-kept',
        // A partly deleted patch still contains the kept hunks, so dropping one
        // hunk is a re-cut — plan-outside work (UPG-09).
        requiresRecut: undecided || item.decision === 'delete',
        patchFile: current.file,
      })
    }
  }
  const workspaceFile = join(options.tree, 'pnpm-workspace.yaml')
  if (plans.length > 0) {
    if (!existsSync(workspaceFile)) {
      gaps.push('the candidate tree has no pnpm-workspace.yaml, so the patchedDependencies keys could not be moved with the patch files: ' + plans.map((plan) => plan.key).join(', '))
    } else {
      const before = await readFile(workspaceFile, 'utf8')
      const rewritten = rewritePatchedDependencies(before, plans)
      for (const entry of rewritten.missing) gaps.push('the patchedDependencies block registers no entry for ' + entry + ': the patch file moved but the registration did not')
      if (rewritten.text !== before) {
        await writeFile(workspaceFile, rewritten.text, 'utf8')
        changed.push(...rewritten.changed)
      }
    }
  }
  return { items, files, changed, gaps }
}

/** The proposal fields one patch item keeps in the report. */
function itemFacts(item) {
  const present = item?.evidence?.present
  return {
    component: item.component,
    file: item.file,
    marker: item.marker,
    decision: item.decision,
    reason: item.reason,
    // What the DECLARATION saw in the candidate package text. It is reported, not
    // trusted: the resolved build is the evidence, and a disagreement is written
    // down instead of being smoothed over.
    declared: present === true ? 'present' : present === false ? 'absent' : 'unknown',
  }
}

// ── the resolved build, the shared instance and the marker evidence ─────────

/**
 * Read the candidate tree's OWN resolved engines.
 *
 * Same question the baseline asks of the running install, asked of the candidate
 * tree instead: which physical directory does each engine load from, do read and
 * edit reach ONE hashline module (FR-8), and does the resolved build carry the
 * patch markers. A version number proves nothing here; the marker text does.
 *
 * The read/edit sides are resolved from each PLUGIN package's own manifest, and a
 * side that is absent is reported as unresolved rather than being replaced by the
 * bundle's resolver: comparing a fallback with itself would make this check pass
 * without measuring anything.
 * @param {{tree: string}} options the candidate tree
 * @returns {{resolution: object, engines: object, unknown: string[]}} the evidence
 */
export function resolvedCandidateEngines(options) {
  const label = options.label ?? '候选树'
  const unknown = []
  const requireFrom = createRequire(join(options.tree, 'package.json'))
  /** The physical directory one specifier resolves to, or the reason it does not. */
  const resolveEngineDir = (requireOf, specifier) => {
    try {
      return { path: dirname(realpathSync(requireOf.resolve(specifier + '/package.json'))) }
    } catch (error) {
      return { problem: 'the package does not resolve: ' + (error instanceof Error ? error.message : String(error)) }
    }
  }
  const engines = {}
  for (const [component, specifier] of Object.entries(PACKAGE_OF_COMPONENT)) {
    const resolved = resolveEngineDir(requireFrom, specifier)
    if (resolved.problem !== undefined) {
      engines[component] = { version: 'unknown', realpath: 'unknown', problem: resolved.problem }
      unknown.push(component + ': ' + resolved.problem)
      continue
    }
    let version = 'unknown'
    try {
      version = JSON.parse(readFileSync(join(resolved.path, 'package.json'), 'utf8')).version ?? 'unknown'
    } catch (error) {
      unknown.push(component + ': the resolved manifest at ' + resolved.path + ' is unreadable (' + (error instanceof Error ? error.message : String(error)) + ')')
    }
    engines[component] = { version, realpath: resolved.path, patch: patchEvidence(requireFrom, specifier, PATCH_MARKERS[component]) }
  }
  // The read and edit sides must reach ONE physical hashline module (FR-8): two
  // instances make the two tools disagree about the snapshot they share.
  const sideOf = (plugin) => {
    const manifest = join(options.tree, 'node_modules', '@dsh-tool-hashline', plugin, 'package.json')
    if (!existsSync(manifest)) {
      return { problem: '@dsh-tool-hashline/' + plugin + ' is not installed in the ' + label + ', so its own resolution of hashline cannot be read' }
    }
    return resolveEngineDir(createRequire(manifest), PACKAGE_OF_COMPONENT.hashline)
  }
  const readSide = sideOf('tool-read')
  const editSide = sideOf('tool-edit')
  if (readSide.problem !== undefined) unknown.push('the read side does not resolve hashline in the ' + label + ': ' + readSide.problem)
  if (editSide.problem !== undefined) unknown.push('the edit side does not resolve hashline in the ' + label + ': ' + editSide.problem)
  const readPath = readSide.path ?? 'unknown'
  const editPath = editSide.path ?? 'unknown'
  return {
    resolution: {
      readSide: readPath,
      editSide: editPath,
      readSideResolved: readSide.problem === undefined,
      editSideResolved: editSide.problem === undefined,
      samePhysicalInstance: readPath !== 'unknown' && readPath === editPath,
      insideCandidateTree: readPath !== 'unknown' && inside(options.tree, readPath),
      note: 'read 与 edit 必须落在' + label + '内的同一个物理 hashline 实例：两个实例会让两边对同一份 snapshot 各说各话（FR-8）。未解析到就是未测量，不记通过。',
    },
    engines,
    unknown,
  }
}

/**
 * Prove the recorded patch digests still match the bytes on disk.
 *
 * A patch whose registration was renamed still has to be the SAME patch the
 * proposal recorded — otherwise an upgrade could quietly ship different bytes
 * under an approved hash. A patch file the decisions removed on purpose is a
 * match with an explained absence, not a drifted digest.
 * @param {{recorded: {path: string, sha256: string}[], tree: string, removed?: string[]}} options the recorded digests and the tree
 * @returns {{entries: object[], problems: string[]}} one entry per recorded patch
 */
export function patchDigestCheck(options) {
  const patchDirectory = join(options.tree, 'patches')
  const listing = namesIn(patchDirectory)
  const present = listing.names.filter((name) => name.endsWith('.patch')).sort()
  const removed = Array.isArray(options.removed) ? options.removed : []
  const problems = listing.problem === undefined ? [] : [listing.problem]
  const entries = (Array.isArray(options.recorded) ? options.recorded : []).map((entry) => {
    const wanted = decodePatchFileName(basename(String(entry.path)))
    const recordVersion = typeof wanted?.version === 'string' ? wanted.version : undefined
    const samePackage = present.map(decodePatchFileName).filter((file) => file !== undefined && file.package === wanted?.package)
    const match = samePackage.find((file) => digestOfFile(join(patchDirectory, file.file)).digest === String(entry.sha256))
    const deletedByDecision = samePackage.length === 0 && removed.includes(wanted?.package)
    const fallback = samePackage[0]
    const now = match !== undefined ? match.file
      : deletedByDecision ? 'removed-by-decision'
        : fallback === undefined ? 'missing' : digestOfFile(join(patchDirectory, fallback.file)).digest
    return {
      path: String(entry.path),
      recorded: String(entry.sha256),
      now,
      match: match !== undefined || deletedByDecision,
      ...deletedByDecision ? { removedByDecision: true } : {},
      ...recordVersion === undefined ? {} : { recordedVersion: recordVersion },
    }
  })
  return { entries, problems }
}

/**
 * Compare the version each engine RESOLVES to against the approved candidate.
 *
 * Without this, a tree that still runs the baseline would pass every other check
 * (its own markers are of course present) and the report's "version after" would
 * equal "version before". What is validated has to be the approved combination.
 * @param {{proposal: object, engines: object}} options the proposal and the resolved engines
 * @returns {{items: object[], unknown: string[]}} the comparison
 */
export function candidateVersionCheck(options) {
  const items = []
  const unknown = []
  for (const candidate of Array.isArray(options.proposal?.candidates) ? options.proposal.candidates : []) {
    const component = candidate?.component
    if (!(component in PACKAGE_OF_COMPONENT)) continue
    if (candidate.execution === 'manual') continue
    const approved = typeof candidate.version === 'string' && candidate.version !== '' ? candidate.version : null
    const resolved = options.engines?.[component]?.version ?? 'unknown'
    if (approved === null || resolved === 'unknown') {
      items.push({ component, approved, resolved, match: false })
      unknown.push('the ' + component + ' candidate version could not be compared with the resolved build (approved ' + String(approved) + ', resolved ' + String(resolved) + ')')
      continue
    }
    items.push({ component, approved, resolved, match: approved === resolved })
  }
  return { items, unknown }
}

/**
 * Whether `version` satisfies `range`, as far as this narrow evaluator goes.
 *
 * Only an exact pin, a caret and a tilde are evaluated (that is what these
 * manifests declare); anything else returns null, which the caller records as
 * "not evaluated" instead of guessing. npm's pre-release rule is honoured: a
 * pre-release version only satisfies a range whose own bound is a pre-release of
 * the same `major.minor.patch`.
 * @param {string} range the declared range
 * @param {string} version the resolved version
 * @returns {boolean | null} the verdict, or null when the range is out of scope
 */
export function satisfiesRange(range, version) {
  const declared = String(range ?? '').trim()
  const actual = parseVersion(version)
  if (actual === null) return null
  if (parseVersion(declared) !== null) return compareVersions(version, declared) === 0
  const prefixed = /^([\^~])\s*(\S+)$/u.exec(declared)
  if (prefixed === null) return null
  const bound = parseVersion(prefixed[2])
  if (bound === null) return null
  if (actual.pre.length > 0) {
    if (bound.pre.length === 0) return false
    if (actual.core[0] !== bound.core[0] || actual.core[1] !== bound.core[1] || actual.core[2] !== bound.core[2]) return false
    return compareVersions(version, prefixed[2]) >= 0
  }
  if (compareVersions(version, prefixed[2]) < 0) return false
  const upper = prefixed[1] === '^'
    ? (bound.core[0] > 0 ? [bound.core[0] + 1, 0, 0] : [0, bound.core[1] + 1, 0])
    : [bound.core[0], bound.core[1] + 1, 0]
  return compareVersions(version, upper[0] + '.' + upper[1] + '.' + upper[2]) < 0
}

/**
 * Check the version constraints the engine manifests declare on each other.
 *
 * 「校验三方版本约束」means the engines must agree with each other, not just
 * exist: a tool-edit that declares a hashline range has to be satisfied by the
 * hashline this tree resolves. A range this narrow evaluator cannot read is
 * reported as `evaluated: false` and named as a gap, never assumed satisfied.
 * @param {{engines: object}} options the resolved engines
 * @returns {{items: object[], gaps: string[]}} the constraint findings
 */
export function engineConstraintCheck(options) {
  const items = []
  const gaps = []
  for (const [component, manifest] of Object.entries(options.engines ?? {})) {
    if (typeof manifest?.realpath !== 'string' || manifest.realpath === 'unknown') {
      gaps.push('the ' + component + ' manifest could not be read, so its version declarations were not checked')
      continue
    }
    let parsed
    try {
      parsed = JSON.parse(readFileSync(join(manifest.realpath, 'package.json'), 'utf8'))
    } catch (error) {
      gaps.push('the ' + component + ' manifest at ' + manifest.realpath + ' is unreadable: ' + (error instanceof Error ? error.message : String(error)))
      continue
    }
    for (const [other, specifier] of Object.entries(PACKAGE_OF_COMPONENT)) {
      if (other === component) continue
      for (const field of ['dependencies', 'peerDependencies']) {
        const range = parsed?.[field]?.[specifier]
        if (typeof range !== 'string') continue
        const resolved = options.engines?.[other]?.version ?? 'unknown'
        const verdict = satisfiesRange(range, resolved)
        items.push({ component, field, package: specifier, declared: range, resolved, evaluated: verdict !== null, match: verdict })
        if (verdict === null) {
          gaps.push(component + ' declares ' + specifier + ' as ' + range + ' (outside the ranges this run evaluates), so the three-way constraint was reported but NOT evaluated')
        }
      }
    }
  }
  return { items, gaps }
}

// ── execution: allowlist, runner, timeout, cancel ───────────────────────────

/**
 * Whether a command may run in the candidate tree.
 *
 * The allowlist is this command's own and is strictly narrower than a shell: the
 * manager must be pnpm/npm/node, the verb install/build/test/run/exec — or the
 * exact name of a script the PROPOSAL declared, which is the only way
 * `pnpm test:unit` (pnpm's shorthand) is reachable. Nothing here loosens
 * `upgrades.mjs`'s read-only metadata allowlist: that one pins the assessment's
 * queries and is not consulted by this path.
 * @param {{command: string, args: string[], tree: string, declaredScripts?: string[]}} options the call
 * @returns {string | undefined} the refusal reason, or undefined
 */
export function candidateCommandProblem(options) {
  // The label names the tree the rule confines a node script to. The candidate
  // run and the target switch share this rule and differ only in which tree it is,
  // so the words are a parameter instead of a second copy.
  const label = options.label ?? 'candidate tree'
  const manager = basename(options.command).replace(/\.(cmd|exe|bat)$/iu, '')
  if (!MANAGERS.includes(manager)) {
    return 'refused: only ' + MANAGERS.join(' / ') + ' may run in the ' + label + ' (got ' + JSON.stringify(options.command) + ')'
  }
  const verb = options.args.find((arg) => !arg.startsWith('-'))
  if (manager === 'node') {
    if (verb === undefined) return 'refused: node needs a script path'
    const script = resolve(options.tree, verb)
    if (!inside(options.tree, script)) return 'refused: the node script ' + verb + ' is outside the ' + label + ' ' + options.tree
    return undefined
  }
  if (verb === undefined) return 'refused: ' + manager + ' needs a verb (' + MANAGER_VERBS.join(' / ') + ')'
  if (MANAGER_VERBS.includes(verb)) return undefined
  if ((options.declaredScripts ?? []).includes(verb)) return undefined
  return 'refused: ' + manager + ' ' + verb + ' is neither one of ' + MANAGER_VERBS.join(' / ') + ' nor a script the proposal declared'
}

/**
 * The real runner: a child process, with `shell: true` on Windows.
 *
 * `execFileSync('pnpm.cmd')` is EINVAL on this platform (the gap
 * `operations-pack.spec.ts` already records), so the Windows shape is the one
 * `scripts/test-profile.mjs` uses: the `.cmd` name plus a shell. Arguments that
 * carry a space are quoted here, because a shell splits them otherwise.
 * @param {(command: string, args: string[], options: object) => unknown} [launcher] injectable process launcher
 * @returns {(command: string, args: string[], options: {cwd: string, timeoutMs?: number, env?: object}) => unknown} the runner
 */
export function createDefaultRunner(launcher) {
  const start = launcher ?? execFileSync
  const shell = process.platform === 'win32'
  return (command, args, options) => {
    const quoted = shell ? args.map((arg) => (String(arg).includes(' ') ? '"' + String(arg) + '"' : String(arg))) : args
    return start(command, quoted, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, ...options.env ?? {} },
      ...options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs, killSignal: 'SIGKILL' },
    })
  }
}

/**
 * The pnpm/npm executable for this platform.
 * @param {string} manager 'pnpm' | 'npm' | 'node'
 * @returns {string} the command to spawn
 */
export function managerCommand(manager) {
  return process.platform === 'win32' && manager !== 'node' ? manager + '.cmd' : manager
}

/**
 * An interrupt predicate bound to the process's own stop signals.
 *
 * The CLI installs this so a user who stops a long candidate run leaves a
 * recorded "cancelled" instead of a report that reads as complete: the command
 * already running is killed by its timeout or by the shell, and every later gate
 * is recorded as NOT executed.
 * @returns {{cancelled: () => boolean, dispose: () => void}} the predicate and its cleanup
 */
export function interruptPredicate() {
  let stopped = false
  const onInterrupt = () => {
    stopped = true
  }
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onInterrupt)
  return {
    cancelled: () => stopped,
    dispose: () => {
      process.removeListener('SIGINT', onInterrupt)
      process.removeListener('SIGTERM', onInterrupt)
    },
  }
}

/** One run's normalized outcome, whatever the runner returned or threw. */
function normalizeRunOutcome(value) {
  if (typeof value === 'string') return { exitCode: 0, stdout: value, stderr: '' }
  if (value === undefined || value === null) return { exitCode: 0, stdout: '', stderr: '' }
  const record = value
  const exitCode = typeof record.exitCode === 'number' ? record.exitCode
    : typeof record.status === 'number' ? record.status : null
  return {
    exitCode,
    stdout: String(record.stdout ?? ''),
    stderr: String(record.stderr ?? ''),
    timedOut: record.timedOut === true,
    ...typeof record.failure === 'string' ? { failure: record.failure } : {},
  }
}

/**
 * The failure shape a thrown runner gives us.
 *
 * A thrown child carries its own status, output and signal; the reason it was
 * thrown is kept in `stderr` when the child wrote nothing, so the report never
 * says "failed" without saying why.
 * @param {unknown} error whatever the runner threw
 * @returns {{exitCode: number | null, stdout: string, stderr: string, timedOut: boolean}} the outcome
 */
function failureOf(error) {
  const record = error ?? {}
  return {
    exitCode: typeof record.status === 'number' ? record.status : typeof record.code === 'number' ? record.code : null,
    stdout: String(record.stdout ?? ''),
    stderr: String(record.stderr ?? record.message ?? String(error)),
    timedOut: record.code === 'ETIMEDOUT' || record.signal === 'SIGKILL' || record.signal === 'SIGTERM',
  }
}

/** A file-name-safe form of one command's name. */
function logNameOf(name) {
  return String(name).replace(/[^A-Za-z0-9._-]+/gu, '_')
}

/**
 * Run one candidate command and record it, whatever happens.
 *
 * A timeout kills the child and is recorded as a timeout, not as a pass; a thrown
 * runner is recorded with its own stderr; a refused command never runs at all.
 * Nothing is retried: a retry would hide the failing state UPG-09 asks us to keep.
 * @param {object} state the run's mutable state
 * @param {{name: string, command: string, args: string[], cwd: string, source: string}} spec the call
 * @returns {Promise<object>} the recorded entry
 */
async function runOne(state, spec) {
  const index = state.commands.length
  const problem = candidateCommandProblem({ command: spec.command, args: spec.args, tree: state.tree, declaredScripts: state.declaredScripts })
  if (problem !== undefined) {
    const refused = { name: spec.name, source: spec.source, command: spec.command, args: [...spec.args], cwd: spec.cwd, exitCode: null, durationMs: 0, refused: problem }
    state.commands.push(refused)
    state.failures.push({ name: spec.name, reason: problem })
    return refused
  }
  const startedAt = Date.now()
  let outcome
  try {
    outcome = normalizeRunOutcome(await Promise.resolve(state.runner(spec.command, spec.args, { cwd: spec.cwd, timeoutMs: state.timeoutMs })))
  } catch (error) {
    outcome = failureOf(error)
  }
  const entry = {
    name: spec.name,
    source: spec.source,
    command: spec.command,
    args: [...spec.args],
    cwd: spec.cwd,
    exitCode: outcome.exitCode,
    durationMs: Date.now() - startedAt,
    timedOut: outcome.timedOut === true,
    stdout: clip(outcome.stdout, 4000),
    stderr: clip(outcome.stderr, 4000),
    ...outcome.failure === undefined ? {} : { failure: outcome.failure },
  }
  // One log per command, on disk: the record in result.json is clipped, the log
  // keeps what the command actually wrote, so a failure can be read later.
  const log = join(state.logsDirectory, String(index).padStart(2, '0') + '-' + logNameOf(spec.name) + '.log')
  const body = [
    '# ' + spec.name + ' (' + spec.source + ')',
    '# ' + spec.command + ' ' + spec.args.join(' '),
    '# cwd ' + spec.cwd,
    '# exit ' + String(entry.exitCode) + (entry.timedOut === true ? ' (timed out)' : '') + ', ' + String(entry.durationMs) + 'ms',
    '',
    '--- stdout ---',
    String(outcome.stdout ?? ''),
    '--- stderr ---',
    String(outcome.stderr ?? ''),
    '',
  ].join('\n')
  try {
    await writeFile(log, body, 'utf8')
    entry.log = log
  } catch (error) {
    state.gaps.push('the log of ' + spec.name + ' could not be written to ' + log + ': ' + (error instanceof Error ? error.message : String(error)))
  }
  state.commands.push(entry)
  return entry
}

/** Whether a recorded command counts as a pass. */
function passed(entry) {
  return entry.refused === undefined && entry.timedOut !== true && entry.exitCode === 0
}

/** A short, quotable reason a recorded command did not pass. */
function whyNot(entry) {
  if (entry.refused !== undefined) return entry.refused
  if (entry.timedOut === true) return 'timed out'
  return 'exit code ' + String(entry.exitCode)
}

/**
 * The "path:line" locations in a command's output, so a failure is quotable.
 * @param {object} entry the recorded command
 * @returns {string[]} the locations found in its stderr and stdout
 */
export function failureLocations(entry) {
  const text = String(entry?.stderr ?? '') + '\n' + String(entry?.stdout ?? '')
  const found = new Set()
  for (const match of text.matchAll(/([A-Za-z]:[\\/][^\s:()'"]+|[./][^\s:()'"]+):(\d+)(?::(\d+))?/gu)) {
    found.add(match[1] + ':' + match[2] + (match[3] === undefined ? '' : ':' + match[3]))
  }
  return [...found].slice(0, 12)
}

// ── the run ─────────────────────────────────────────────────────────────────

/**
 * Validate an approved candidate in isolation.
 *
 * The order follows the spec: the tree is copied, the approved dependency
 * versions and patch decisions are applied to it, the manager installs into the
 * tree's OWN store, the resolved build is read and compared with what was
 * approved, then the proposal's declared gates run, then the short link. The
 * first failure stops the sequence — the remaining gates are recorded as NOT RUN,
 * because a "0" that skipped a gate is the one claim this workflow must never
 * make.
 * @param {object} options the run's facts
 * @returns {Promise<object>} the report written to result.json
 */
export async function validateCandidate(options) {
  const proposal = options.proposal
  const tree = join(options.candidateDirectory, 'tree')
  const state = {
    commands: [],
    failures: [],
    skipped: [],
    gaps: [],
    checks: [],
    patchItems: [],
    tree,
    logsDirectory: join(options.candidateDirectory, 'logs'),
    declaredScripts: (Array.isArray(proposal?.changes?.verification) ? proposal.changes.verification : [])
      .map((entry) => entry?.name)
      .filter((name) => typeof name === 'string'),
    runner: options.runner ?? createDefaultRunner(),
    timeoutMs: (options.timeoutMin ?? DEFAULT_TIMEOUT_MIN) * 60_000,
  }
  const source = options.runner === undefined ? 'default' : 'injected'
  const interrupt = options.cancel === undefined ? interruptPredicate() : undefined
  const cancel = options.cancel ?? interrupt.cancelled
  try {
    await mkdir(state.logsDirectory, { recursive: true })
    const copy = await copyCandidateTree({ from: options.maintenanceRepository, to: tree })
    const includedInputs = includedInputsOf({ baseline: options.baseline, tree })
    state.gaps.push(...includedInputs.problems)

    // 1) the approved dependency versions, then the patch decisions.
    const dependencies = await applyDependencyUpdates({ tree, proposal })
    state.gaps.push(...dependencies.gaps)
    const applied = await applyPatchDecisions({ tree, proposal })
    state.gaps.push(...applied.gaps)

    // 2) the candidate's own install: its store, its lockfile.
    const storeDirectory = join(options.candidateDirectory, '.pnpm-store')
    const declaredManager = managerOf(tree)
    if (declaredManager.problem !== undefined) state.gaps.push(declaredManager.problem)
    const installed = await runOne(state, {
      name: 'install',
      source: 'candidate-install',
      command: managerCommand(declaredManager.manager),
      args: ['install', '--store-dir', storeDirectory],
      cwd: tree,
    })
    // A failed install is a failure, not a step to skip past: everything after it
    // would be measured against a tree that was never installed.
    if (!passed(installed)) state.failures.push({ name: 'install', reason: whyNot(installed) })

    // 3) the resolved build: identity, shared instance, versions, digests.
    const resolved = resolvedCandidateEngines({ tree })
    const removedPackages = applied.files
      .filter((entry) => entry.to === null)
      .map((entry) => decodePatchFileName(entry.from)?.package)
      .filter((entry) => entry !== undefined)
    const digests = patchDigestCheck({ recorded: proposal?.rollback?.patchFiles ?? [], tree, removed: removedPackages })
    state.gaps.push(...digests.problems)
    state.patchItems = applied.items.map((item) => resolvedPatchItem(item, resolved.engines))
    for (const item of state.patchItems) {
      if (item.apply === 'undecided') {
        state.gaps.push('the ' + item.component + ' patch item ' + item.marker + ' is still pending-verification: this step does not turn an undecided item into keep')
        continue
      }
      if (item.resolved === 'unknown') {
        state.gaps.push('the ' + item.component + ' marker ' + item.marker + ' could not be read out of the candidate tree\'s resolved build, so that decision was NOT measured')
        continue
      }
      if (item.satisfied !== true) {
        state.failures.push({
          name: 'patch:' + item.component + ':' + item.marker,
          reason: item.requiresRecut === true
            ? 'the decision needs a re-cut patch, which is plan-outside work (UPG-09)'
            : 'the resolved build does not show the state the decision expects',
        })
      }
    }
    // The shared instance is only measured when BOTH sides resolve on their own:
    // a fallback compared with itself would be a pass that measured nothing.
    const sidesResolved = resolved.resolution.readSideResolved && resolved.resolution.editSideResolved
    const resolutionOkay = sidesResolved && resolved.resolution.samePhysicalInstance && resolved.resolution.insideCandidateTree
    const resolutionDetail = sidesResolved
      ? 'read side ' + resolved.resolution.readSide + ', edit side ' + resolved.resolution.editSide
        + (resolutionOkay ? '' : (resolved.resolution.insideCandidateTree ? ' — two physical hashline instances' : ' — the resolved hashline is not inside the candidate tree'))
      : 'the two plugin packages are not installed in the candidate tree, so each side\'s own resolution could not be read: read side ' + String(resolved.resolution.readSide) + ', edit side ' + String(resolved.resolution.editSide)
    state.checks.push({ name: 'resolved-paths-and-shared-instance', status: resolutionOkay ? 'pass' : sidesResolved ? 'fail' : 'gap', detail: resolutionDetail })
    if (!resolutionOkay && sidesResolved) state.failures.push({ name: 'resolved-paths-and-shared-instance', reason: resolutionDetail })
    // What is validated must BE the approved combination (this is the check that
    // stops a baseline tree from reading as a verified candidate).
    const versions = candidateVersionCheck({ proposal, engines: resolved.engines })
    const versionsMatch = versions.items.length > 0 && versions.items.every((item) => item.match)
    const versionsDetail = versions.items.length === 0
      ? 'this proposal names no in-repo candidate version to compare'
      : versions.items.map((item) => item.component + ' approved ' + String(item.approved) + ', resolved ' + String(item.resolved) + (item.match ? ' (match)' : ' (MISMATCH)')).join('; ')
    state.checks.push({ name: 'candidate-versions-match', status: versions.items.length === 0 ? 'n/a' : versionsMatch ? 'pass' : 'fail', detail: versionsDetail })
    // Only a COMPARED mismatch is a failure: a version nobody could read stays an
    // unmeasured unknown (it already landed in criticalUnknowns).
    if (versions.items.some((item) => item.resolved !== 'unknown' && !item.match)) {
      state.failures.push({ name: 'candidate-versions-match', reason: 'the candidate tree does not resolve the approved candidate version: ' + versionsDetail })
    }
    const constraints = engineConstraintCheck({ engines: resolved.engines })
    state.gaps.push(...constraints.gaps)
    const evaluated = constraints.items.filter((item) => item.evaluated)
    const constraintsMatch = evaluated.every((item) => item.match === true)
    const constraintsDetail = constraints.items.length === 0
      ? 'neither engine declares a version constraint on the other'
      : constraints.items.map((item) => item.component + ' declares ' + item.package + ' ' + item.declared + ', resolved ' + String(item.resolved) + (item.evaluated ? (item.match ? ' (satisfied)' : ' (NOT satisfied)') : ' (not evaluated: outside the ranges this run reads)')).join('; ')
    state.checks.push({ name: 'engine-version-constraints', status: evaluated.length === 0 ? 'n/a' : constraintsMatch ? 'pass' : 'fail', detail: constraintsDetail })
    if (evaluated.length > 0 && !constraintsMatch) {
      state.failures.push({ name: 'engine-version-constraints', reason: 'an engine\'s declared version constraint is not satisfied by what the candidate tree resolves' })
    }
    const digestOkay = digests.entries.every((entry) => entry.match)
    state.checks.push({
      name: 'patch-digests-on-disk',
      status: digests.entries.length === 0 ? 'n/a' : digestOkay ? 'pass' : 'fail',
      detail: digests.entries.length === 0
        ? 'this proposal recorded no patch digest'
        : digests.entries.map((entry) => basename(entry.path) + ' recorded ' + entry.recorded.slice(0, 12) + '… now ' + String(entry.now).slice(0, 12) + (entry.match ? ' (match)' : ' (MISMATCH)')).join('; '),
    })
    if (!digestOkay) state.failures.push({ name: 'patch-digests-on-disk', reason: 'a recorded patch digest no longer matches the bytes in the candidate tree' })

    // 4) the proposal's declared gates, in order, stopping at the first failure.
    const verification = Array.isArray(proposal?.changes?.verification) ? proposal.changes.verification : []
    if (verification.length === 0) {
      state.gaps.push('this proposal declares no verification command, so no gate was executed: an empty gate list is never a pass (upgrade propose lists the repository\'s own scripts)')
    }
    for (const [index, entry] of verification.entries()) {
      const name = typeof entry?.name === 'string' ? entry.name : 'gate-' + (index + 1)
      if (state.failures.length > 0) {
        state.skipped.push({ name, reason: 'an earlier step failed or was refused: the gate was NOT executed (UPG-09 keeps the failure as it is)' })
        continue
      }
      if (cancel(name) === true) {
        state.skipped.push({ name, reason: 'cancelled before this gate started' })
        continue
      }
      const argv = splitDeclared(entry)
      if (argv === undefined) {
        state.skipped.push({ name, reason: 'the proposal declares no runnable command for this entry (no packageManager means no run prefix was assumed), so it was not executed' })
        state.gaps.push('gate ' + name + ' has no runnable command in the proposal: ' + JSON.stringify(entry?.script ?? null))
        continue
      }
      const recorded = await runOne(state, { name, source: 'proposal-changes', command: argv.command, args: argv.args, cwd: tree })
      if (!passed(recorded)) state.failures.push({ name, reason: whyNot(recorded) })
    }

    // 5) the short link over the candidate tree (test-profile.mjs's shape, pointed here).
    if (state.failures.length > 0) {
      state.skipped.push({ name: 'read-edit-short-link', reason: 'an earlier step failed: the short link was NOT executed' })
    } else if (resolved.engines.hashline?.version === 'unknown') {
      // The link loads read and edit through the candidate tree's own engines; with
      // no resolved engine there is nothing to link, and "not executed" is the only
      // honest record.
      state.skipped.push({ name: 'read-edit-short-link', reason: 'the candidate tree resolves no hashline engine, so the link was NOT executed' })
    } else if (cancel('read-edit-short-link') === true) {
      state.skipped.push({ name: 'read-edit-short-link', reason: 'cancelled before the short link started' })
    } else {
      const driver = join(tree, ...SHORT_LINK_DRIVER_PATH)
      await mkdir(dirname(driver), { recursive: true })
      await writeFile(driver, shortLinkDriver(), 'utf8')
      const recorded = await runOne(state, { name: 'read-edit-short-link', source: 'own-check', command: managerCommand('node'), args: [driver, tree], cwd: tree })
      const outcome = parseDriverOutcome(recorded)
      state.checks.push({ name: 'read-edit-short-link', status: outcome.status, detail: outcome.detail, ...recorded.exitCode === null ? {} : { exitCode: recorded.exitCode }, durationMs: recorded.durationMs })
      if (outcome.status === 'gap') state.gaps.push('read→edit short link: ' + outcome.detail)
      if (outcome.status === 'fail') state.failures.push({ name: 'read-edit-short-link', reason: outcome.detail })
    }
    state.checks.push({
      name: 'patch-marker-evidence',
      status: state.patchItems.length === 0 ? 'n/a'
        : state.patchItems.some((item) => item.resolved === 'unknown') ? 'gap'
          : state.patchItems.every((item) => item.satisfied === true) ? 'pass' : 'fail',
      detail: state.patchItems.length === 0
        ? 'this proposal carries no patch decision'
        : state.patchItems.map((item) => item.component + '/' + basename(item.file) + ' ' + item.decision + ' expects ' + item.expected + ' resolved ' + item.resolved).join('; '),
    })

    // 6) the re-collected candidate baseline and its critical unknowns.
    const criticalUnknowns = []
    if (includedInputs.commit === 'unknown') criticalUnknowns.push('the maintenance repository commit is unknown, so the validated input set is not pinned')
    if (includedInputs.lockfileSha256 === 'missing') criticalUnknowns.push('the candidate tree carries no lockfile, so the resolved dependency combination is not pinned')
    for (const entry of includedInputs.files) {
      if (entry.sha256 !== 'missing' && entry.sha256 !== 'unreadable') continue
      criticalUnknowns.push('the uncommitted input ' + entry.path + ' is ' + entry.sha256 + ' in the candidate tree, so that input was NOT validated')
    }
    for (const entry of resolved.unknown) criticalUnknowns.push(entry)
    for (const entry of versions.unknown) criticalUnknowns.push(entry)
    if (!digestOkay) criticalUnknowns.push('a recorded patch digest does not match the candidate tree')
    const candidateBaseline = {
      collectedAt: options.now,
      tree,
      commit: includedInputs.commit,
      engines: resolved.engines,
      resolution: resolved.resolution,
      patchDigests: digests.entries,
      // The digest AFTER the install: the input digest is the one in
      // includedInputs, and the two must not be confused.
      lockfileSha256: digestOfFile(join(tree, 'pnpm-lock.yaml')).digest,
      constraints,
      unknown: [...resolved.unknown, ...versions.unknown],
      note: '候选树自己的解析结果：版本号不是补丁证据，标记文本才是（所以这里是 patchEvidence 的结论，不是 package.json 的版本）。lockfileSha256 是安装后的摘要。',
    }
    const verdict = verdictOf({ state, criticalUnknowns })
    const switchAuthorized = options.basis?.scope?.switch === true
    return {
      tool: CANDIDATE_TOOL,
      version: CANDIDATE_VERSION,
      generatedAt: options.now,
      proposalId: proposal?.proposalId ?? 'unknown',
      proposalHash: proposal?.proposalHash ?? 'unknown',
      baselineHash: proposal?.baselineHash ?? 'unknown',
      proposalDirectory: options.proposalDirectory,
      candidateDirectory: options.candidateDirectory,
      evidenceDirectory: options.evidenceDirectory,
      tree,
      treeEntries: copy.topLevelEntries,
      runner: {
        source,
        note: source === 'injected'
          ? '本次命令结果来自注入的 runner（测试夹具），不是真实子进程；报告如实标注来源。'
          : '本次命令由真实子进程执行（win32 走 shell: true，见 scripts/test-profile.mjs 的 run()）。',
      },
      verdict,
      authorization: { ...(options.basis ?? {}), rule: '最后一条同意记录必须对本 proposalHash 为 approve、scope.candidateValidation === true；基线重新采集后未漂移；方案位于证据树内；调用会话不是子 agent。' },
      includedInputs,
      dependencyUpdates: dependencies.updates,
      candidateBaseline,
      patchDecisions: applied.items,
      patchResults: state.patchItems,
      patchFiles: applied.files,
      workspaceChanges: applied.changed,
      checks: state.checks,
      commands: state.commands,
      skipped: state.skipped,
      gaps: state.gaps,
      criticalUnknowns,
      pendingVerification: criticalUnknowns.length > 0,
      failures: state.failures,
      stop: state.failures.length > 0
        ? {
          rule: 'UPG-09',
          note: '候选需要方案外的实现、语义或测试契约改动时，本工作流保留失败现场并停止：不放宽断言、不把测试改绿、不扩大修复范围。',
          next: 'upgrade propose (a plan-outside change needs a new proposal and a new answer)',
        }
        : null,
      versions: {
        before: {
          dsh: proposal?.baseline?.versions?.dsh ?? 'unknown',
          hashline: proposal?.baseline?.versions?.hashline ?? 'unknown',
          toolEdit: proposal?.baseline?.versions?.toolEdit ?? 'unknown',
        },
        after: {
          dsh: proposal?.baseline?.versions?.dsh ?? 'unknown',
          hashline: resolved.engines.hashline?.version ?? 'unknown',
          toolEdit: resolved.engines['tool-edit']?.version ?? 'unknown',
        },
        approved: Object.fromEntries((Array.isArray(proposal?.candidates) ? proposal.candidates : []).map((entry) => [entry.component, entry.version ?? null])),
        note: '官方 DSH 不在本工作流的执行范围内（UPG-08），所以它的版本只被报告，不被改动；候选组合的版本由 candidate-versions-match 核验，不是只写在这里。',
      },
      scope: {
        switchAuthorized,
        switched: false,
        installedInto: 'the candidate tree only',
        note: '候选验证只安装到候选树；目标切换、失败回滚与目标安装树的改动属于票据 07，本轮未执行。',
      },
      statements: {
        mayClaimSecondPhasePrecondition: verdict === 'candidate-verified',
        mayClaimUpgraded: false,
        mayClaimSemanticRegression: false,
        targetUntouched: true,
        dailyProfileUntouched: true,
        officialInstallUntouched: true,
        note: '只有 candidate-verified 才能写「满足第二阶段同意的前置条件」；本报告只描述候选树内的验证结果，不声称目标已切换、不声称版本已在目标上生效，也不声称上游语义回归已经判定。',
      },
      next: nextStepOf(verdict, switchAuthorized),
      nextNote: nextNoteOf(verdict, switchAuthorized),
    }
  } finally {
    if (interrupt !== undefined) interrupt.dispose()
  }
}

/**
 * The package manager a candidate tree declares.
 *
 * A declared manager this run does not drive is a NAMED gap, not a silent
 * rewrite: falling back to pnpm without saying so would hide which manager the
 * tree expects.
 * @param {string} tree the candidate tree
 * @returns {{manager: string, problem?: string}} the manager and, when it was replaced, why
 */
export function managerOf(tree, label = 'the candidate tree') {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(tree, 'package.json'), 'utf8'))
  } catch (error) {
    return { manager: 'pnpm', problem: label + '\'s package.json is unreadable (' + (error instanceof Error ? error.message : String(error)) + '), so pnpm was assumed for the install' }
  }
  const declared = typeof manifest.packageManager === 'string' ? manifest.packageManager.trim() : ''
  const name = /^(@[^/]+\/[^@]+|[^@]+)/u.exec(declared)?.[1]
  if (name === undefined) return { manager: 'pnpm', problem: label + ' declares no packageManager, so pnpm was assumed for the install' }
  if (name === 'pnpm' || name === 'npm') return { manager: name }
  return { manager: 'pnpm', problem: label + ' declares ' + name + ' as its package manager, which this run does not drive (pnpm/npm only): pnpm was used instead' }
}

/**
 * The argv a declared verification entry runs as.
 *
 * `run` is the repository's own declared prefix (`pnpm check:preset`); when the
 * repository declared no package manager, `run` is null and there is nothing to
 * execute — the entry is a named gap, never an invented command.
 * @param {object} entry the proposal's verification entry
 * @returns {{command: string, args: string[]} | undefined} the argv
 */
export function splitDeclared(entry) {
  const run = typeof entry?.run === 'string' && entry.run.trim() !== '' ? entry.run.trim() : undefined
  if (run === undefined) return undefined
  const parts = run.split(/\s+/u)
  const name = parts[0].replace(/\.(cmd|exe|bat)$/iu, '')
  if (!MANAGERS.includes(name)) return undefined
  return { command: managerCommand(name), args: parts.slice(1) }
}

/**
 * One patch item's mechanical state versus the resolved build.
 *
 * The label names the tree the markers were read out of, so the candidate run and
 * the target switch report the same verdict in their own words.
 * @param {object} item the proposal's decision item
 * @param {object} engines the resolved engines
 * @param {string} [label] the tree the resolved build was read from
 * @returns {object} the verdict
 */
export function resolvedPatchItem(item, engines, label = '候选树') {
  const engine = engines[item.component] ?? {}
  const present = Array.isArray(engine.patch?.present) ? engine.patch.present : []
  const missing = Array.isArray(engine.patch?.missing) ? engine.patch.missing : []
  const resolved = present.includes(item.marker) ? 'present' : missing.includes(item.marker) ? 'absent' : 'unknown'
  const undecided = item.decision === 'pending-verification'
  const expected = undecided ? 'undecided' : item.decision === 'delete' ? 'absent' : 'present'
  const disagreed = item.declared !== undefined && item.declared !== 'unknown' && item.declared !== resolved
  const measured = undecided
    ? '该项仍是 pending-verification：本步不把它收敛成 keep，需要新方案给出 keep/redo/delete。'
    : item.decision === 'delete'
      ? (resolved === 'absent'
        ? '本步只证明补丁文件与注册行已按 delete 决策移除、构建里不再出现该标记；上游是否已实现同一行为（语义回归）不在本步测量。'
        : '决策是 delete，但候选构建里仍有该标记：补丁没有被真正摘掉，需要重切（方案外实现）。')
      : (resolved === 'present'
        ? '标记在' + label + '解析到的构建文件里仍存在：本步只证明补丁仍作用于该构建，语义兼容性由方案与人工确认。'
        : '标记在' + label + '的构建里不存在：补丁没有生效，需要重切（方案外实现）。')
  return {
    component: item.component,
    file: item.file,
    marker: item.marker,
    decision: item.decision,
    apply: item.apply ?? 'unknown',
    declared: item.declared ?? 'unknown',
    expected,
    resolved,
    satisfied: !undecided && resolved === expected,
    // Whether upstream now owns the behaviour is the PROPOSAL's judgement from its
    // sources (UPG-02); measuring "the patch applied" is not that judgement.
    semanticRegression: 'not-measured',
    requiresRecut: undecided ? false : item.requiresRecut === true || (item.decision === 'redo' && resolved !== 'present'),
    patchFile: item.patchFile ?? null,
    note: (disagreed ? '声明的候选包文本记为 ' + item.declared + '，解析到的构建是 ' + resolved + '：以实际解析到的构建为准（版本号与声明都不构成补丁证据）。' : '') + measured,
  }
}

/** Parse the driver's last JSON line into a check outcome. */
export function parseDriverOutcome(recorded) {
  const line = String(recorded.stdout ?? '').trim().split('\n').filter((entry) => entry.trim() !== '').at(-1)
  let parsed
  try {
    parsed = line === undefined ? undefined : JSON.parse(line)
  } catch (error) {
    parsed = { status: 'failed', error: 'the short-link driver wrote no parsable result: ' + (error instanceof Error ? error.message : String(error)) }
  }
  if (parsed?.status === 'ok') return { status: 'pass', detail: 'read → PUT → read landed in the candidate tree (tag ' + String(parsed.tag) + ')' }
  if (parsed?.status === 'gap') return { status: 'gap', detail: String(parsed.detail ?? 'the candidate tree cannot run the short link') + (Array.isArray(parsed.missing) ? ': ' + parsed.missing.join(', ') : '') }
  const reason = parsed?.error ?? parsed?.detail
  return {
    status: 'fail',
    detail: reason === undefined
      ? 'the short-link driver did not report a result (exit code ' + String(recorded.exitCode) + (recorded.timedOut === true ? ', timed out' : '') + '): ' + clip(String(recorded.stderr ?? ''), 400)
      : String(reason),
  }
}

/**
 * The verdict, in one place.
 *
 * `failed` is reserved for a measured failure (a gate, a check, a patch item);
 * everything unmeasured — a critical unknown, a skipped step, a gap — can only
 * reach `incomplete`. A "verified" that skipped a gate is the one claim this
 * workflow must never make (UPG-06). A check with nothing to measure is `n/a`,
 * which neither passes nor fails.
 * @param {{state: object, criticalUnknowns: string[]}} options the run's facts
 * @returns {'candidate-verified'|'candidate-failed'|'candidate-incomplete'} the verdict
 */
export function verdictOf(options) {
  const state = options.state
  const executed = state.commands.filter((entry) => entry.source === 'proposal-changes' && entry.refused === undefined)
  if (state.failures.length > 0) return 'candidate-failed'
  if (options.criticalUnknowns.length > 0) return 'candidate-incomplete'
  if (state.skipped.length > 0) return 'candidate-incomplete'
  if (state.gaps.length > 0) return 'candidate-incomplete'
  if (state.checks.some((check) => check.status === 'fail')) return 'candidate-failed'
  if (state.checks.some((check) => check.status === 'gap')) return 'candidate-incomplete'
  if (executed.length === 0) return 'candidate-incomplete'
  return 'candidate-verified'
}

/**
 * What the caller should do next, as the command name every other `next` uses.
 * @param {string} verdict the verdict
 * @param {boolean} switchAuthorized whether the approval covered both phases
 * @returns {string} the next step
 */
function nextStepOf(verdict, switchAuthorized) {
  if (verdict !== 'candidate-verified') return 'upgrade propose (a new proposal and a new answer)'
  if (switchAuthorized) return 'ticket 07 (the target switch is not implemented; nothing was switched)'
  return 'ask the user whether to switch the target (ticket 07 is not implemented)'
}

/**
 * The same next step as prose for the human report.
 * @param {string} verdict the verdict
 * @param {boolean} switchAuthorized whether the approval covered both phases
 * @returns {string} the Chinese sentence validation.md shows
 */
function nextNoteOf(verdict, switchAuthorized) {
  if (verdict !== 'candidate-verified') {
    return '候选未通过或不完整：不切换目标、不改日常 profile；按失败原因另提方案（upgrade propose）并取得新的用户同意。'
  }
  if (switchAuthorized) {
    return '候选已满足第二阶段的前置条件；用户已在同一次回复里批准两阶段，但目标切换属于票据 07（尚未实现），本轮只交付前置条件，未切换任何目标。'
  }
  return '候选已满足第二阶段（目标切换）的同意前置条件；按 D4 先请用户明确是否切换目标。票据 07 的目标切换尚未实现，本轮不切换。'
}

/** The generated short-link driver, written inside the candidate tree. */
export function shortLinkDriver() {
  return [
    "import { createRequire } from 'node:module'",
    "import { pathToFileURL } from 'node:url'",
    "import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'",
    "import { tmpdir } from 'node:os'",
    "import { join } from 'node:path'",
    '',
    'const tree = process.argv[2]',
    "if (typeof tree !== 'string' || tree === '') {",
    "  console.log(JSON.stringify({ status: 'failed', error: 'the candidate tree was not given' }))",
    '  process.exit(4)',
    '}',
    "const require_ = createRequire(join(tree, 'package.json'))",
    "const NEEDED = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-fs-local', '@deepseek-ai/dsh-fs-observation-policy', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools', '@dsh-tool-hashline/tool-read', '@dsh-tool-hashline/tool-edit']",
    'const missing = []',
    'const entries = {}',
    'for (const specifier of NEEDED) {',
    '  try { entries[specifier] = pathToFileURL(require_.resolve(specifier)).href } catch { missing.push(specifier) }',
    '}',
    'if (missing.length > 0) {',
    "  console.log(JSON.stringify({ status: 'gap', detail: 'the candidate tree does not carry the host runtime this short link needs', missing }))",
    '  process.exit(' + SHORT_LINK_GAP_EXIT + ')',
    '}',
    'try {',
    "  const { Context } = await import(entries['@deepseek-ai/cordis'])",
    "  const LocalFileSystem = (await import(entries['@deepseek-ai/dsh-fs-local'])).default",
    "  const FsPolicy = await import(entries['@deepseek-ai/dsh-fs-observation-policy'])",
    "  const SystemPrompt = (await import(entries['@deepseek-ai/dsh-system-prompt'])).default",
    "  const ToolRuntime = (await import(entries['@deepseek-ai/dsh-tools'])).default",
    "  const ToolRead = await import(entries['@dsh-tool-hashline/tool-read'])",
    "  const ToolEdit = await import(entries['@dsh-tool-hashline/tool-edit'])",
    "  const dir = mkdtempSync(join(tmpdir(), 'candidate-short-link-'))",
    "  const file = join(dir, 'target.txt')",
    "  writeFileSync(file, 'one\\ntwo\\nthree\\n')",
    '  const ctx = new Context()',
    '  await ctx.plugin(SystemPrompt, {})',
    '  await ctx.plugin(LocalFileSystem, { cwd: dir })',
    '  await ctx.plugin(FsPolicy)',
    "  ctx.provide('workingDirectory', { defaultDirectory: dir, get: () => dir, ensure: () => Promise.resolve(dir) })",
    '  const runtime = new ToolRuntime(ctx)',
    '  await ctx.plugin(ToolRead, {})',
    "  await ctx.plugin(ToolEdit, { mode: 'auto' })",
    '  const agent = { session: { cwd: dir, header: { cwd: dir } } }',
    '  const signal = new AbortController().signal',
    "  const read = await runtime.execute({ callId: 'candidate-read', name: 'read', arguments: { file_path: 'target.txt' }, signal, agent })",
    "  if (read.isError) throw new Error('the read leg failed: ' + read.error.message)",
    '  const tag = read.value.tag',
    "  if (typeof tag !== 'string' || !/^[0-9A-F]{4}$/u.test(tag)) throw new Error('the read leg minted no tag: ' + JSON.stringify(read.value))",
    "  const edit = await runtime.execute({ callId: 'candidate-edit', name: 'edit', arguments: { input: '[' + read.value.path + '#' + tag + ']\\nPUT 2.=2:\\n+TWO' }, signal, agent })",
    "  if (edit.isError) throw new Error('the edit leg failed: ' + edit.error.message)",
    "  const after = readFileSync(file, 'utf8')",
    "  if (after !== 'one\\nTWO\\nthree\\n') throw new Error('the edit leg wrote unexpected bytes: ' + JSON.stringify(after))",
    "  console.log(JSON.stringify({ status: 'ok', tag, disk: after }))",
    '} catch (error) {',
    "  console.log(JSON.stringify({ status: 'failed', error: String(error && error.message ? error.message : error) }))",
    '  process.exit(4)',
    '}',
    '',
  ].join('\n')
}

// ── writing and rendering ───────────────────────────────────────────────────

/**
 * Write the two files this command may write.
 *
 * `result.json` sits beside the candidate tree; `validation.md` sits beside the
 * proposal. Neither proposal.json nor consent.json is rewritten: the approval
 * stays exactly as it was given.
 * @param {{report: object, proposalDirectory: string}} options the report and where it goes
 * @returns {Promise<{result: string, report: string}>} the written paths
 */
export async function writeCandidateReport(options) {
  const rendered = renderValidationReport(options.report)
  const files = {
    result: join(options.report.candidateDirectory, 'result.json'),
    report: join(options.proposalDirectory, 'validation.md'),
  }
  await mkdir(options.report.candidateDirectory, { recursive: true })
  await writeFile(files.result, JSON.stringify(options.report, null, 2) + '\n', 'utf8')
  await writeFile(files.report, rendered + '\n', 'utf8')
  return files
}

/** The verdict's one line, in the words the claim boundary allows. */
function verdictLine(report) {
  if (report.verdict === 'candidate-verified') {
    return 'candidate-verified：方案列出的门禁全部实际执行且通过，候选版本与解析到的构建一致，补丁决策的机械结果成立。满足第二阶段（目标切换）同意的前置条件；本轮未切换任何目标。'
  }
  if (report.verdict === 'candidate-failed') return 'candidate-failed：有门禁/核验项实测失败。不切换目标，保留失败现场并另提方案（UPG-09）。'
  return 'candidate-incomplete：有步骤未执行、缺项或关键基线为 unknown。不得当作通过，也不切换目标。'
}

/**
 * Render validation.md: the one human report this command writes.
 * @param {object} report the result
 * @returns {string} markdown
 */
export function renderValidationReport(report) {
  const quoted = (value) => '`' + (value === undefined || value === null || value === '' ? 'unknown' : String(value)) + '`'
  const lines = []
  lines.push('# 隔离候选验证 — ' + report.proposalId)
  lines.push('')
  lines.push('- 结论：**' + report.verdict + '**')
  lines.push('- ' + verdictLine(report))
  lines.push('- 生成时间：' + quoted(report.generatedAt))
  lines.push('- proposalHash：' + quoted(report.proposalHash) + '，baselineHash：' + quoted(report.baselineHash))
  lines.push('- 候选目录：' + quoted(report.candidateDirectory))
  lines.push('- 候选树：' + quoted(report.tree) + '（维护仓库快照，含未提交输入）')
  lines.push('- 命令来源：' + (report.runner?.source === 'injected' ? '注入的 runner（测试夹具，非真实子进程）' : '真实子进程（win32 走 shell: true）'))
  lines.push('')
  lines.push('## 授权依据')
  lines.push('')
  lines.push('- 决策：' + quoted(report.authorization?.decision) + '，授权范围：candidateValidation=' + String(report.authorization?.scope?.candidateValidation) + '、switch=' + String(report.authorization?.scope?.switch))
  lines.push('- 同意记录绑定 proposalHash ' + quoted(report.authorization?.proposalHash) + '、baselineHash ' + quoted(report.authorization?.baselineHash))
  lines.push('- 用户回复：seq ' + quoted(report.authorization?.reply?.seq) + '（来源 ' + quoted(report.authorization?.reply?.source) + '），记录时间 ' + quoted(report.authorization?.repliedAt) + '，记录者 ' + quoted(report.authorization?.recorder?.sessionId) + '/' + quoted(report.authorization?.recorder?.role))
  lines.push('- 闸门：' + String(report.authorization?.rule ?? ''))
  lines.push('')
  lines.push('## includedInputs（本次验证实际包含的输入）')
  lines.push('')
  lines.push('- commit：' + quoted(report.includedInputs?.commit) + '，dirty：' + quoted(report.includedInputs?.dirty))
  lines.push('- lockfile sha256（安装前）：' + quoted(report.includedInputs?.lockfileSha256))
  if ((report.includedInputs?.files ?? []).length === 0) {
    lines.push('- 未提交输入：无（候选树就是已提交状态的快照）')
  } else {
    for (const entry of report.includedInputs.files) {
      const note = entry.sha256 === 'missing' || entry.sha256 === 'unreadable' ? '（**不在候选树里：视作未验证**）' : ''
      lines.push('- 未提交输入：' + quoted(entry.path) + ' sha256 ' + quoted(entry.sha256) + note)
    }
  }
  for (const entry of report.includedInputs?.patchFiles ?? []) lines.push('- patch：' + quoted(entry.path) + ' sha256 ' + quoted(entry.sha256))
  lines.push('')
  lines.push('## 候选依赖更新（把批准的版本钉进候选树）')
  lines.push('')
  if ((report.dependencyUpdates ?? []).length === 0) {
    lines.push('本方案没有可钉的候选依赖版本（见缺口清单）。')
  } else {
    lines.push('| 包 | 字段 | 原声明 | 候选版本 | 已改 |')
    lines.push('|---|---|---|---|---|')
    for (const entry of report.dependencyUpdates) {
      lines.push('| ' + entry.package + ' | ' + entry.field + ' | ' + quoted(entry.from) + ' | ' + quoted(entry.to) + ' | ' + (entry.changed ? '是' : '否（已是该版本）') + ' |')
    }
  }
  lines.push('')
  lines.push('## 逐条命令（退出码与耗时）')
  lines.push('')
  if ((report.commands ?? []).length === 0) {
    lines.push('本次没有执行任何命令（候选目录下也没有 logs/）。')
  } else {
    lines.push('| 名称 | 来源 | 命令 | 退出码 | 耗时(ms) | 结果 |')
    lines.push('|---|---|---|---|---|---|')
    for (const entry of report.commands) {
      const result = entry.refused !== undefined ? 'refused: ' + entry.refused : entry.timedOut === true ? '超时' : entry.exitCode === 0 ? 'pass' : 'FAIL'
      lines.push('| ' + entry.name + ' | ' + entry.source + ' | ' + quoted(entry.command + ' ' + entry.args.join(' ')) + ' | ' + String(entry.exitCode) + ' | ' + String(entry.durationMs) + ' | ' + result + ' |')
    }
    lines.push('')
    lines.push('每条命令的完整输出在候选目录的 `logs/` 下（一条命令一份；`result.json` 里的文本是裁剪过的）。')
  }
  lines.push('')
  const failed = (report.commands ?? []).filter((entry) => entry.refused === undefined && (entry.timedOut === true || entry.exitCode !== 0))
  if (failed.length > 0) {
    lines.push('### 失败原文')
    lines.push('')
    for (const entry of failed) {
      lines.push('- **' + entry.name + '**（退出码 ' + String(entry.exitCode) + (entry.timedOut === true ? '，超时' : '') + '）')
      const locations = failureLocations(entry)
      if (locations.length > 0) lines.push('  - 位置：' + locations.map((entryLocation) => '`' + entryLocation + '`').join('、'))
      const text = String(entry.stderr ?? '').trim() !== '' ? String(entry.stderr).trim() : String(entry.stdout ?? '').trim()
      for (const line of text.split('\n').slice(-20)) lines.push('  - ' + line)
    }
    lines.push('')
  }
  lines.push('## 逐项补丁结果与标记证据')
  lines.push('')
  lines.push('本步只判定补丁的**机械结果**（文件与注册是否按决策移动/删除、解析到的构建里标记在不在）。上游是否已实现同一行为（**语义回归**）由方案依据来源申报判断（UPG-02），本步不测量，也不以「补丁能否应用」代替它。')
  lines.push('')
  if ((report.patchResults ?? []).length === 0) {
    lines.push('本方案没有逐项补丁决策。')
  } else {
    lines.push('| 组件 | 文件 | 决策 | 机械动作 | 期望 | 解析结果 | 成立 | 语义回归 |')
    lines.push('|---|---|---|---|---|---|---|---|')
    for (const item of report.patchResults) {
      lines.push('| ' + item.component + ' | ' + quoted(item.file) + ' | ' + item.decision + ' | ' + item.apply + ' | ' + String(item.expected) + ' | ' + item.resolved + ' | ' + (item.satisfied ? '是' : '否') + ' | ' + String(item.semanticRegression ?? 'not-measured') + ' |')
    }
    lines.push('')
    for (const item of report.patchResults) lines.push('- ' + item.component + ' / ' + quoted(item.marker) + '：' + item.note)
  }
  if ((report.patchFiles ?? []).length > 0) {
    lines.push('')
    for (const entry of report.patchFiles) lines.push('- patch 文件：' + quoted(entry.from) + ' → ' + (entry.to === null ? '已删除' : quoted(entry.to)) + '（' + entry.action + '）')
  }
  if ((report.workspaceChanges ?? []).length > 0) {
    lines.push('')
    for (const entry of report.workspaceChanges) lines.push('- patchedDependencies：' + entry)
  }
  lines.push('')
  lines.push('## 解析路径、共享实例与版本核验')
  lines.push('')
  lines.push('- hashline realpath：' + quoted(report.candidateBaseline?.engines?.hashline?.realpath) + '（版本 ' + quoted(report.candidateBaseline?.engines?.hashline?.version) + '）')
  lines.push('- tool-edit realpath：' + quoted(report.candidateBaseline?.engines?.['tool-edit']?.realpath) + '（版本 ' + quoted(report.candidateBaseline?.engines?.['tool-edit']?.version) + '）')
  lines.push('- read 侧解析：' + quoted(report.candidateBaseline?.resolution?.readSide) + '（已解析：' + String(report.candidateBaseline?.resolution?.readSideResolved) + '）')
  lines.push('- edit 侧解析：' + quoted(report.candidateBaseline?.resolution?.editSide) + '（已解析：' + String(report.candidateBaseline?.resolution?.editSideResolved) + '）')
  lines.push('- 同一物理实例：' + String(report.candidateBaseline?.resolution?.samePhysicalInstance) + '，落在候选树内：' + String(report.candidateBaseline?.resolution?.insideCandidateTree))
  for (const check of report.checks ?? []) lines.push('- 核验项 ' + check.name + '：' + check.status + ' — ' + check.detail)
  if ((report.candidateBaseline?.patchDigests ?? []).length > 0) {
    lines.push('')
    lines.push('- patch 摘要核对：')
    for (const entry of report.candidateBaseline.patchDigests) lines.push('  - ' + quoted(entry.path) + ' 记录 ' + quoted(entry.recorded) + ' / 磁盘 ' + quoted(entry.now) + '：' + (entry.match ? '一致' : '不一致'))
  }
  if ((report.candidateBaseline?.constraints?.items ?? []).length > 0) {
    lines.push('')
    lines.push('- 引擎之间声明的版本约束：')
    for (const entry of report.candidateBaseline.constraints.items) {
      const verdict = entry.evaluated ? (entry.match ? '满足' : '**不满足**') : '未求值（超出本步读取的范围语法）'
      lines.push('  - ' + entry.component + ' 的 ' + entry.field + ' 声明 ' + quoted(entry.package) + ' ' + quoted(entry.declared) + ' / 解析到 ' + quoted(entry.resolved) + '：' + verdict)
    }
  }
  lines.push('')
  lines.push('## 跳过、缺项与 GAP')
  lines.push('')
  const skipped = report.skipped ?? []
  const gaps = report.gaps ?? []
  const unknowns = report.criticalUnknowns ?? []
  if (skipped.length === 0 && gaps.length === 0 && unknowns.length === 0) {
    lines.push('无：所有门禁都实际执行，没有跳过、缺项或关键 unknown。')
  } else {
    for (const entry of skipped) lines.push('- 跳过 ' + entry.name + '：' + entry.reason)
    for (const entry of gaps) lines.push('- 缺项/GAP：' + entry)
    for (const entry of unknowns) lines.push('- 关键 unknown：' + entry)
    lines.push('')
    lines.push('以上各项都**不计入通过**：skipped、缺项与 GAP 一律如实写出。')
  }
  lines.push('')
  lines.push('## 最终版本组合')
  lines.push('')
  lines.push('- 验证前：hashline ' + quoted(report.versions?.before?.hashline) + '、tool-edit ' + quoted(report.versions?.before?.toolEdit) + '、DSH ' + quoted(report.versions?.before?.dsh))
  lines.push('- 方案批准：hashline ' + quoted(report.versions?.approved?.hashline) + '、tool-edit ' + quoted(report.versions?.approved?.['tool-edit']))
  lines.push('- 候选树实际：hashline ' + quoted(report.versions?.after?.hashline) + '、tool-edit ' + quoted(report.versions?.after?.toolEdit) + '、DSH ' + quoted(report.versions?.after?.dsh))
  lines.push('- ' + String(report.versions?.note ?? ''))
  lines.push('')
  lines.push('## 边界声明')
  lines.push('')
  lines.push('- 未切换目标：' + String(report.scope?.switched === false) + '（目标切换、失败回滚属于票据 07）。')
  lines.push('- 只安装到候选树：' + quoted(report.scope?.installedInto) + '；维护仓库工作树、仓库根 .pnpm-store 与全局 store 均未写入。')
  lines.push('- 未改日常 profile、未动官方 DSH 安装、未重启或关闭 DSH。')
  lines.push('- 用户是否已一次批准两阶段：' + String(report.scope?.switchAuthorized) + '；本轮仍只交付前置条件。')
  lines.push('- 语义回归是否已判定：' + String(report.statements?.mayClaimSemanticRegression) + '（本步只给机械证据）。')
  lines.push('')
  lines.push('## 下一步')
  lines.push('')
  lines.push('- ' + String(report.nextNote ?? report.next ?? ''))
  if (report.stop !== null && report.stop !== undefined) {
    lines.push('- 停止条件 ' + report.stop.rule + '：' + report.stop.note)
    lines.push('- 下一步：' + String(report.stop.next))
  }
  lines.push('- 只有 candidate-verified 才能说「满足第二阶段同意的前置条件」；本报告只描述候选树内的验证结果，任何情况都不声称目标已切换或版本已在目标上生效。')
  lines.push('')
  return lines.join('\n')
}





