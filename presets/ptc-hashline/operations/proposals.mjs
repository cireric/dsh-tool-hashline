/**
 * The reviewable upgrade proposal and the consent record (ticket 05's seam,
 * UPG-03/05/06/07 and SCOPE-06's execution branch).
 *
 * Three boundaries shape this module:
 *
 * - A proposal is built from an ALREADY WRITTEN assessment; nothing here
 *   assesses, queries or downloads. It only refuses: a run that did not reach
 *   `recommend-candidate` with at least one recommended component has no
 *   candidate to propose, so no proposal file is created.
 * - The proposal is a payload with an identity. Every bound input (baseline
 *   hash, candidates, per-item patch decisions, target, scope, verification,
 *   rollback) is hashed into `proposalHash`; the id is
 *   `<stamp>-<hash[0..12]>`, so another payload is another directory and an
 *   old approval can never cover it.
 * - Consent is a RECORD, not an execution: it binds the user's verbatim reply,
 *   the time, the proposal hash, the baseline hash and the authorized target.
 *   The file is append-only — an existing record is never rewritten — and the
 *   status is derived from the LAST record, so "no record" is `pending`.
 *
 * Language follows the sibling modules (upgrades.mjs, incidents.mjs) rather than
 * one blanket rule: code comments are English, the JSON refusal "reason" strings
 * are English like every other operations command, and the prose a human reads —
 * proposal.md and the per-item reasons copied from the assessment — is Chinese.
 *
 * Nothing in this module installs, builds, switches, or writes anything outside
 * `<evidenceDirectory>/upgrades/<proposalId>/`: the candidate directory is
 * NAMED, never created. It records workflow traceability only; it does not claim
 * to defend against a local operator who forges their own log.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/proposals
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { isUserMessage, textOfBlocks } from './text.mjs'
import { SOURCE_KINDS, upgradeDirectory } from './upgrades.mjs'

/** Identity written into every proposal. */
export const PROPOSAL_TOOL = 'ptc-hashline-operations-upgrade-proposal'
/** Identity written into every consent file. */
export const CONSENT_TOOL = 'ptc-hashline-operations-upgrade-consent'
/** Schema version shared by both records. */
export const PROPOSAL_VERSION = 1
/** The only two answers a user can give. */
export const DECISIONS = ['approve', 'reject']
/** The scopes an approval can name. Anything else is a usage error. */
export const CONSENT_SCOPES = ['candidate-validation', 'validation-and-switch']
/**
 * Flags that try to make approval automatic. They are refused as a usage error
 * on every entry: a default acceptance is never the user's own reply.
 */
export const AUTO_APPROVAL_FLAGS = ['yes', 'y', 'approved', 'approve', 'auto', 'accept', 'accepted', 'assume-yes', 'non-interactive', 'force', 'confirmed', 'default-yes']
// The spec names --yes / --approved / --auto and "the like"; --force, --accept,
// --non-interactive, --confirmed, --assume-yes and --default-yes ARE that "like",
// and no command of this CLI accepts any of them. The refusal is enforced on the
// whole entry rather than on two commands, because the boundary belongs to the
// entry: a default acceptance is not a consent whoever passes it.

/**
 * The execution scope a proposal carries: candidate validation is proposed,
 * a switch is NOT — it needs an explicit one-time approval (UPG-07).
 */
export const PROPOSAL_SCOPE = {
  candidateValidation: true,
  switch: false,
  note: '默认只提议候选验证；目标切换需要用户在下一次明确答复里显式授予 validation-and-switch（UPG-07）。',
}

/** What this ticket is allowed to do, stated in the artifact itself. */
export const EXECUTION_BOUNDARY = {
  mode: 'consent-only',
  installed: false,
  built: false,
  switched: false,
  note: '本方案不安装、不构建、不执行验证命令、不切换目标；候选目录只被命名，尚未创建。',
}

/** The conditions that stop an approved upgrade before it lands (UPG-05/06/09/10/12). */
export const STOP_CONDITIONS = [
  '无回复、拒绝或含糊回复：停在等待/拒绝状态，不开始任何安装、构建或切换（UPG-03）。',
  '基线漂移：已提交或未提交输入变化（commit、未提交改动、lockfile、patches/*、引擎版本）即停止应用旧方案，重新评估并询问（UPG-05）。',
  '候选版本、补丁语义、目标 profile/路径或重要影响范围变化：旧同意不覆盖，另出方案重新询问（UPG-05）。',
  '候选验证失败：不切换目标，保留失败与原因（UPG-06）。',
  '出现方案外的实现、语义或测试契约改动：保留候选失败，停止并另提方案，不放宽断言（UPG-09）。',
  '目标受影响文件存在用户改动：停止该次切换，无关改动保留；不自动 stash、提交或回退（UPG-10）。',
  '目标切换部分失败或状态不明、目标已被外部改动、备份不完整：停止、留证并交接，不覆盖（UPG-12）。',
]

/** Digest one string. */
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Canonical JSON: object keys sorted at every depth, `undefined` members dropped.
 *
 * The hash must depend on the VALUES only: a JSON writer's key order or a
 * property added later must not silently change what a hash means.
 * @param {unknown} value the value to canonicalise
 * @returns {string} the canonical JSON text
 */
export function canonicalJson(value) {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize)
    if (entry !== null && typeof entry === 'object') {
      const out = {}
      for (const key of Object.keys(entry).sort()) {
        if (entry[key] === undefined) continue
        out[key] = normalize(entry[key])
      }
      return out
    }
    return entry
  }
  return JSON.stringify(normalize(value))
}

/**
 * The payload a proposal's identity is computed from.
 * @param {object} bound the bound inputs
 * @returns {string} the hex SHA-256
 */
export function proposalHashOf(bound) {
  return sha256(canonicalJson(bound))
}

/** A string field, or `'unknown'` — never an empty cell standing in for a fact. */
function textOf(value) {
  return typeof value === 'string' && value !== '' ? value : 'unknown'
}

/** Sorted patch digests, so their ORDER can never change a hash. */
function patchDigestsOf(repository) {
  return (Array.isArray(repository?.patchFiles) ? repository.patchFiles : [])
    .map((entry) => ({ path: textOf(entry?.path), sha256: textOf(entry?.sha256) }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * The baseline inputs a proposal is bound to.
 *
 * HEAD equality alone can never prove a file did not change, so the uncommitted
 * input list (`changedPaths` from porcelain) is part of the snapshot: an edited
 * lockfile and a NEW untracked file both move it (UPG-05, D10).
 * @param {object} baseline the collected baseline report
 * @returns {object} the bound baseline projection
 */
export function baselineSnapshot(baseline) {
  const repository = baseline?.repository ?? {}
  return {
    commit: textOf(repository.commit),
    dirty: textOf(repository.dirty),
    changedPaths: [...(Array.isArray(repository.changedPaths) ? repository.changedPaths : [])].map(String).sort(),
    lockfileSha256: textOf(repository.lockfileSha256),
    patchFiles: patchDigestsOf(repository),
    versions: {
      dsh: textOf(baseline?.versions?.dsh),
      hashline: textOf(baseline?.engines?.hashline?.version),
      toolEdit: textOf(baseline?.engines?.toolEdit?.version),
    },
    // A version number is not patch evidence; the resolved build's marker verdict is.
    patches: {
      hashline: textOf(baseline?.engines?.hashline?.patch?.status),
      toolEdit: textOf(baseline?.engines?.toolEdit?.patch?.status),
    },
  }
}

/**
 * The hash of one collected baseline.
 * @param {object} baseline the collected baseline report
 * @returns {string} the hex SHA-256
 */
export function baselineHashOf(baseline) {
  return sha256(canonicalJson(baselineSnapshot(baseline)))
}

/**
 * Whether an assessment supports a proposal at all (UPG-03).
 * @param {object} assessment the written assessment
 * @returns {{eligible: boolean, reason?: string, next?: string, components?: string[]}} the verdict
 */
export function proposalEligibility(assessment) {
  if (assessment === null || typeof assessment !== 'object' || Array.isArray(assessment)) {
    return { eligible: false, reason: 'the file is not an assessment this workflow wrote', next: 'upgrade assess' }
  }
  if (assessment.conclusion !== 'recommend-candidate') {
    return {
      eligible: false,
      reason: 'the assessment concluded ' + JSON.stringify(assessment.conclusion ?? null) + ', not "recommend-candidate": there is no candidate to propose (defer / insufficient-evidence / no-upgrade never becomes a proposal)',
      next: 'upgrade assess',
    }
  }
  const recommended = (Array.isArray(assessment.components) ? assessment.components : []).filter((component) => component?.recommended === true)
  if (recommended.length === 0) {
    return {
      eligible: false,
      reason: 'no component is marked recommended: a pending or deferred item is not an execution basis, so nothing is proposed',
      next: 'upgrade assess',
    }
  }
  return { eligible: true, components: recommended.map((component) => component.component) }
}

/**
 * The candidate combination a proposal names.
 * @param {object} assessment the assessment
 * @returns {object[]} one entry per recommended component
 */
export function candidatesOf(assessment) {
  return (Array.isArray(assessment?.components) ? assessment.components : [])
    .filter((component) => component?.recommended === true)
    .map((component) => {
      const release = component.channels?.release ?? {}
      return {
        component: component.component,
        label: typeof component.label === 'string' ? component.label : component.component,
        version: typeof release.version === 'string' ? release.version : (typeof component.latest?.stable === 'string' ? component.latest.stable : null),
        kind: 'release',
        source: textOf(release.source),
        url: release.url ?? null,
        queriedAt: release.queriedAt ?? null,
        // D2: the official host is advised about, never executed against.
        execution: component.execution === 'manual' ? 'manual' : 'in-repo',
      }
    })
}

/**
 * The reasons behind the proposal, each with the upstream source it came from.
 * @param {object} assessment the assessment
 * @returns {object[]} one entry per component, recommended or not
 */
export function reasonsOf(assessment) {
  return (Array.isArray(assessment?.components) ? assessment.components : []).map((component) => ({
    component: component.component,
    label: typeof component.label === 'string' ? component.label : component.component,
    conclusion: component.conclusion,
    recommended: component.recommended === true,
    reason: String(component.reason ?? ''),
    sources: SOURCE_KINDS.map((kind) => {
      const channel = component.channels?.[kind] ?? {}
      return {
        kind,
        status: textOf(channel.status),
        version: channel.version ?? null,
        commit: channel.commit ?? null,
        queriedAt: channel.queriedAt ?? null,
        source: textOf(channel.source),
        url: channel.url ?? null,
      }
    }),
  }))
}

/**
 * Every local patch item with its decision, taken from the assessment as written.
 * @param {object} assessment the assessment
 * @returns {object[]} one entry per patch marker
 */
export function patchDecisionsOf(assessment) {
  const items = []
  for (const component of Array.isArray(assessment?.components) ? assessment.components : []) {
    for (const item of Array.isArray(component.patches) ? component.patches : []) {
      items.push({
        component: component.component,
        file: item.file,
        marker: item.marker,
        decision: item.decision,
        reason: item.reason,
        evidence: item.evidence ?? {},
      })
    }
  }
  return items
}

/**
 * The impact surface the candidates touch, as declared by the sources.
 * @param {object} assessment the assessment
 * @returns {string[]} one line per component
 */
export function expectedImpactOf(assessment) {
  return (Array.isArray(assessment?.components) ? assessment.components : []).map((component) => {
    const impact = component.impact ?? {}
    const affected = Array.isArray(impact.affected) && impact.affected.length > 0 ? impact.affected.join('、') : '来源未申报'
    return (component.label ?? component.component) + '：需核对的契约面 ' + (Array.isArray(impact.surface) ? impact.surface.join('、') : 'unknown') + '；本次来源申报触及 ' + affected
  })
}

/**
 * The files an approved candidate install would change.
 *
 * Only files the baseline actually proves exist are listed; the mapping from a
 * repository patch file to a component is NOT derivable here, so each patch is
 * listed as reviewed with the decisions, never as one component's patch.
 * @param {object} baseline the collected baseline report
 * @returns {{path: string, change: string}[]} the declared change set
 */
export function changedFilesOf(baseline) {
  const repository = baseline?.repository ?? {}
  const files = [{ path: 'package.json', change: '把候选组合写进精确依赖，并按逐项补丁决策更新 patch 声明' }]
  if (textOf(repository.lockfileSha256) !== 'unknown') {
    files.push({ path: 'pnpm-lock.yaml', change: '用候选组合重新解析锁文件（当前 sha256 ' + repository.lockfileSha256 + '）' })
  }
  for (const entry of patchDigestsOf(repository)) {
    files.push({ path: 'patches/' + basename(entry.path), change: '按逐项补丁决策重做或删除（keep 则不动）；上游已实现的行为整段删除' })
  }
  return files
}

/**
 * The risks the proposal names, so nobody has to infer them later.
 * @param {{assessment: object, baseline: object, verification: object}} options the inputs
 * @returns {string[]} one line per risk
 */
export function risksOf(options) {
  const risks = []
  const repository = options.baseline?.repository ?? {}
  if (repository.dirty === 'dirty') {
    risks.push('维护仓库存在未提交输入（' + (Array.isArray(repository.changedPaths) ? repository.changedPaths.join(', ') : 'unknown') + '）：D10 允许只读分析与隔离候选，但目标切换会停止；这些改动不会被 stash、提交或回退。')
  }
  const notRecommended = (Array.isArray(options.assessment?.components) ? options.assessment.components : [])
    .filter((component) => component?.recommended !== true)
  for (const component of notRecommended) {
    risks.push('未纳入本方案的组件 ' + component.component + ' 保持当前版本（结论 ' + component.conclusion + '）：它不在本方案的授权范围内。')
  }
  const hashline = (options.assessment?.components ?? []).find((component) => component?.component === 'hashline')
  if (hashline !== undefined && (hashline.patches ?? []).length > 0) {
    risks.push('逐项补丁决策依赖候选包文件文本：真实 registry 查询取不到这些字节，本轮决策来自来源提供的候选包文本；缺失时该项记 pending-verification，不得据版本号推断。')
  }
  if ((options.verification?.commands ?? []).length === 0) {
    risks.push('本仓库未声明可列举的验证命令：候选验证需要用户另行给出命令，脚本不会自行发明。')
  }
  const dsh = (options.assessment?.components ?? []).find((component) => component?.component === 'dsh')
  if (dsh !== undefined) {
    risks.push('官方 DSH 只给影响面与人工建议：本工作流不 checkout、不 install、不改全局安装、应用包或启动配置（UPG-08）。')
  }
  const unknown = Array.isArray(options.baseline?.unknown) ? options.baseline.unknown : []
  for (const gap of unknown) risks.push('基线缺口：' + gap + '（未知字段不被填成已核实）。')
  risks.push('同意记录是工作流追溯，不宣称防御本机操作者伪造；含糊回复与无回复的判定由 skill 负责，脚本只负责来源、绑定与拒收。')
  return risks
}

/**
 * Read the verification commands a maintenance repository DECLARES.
 *
 * Nothing is executed and nothing is guessed: the commands are the `scripts`
 * entries of the repository's own package.json, and an absent or empty `scripts`
 * block is a named gap rather than an invented command.
 * @param {string | undefined} repositoryPath the maintenance worktree
 * @returns {Promise<{commands: {name: string, script: string, run: string}[], gaps: string[]}>} the declaration
 */
export async function readVerificationCommands(repositoryPath) {
  if (typeof repositoryPath !== 'string' || repositoryPath === '') {
    return { commands: [], gaps: ['the maintenance repository is not configured: no verification command could be listed (nothing was guessed)'] }
  }
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(repositoryPath, 'package.json'), 'utf8'))
  } catch (error) {
    return {
      commands: [],
      gaps: ['the maintenance repository has no readable package.json (' + (error instanceof Error ? error.message : String(error)) + '): no verification command could be listed'],
    }
  }
  const scripts = manifest?.scripts
  if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts) || Object.keys(scripts).length === 0) {
    return { commands: [], gaps: ['the maintenance repository declares no scripts in package.json: no verification command could be listed (this run does not invent one)'] }
  }
  // The run prefix is READ from the declared package manager, never assumed: a
  // repository that names none gets its script bodies verbatim plus a named gap
  // instead of an invented "pnpm ...". Which of these scripts are the candidate's
  // gates is the approver's call: this run neither filters nor ranks them.
  const declared = typeof manifest.packageManager === 'string' ? manifest.packageManager.trim() : ''
  const manager = /^(@[^/]+\/[^@]+|[^@]+)/u.exec(declared)?.[1] ?? ''
  const commands = Object.keys(scripts)
    .sort()
    .filter((name) => typeof scripts[name] === 'string')
    .map((name) => ({ name, script: scripts[name], run: manager === '' ? null : manager + ' ' + name }))
  return {
    commands,
    gaps: manager === ''
      ? ['the maintenance repository declares no packageManager in package.json: the declared script bodies are listed verbatim and no run prefix is assumed']
      : [],
  }
}

/**
 * Build one proposal from an assessment and a freshly collected baseline.
 *
 * The hash is computed from {@link bindingOf}'s projection of the result, so the
 * written file and the recorded hash cannot drift apart: a later consent
 * recomputes it from the visible fields.
 * @param {object} options the inputs
 * @returns {{proposal: object, bound: object}} the proposal and the payload it hashes
 */
export function buildProposal(options) {
  const assessment = options.assessment
  const baseline = options.baseline
  const evidenceDirectory = resolve(options.evidenceDirectory)
  const target = options.target
  const now = options.now
  const stamp = basename(upgradeDirectory(evidenceDirectory, now))
  const verification = (options.verification?.commands ?? []).map((command) => ({ name: command.name, script: command.script, run: command.run }))
  const baselineHash = baselineHashOf(baseline)
  const candidates = candidatesOf(assessment)
  const patchDecisions = patchDecisionsOf(assessment)
  const scope = { ...PROPOSAL_SCOPE }
  const rollback = {
    baselineHash,
    commit: textOf(baseline?.repository?.commit),
    dirty: textOf(baseline?.repository?.dirty),
    // Uncommitted input: a rollback must not overwrite it, and a matching HEAD
    // alone could never prove the file did not change.
    userInputs: [...(Array.isArray(baseline?.repository?.changedPaths) ? baseline.repository.changedPaths : [])].map(String).sort(),
    lockfileSha256: textOf(baseline?.repository?.lockfileSha256),
    patchFiles: patchDigestsOf(baseline?.repository),
    roles: baseline?.roles ?? {},
    target: { role: target.role, path: target.path },
    note: '回退范围只覆盖本轮变动的依赖、补丁与安装状态；userInputs 中的用户改动不作回退，也不得被覆盖。',
  }
  const bound = { baselineHash, candidates, patchDecisions, target, scope, verification, rollback }
  const proposalHash = proposalHashOf(bound)
  const proposalId = stamp + '-' + proposalHash.slice(0, 12)
  const directory = join(evidenceDirectory, 'upgrades', proposalId)
  const gaps = [
    ...(Array.isArray(baseline?.unknown) ? baseline.unknown.map((gap) => 'baseline: ' + gap) : []),
    ...(options.verification?.gaps ?? []),
    ...(Array.isArray(assessment?.gaps) ? assessment.gaps : []),
  ]
  const proposal = {
    tool: PROPOSAL_TOOL,
    version: PROPOSAL_VERSION,
    proposalId,
    proposalHash,
    generatedAt: now,
    assessment: {
      directory: options.assessmentDirectory ?? null,
      conclusion: assessment?.conclusion ?? null,
      summary: assessment?.summary ?? null,
      complete: assessment?.complete === true,
      verified: assessment?.verified === true,
    },
    // The exact combination, its hash, and where each fact was read from.
    baseline: {
      hash: baselineHash,
      collectedAt: baseline?.collectedAt ?? 'unknown',
      ...baselineSnapshot(baseline),
      roles: baseline?.roles ?? {},
      resolvedPaths: baseline?.resolvedPaths ?? {},
      realpaths: baseline?.realpaths ?? {},
      unknown: [...(Array.isArray(baseline?.unknown) ? baseline.unknown : [])],
    },
    baselineHash,
    target,
    candidates,
    reasons: reasonsOf(assessment),
    patchDecisions,
    changes: {
      files: changedFilesOf(baseline),
      candidateDirectory: join(directory, 'candidate'),
      // Named, not created: the candidate tree belongs to ticket 06.
      created: false,
      verification,
      expectedImpact: expectedImpactOf(assessment),
    },
    scope,
    risks: risksOf({ assessment, baseline, verification: options.verification }),
    stopConditions: [...STOP_CONDITIONS],
    rollback,
    execution: { ...EXECUTION_BOUNDARY },
    gaps,
    directory,
    note: '本方案只供审阅与同意：目录里的三个文件是全部写入，未安装、未构建、未执行验证命令、未切换目标。',
  }
  return { proposal, bound }
}

/**
 * The payload one written proposal is identified by.
 *
 * Recomputed from the VISIBLE fields (never from a stored copy), so editing any
 * bound input after the fact makes the recorded `proposalHash` unreachable and
 * a consent has to refuse it (UPG-05).
 * @param {object} proposal the written proposal
 * @returns {object} the bound inputs
 */
export function bindingOf(proposal) {
  return {
    baselineHash: proposal?.baselineHash,
    candidates: proposal?.candidates,
    patchDecisions: proposal?.patchDecisions,
    target: proposal?.target,
    scope: proposal?.scope,
    verification: proposal?.changes?.verification ?? [],
    rollback: proposal?.rollback,
  }
}

/**
 * The drift between what an assessment recorded and the baseline re-collected now.
 *
 * The components' own baseline versions are the input a proposal rests on: if
 * they moved between the check and the proposal, the proposal would describe a
 * combination that no longer runs here (UPG-05).
 * @param {object} assessment the assessment
 * @param {object} baseline the freshly collected baseline
 * @returns {{component: string, recorded: string, now: string}[]} the drifted components
 */
export function freshnessDrift(assessment, baseline) {
  const live = {
    dsh: textOf(baseline?.versions?.dsh),
    hashline: textOf(baseline?.engines?.hashline?.version),
    'tool-edit': textOf(baseline?.engines?.toolEdit?.version),
  }
  const drift = []
  for (const [component, now] of Object.entries(live)) {
    const recorded = (Array.isArray(assessment?.components) ? assessment.components : [])
      .find((entry) => entry?.component === component)?.baseline?.version
    const value = textOf(recorded)
    if (value !== now) drift.push({ component, recorded: value, now })
  }
  return drift
}

/**
 * The drift that invalidates an approval (UPG-05).
 *
 * Two independent checks, because they fail independently: the baseline (bytes,
 * committed and uncommitted) and the named target (where an approved switch
 * would land).
 * @param {{proposal: object, baseline: object, maintenancePath?: string}} options the inputs
 * @returns {{field: string, recorded: unknown, now: unknown, note: string}[]} the drift
 */
export function consentDrift(options) {
  const drift = []
  const current = baselineHashOf(options.baseline)
  if (current !== options.proposal?.baselineHash) {
    drift.push({
      field: 'baselineHash',
      recorded: options.proposal?.baselineHash ?? null,
      now: current,
      note: 'the maintenance worktree or the resolved combination changed since the proposal was written (committed AND uncommitted inputs count)',
    })
  }
  const target = options.proposal?.target ?? {}
  if (target.role === 'maintenance-repository') {
    const now = typeof options.maintenancePath === 'string' && options.maintenancePath !== '' ? options.maintenancePath : null
    if (now === null) {
      drift.push({ field: 'target', recorded: target.path ?? null, now: null, note: 'the maintenance repository role is no longer resolvable, so the recorded target cannot be checked' })
    } else if (target.path !== now) {
      drift.push({ field: 'target', recorded: target.path ?? null, now, note: 'the recorded target moved: this approval named another location' })
    }
  }
  return drift
}

/**
 * The consent file's status, derived from its LAST record.
 * @param {object[]} records the appended records
 * @returns {'pending'|'approved'|'rejected'} the status
 */
export function consentStatus(records) {
  const last = Array.isArray(records) && records.length > 0 ? records[records.length - 1] : undefined
  if (last === undefined) return 'pending'
  if (last.decision === 'approve') return 'approved'
  if (last.decision === 'reject') return 'rejected'
  return 'pending'
}

/**
 * The scope one approval grants.
 * @param {string | undefined} name the requested scope name
 * @returns {{candidateValidation: boolean, switch: boolean}} the granted scope
 */
export function scopeFor(name) {
  return { candidateValidation: true, switch: name === 'validation-and-switch' }
}

/**
 * One consent record: the user's own reply bound to one proposal and target.
 * @param {{proposal: object, decision: string, scope: object, reply: {quote: string, source: string, seq: number}, recorder: {sessionId: string, role: string}, now: string}} options the answer
 * @returns {object} the record to append
 */
export function makeConsentRecord(options) {
  return {
    proposalHash: options.proposal.proposalHash,
    baselineHash: options.proposal.baselineHash,
    target: { role: options.proposal.target?.role ?? 'unknown', path: options.proposal.target?.path ?? 'unknown' },
    // A rejection grants nothing, so its scope is empty rather than "false".
    scope: options.decision === 'approve' ? { ...options.scope } : {},
    decision: options.decision,
    repliedAt: options.now,
    reply: { quote: options.reply.quote, source: options.reply.source, seq: options.reply.seq },
    recorder: { sessionId: options.recorder.sessionId, role: options.recorder.role },
  }
}

/**
 * Find the user's own verbatim reply in ONE session's decoded records.
 *
 * The predicate is the same one the incident bundle uses for its last user
 * message (`user/message` with `data.source.kind === 'user'`): an agent
 * message, a tool result or another session's text is never the user's consent.
 * @param {object[]} records decoded session records, in log order
 * @param {string} quote the reported reply
 * @returns {{seq: number, matches: number} | undefined} the LAST matching message
 */
export function locateUserReply(records, quote) {
  const normalize = (value) => String(value ?? '').replace(/\r\n/gu, '\n').trim()
  const needle = normalize(quote)
  if (needle === '') return undefined
  const matches = []
  for (const record of Array.isArray(records) ? records : []) {
    // The SAME predicate the incident bundle uses: one definition, not two copies.
    if (!isUserMessage(record)) continue
    if (normalize(textOfBlocks(record.data?.content)).includes(needle)) matches.push(record.seq)
  }
  if (matches.length === 0) return undefined
  return { seq: matches[matches.length - 1], matches: matches.length }
}

/** The proposal file one `--proposal` value names (a directory resolves to its proposal.json). */
async function proposalFileOf(value) {
  const resolved = resolve(value)
  try {
    const info = await stat(resolved)
    return info.isDirectory() ? join(resolved, 'proposal.json') : resolved
  } catch {
    return resolved
  }
}

/**
 * Read the latest assessment under an evidence directory.
 * @param {string} evidenceDirectory the configured evidence root
 * @returns {Promise<string | undefined>} the assessment file, when one exists
 */
export async function findLatestAssessment(evidenceDirectory) {
  const root = join(evidenceDirectory, 'upgrades')
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return undefined
  }
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  for (let index = directories.length - 1; index >= 0; index -= 1) {
    const candidate = join(root, directories[index], 'assessment.json')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Resolve the assessment a proposal is built from.
 * @param {{value?: string | true, evidenceDirectory: string}} options the flag and the evidence root
 * @returns {Promise<{path?: string, directory?: string, assessment?: object, reason?: string}>} the assessment or the reason
 */
export async function resolveAssessment(options) {
  if (options.value === true) return { reason: '--assessment needs a directory or a JSON file path' }
  const named = typeof options.value === 'string' && options.value !== '' ? options.value : undefined
  let path_
  if (named === undefined) {
    path_ = await findLatestAssessment(options.evidenceDirectory)
    if (path_ === undefined) {
      return { reason: 'no assessment was found under ' + join(options.evidenceDirectory, 'upgrades') + ': run "upgrade assess" first (this command never assesses on its own)', next: 'upgrade assess' }
    }
  } else {
    const resolved = resolve(named)
    try {
      const info = await stat(resolved)
      path_ = info.isDirectory() ? join(resolved, 'assessment.json') : resolved
    } catch {
      path_ = resolved
    }
  }
  let text
  try {
    text = await readFile(path_, 'utf8')
  } catch (error) {
    return { path: path_, reason: 'the assessment at ' + path_ + ' cannot be read: ' + (error instanceof Error ? error.message : String(error)) }
  }
  try {
    return { path: path_, directory: dirname(path_), assessment: JSON.parse(text) }
  } catch (error) {
    return { path: path_, reason: 'the assessment at ' + path_ + ' is not valid JSON: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

/**
 * Read one written proposal.
 * @param {string | true | undefined} value the `--proposal` value
 * @returns {Promise<{path?: string, directory?: string, proposal?: object, reason?: string}>} the proposal or the reason
 */
export async function readProposal(value) {
  if (typeof value !== 'string' || value === '') return { reason: '--proposal needs the path of a proposal.json (or its directory)' }
  const path_ = await proposalFileOf(value)
  let text
  try {
    text = await readFile(path_, 'utf8')
  } catch (error) {
    return { path: path_, reason: 'the proposal at ' + path_ + ' cannot be read: ' + (error instanceof Error ? error.message : String(error)) }
  }
  let proposal
  try {
    proposal = JSON.parse(text)
  } catch (error) {
    return { path: path_, reason: 'the proposal at ' + path_ + ' is not valid JSON: ' + (error instanceof Error ? error.message : String(error)) }
  }
  if (proposal === null || typeof proposal !== 'object' || typeof proposal.proposalHash !== 'string' || !Array.isArray(proposal.candidates) || proposal.rollback === undefined) {
    return { path: path_, reason: 'the file at ' + path_ + ' is not a proposal this workflow wrote (proposalHash, candidates and rollback are required)' }
  }
  return { path: path_, directory: dirname(path_), proposal }
}

/**
 * Refuse a candidate directory that would land in the maintenance worktree.
 *
 * A4: the candidate tree is NAMED under the evidence directory and must never be
 * created inside the worktree an upgrade is about to change.
 * @param {{candidateDirectory: string, evidenceDirectory: string, maintenanceRepository?: string}} options the paths
 * @returns {string | undefined} the refusal reason, or undefined
 */
export function candidateDirectoryProblem(options) {
  const inside = (parent, child) => {
    const step = relative(resolve(parent), resolve(child))
    return step !== '' && !step.startsWith('..') && !isAbsolute(step)
  }
  if (!inside(options.evidenceDirectory, options.candidateDirectory)) {
    return 'the candidate directory ' + options.candidateDirectory + ' is outside the evidence directory ' + options.evidenceDirectory + '; the evidence directory is the only place this workflow may name it'
  }
  if (typeof options.maintenanceRepository === 'string' && options.maintenanceRepository !== '' && inside(options.maintenanceRepository, options.candidateDirectory)) {
    return 'the candidate directory ' + options.candidateDirectory + ' would be inside the maintenance worktree ' + options.maintenanceRepository + '; name an evidence directory outside it before proposing (nothing was written)'
  }
  return undefined
}

/**
 * Refuse a proposal that does not live inside this workflow's evidence tree.
 *
 * B15: the only files this ticket writes are the three beside the proposal, so a
 * --proposal value naming a file anywhere else must not get a record appended
 * next to it. An unverifiable placement (no usable evidence directory) is the
 * same refusal, because the tree cannot be checked.
 * @param {{directory: string, evidenceDirectory: string}} options the paths
 * @returns {string | undefined} the refusal reason, or undefined
 */
export function proposalPlacementProblem(options) {
  const root = join(resolve(options.evidenceDirectory), 'upgrades')
  const step = relative(root, resolve(options.directory))
  if (step === '' || step.startsWith('..') || isAbsolute(step)) {
    return 'the proposal lives at ' + options.directory + ', which is not under ' + root
      + ': a consent record is only ever written inside the evidence directory tree of this workflow, so nothing was recorded'
  }
  return undefined
}

/**
 * Read an existing consent file.
 * @param {string} path the consent.json path
 * @returns {Promise<{exists: boolean, raw?: string, consent?: object, reason?: string}>} the file
 */
export async function readConsent(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false }
    return { exists: false, reason: 'the consent file at ' + path + ' cannot be read: ' + (error instanceof Error ? error.message : String(error)) }
  }
  try {
    const consent = JSON.parse(text)
    if (consent === null || typeof consent !== 'object' || !Array.isArray(consent.records)) {
      return { exists: true, raw: text, reason: 'the consent file at ' + path + ' is not a consent record this workflow wrote (a "records" array is required)' }
    }
    return { exists: true, raw: text, consent }
  } catch (error) {
    return { exists: true, raw: text, reason: 'the consent file at ' + path + ' is not valid JSON: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

/** One empty (pending) consent file for a proposal. */
function emptyConsent(proposal) {
  return {
    tool: CONSENT_TOOL,
    version: PROPOSAL_VERSION,
    proposalId: proposal.proposalId,
    proposalHash: proposal.proposalHash,
    baselineHash: proposal.baselineHash,
    status: 'pending',
    records: [],
    note: '无记录即 pending：同意必须由用户本人对这份 proposalHash 的明确回复产生，不接受 --yes 之类的自动批准。',
  }
}

/**
 * Write the proposal, its human report and the consent file.
 *
 * Render first, then create: a render bug must not leave an empty proposal behind
 * (the partial-success lesson ADR-0004 records). An EXISTING consent file is never
 * rewritten — an approval already recorded for the same bound inputs stays.
 * @param {{directory: string, proposal: object}} options the proposal
 * @returns {Promise<{proposal: string, report: string, consent: string}>} the written paths
 */
export async function writeProposal(options) {
  const report = renderProposalReport(options.proposal)
  const files = {
    proposal: join(options.directory, 'proposal.json'),
    report: join(options.directory, 'proposal.md'),
    consent: join(options.directory, 'consent.json'),
  }
  await mkdir(options.directory, { recursive: true })
  await writeFile(files.proposal, JSON.stringify(options.proposal, null, 2) + '\n', 'utf8')
  await writeFile(files.report, report + '\n', 'utf8')
  if (!existsSync(files.consent)) {
    await writeFile(files.consent, JSON.stringify(emptyConsent(options.proposal), null, 2) + '\n', 'utf8')
  }
  return files
}

/**
 * Append one consent record (append-only; old records keep their bytes).
 * @param {{path: string, proposal: object, record: object}} options the record
 * @returns {Promise<{consent?: object, path?: string, appended?: number, reason?: string}>} the file after the append
 */
export async function appendConsentRecord(options) {
  const current = await readConsent(options.path)
  if (current.reason !== undefined) return { reason: current.reason }
  const records = current.consent === undefined ? [] : current.consent.records
  const foreign = records.filter((record) => record?.proposalHash !== options.proposal.proposalHash)
  if (foreign.length > 0) {
    return {
      reason: 'this consent file holds ' + foreign.length + ' record(s) for another proposal hash ('
        + foreign.map((record) => String(record?.proposalHash)).join(', ')
        + '): an approval never covers the new hash ' + options.proposal.proposalHash + ', so nothing was recorded',
    }
  }
  const all = [...records, options.record]
  const consent = {
    ...emptyConsent(options.proposal),
    status: consentStatus(all),
    records: all,
    note: '只追加：旧记录不被改写，status 取最后一条记录；无记录即 pending。',
  }
  await mkdir(dirname(options.path), { recursive: true })
  await writeFile(options.path, JSON.stringify(consent, null, 2) + '\n', 'utf8')
  return { consent, path: options.path, appended: records.length }
}

/**
 * Render the reviewable proposal as markdown: the same payload a reader reviews
 * before answering, and the same one the consent record binds.
 * @param {object} proposal the proposal
 * @returns {string} markdown
 */
export function renderProposalReport(proposal) {
  const quoted = (value) => '`' + (value === undefined || value === null || value === '' ? 'unknown' : String(value)) + '`'
  const lines = []
  lines.push('# Upgrade 方案 — ' + proposal.proposalId)
  lines.push('')
  lines.push('- proposalHash：' + quoted(proposal.proposalHash))
  lines.push('- baselineHash：' + quoted(proposal.baselineHash))
  lines.push('- 生成时间：' + quoted(proposal.generatedAt))
  lines.push('- 评估来源：' + quoted(proposal.assessment?.directory) + '（结论 ' + quoted(proposal.assessment?.conclusion) + '）')
  lines.push('- 执行范围：仅候选验证' + (proposal.scope?.switch === true ? '＋目标切换' : '') + '；' + (proposal.scope?.note ?? ''))
  lines.push('')
  lines.push('## 当前精确基线')
  lines.push('')
  lines.push('- commit：' + quoted(proposal.baseline?.commit) + '，dirty：' + quoted(proposal.baseline?.dirty))
  if (Array.isArray(proposal.baseline?.changedPaths) && proposal.baseline.changedPaths.length > 0) {
    lines.push('- 未提交输入：' + proposal.baseline.changedPaths.map(quoted).join('、') + '（这些改动不作回退，也不会被覆盖）')
  }
  lines.push('- lockfile sha256：' + quoted(proposal.baseline?.lockfileSha256))
  lines.push('- 引擎版本：hashline ' + quoted(proposal.baseline?.versions?.hashline) + '、tool-edit ' + quoted(proposal.baseline?.versions?.toolEdit) + '、DSH ' + quoted(proposal.baseline?.versions?.dsh))
  lines.push('- 补丁证据（解析后构建文件）：hashline ' + quoted(proposal.baseline?.patches?.hashline) + '、tool-edit ' + quoted(proposal.baseline?.patches?.toolEdit))
  for (const entry of proposal.baseline?.patchFiles ?? []) lines.push('- patch：' + quoted(entry.path) + ' sha256 ' + quoted(entry.sha256))
  lines.push('')
  lines.push('## 候选组合')
  lines.push('')
  lines.push('| 组件 | 候选版本 | 渠道 | 来源 | 查询时间 | 执行方式 |')
  lines.push('|---|---|---|---|---|---|')
  for (const candidate of proposal.candidates ?? []) {
    lines.push('| ' + candidate.label + ' | ' + quoted(candidate.version) + ' | ' + candidate.kind + ' | ' + quoted(candidate.source) + ' | ' + quoted(candidate.queriedAt) + ' | ' + candidate.execution + ' |')
  }
  lines.push('')
  lines.push('## 升级理由与上游来源')
  lines.push('')
  for (const reason of proposal.reasons ?? []) {
    lines.push('- **' + reason.component + '**（' + reason.conclusion + (reason.recommended ? '，已推荐' : '，未纳入本方案') + '）：' + reason.reason)
    for (const sourceKind of reason.sources ?? []) {
      lines.push('  - ' + sourceKind.kind + '：' + quoted(sourceKind.version ?? sourceKind.commit) + ' / ' + sourceKind.status + ' / ' + quoted(sourceKind.source) + (sourceKind.url === null ? '' : ' / ' + sourceKind.url))
    }
  }
  lines.push('')
  lines.push('## 逐项补丁决策')
  lines.push('')
  if ((proposal.patchDecisions ?? []).length === 0) {
    lines.push('本方案涉及的组件没有本地补丁。')
  } else {
    lines.push('| 组件 | 文件 | 标记 | 决策 | 理由 |')
    lines.push('|---|---|---|---|---|')
    for (const item of proposal.patchDecisions) {
      lines.push('| ' + item.component + ' | ' + quoted(item.file) + ' | ' + quoted(item.marker) + ' | ' + item.decision + ' | ' + item.reason + ' |')
    }
  }
  lines.push('')
  lines.push('## 拟变更范围')
  lines.push('')
  for (const file of proposal.changes?.files ?? []) lines.push('- ' + quoted(file.path) + '：' + file.change)
  lines.push('- 候选目录：' + quoted(proposal.changes?.candidateDirectory) + '（只命名，**尚未创建**）')
  lines.push('')
  lines.push('### 验证命令（只从仓库 package.json 的 scripts 列举，未执行）')
  lines.push('')
  if ((proposal.changes?.verification ?? []).length === 0) {
    lines.push('本仓库未声明可列举的验证命令：需要用户另行给出，脚本不猜命令。')
  } else {
    for (const command of proposal.changes.verification) lines.push('- ' + quoted(command.run) + '（' + quoted(command.name) + '）：`' + command.script + '`')
    lines.push('')
    lines.push('以上是仓库 `scripts` 声明的全部脚本：哪些属于本次候选的门禁由审阅时确认，脚本不筛选、不排序判断。')
  }
  lines.push('')
  lines.push('### 预计影响')
  lines.push('')
  for (const impact of proposal.changes?.expectedImpact ?? []) lines.push('- ' + impact)
  lines.push('')
  lines.push('## 已知风险')
  lines.push('')
  for (const risk of proposal.risks ?? []) lines.push('- ' + risk)
  lines.push('')
  lines.push('## 失败停止条件')
  lines.push('')
  for (const condition of proposal.stopConditions ?? []) lines.push('- ' + condition)
  lines.push('')
  lines.push('## 回退基线')
  lines.push('')
  lines.push('- baselineHash：' + quoted(proposal.rollback?.baselineHash))
  lines.push('- commit：' + quoted(proposal.rollback?.commit) + '，dirty：' + quoted(proposal.rollback?.dirty))
  lines.push('- lockfile sha256：' + quoted(proposal.rollback?.lockfileSha256))
  for (const entry of proposal.rollback?.patchFiles ?? []) lines.push('- patch：' + quoted(entry.path) + ' sha256 ' + quoted(entry.sha256))
  lines.push('- 授权目标：' + quoted(proposal.rollback?.target?.role) + '（' + quoted(proposal.rollback?.target?.path) + '）')
  if ((proposal.rollback?.userInputs ?? []).length > 0) lines.push('- 用户未提交输入（不作回退）：' + proposal.rollback.userInputs.map(quoted).join('、'))
  lines.push('')
  lines.push('## 执行边界')
  lines.push('')
  lines.push('- 本方案 mode=' + quoted(proposal.execution?.mode) + '：installed=' + String(proposal.execution?.installed) + '、built=' + String(proposal.execution?.built) + '、switched=' + String(proposal.execution?.switched) + '。')
  lines.push('- 未安装、未构建、未执行验证命令、未修改 manifest / lockfile / patch / dist / profile、未切换目标。')
  lines.push('- 未获用户明确同意前不进入候选验证；--yes 之类的自动接受参数不构成同意（入口直接拒绝）。')
  lines.push('- 同意记录见同目录 consent.json：无记录即 pending；旧 proposalHash 的同意不会覆盖本方案。')
  lines.push('')
  if ((proposal.gaps ?? []).length > 0) {
    lines.push('## 缺口')
    lines.push('')
    for (const gap of proposal.gaps) lines.push('- ' + gap)
    lines.push('')
  }
  return lines.join('\n')
}
