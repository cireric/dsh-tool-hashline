/**
 * The engine comparator (ticket 04): what has actually been PUBLISHED for the two
 * exact-version engine packages, against what this project pins, and what that
 * means for the local patches.
 *
 * Three rules decide the shape of this module:
 *
 *   - The published VERSION LIST is the authority, not a dist-tag. A tag can point
 *     at a pre-release (both packages' "latest" does today), and a published
 *     version can carry no tag at all. Stable and pre-release candidates are
 *     therefore classified by SEMVER, sorted by semver, and listed separately.
 *   - A failed query is BLOCKED, never "no update". Each engine is asked
 *     independently with a bounded timeout, so one failure cannot erase the other
 *     engine's answer, and no earlier round's data is reused as if it were current.
 *   - A version number or a patch marker proves nothing about behaviour. The
 *     patch items stay pending-verification until the controlled candidate
 *     validation reads the candidate package's own bytes, and the two-engine
 *     combination stays pending-verification until that flow runs.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/sync-engines
 */
import { compareVersions, parseVersion, PATCH_MARKERS } from './upgrades.mjs'
import { captureStreams, QueryTimeoutError } from './sync-run.mjs'
import { hashOf, sha256Of } from './sync-hash.mjs'

/** The area this comparator covers. */
export const ENGINES_AREA = 'engines'

/** Bumped when a checkpoint's identity changes meaning, not when a version changes. */
export const ENGINES_COMPARATOR_VERSION = 1

/** The two engine packages, in report order. */
export const ENGINE_ORDER = ['hashline', 'tool-edit']

/** The exact package each engine anchor pins. */
export const ENGINE_PACKAGES = {
  hashline: '@hy-sde-org/dsh-hashline',
  'tool-edit': '@hy-sde-org/dsh-tool-edit',
}

/** The query budget one engine's release lookup is given. */
export const DEFAULT_QUERY_TIMEOUT_MS = 20_000

/** The release channels, in report order. */
export const CHANNELS = ['stable', 'prerelease']

/**
 * Split published versions into the two channels, sorted by semver.
 *
 * Classification is by the version's own pre-release part, because a dist-tag is
 * an editorial label: these packages tag a pre-release as "latest", and a version
 * with no tag is still published. An unparsable version is reported, never waved
 * through.
 * @param {string[]} versions the published versions
 * @returns {{stable: string[], prerelease: string[], invalid: string[]}} the channels
 */
export function classifyVersions(versions) {
  const parsed = []
  const invalid = []
  for (const raw of Array.isArray(versions) ? versions : []) {
    const facts = parseVersion(raw)
    if (facts === null) {
      invalid.push(String(raw))
      continue
    }
    parsed.push({ version: String(raw), prerelease: facts.pre.length > 0 })
  }
  parsed.sort((left, right) => compareVersions(left.version, right.version) ?? 0)
  return {
    stable: parsed.filter((entry) => !entry.prerelease).map((entry) => entry.version),
    prerelease: parsed.filter((entry) => entry.prerelease).map((entry) => entry.version),
    invalid,
  }
}

/**
 * The highest version of a sorted list.
 * @param {string[]} versions ascending versions
 * @returns {string | undefined} the highest
 */
export function highest(versions) {
  return versions.length === 0 ? undefined : versions[versions.length - 1]
}

/**
 * Every version strictly above the fixed one, in semver order.
 * @param {{fixed: string, ordered: string[]}} options the pin and the full order
 * @returns {string[]} the newer versions
 */
export function newerThan(options) {
  const fixed = options.fixed
  if (parseVersion(fixed) === null) return []
  return options.ordered.filter((version) => (compareVersions(version, fixed) ?? 0) > 0)
}

/**
 * The update basis from the pinned version to one candidate.
 *
 * A single step and a long climb look the same in a version number, so the
 * versions in between are listed. "No intermediate version" is a statement about
 * PUBLISHED versions only — it never means "no upstream change", and the note says
 * so because the release notes are outside a read-only metadata query.
 * @param {{fixed: string, candidate: string, ordered: string[]}} options the step
 * @returns {object} the basis
 */
export function updateBasis(options) {
  const steps = newerThan({ fixed: options.fixed, ordered: options.ordered })
  const index = steps.indexOf(options.candidate)
  const upTo = index < 0 ? steps : steps.slice(0, index + 1)
  return {
    fixed: options.fixed,
    candidate: options.candidate,
    direction: (compareVersions(options.candidate, options.fixed) ?? 0) > 0 ? 'newer' : 'not-newer',
    steps: upTo,
    intermediate: upTo.slice(0, Math.max(0, upTo.length - 1)),
    note: '列出的是已发布的中间版本：上游发布说明不在只读元数据查询范围内，因此「没有中间版本」只说明没有中间发布，不说明上游没有改动',
  }
}

/**
 * Normalise one release-source record, or refuse.
 *
 * This is the fixture seam for the external source (the same boundary the upgrade
 * assessment uses): a test or a maintainer can pin the answer, and a malformed
 * record is refused instead of being read as "nothing published".
 * @param {object} record the raw record
 * @returns {object} the normalised record
 * @throws {Error} when the record cannot be read
 */
export function normalizeReleaseSource(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new Error('a release-source record must be an object')
  const name = record.package ?? record.component
  if (typeof name !== 'string' || !Object.values(ENGINE_PACKAGES).includes(name)) {
    throw new Error('release-source record names an unknown package: ' + JSON.stringify(name) + '; expected one of ' + Object.values(ENGINE_PACKAGES).join(', '))
  }
  if (record.status !== 'verified' && record.status !== 'failed') {
    throw new Error('release-source record has an unknown status: ' + JSON.stringify(record.status) + '; a channel is verified or failed, and a typo must not read as a failed query')
  }
  const queriedAt = typeof record.queriedAt === 'string' ? record.queriedAt : new Date().toISOString()
  if (Number.isNaN(Date.parse(queriedAt))) throw new Error('release-source record has an unparsable queriedAt: ' + JSON.stringify(record.queriedAt))
  const versions = record.versions === undefined ? [] : record.versions
  if (!Array.isArray(versions)) throw new Error('release-source record versions must be an array')
  const tags = record.tags !== null && typeof record.tags === 'object' && !Array.isArray(record.tags) ? record.tags : {}
  return {
    package: name,
    status: record.status,
    queriedAt,
    source: typeof record.source === 'string' ? record.source : 'unspecified',
    versions: versions.filter((entry) => typeof entry === 'string'),
    tags: Object.fromEntries(Object.entries(tags).filter(([, value]) => typeof value === 'string')),
    timeout: record.timeout === true,
    ...record.detail === undefined ? {} : { detail: String(record.detail) },
  }
}

/**
 * Normalise a list of records, one per package at most.
 * @param {object[]} records the raw records
 * @returns {Map<string, object>} the records by package
 * @throws {Error} when two records claim the same package
 */
export function normalizeReleaseSources(records) {
  if (!Array.isArray(records)) throw new Error('release sources must be an array of records')
  const byPackage = new Map()
  for (const record of records) {
    const normalized = normalizeReleaseSource(record)
    if (byPackage.has(normalized.package)) {
      throw new Error('two release-source records claim ' + normalized.package + ': one package has one answer, so this run refuses instead of picking the first')
    }
    byPackage.set(normalized.package, normalized)
  }
  return byPackage
}

/**
 * Ask the registry for one package's published versions and tags.
 *
 * Read-only and bounded: npm view, no install, no download, and a timeout the
 * caller sets. A timeout is its own failure so the report can say so.
 * @param {object} options the query
 * @param {string} options.package the package name
 * @param {string} options.queriedAt the query time to record
 * @param {number} [options.timeoutMs] the budget
 * @param {Function} [options.runner] injectable runner (tests pass a stub)
 * @returns {object} the release-source record
 */
export function queryReleaseSource(options) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS
  const source = 'npm view ' + options.package + ' versions dist-tags --json'
  // The package name comes from the constant table above, and it is re-validated
  // here because on Windows the .cmd shim needs a shell: nothing but a plain
  // scoped name may ever reach it.
  if (!/^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u.test(options.package)) {
    return normalizeReleaseSource({ package: options.package === undefined ? '' : options.package, status: 'failed', queriedAt: options.queriedAt, source, detail: 'refused: the package name is not a plain scoped name (' + JSON.stringify(options.package) + ')' })
  }
  const args = ['view', options.package, 'versions', 'dist-tags', '--json']
  try {
    if (options.runner !== undefined) {
      // An injected runner returns the text directly; the shape is parsed below.
      const text = String(options.runner('npm', args, { timeoutMs, encoding: 'utf8' }))
      return parseReleaseAnswer({ package: options.package, queriedAt: options.queriedAt, source, text })
    }
    // Windows resolves npm through a .cmd shim, which needs a command
    // interpreter; composing that invocation here keeps spawnSync itself
    // shell-free, so no argument is ever re-parsed.
    const windows = process.platform === 'win32'
    const captured = windows
      ? captureStreams('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { timeoutMs })
      : captureStreams('npm', args, { timeoutMs })
    if (captured.timedOut) throw new QueryTimeoutError('npm view', timeoutMs)
    if (captured.status !== 0) {
      throw new Error('npm view exited ' + String(captured.status) + ': ' + (captured.stderr.trim().split('\n')[0] ?? ''))
    }
    return parseReleaseAnswer({ package: options.package, queriedAt: options.queriedAt, source, text: captured.stdout })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return normalizeReleaseSource({
      package: options.package,
      status: 'failed',
      queriedAt: options.queriedAt,
      source,
      detail: message,
      timeout: error?.timeout === true || error?.name === 'QueryTimeoutError',
    })
  }
}

/**
 * Turn one registry answer into a release-source record.
 * @param {{package: string, queriedAt: string, source: string, text: string}} options the answer
 * @returns {object} the normalised record
 * @throws {Error} when the answer is not the documented shape
 */
function parseReleaseAnswer(options) {
  let parsed
  try {
    parsed = JSON.parse(options.text)
  } catch (error) {
    throw new Error('the registry answer is not JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
  const answer = Array.isArray(parsed) ? parsed[0] : parsed
  const versions = Array.isArray(answer?.versions) ? answer.versions : Array.isArray(answer) ? answer : undefined
  if (versions === undefined) throw new Error('the registry answer carries no versions array')
  const tags = answer?.['dist-tags'] ?? answer?.distTags ?? {}
  return normalizeReleaseSource({ package: options.package, status: 'verified', queriedAt: options.queriedAt, source: options.source, versions, tags: tags ?? {} })
}

/**
 * One engine's baseline facts, from the collected project baseline.
 * @param {object} project the project baseline
 * @param {string} engine hashline | tool-edit
 * @returns {{declared: string, locked: string, installed: string, patchStatus: string, present: string[], missing: string[]}} the facts
 */
export function engineBaseline(project, engine) {
  const specifier = ENGINE_PACKAGES[engine]
  const anchor = project?.declarations?.anchors?.[engine === 'hashline' ? 'hashline' : 'toolEdit']
  const locked = (project?.locked?.entries ?? []).find((entry) => entry.specifier === specifier)
  const installed = project?.installed?.engines?.[engine === 'hashline' ? 'hashline' : 'toolEdit']
  return {
    declared: typeof anchor?.declaredVersion === 'string' ? anchor.declaredVersion : 'unknown',
    locked: typeof locked?.version === 'string' ? locked.version : 'unknown',
    installed: typeof installed?.version === 'string' ? installed.version : 'unknown',
    patchStatus: installed?.patch?.status ?? 'unknown',
    present: Array.isArray(installed?.patch?.present) ? installed.patch.present : [],
    missing: Array.isArray(installed?.patch?.missing) ? installed.patch.missing : [],
  }
}

/** The first version that is known, in the order declared -> locked -> installed. */
function fixedVersionOf(baseline) {
  for (const candidate of [baseline.installed, baseline.locked, baseline.declared]) {
    if (candidate !== 'unknown') return candidate
  }
  return 'unknown'
}

/**
 * The patch items for one engine, decided only as far as the evidence goes.
 * @param {string} engine the engine
 * @param {object} baseline its baseline facts
 * @param {string | undefined} candidate the candidate version, when one exists
 * @returns {object[]} one item per marker
 */
export function patchItems(engine, baseline, candidate) {
  const markers = PATCH_MARKERS[engine] ?? []
  return markers.map(({ file, marker }, index) => ({
    // The index is what makes this id stable and unique: two markers can live in
    // the same file, and a file-path id would collide.
    index,
    file: file.join('/'),
    marker,
    decision: 'pending-verification',
    reason: '候选包文本不在只读查询范围内：无法判断该标记在候选里是否仍在；需在受控候选验证阶段读取候选包自身字节后判定',
    evidence: {
      resolvedBuildHasMarker: baseline.present.includes(marker),
      resolvedBuildMissingMarker: baseline.missing.includes(marker),
      candidate: candidate ?? null,
    },
  }))
}

/**
 * Compare the published engine releases with this project's pins.
 * @param {object} context the run's facts
 * @param {object} context.project the project baseline
 * @param {object} [context.options] the run options (release sources, runner, timeout)
 * @param {string} [context.now] the check timestamp
 * @returns {object} the area result
 */
export function compareEnginesArea(context) {
  const options = context.options ?? {}
  const injected = options.releaseSources instanceof Map ? options.releaseSources : undefined
  const runner = options.deps?.runner
  const timeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS
  const now = context.now ?? new Date().toISOString()
  const gaps = []
  const checklist = []
  const differences = []
  const engines = []
  const releaseQueries = []
  const cacheUsed = false

  for (const engine of ENGINE_ORDER) {
    const specifier = ENGINE_PACKAGES[engine]
    const baseline = engineBaseline(context.project, engine)
    const fixed = fixedVersionOf(baseline)
    releaseQueries.push({ package: specifier, mode: injected?.has(specifier) ? 'fixed-response' : runner === undefined ? 'npm' : 'injected-runner' })
    const record = injected?.get(specifier) ?? queryReleaseSource({ package: specifier, queriedAt: now, timeoutMs, runner })

    // The baseline itself: declared, locked and installed must agree, or the pin
    // this whole comparison starts from is not a single fact.
    const known = [baseline.declared, baseline.locked, baseline.installed].filter((entry) => entry !== 'unknown')
    const baselineConsistent = new Set(known).size <= 1 && known.length > 0
    checklist.push({
      id: 'engines.' + engine + '.baseline',
      object: '本项目 ' + specifier + ' 的声明 / 锁定 / 实际解析版本',
      impact: 'version',
      // One identity basis on both sides, so an equal digest always means the
      // three slots agreed: a reader must never see "same" beside two different
      // hashes.
      left: { source: 'package.json + pnpm-lock.yaml + 实际解析', identity: hashOf(known), present: known.length > 0 },
      right: { source: baselineConsistent ? '同一份基线（三处一致）' : '同一份基线（去重后）', identity: baselineConsistent ? hashOf(known) : hashOf([...new Set(known)]), present: true },
      status: baselineConsistent ? 'same' : 'changed',
    })
    if (!baselineConsistent) {
      differences.push({
        id: 'engines.' + engine + '.baseline.mismatch',
        area: ENGINES_AREA,
        object: specifier + ' 的声明 / 锁定 / 实际解析版本不一致',
        impact: 'version',
        left: { source: '基线三元组', identity: hashOf(known), present: true },
        right: { source: '基线三元组（去重）', identity: hashOf([...new Set(known)]), present: true },
        change: 'changed',
        disposition: 'pending-analysis',
        reason: '本项目的声明、锁定与实际解析版本不一致（' + known.join(' / ') + '）：这是本端状态问题，不是上游变化，先确认为什么不同再判断更新',
        recheckWhen: '重新安装或修正声明后重新检查',
        evidence: ['packages/hashline/package.json', 'packages/tool-edit/package.json', 'pnpm-lock.yaml'],
      })
    }

    if (record.status !== 'verified') {
      gaps.push({
        id: 'engines.' + engine,
        status: 'BLOCKED',
        detail: (record.timeout === true ? '发布来源查询超时' : '发布来源不可用') + '（' + record.source + '）：' + (record.detail ?? 'no detail') + '。本轮不判断该引擎是否有更新，也不回退到历史结果',
      })
      checklist.push({
        id: 'engines.' + engine + '.channel',
        object: specifier + ' 的已发布版本枚举',
        impact: 'version',
        left: { source: '本项目固定版本', identity: fixed, present: fixed !== 'unknown' },
        right: { source: record.source, identity: 'unavailable', present: false },
        status: 'unreadable',
      })
      engines.push({ engine, package: specifier, baseline, fixed, status: 'blocked', record: { source: record.source, queriedAt: record.queriedAt, timeout: record.timeout === true, detail: record.detail ?? null } })
      continue
    }

    const channels = classifyVersions(record.versions)
    const ordered = [...channels.prerelease, ...channels.stable].sort((left, right) => compareVersions(left, right) ?? 0)
    const candidate = highest(ordered)
    const stableHighest = highest(channels.stable)
    const prereleaseHighest = highest(channels.prerelease)
    const tagged = new Set(Object.values(record.tags))
    const untagged = ordered.filter((version) => !tagged.has(version))
    const basis = candidate === undefined || fixed === 'unknown' ? undefined : updateBasis({ fixed, candidate, ordered })

    for (const channel of CHANNELS) {
      const list = channels[channel]
      const top = highest(list)
      checklist.push({
        id: 'engines.' + engine + '.channel.' + channel,
        object: specifier + ' 的' + (channel === 'stable' ? '正式版' : '预发布') + '渠道（已发布 ' + String(list.length) + ' 个）',
        impact: 'version',
        left: { source: '本项目固定版本', identity: fixed, present: fixed !== 'unknown' },
        right: { source: record.source, identity: top ?? 'none-published', present: top !== undefined },
        status: top === undefined ? 'only-local' : (compareVersions(top, fixed) ?? 0) > 0 ? 'changed' : 'same',
      })
    }

    checklist.push({
      id: 'engines.' + engine + '.update',
      object: '固定版本 ' + fixed + ' 至候选 ' + (candidate ?? 'none'),
      impact: 'version',
      left: { source: '本项目固定版本', identity: fixed, present: fixed !== 'unknown' },
      right: { source: record.source, identity: candidate ?? 'none-published', present: candidate !== undefined },
      status: candidate === undefined ? 'only-local' : (compareVersions(candidate, fixed) ?? 0) > 0 ? 'changed' : 'same',
    })
    if (candidate !== undefined && fixed !== 'unknown' && (compareVersions(candidate, fixed) ?? 0) > 0) {
      differences.push({
        id: 'engines.' + engine + '.update',
        area: ENGINES_AREA,
        object: specifier + ' ' + fixed + ' -> ' + candidate,
        impact: 'version',
        left: { source: '本项目固定版本（声明 / 锁定 / 解析）', identity: fixed, present: true },
        right: { source: record.source + ' @ ' + record.queriedAt, identity: candidate, present: true },
        change: 'changed',
        disposition: 'pending-analysis',
        reason: '有版本更新、影响待查：候选 ' + candidate + ' 高于固定版本 ' + fixed + '，中间已发布版本 ' + String(basis?.intermediate.length ?? 0) + ' 个' + (channels.stable.length === 0 ? '；该包未发布任何正式版，只有预发布' : '') + '；是否跟进需要更新内容与补丁影响依据，版本号本身不构成结论',
        recheckWhen: '取得候选的更新内容（发布说明或候选包字节）后重新判定；或上游发布新的更高版本时重新检查',
        evidence: [record.source, 'versions: ' + String(record.versions.length) + ' 个', 'tags: ' + JSON.stringify(record.tags)],
      })
    }

    const items = patchItems(engine, baseline, candidate)
    checklist.push({
      id: 'engines.' + engine + '.patch',
      object: specifier + ' 的本地补丁标记（' + String(items.length) + ' 项，候选包文本未取得）',
      impact: 'patch',
      left: { source: '解析后的构建文件里的标记', identity: hashOf(baseline.present), present: baseline.present.length > 0 },
      right: { source: '候选包（未取得）', identity: 'pending-verification', present: false },
      // The candidate's bytes were never read, so this comparison is not
      // "unchanged" — it is unreadable on one side, and the difference records
      // below carry the reason.
      status: 'unreadable',
    })
    for (const item of items) {
      differences.push({
        id: 'engines.' + engine + '.patch[' + String(item.index) + ']',
        area: ENGINES_AREA,
        object: specifier + ' 补丁 ' + item.file + ' :: ' + item.marker,
        impact: 'patch',
        left: { source: '解析后的构建文件', identity: sha256Of(item.marker), present: item.evidence.resolvedBuildHasMarker },
        right: { source: '候选 ' + (candidate ?? 'none') + ' 的包文本', identity: 'pending-verification', present: false },
        change: 'changed',
        disposition: 'pending-analysis',
        reason: '候选包文本未取得，补丁是否仍需保留只能由受控候选验证判定：标记在候选里是否仍在、上游是否已实现同一行为都未知；版本号或标记存在都不是语义已修复的证据',
        recheckWhen: '候选验证阶段读取候选包字节后逐项判定 keep / redo / delete',
        basis: 'docs/specs/2026-10-22-ptc-hashline-requirements-spec.md（补丁维护规则）、tests/compat/README.md',
        evidence: ['tests/compat/README.md', 'patches/'],
      })
    }

    engines.push({
      engine,
      package: specifier,
      status: 'queried',
      baseline,
      fixed,
      source: { source: record.source, queriedAt: record.queriedAt },
      published: { total: record.versions.length, stable: channels.stable, prerelease: channels.prerelease, invalid: channels.invalid, tags: record.tags, untagged },
      candidates: { stable: stableHighest ?? null, prerelease: prereleaseHighest ?? null, highest: candidate ?? null },
      update: basis ?? null,
      patches: items,
    })
  }

  // The combination both engines are evaluated as a PAIR, never one at a time:
  // the two are exact-version anchors that must move together.
  const declaredPair = { hashline: 'unknown', 'tool-edit': 'unknown' }
  const candidatePair = { hashline: null, 'tool-edit': null }
  for (const entry of engines) {
    declaredPair[entry.engine] = entry.fixed
    if (entry.status === 'queried') candidatePair[entry.engine] = entry.candidates.highest
  }
  const pairKnown = Object.values(candidatePair).every((value) => value !== null)
  const sameStep = pairKnown && (compareVersions(candidatePair.hashline, candidatePair['tool-edit']) ?? 1) === 0
  checklist.push({
    id: 'engines.combination',
    object: '两个引擎的声明组合与候选组合',
    impact: 'combination',
    left: { source: '本项目声明', identity: hashOf(declaredPair), present: true },
    right: { source: pairKnown ? '发布来源的候选组合' : '未取得', identity: pairKnown ? hashOf(candidatePair) : 'unavailable', present: pairKnown },
    status: pairKnown && sameStep ? 'changed' : 'unreadable',
  })
  if (pairKnown) {
    differences.push({
      id: 'engines.combination',
      area: ENGINES_AREA,
      object: 'hashline ' + candidatePair.hashline + ' + tool-edit ' + candidatePair['tool-edit'],
      impact: 'combination',
      left: { source: '本项目声明组合', identity: hashOf(declaredPair), present: true },
      right: { source: '发布来源的候选组合', identity: hashOf(candidatePair), present: true },
      change: 'changed',
      disposition: 'pending-analysis',
      reason: '候选组合' + (sameStep ? '两个包落在同一语义版本' : '两个包的候选版本不同（' + String(candidatePair.hashline) + ' / ' + String(candidatePair['tool-edit']) + '）') + '：组合兼容性只能由受控候选验证证明，本检查不安装、不执行、不称组合已通过',
      recheckWhen: '进入受控候选验证（upgrade validate）后，按候选树实际解析结果重新判定',
      basis: 'tests/compat/README.md（兼容矩阵与补丁维护规则）',
      evidence: ['tests/compat/README.md'],
    })
  }

  differences.sort((one, other) => one.id.localeCompare(other.id))
  const blocked = gaps.length > 0
  const pending = differences.filter((entry) => entry.disposition === 'pending-analysis').length
  return {
    status: blocked ? 'incomplete' : 'covered',
    detail: blocked
      ? '发布来源有' + String(gaps.length) + '个引擎不可用：本轮不判断这些引擎是否有更新，也不使用历史结果'
      : '两个引擎的已发布版本按语义版本分类比较（稳定 / 预发布分开），补丁与组合只到待验证：' + String(checklist.length) + ' 个检查点，' + String(differences.length) + ' 条记录（全部待分析）',
    checks: checklist.length,
    differences,
    checklist,
    gaps,
    recommendations: differences
      .filter((entry) => entry.disposition === 'pending-analysis')
      .map((entry) => ({ id: entry.id, text: '待分析：' + entry.object + ' —— ' + entry.recheckWhen })),
    engines,
    releaseQueries,
    // An old cache is only history: this check keeps none, so nothing here can be
    // mistaken for "still current".
    cacheUsed,
  }
}

/** The comparator this build registers for the engines area. */
export const ENGINES_COMPARATOR = {
  area: ENGINES_AREA,
  version: ENGINES_COMPARATOR_VERSION,
  compare: compareEnginesArea,
}
