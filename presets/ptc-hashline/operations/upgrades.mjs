/**
 * Read-only upgrade assessment for the ptc-hashline operations skill
 * (UPG-01, UPG-02, UPG-08, UPG-11).
 *
 * Three components are covered, because D2 names three: the official DSH host
 * (the PTC/SDK/schema surface), hashline and tool-edit. For each one this module
 * records WHERE a fact came from and WHEN it was queried, keeps the stable
 * release, the pre-release and the unreleased commit apart, and turns the answer
 * into ONE of four conclusions:
 *
 *   insufficient-evidence > defer > recommend-candidate > no-upgrade
 *
 * That order is an OVERRIDE order, not a severity scale: the most cautious
 * conclusion wins the aggregate. An unavailable required source therefore caps
 * the whole run at defer, and only three verified stable channels with no newer
 * version can reach no-upgrade. A newer version is never a reason to recommend:
 * every local patch is decided per marker as keep / redo / delete from the
 * candidate package's own bytes, and a decision that cannot be made caps the
 * component at defer.
 *
 * Nothing here installs, builds, downloads, checks out or switches anything. The
 * only writes are the local evaluation files under
 * <evidenceDirectory>/upgrades/<stamp>/ (UPG-08 and the consent boundary of
 * ticket 05); the official DSH installation is only ever advised about.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/upgrades
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { HASHLINE_PATCH_MARKERS, TOOL_EDIT_PATCH_MARKERS } from './baseline.mjs'

/** Report identity written into every assessment. */
export const UPGRADE_TOOL = 'ptc-hashline-operations-upgrade'
/** Report schema version. */
export const UPGRADE_VERSION = 1
/** The three components the assessment covers (D2). */
export const COMPONENTS = ['dsh', 'hashline', 'tool-edit']
/** Human labels, used in the markdown report only. */
export const COMPONENT_LABELS = { dsh: 'DSH 组件（官方）', hashline: 'hashline', 'tool-edit': 'tool-edit' }
/** The channels a query can answer for (正式版 / 预发布 / 未发布 commit). */
export const SOURCE_KINDS = ['release', 'prerelease', 'commit']
/** Three-state verdict of one query; 'unverified' is never 'latest'. */
export const SOURCE_STATUSES = ['verified', 'unverified', 'unknown']
/**
 * The four conclusions, ordered from the most cautious to the most actionable.
 * {@link aggregateConclusion} keeps the LOWEST index, so an unavailable source
 * can never be overruled by a confident one.
 */
export const CONCLUSIONS = ['insufficient-evidence', 'defer', 'recommend-candidate', 'no-upgrade']
/** Roles `--target` may name. Both are REPORTED; neither is switched. */
export const TARGET_ROLES = ['maintenance-repository', 'upgrade-target']
/**
 * The local patches this repository ships, per component. The marker lists are
 * the same ones the baseline uses to prove a patch is in effect: an upgrade is
 * decided on the SAME evidence, read out of the candidate package instead.
 */
export const PATCH_MARKERS = {
  dsh: [],
  hashline: HASHLINE_PATCH_MARKERS,
  'tool-edit': TOOL_EDIT_PATCH_MARKERS,
}
/**
 * The impact surface UPG-02 asks to map. A source record may declare which of
 * these its diff touches; an area nobody declared is reported as untouched
 * rather than assumed safe.
 */
export const IMPACT_SURFACE = {
  dsh: ['ptc', 'sdk', 'schema', 'errors', 'cancellation', 'scope', 'fs', 'session'],
  hashline: ['tag', 'store', 'seen', 'recovery', 'commit'],
  'tool-edit': ['mode', 'retry', 'mv', 'rem', 'bom', 'tool-description', 'defaults'],
}
/** The commands a metadata query may run: read-only, never an install. */
export const QUERY_ALLOWLIST = [
  { command: 'npm', verb: 'view' },
  { command: 'git', verb: 'ls-remote' },
]
/** What the official DSH component may be given: advice, never an action (UPG-08). */
export const DSH_MANUAL_ACTIONS = [
  '按官方发布说明逐项核对 PTC/SDK/schema/错误/取消/scope/FS/Session 的契约变化，据此判断本仓库补丁是否需要重做。',
  '官方 DSH 的安装由用户手工执行：本工作流不 checkout、不 install、不修改全局安装、应用包或启动配置。',
  '用户自行准备好该版本后，再进入隔离候选验证；候选验证与目标切换不属于本版本（票据 06/07）。',
]
/** One-line statement of each conclusion. */
export const CONCLUSION_SUMMARY = {
  'insufficient-evidence': '证据不足：必需来源不可用，本次不判断是否有更新',
  defer: '暂缓：有更新迹象或证据不完整，当前不建议升级',
  'recommend-candidate': '推荐候选：正式版有更新，逐项补丁决策已给出',
  'no-upgrade': '无需升级：三方已核实的正式版中没有更新版本',
}

/**
 * Digest one string.
 * @param {string} text the bytes to hash
 * @returns {string} the hex SHA-256
 */
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** A list of strings, dropping everything else. */
function stringsOf(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry !== '') : []
}

/** The bound-dependency records one source declares. */
function dependenciesOf(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry) => entry !== null && typeof entry === 'object')
    .map((entry) => ({
      name: typeof entry.name === 'string' ? entry.name : 'unknown',
      version: typeof entry.version === 'string' ? entry.version : null,
      // Tri-state on purpose: 'unknown' is not 'ready', and it does not silently
      // pass either — it is reported and the component stays non-committal.
      ready: entry.ready === true ? true : entry.ready === false ? false : 'unknown',
    }))
}

/**
 * Parse one version into comparable pieces.
 * @param {unknown} text a semver-ish string, optionally prefixed with "v"
 * @returns {{core: number[], pre: string[]} | null} the pieces, or null when unparsable
 */
export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(String(text ?? '').trim())
  if (match === null) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/**
 * Compare two versions by semver precedence.
 *
 * A pre-release sorts BELOW its release (`1.0.0-rc.1 < 1.0.0`), which is what
 * makes "the stable channel did not move, only a pre-release did" expressible.
 * @param {unknown} left candidate version
 * @param {unknown} right baseline version
 * @returns {-1 | 0 | 1 | null} the order, or null when either side is unparsable
 */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === null || b === null) return null
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1
  const length = Math.max(a.pre.length, b.pre.length)
  for (let index = 0; index < length; index += 1) {
    const one = a.pre[index]
    const other = b.pre[index]
    if (one === undefined) return -1
    if (other === undefined) return 1
    const oneNumeric = /^\d+$/u.test(one)
    const otherNumeric = /^\d+$/u.test(other)
    if (oneNumeric && otherNumeric) {
      const left_ = Number(one)
      const right_ = Number(other)
      if (left_ !== right_) return left_ < right_ ? -1 : 1
      continue
    }
    if (oneNumeric) return -1
    if (otherNumeric) return 1
    if (one !== other) return one < other ? -1 : 1
  }
  return 0
}

/**
 * Normalise ONE source record, or refuse.
 *
 * A record that cannot be read is refused loudly instead of being dropped: a
 * missing record and a "queried, nothing there" record must not look alike, or
 * an offline run would read as an empty channel.
 * @param {object} record the raw record (a fixture, or a provider's answer)
 * @param {{now?: string}} [options] default query time for records that carry none
 * @returns {object} the normalised record
 */
export function normalizeSource(record, options = {}) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('a source record must be an object')
  }
  if (!COMPONENTS.includes(record.component)) {
    throw new Error('source record names an unknown component: ' + JSON.stringify(record.component))
  }
  if (!SOURCE_KINDS.includes(record.kind)) {
    throw new Error('source record names an unknown kind: ' + JSON.stringify(record.kind))
  }
  const queriedAt = typeof record.queriedAt === 'string' ? record.queriedAt : options.now ?? new Date().toISOString()
  if (Number.isNaN(Date.parse(queriedAt))) {
    throw new Error('source record has an unparsable queriedAt: ' + JSON.stringify(record.queriedAt))
  }
  if (!SOURCE_STATUSES.includes(record.status)) {
    throw new Error('source record has an unknown status: ' + JSON.stringify(record.status) + '; a channel is verified, unverified or unknown, and a typo must not read as an unqueried one')
  }
  const files = record.files !== null && typeof record.files === 'object' && !Array.isArray(record.files) ? record.files : undefined
  return {
    component: record.component,
    kind: record.kind,
    status: record.status,
    queriedAt,
    source: typeof record.source === 'string' ? record.source : 'unspecified',
    version: typeof record.version === 'string' ? record.version : null,
    commit: typeof record.commit === 'string' ? record.commit : null,
    url: typeof record.url === 'string' ? record.url : null,
    // Whether a commit is part of a published release. 'unknown' is honest and
    // never blocks no-upgrade; only an explicit true is treated as unreleased.
    unreleased: record.unreleased === true ? true : record.unreleased === false ? false : 'unknown',
    covers: stringsOf(record.covers),
    areas: stringsOf(record.areas),
    boundDependencies: dependenciesOf(record.boundDependencies),
    blocking: record.blocking === true,
    ...record.detail === undefined ? {} : { detail: String(record.detail) },
    ...files === undefined ? {} : { files },
  }
}

/**
 * The shape one record takes in sources.json: candidate package text is replaced
 * by its digest, so the evidence cites the bytes without carrying them.
 * @param {object} record a normalised record
 * @returns {object} the exportable record
 */
export function publicSource(record) {
  const { files, ...rest } = record
  if (files === undefined) return rest
  return {
    ...rest,
    candidateFiles: Object.keys(files).sort().map((path) => ({ path, sha256: sha256(String(files[path])) })),
  }
}

/**
 * The records a run with no metadata source at all produces.
 *
 * Every component/kind pair is represented, all of them `unverified`: an offline
 * run must still produce an assessment (the ticket's seam), and the honest
 * answer for each channel is "not checked", never "latest".
 * @param {string} now the query time to record
 * @param {string} [detail] why the channel is unverified
 * @returns {object[]} one record per component and kind
 */
export function offlineSources(now, detail = 'no metadata source was queried in this run') {
  const records = []
  for (const component of COMPONENTS) {
    for (const kind of SOURCE_KINDS) {
      records.push({
        component,
        kind,
        status: 'unverified',
        queriedAt: now,
        source: 'none',
        version: null,
        commit: null,
        url: null,
        unreleased: 'unknown',
        covers: [],
        areas: [],
        boundDependencies: [],
        blocking: false,
        detail,
      })
    }
  }
  return records
}

/**
 * Add the records a caller did not supply, so "unavailable" is visible.
 * @param {object[]} records normalised records
 * @param {string} now the query time to record on the synthesized ones
 * @returns {object[]} one record per component and kind, in a stable order
 */
export function completeSources(records, now) {
  const supplied = new Set(records.map((record) => record.component + '|' + record.kind))
  const missing = offlineSources(now, 'this source was not queried: without it the conclusion cannot reach no-upgrade')
    .filter((record) => !supplied.has(record.component + '|' + record.kind))
  const all = [...records, ...missing]
  return all.sort((left, right) =>
    COMPONENTS.indexOf(left.component) - COMPONENTS.indexOf(right.component)
    || SOURCE_KINDS.indexOf(left.kind) - SOURCE_KINDS.indexOf(right.kind))
}

/**
 * Normalise and complete one run's source records.
 *
 * The single entry point both the assessment and the evidence writer use, so
 * sources.json and the conclusion can never disagree about which records exist.
 * @param {object[] | undefined} records raw records (a provider's answer, or a fixture)
 * @param {string} now the query time to record on records that carry none
 * @returns {object[]} one normalised record per component and kind
 */
export function prepareSources(records, now) {
  const normalized = (records ?? []).map((record) => normalizeSource(record, { now }))
  // One channel has exactly one answer. Two records for the same channel would
  // silently make the assessment read the first and ignore the second, so the
  // run refuses instead of choosing for the reader.
  const seen = new Set()
  for (const record of normalized) {
    const key = record.component + '|' + record.kind
    if (seen.has(key)) {
      throw new Error('two source records claim the same channel (' + key + '): one channel has one answer, so this run refuses instead of picking the first')
    }
    seen.add(key)
  }
  return completeSources(normalized, now)
}

/**
 * Which surface areas the queried sources say they touch.
 * @param {string} component the component
 * @param {object[]} records this component's records
 * @returns {{surface: string[], affected: string[], unmapped: string[], note: string}} the impact mapping
 */
export function impactOf(component, records) {
  const surface = IMPACT_SURFACE[component] ?? []
  const declared = [...new Set(records.flatMap((record) => record.areas))]
  return {
    surface,
    affected: declared.filter((area) => surface.includes(area)),
    unmapped: declared.filter((area) => !surface.includes(area)),
    note: 'An area nobody declared is reported as untouched by this evidence, not as safe: the check is only as good as the diff it was given.',
  }
}

/**
 * The candidate package whose files decide the patch items.
 *
 * The stable release is preferred; a pre-release is used only when no stable
 * candidate carries files. A record with no `files` cannot decide anything, so
 * the decision stays 'pending-verification' rather than guessing.
 * @param {object[]} records this component's records
 * @returns {object | undefined} the record carrying candidate package text
 */
function candidatePackage(records) {
  const usable = records.filter((record) => record.status === 'verified' && record.files !== undefined)
  return usable.find((record) => record.kind === 'release') ?? usable.find((record) => record.kind === 'prerelease')
}

/**
 * Decide every local patch item: keep, redo, delete — or say that it cannot be
 * decided yet.
 *
 * The decision is semantic, never "does the patch apply": the marker text is
 * read out of the CANDIDATE package, so a surviving marker means the behaviour
 * the patch introduced is still ours to keep, an upstream coverage declaration
 * means the behaviour is now upstream's (delete), and a marker that disappeared
 * from a file that changed means the hunk must be re-cut (redo).
 * @param {{component: string, records: object[], baseline?: {present?: string[]}}} options the decision inputs
 * @returns {object[]} one item per marker, each with its reason and evidence
 */
export function decidePatches(options) {
  const markers = PATCH_MARKERS[options.component] ?? []
  if (markers.length === 0) return []
  const candidate = candidatePackage(options.records)
  const verified = options.records.filter((record) => record.status === 'verified')
  // The evidence every item cites is the same clump: which source, which url,
  // which version. Built once, then narrowed per decision.
  const evidenceOf = (record) => ({
    source: record === undefined ? null : record.source,
    url: record === undefined ? null : record.url,
    version: record === undefined ? null : record.version,
  })
  return markers.map(({ file, marker }) => {
    const path = file.join('/')
    const where = 'the candidate package (' + (candidate === undefined ? 'not available' : (candidate.version ?? candidate.commit ?? candidate.kind) + ' via ' + candidate.source + ')')
    const covering = verified.find((record) => record.covers.includes(marker))
    if (covering !== undefined) {
      return {
        file: path,
        marker,
        decision: 'delete',
        reason: '上游在 ' + (covering.version ?? covering.commit ?? covering.kind) + '（' + covering.source + '）已实现同一行为：' + (covering.detail ?? marker) + '；本地补丁可整体删除',
        evidence: { ...evidenceOf(covering), commit: covering.commit, covers: true },
      }
    }
    const text = candidate?.files?.[path]
    if (text === undefined) {
      return {
        file: path,
        marker,
        decision: 'pending-verification',
        reason: '无法从 ' + where + ' 读到 ' + path + '：不知道该标记是否仍在，需在候选验证阶段核对后定为 keep/redo/delete',
        evidence: { ...evidenceOf(candidate), present: null },
      }
    }
    if (text.includes(marker)) {
      return {
        file: path,
        marker,
        decision: 'keep',
        reason: where + ' 的 ' + path + ' 仍含该标记：补丁引入的行为未被上游替代，补丁可保持原样',
        evidence: { ...evidenceOf(candidate), present: true },
      }
    }
    return {
      file: path,
      marker,
      decision: 'redo',
      reason: where + ' 的 ' + path + ' 已不再含该标记，而上游改动了同一处：补丁需按新代码重做；若上游已整体实现该行为，改记 delete 并补 covers 证据',
      evidence: { ...evidenceOf(candidate), present: false },
    }
  })
}

/**
 * One channel's facts, as reported (never as reconstructed).
 * @param {object[]} records this component's records
 * @param {string} kind the channel
 * @returns {object} the channel report
 */
export function channelOf(records, kind) {
  const record = records.find((entry) => entry.kind === kind)
  if (record === undefined) {
    return { kind, status: 'unverified', version: null, commit: null, queriedAt: null, source: 'none', url: null, detail: 'no record was supplied for this channel' }
  }
  return {
    kind,
    status: record.status,
    version: record.version,
    commit: record.commit,
    queriedAt: record.queriedAt,
    source: record.source,
    url: record.url,
    ...record.detail === undefined ? {} : { detail: record.detail },
  }
}

/**
 * The baseline facts of ONE component.
 *
 * The three roles are never collapsed: the official DSH host carries no local
 * patch, so its "patch status" is n/a and only its contract surface is assessed;
 * the two engines report the patch evidence the baseline collected.
 * @param {object} baseline the collected baseline report
 * @param {string} component the component to read
 * @returns {{version: string, patch: object}} the component's baseline facts
 */
export function baselineOf(baseline, component) {
  if (component === 'dsh') {
    return {
      version: typeof baseline?.versions?.dsh === 'string' ? baseline.versions.dsh : 'unknown',
      patch: { status: 'n/a', note: 'the official DSH host carries no local patch; only its contract impact is assessed' },
    }
  }
  const engine = component === 'hashline' ? baseline?.engines?.hashline : baseline?.engines?.toolEdit
  return {
    version: typeof engine?.version === 'string' ? engine.version : 'unknown',
    patch: {
      status: engine?.patch?.status ?? 'unknown',
      present: engine?.patch?.present ?? [],
      missing: engine?.patch?.missing ?? [],
    },
  }
}

/** A short count of the patch decisions, for the one-line reason. */
function summariseDecisions(patches) {
  if (patches.length === 0) return '该组件没有本地补丁'
  const counts = { keep: 0, redo: 0, delete: 0, 'pending-verification': 0 }
  for (const item of patches) counts[item.decision] += 1
  return 'keep ' + counts.keep + '、redo ' + counts.redo + '、delete ' + counts.delete
}

/**
 * Assess ONE component: which channel moved, what the diff touches, and what
 * each local patch item becomes.
 *
 * The order of the branches IS the policy, so it is written out rather than
 * folded into a score: no verified stable release caps at defer/insufficient; a
 * baseline that cannot be compared yields a PENDING candidate, never a verified
 * one; a stable release that did not move cannot be recommended even when a
 * pre-release did; and only then does a newer stable release get its patch items
 * decided.
 * @param {{component: string, baseline: {version: string, patch: object}, records: object[]}} options the inputs
 * @returns {object} the component assessment
 */
export function assessComponent(options) {
  const component = options.component
  const baseline = options.baseline ?? { version: 'unknown', patch: { status: 'unknown' } }
  const records = options.records.filter((record) => record.component === component)
  const channels = {}
  for (const kind of SOURCE_KINDS) channels[kind] = channelOf(records, kind)

  const baselineVersion = typeof baseline.version === 'string' && baseline.version !== '' ? baseline.version : 'unknown'
  const stableVersion = channels.release.status === 'verified' && typeof channels.release.version === 'string' ? channels.release.version : null
  const prereleaseVersion = channels.prerelease.status === 'verified' && typeof channels.prerelease.version === 'string' ? channels.prerelease.version : null
  const commit = channels.commit.status === 'verified' && typeof channels.commit.commit === 'string' ? channels.commit.commit : null
  const stableNewer = stableVersion === null || baselineVersion === 'unknown' ? null : compareVersions(stableVersion, baselineVersion)
  const prereleaseNewer = prereleaseVersion === null || baselineVersion === 'unknown' ? null : compareVersions(prereleaseVersion, baselineVersion)
  const unreleased = records.find((record) => record.kind === 'commit' && record.status === 'verified' && record.unreleased === true)
  const patches = decidePatches({ component, records })
  const undecided = patches.filter((item) => item.decision === 'pending-verification')
  // A dependency that is not ready includes one whose readiness is unknown: an
  // unstated readiness is not a licence to recommend.
  const blockingDependencies = records.flatMap((record) => record.boundDependencies.filter((dependency) => dependency.ready !== true))
  const blockingRecords = records.filter((record) => record.blocking === true)

  const channelsVerified = records.length > 0 && records.every((record) => record.status === 'verified')
  const unverifiedChannels = SOURCE_KINDS.filter((kind) => channels[kind].status !== 'verified')

  let conclusion
  let reason
  if (stableVersion === null) {
    if (prereleaseVersion !== null || commit !== null) {
      conclusion = 'defer'
      reason = '正式版元数据不可用'
        + (prereleaseVersion === null ? '' : '，只有预发布 ' + prereleaseVersion)
        + (commit === null ? '' : '，另有分支 commit ' + commit)
        + '：暂缓，不据预发布或未发布内容推荐升级'
    } else {
      conclusion = 'insufficient-evidence'
      reason = '正式版元数据不可用（' + SOURCE_KINDS.map((kind) => kind + '=' + channels[kind].status).join('、') + '）：本次不判断是否有更新'
    }
  } else if (stableNewer !== null && stableNewer <= 0) {
    // The stable channel did not move. A newer pre-release or an unreleased
    // commit is still a change, so neither may be called "no update".
    if (prereleaseNewer !== null && prereleaseNewer > 0) {
      conclusion = 'defer'
      reason = '正式版没有更新（基线 ' + baselineVersion + '、正式版 ' + stableVersion + '），但存在更高的预发布 ' + prereleaseVersion + '：预发布暂缓'
    } else if (unreleased !== undefined) {
      conclusion = 'defer'
      reason = '正式版没有更新，但上游有未发布 commit ' + unreleased.commit + '：未发布内容暂缓'
    } else {
      conclusion = 'no-upgrade'
      reason = '该组件的正式版没有更新版本（基线 ' + baselineVersion + '、正式版 ' + stableVersion + '）'
    }
  } else if (blockingDependencies.length > 0) {
    // Judge the declared blockers BEFORE deciding how comparable the versions
    // are: an unready binding dependency defers even when the baseline cannot be
    // compared, because it is a known reason not to proceed.
    conclusion = 'defer'
    reason = '候选 ' + (stableVersion ?? 'unknown') + ' 的绑定依赖未就绪：' + blockingDependencies.map((dependency) => dependency.name + '@' + (dependency.version ?? 'unknown') + '=' + dependency.ready).join('、')
  } else if (blockingRecords.length > 0) {
    conclusion = 'defer'
    reason = '候选 ' + (stableVersion ?? 'unknown') + ' 的来源标为阻塞：' + blockingRecords.map((record) => record.detail ?? record.source).join('、')
  } else if (undecided.length > 0) {
    conclusion = 'defer'
    reason = '候选 ' + (stableVersion ?? 'unknown') + ' 已核实，但 ' + undecided.length + ' 项补丁无法决策（' + undecided.map((item) => item.file).join('、') + '）：先取得候选包文本，暂缓'
  } else if (stableNewer === null) {
    conclusion = 'recommend-candidate'
    reason = '已核实正式版 ' + stableVersion + '，但当前基线版本 ' + baselineVersion + ' 无法比较：候选待验证，不标为已核实（UPG-11）'
  } else {
    conclusion = 'recommend-candidate'
    reason = '候选 ' + stableVersion + ' 相对基线 ' + baselineVersion + ' 有更新；逐项补丁决策：' + summariseDecisions(patches)
  }

  // A required channel that was not verified caps THIS COMPONENT, not only the
  // run: an unchecked pre-release or branch head could still hide something
  // newer, so neither "no update" nor a recommendation may rest on it.
  if (!channelsVerified && CONCLUSIONS.indexOf(conclusion) > CONCLUSIONS.indexOf('defer')) {
    reason = '该组件的 ' + unverifiedChannels.join('、') + ' 渠道未核实（' + reason + '）：未核实的必需来源使结论最高只能到 defer'
    conclusion = 'defer'
  }

  const pendingVerification = conclusion === 'recommend-candidate' && stableNewer === null
  return {
    component,
    label: COMPONENT_LABELS[component],
    // D2: the official host is advised about, never executed against.
    execution: component === 'dsh' ? 'manual' : 'in-repo',
    baseline: { version: baselineVersion, patch: baseline.patch ?? { status: 'unknown' } },
    channels,
    latest: { stable: stableVersion, prerelease: prereleaseVersion, commit },
    update: {
      comparable: stableNewer !== null,
      stableNewer,
      prereleaseNewer,
      unreleasedCommit: unreleased === undefined ? null : unreleased.commit,
    },
    impact: impactOf(component, records),
    patches,
    boundDependencies: records.flatMap((record) => record.boundDependencies),
    channelsVerified,
    conclusion,
    reason,
    // 'verified' means the version comparison rests on verified sources. A
    // pending candidate is explicitly NOT that, and neither is a capped one.
    verified: channelsVerified && conclusion !== 'insufficient-evidence' && pendingVerification === false,
    pendingVerification,
    recommended: false,
    ...component === 'dsh' ? { manualActions: [...DSH_MANUAL_ACTIONS] } : {},
  }
}

/**
 * Combine the three component conclusions, most cautious first.
 *
 * The unavailable-source rule is enforced structurally rather than hoped for: a
 * no-upgrade can never survive a component whose channels were not all verified.
 * @param {object[]} components the component assessments
 * @returns {string} the aggregate conclusion
 */
export function aggregateConclusion(components) {
  const worst = components.reduce(
    (current, component) => (CONCLUSIONS.indexOf(component.conclusion) < CONCLUSIONS.indexOf(current) ? component.conclusion : current),
    'no-upgrade',
  )
  if (worst === 'no-upgrade' && components.some((component) => component.channelsVerified !== true)) return 'defer'
  return worst
}

/**
 * Assess all three components for one run.
 * @param {object} options
 * @param {object} options.baseline the collected baseline report
 * @param {object[]} [options.records] source records (a provider's answer, or a fixture)
 * @param {string} [options.now] assessment timestamp (tests pin it)
 * @param {{role: string, path: string, note: string}} [options.target] the reported target role
 * @returns {object} the assessment
 */
export function assessUpgrade(options) {
  const now = options.now ?? new Date().toISOString()
  const records = prepareSources(options.records, now)
  const components = COMPONENTS.map((component) => assessComponent({
    component,
    baseline: baselineOf(options.baseline, component),
    records,
  }))
  const conclusion = aggregateConclusion(components)
  for (const component of components) {
    // An item is recommended only when the RUN reaches a recommendation, so
    // does that item, AND the item is not a pending candidate: a baseline the
    // run could not compare (UPG-11) is listed with recommended: false, never
    // as something to apply.
    component.recommended = conclusion === 'recommend-candidate'
      && component.conclusion === 'recommend-candidate'
      && component.pendingVerification === false
  }
  const unverified = records.filter((record) => record.status !== 'verified')
  const complete = unverified.length === 0 && components.every((component) => component.verified === true)
  const pendingVerification = components.some((component) => component.pendingVerification === true)
  return {
    tool: UPGRADE_TOOL,
    version: UPGRADE_VERSION,
    generatedAt: now,
    target: options.target ?? { role: 'upgrade-target', path: 'unknown', note: 'Reported only: an assessed target is not a switch target.' },
    scope: {
      wrote: 'local-evaluation-report-only',
      mutated: [],
      installed: false,
      built: false,
      switched: false,
      announcedSuccess: false,
      note: 'No consent was asked or granted here: no manifest, lockfile, patch, dist or profile is touched, and no candidate is installed (ticket 05 boundary).',
    },
    conclusion,
    summary: CONCLUSION_SUMMARY[conclusion],
    complete,
    verified: complete && pendingVerification === false,
    pendingVerification,
    conclusions: Object.fromEntries(components.map((component) => [component.component, component.conclusion])),
    components,
    sources: { total: records.length, verified: records.length - unverified.length, unverified: unverified.length },
    manualActions: (components.find((component) => component.component === 'dsh')?.manualActions) ?? [],
    gaps: [
      ...(Array.isArray(options.baseline?.unknown) ? options.baseline.unknown : []),
      ...unverified.map((record) => 'source ' + record.component + '/' + record.kind + ' is ' + record.status + (record.detail === undefined ? '' : ': ' + record.detail)),
    ],
  }
}

/** The npm executable for this platform (a .cmd shim is what Windows resolves). */
function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/**
 * Refuse any metadata command outside the read-only allow-list.
 *
 * The list exists so an install can never be reached through the query path: a
 * query may read the registry and list refs, nothing else.
 * @param {'npm'|'git'} command the logical command
 * @param {string} verb its verb (the first argument)
 * @returns {void}
 */
export function assertReadOnly(command, verb) {
  if (!QUERY_ALLOWLIST.some((entry) => entry.command === command && entry.verb === verb)) {
    throw new Error('refused a metadata query outside the read-only allow-list: ' + command + ' ' + verb)
  }
}

/**
 * Parse a git ls-remote listing into commits and refs.
 * @param {string} stdout the command output
 * @returns {{commit: string, ref: string}[]} one entry per ref
 */
export function parseRefs(stdout) {
  return String(stdout).split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [commit, ref] = line.split(/\s+/u)
      return { commit, ref }
    })
    .filter((entry) => typeof entry.commit === 'string' && /^[0-9a-f]{7,40}$/u.test(entry.commit) && typeof entry.ref === 'string')
}

/**
 * The branch head to report, preferring the default branch.
 * @param {{commit: string, ref: string}[]} refs parsed refs
 * @returns {string | null} the commit, or null when no head was listed
 */
export function pickHead(refs) {
  const heads = refs.filter((entry) => entry.ref.startsWith('refs/heads/'))
  if (heads.length === 0) return null
  const preferred = heads.find((entry) => entry.ref === 'refs/heads/main') ?? heads.find((entry) => entry.ref === 'refs/heads/master')
  return (preferred ?? heads[0]).commit
}

/**
 * The tag that carries one published version, if the listing has it.
 *
 * An annotated tag is listed twice: the tag OBJECT and its dereferenced commit
 * (suffixed ^{}). The dereference is the commit that actually carries the
 * release, so it wins when both are present.
 * @param {{commit: string, ref: string}[]} refs parsed refs
 * @param {string} version the published version to look for
 * @returns {{commit: string, ref: string} | undefined} the matching tag
 */
export function findTagCommit(refs, version) {
  const wanted = String(version).replace(/^v/u, '')
  const matches = refs.filter((entry) => entry.ref.startsWith('refs/tags/')
    && entry.ref.replace(/^refs\/tags\//u, '').replace(/\^\{\}$/u, '').replace(/^v/u, '') === wanted)
  return matches.find((entry) => entry.ref.endsWith('^{}')) ?? matches[0]
}

/**
 * The DEFAULT metadata provider: read-only registry and ref queries.
 *
 * Every failure is a recorded unverified channel with its reason, never a
 * guessed version and never an install: the ticket forbids using an install in
 * place of an unavailable query, and "latest" is only written when a registry
 * actually answered. The runner is injectable so the failure paths are testable
 * without a network.
 * @param {object} [options]
 * @param {(command: string, args: string[]) => string} [options.runner] the process runner
 * @param {string} [options.now] a pinned query time (tests)
 * @param {Record<string, string>} [options.packages] package name per component
 * @param {Record<string, string>} [options.repositories] upstream git URL per component
 * @returns {(component: string) => Promise<object[]>} the query
 */
export function createMetadataQueries(options = {}) {
  const runner = options.runner ?? ((command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  const clock = () => options.now ?? new Date().toISOString()
  const packages = {
    dsh: '@deepseek-ai/dsh',
    hashline: '@hy-sde-org/dsh-hashline',
    'tool-edit': '@hy-sde-org/dsh-tool-edit',
    ...options.packages,
  }
  const repositories = options.repositories ?? {}
  return async function query(component) {
    const name = packages[component]
    const registryUrl = 'https://registry.npmjs.org/' + name
    const gitUrl = repositories[component]
    const queriedAt = clock()
    const messageOf = (error) => (error instanceof Error ? error.message : String(error))

    // 1) ONE read-only ref listing: branch heads AND release tags. Whether the
    //    head is a published release is then decided from data, not assumed.
    let refs
    try {
      if (typeof gitUrl !== 'string' || gitUrl === '') throw new Error('the upstream repository URL is unknown, so no commit-level query was made')
      assertReadOnly('git', 'ls-remote')
      refs = { entries: parseRefs(runner('git', ['ls-remote', gitUrl])) }
    } catch (error) {
      refs = { error: messageOf(error) }
    }
    // 2) The registry metadata: the stable release and the pre-release channel.
    let registry
    try {
      assertReadOnly('npm', 'view')
      registry = { tags: JSON.parse(String(runner(npmCommand(), ['view', name, 'dist-tags', '--json']))) }
    } catch (error) {
      registry = { error: messageOf(error) }
    }

    const stable = registry.error === undefined && typeof registry.tags?.latest === 'string' ? registry.tags.latest : null
    const channelTag = registry.error === undefined ? Object.keys(registry.tags ?? {}).filter((tag) => tag !== 'latest').sort()[0] : undefined
    const releaseTag = stable === null || refs.error !== undefined ? undefined : findTagCommit(refs.entries, stable)

    const records = []
    if (registry.error === undefined) {
      records.push({
        component,
        kind: 'release',
        status: stable === null ? 'unknown' : 'verified',
        queriedAt,
        source: 'npm view ' + name + ' dist-tags',
        version: stable,
        // The release tag's commit makes this evidence concrete; it stays null
        // when the registry answered but no tag matches the published version.
        commit: releaseTag === undefined ? null : releaseTag.commit,
        url: registryUrl,
        ...stable === null ? { detail: 'the registry metadata carries no "latest" dist-tag' } : {},
      })
      records.push({
        component,
        kind: 'prerelease',
        // A registry that answered and publishes no other tag is a VERIFIED
        // absence, which keeps "no pre-release exists" apart from "nobody asked".
        status: 'verified',
        queriedAt,
        source: 'npm view ' + name + ' dist-tags',
        version: channelTag === undefined ? null : (typeof registry.tags[channelTag] === 'string' ? registry.tags[channelTag] : null),
        commit: null,
        url: registryUrl,
        ...channelTag === undefined ? { detail: 'no pre-release dist-tag is published' } : {},
      })
    } else {
      for (const kind of ['release', 'prerelease']) {
        records.push({
          component,
          kind,
          status: 'unverified',
          queriedAt,
          source: 'npm view ' + name + ' dist-tags',
          version: null,
          commit: null,
          url: null,
          detail: 'the registry query failed: ' + registry.error,
        })
      }
    }

    if (refs.error !== undefined) {
      records.push({
        component,
        kind: 'commit',
        status: 'unverified',
        queriedAt,
        source: typeof gitUrl === 'string' ? 'git ls-remote ' + gitUrl : 'none',
        version: null,
        commit: null,
        url: null,
        detail: 'the commit-level query failed: ' + refs.error,
      })
      return records
    }
    const head = pickHead(refs.entries)
    // The head is a published release only when it IS the release tag's commit.
    // Anything else means commits exist beyond that release; their diff is not
    // fetched here, so the record states only what the ref listing proves.
    const unreleased = head === null || releaseTag === undefined ? 'unknown' : releaseTag.commit === head ? false : true
    records.push({
      component,
      kind: 'commit',
      status: head === null ? 'unknown' : 'verified',
      queriedAt,
      source: 'git ls-remote ' + gitUrl,
      version: null,
      commit: head,
      url: gitUrl,
      unreleased,
      ...head === null
        ? { detail: 'the remote reported no branch head' }
        : unreleased === false
          ? { detail: 'the branch head is the commit of release tag ' + releaseTag.ref }
          : unreleased === true
            ? { detail: 'the branch head is not the commit of release tag ' + releaseTag.ref + ': commits beyond the published release exist, and their diff was not fetched' }
            : { detail: 'no tag matches the published version, so whether the head is published is unknown' },
    })
    return records
  }
}

/** The directory a manifest path points at, or null when the path is unknown. */
function directoryOf(manifestPath) {
  if (typeof manifestPath !== 'string' || manifestPath === '' || manifestPath === 'unknown') return null
  return dirname(manifestPath)
}

/** A resolved directory, or null when the baseline could not resolve it. */
function directoryOrNull(maybeDirectory) {
  if (typeof maybeDirectory !== 'string' || maybeDirectory === '' || maybeDirectory.startsWith('unknown')) return null
  return maybeDirectory
}

/**
 * The upstream git URL of each component, read from its RESOLVED manifest.
 *
 * Only a declared repository field is used: an unreachable or undeclared one
 * leaves that component without a git URL, which the provider reports as an
 * unverified commit channel instead of a guessed repository.
 * @param {object} baseline the collected baseline report
 * @returns {Promise<Record<string, string>>} git URL per component
 */
export async function upstreamRepositories(baseline) {
  const candidates = {
    dsh: directoryOf(baseline?.resolvedPaths?.dsh),
    hashline: directoryOrNull(baseline?.realpaths?.hashline),
    'tool-edit': directoryOrNull(baseline?.realpaths?.toolEdit),
  }
  const repositories = {}
  for (const [component, directory] of Object.entries(candidates)) {
    if (directory === null) continue
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      const raw = typeof manifest.repository === 'string' ? manifest.repository : (typeof manifest.repository?.url === 'string' ? manifest.repository.url : undefined)
      if (typeof raw !== 'string' || raw === '') continue
      repositories[component] = raw.replace(/^git\+/u, '')
    } catch {
      // Not a silent catch: a missing or unreadable manifest leaves this
      // component without a git URL, and the provider reports that channel as
      // unverified rather than guessing a repository.
    }
  }
  return repositories
}

/**
 * Render the human-readable evaluation report.
 * @param {object} assessment the assessment
 * @returns {string} markdown
 */
export function renderUpgradeReport(assessment) {
  const lines = []
  const quoted = (value) => '`' + (value === undefined || value === null || value === '' ? 'unknown' : String(value)) + '`'
  lines.push('# Upgrade 只读评估 — ' + assessment.generatedAt)
  lines.push('')
  lines.push('- 结论：**' + assessment.conclusion + '** —— ' + assessment.summary)
  lines.push('- 目标角色：' + quoted(assessment.target.role) + '（' + quoted(assessment.target.path) + '）—— 仅报告，未切换')
  lines.push('- 证据完整性：' + (assessment.complete ? '完整' : '不完整') + '（来源 ' + assessment.sources.verified + '/' + assessment.sources.total + ' 已核实）')
  lines.push('- 已核实：' + (assessment.verified ? '是' : '否') + (assessment.pendingVerification ? '（含待验证候选：不标为已核实、不宣告成功）' : ''))
  lines.push('')
  lines.push('## 组件结论')
  lines.push('')
  lines.push('| 组件 | 当前版本 | 补丁状态 | 结论 | 是否推荐 | 说明 |')
  lines.push('|---|---|---|---|---|---|')
  for (const component of assessment.components) {
    lines.push('| ' + component.label + ' | ' + quoted(component.baseline.version) + ' | ' + quoted(component.baseline.patch.status) + ' | ' + component.conclusion + ' | ' + (component.recommended ? '是' : '否') + ' | ' + component.reason + ' |')
  }
  lines.push('')
  lines.push('“是否推荐＝是”只标在本次确实推荐的项上：待验证候选（基线无法比较）、暂缓项与证据不足项一律记 recommended: false，不得据此执行切换。')
  lines.push('')
  lines.push('## 来源（每次查询都留痕：正式版 / 预发布 / 未发布 commit 分开记录）')
  lines.push('')
  lines.push('| 组件 | 渠道 | 版本或 commit | 状态 | 查询时间 | 来源 | 链接 |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const component of assessment.components) {
    for (const kind of SOURCE_KINDS) {
      const channel = component.channels[kind]
      // A verified channel with no version is a VERIFIED ABSENCE ("none published"),
      // which must not read like the 'unknown' of an unqueried source.
      const cell = channel.version !== null ? quoted(channel.version)
        : channel.commit !== null ? quoted(channel.commit)
          : channel.status === 'verified' ? '无（未发布）' : quoted('unknown')
      lines.push('| ' + component.label + ' | ' + kind + ' | ' + cell + ' | ' + channel.status + ' | ' + quoted(channel.queriedAt) + ' | ' + quoted(channel.source) + ' | ' + (channel.url === null ? '—' : channel.url) + ' |')
    }
  }
  lines.push('')
  lines.push('一个不可用的来源记 unverified：它既不是「已是最新」，也不是「没有更新」。')
  lines.push('')
  lines.push('## 影响面（UPG-02）')
  lines.push('')
  lines.push('| 组件 | 需核对的契约面 | 本次 diff 申报触及 |')
  lines.push('|---|---|---|')
  for (const component of assessment.components) {
    lines.push('| ' + component.label + ' | ' + component.impact.surface.join(', ') + ' | ' + (component.impact.affected.length === 0 ? '（来源未申报）' : component.impact.affected.join(', ')) + ' |')
  }
  lines.push('')
  const withPatches = assessment.components.filter((component) => component.patches.length > 0)
  if (withPatches.length > 0) {
    lines.push('## 逐项补丁决策（按语义，不按能否应用）')
    lines.push('')
    lines.push('| 组件 | 文件 | 标记 | 决策 | 理由 |')
    lines.push('|---|---|---|---|---|')
    for (const component of withPatches) {
      for (const item of component.patches) {
        lines.push('| ' + component.label + ' | ' + quoted(item.file) + ' | ' + quoted(item.marker) + ' | ' + item.decision + ' | ' + item.reason + ' |')
      }
    }
    lines.push('')
    lines.push('keep = 候选里同一行为的标记仍在且未被上游替代；redo = 上游改了同一处，需按新代码重做；delete = 上游已实现同一行为。')
    lines.push('')
  }
  lines.push('## 官方 DSH：影响与人工处理建议（UPG-08）')
  lines.push('')
  for (const action of assessment.manualActions) lines.push('- ' + action)
  lines.push('')
  lines.push('本工作流不 checkout、不 install、不修改官方 DSH 的全局安装、应用包或启动配置；上表只给影响与人工建议。')
  lines.push('')
  if (assessment.gaps.length > 0) {
    lines.push('## 缺口（未核实的地方逐条列出）')
    lines.push('')
    for (const gap of assessment.gaps) lines.push('- ' + gap)
    lines.push('')
  }
  lines.push('## 边界与未做')
  lines.push('')
  lines.push('- 只写了本地评估报告：本次写入范围就是本目录（assessment.json / report.md / sources.json）。')
  lines.push('- 未修改 manifest / lockfile / patch / dist / profile，未安装、未构建、未切换目标，未宣告升级成功。')
  lines.push('- 未获用户同意前不进入方案、候选安装与目标切换；--yes 之类的自动接受不构成同意。')
  lines.push('')
  return lines.join('\n')
}

/**
 * The evidence directory for one assessment: <evidence>/upgrades/<stamp>/.
 * @param {string} evidenceDirectory the configured evidence root
 * @param {string | Date} [at] assessment timestamp (tests pin it)
 * @returns {string} the assessment directory
 */
export function upgradeDirectory(evidenceDirectory, at) {
  const when = at instanceof Date ? at : new Date(at ?? Date.now())
  if (Number.isNaN(when.getTime())) throw new Error('the assessment timestamp must be a valid date')
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = String(when.getUTCFullYear()) + pad(when.getUTCMonth() + 1) + pad(when.getUTCDate()) + '-' + pad(when.getUTCHours()) + pad(when.getUTCMinutes()) + pad(when.getUTCSeconds())
  return join(evidenceDirectory, 'upgrades', stamp)
}

/**
 * Write the three local evaluation files.
 * @param {{directory: string, assessment: object, records: object[]}} options the run's facts
 * @returns {Promise<{assessment: string, report: string, sources: string}>} the written paths
 */
export async function writeUpgradeAssessment(options) {
  // Render before creating the directory: a render bug must not leave an empty
  // assessment behind (the same lesson ADR-0004 records for partial writes).
  const report = renderUpgradeReport(options.assessment)
  const sources = {
    tool: UPGRADE_TOOL,
    version: UPGRADE_VERSION,
    generatedAt: options.assessment.generatedAt,
    note: 'Each record keeps its query time, channel (release / prerelease / commit) and status. unverified is never a claim of "latest".',
    records: options.records.map(publicSource),
  }
  await mkdir(options.directory, { recursive: true })
  const files = {
    assessment: join(options.directory, 'assessment.json'),
    report: join(options.directory, 'report.md'),
    sources: join(options.directory, 'sources.json'),
  }
  await writeFile(files.assessment, JSON.stringify(options.assessment, null, 2) + '\n', 'utf8')
  await writeFile(files.report, report + '\n', 'utf8')
  await writeFile(files.sources, JSON.stringify(sources, null, 2) + '\n', 'utf8')
  return files
}