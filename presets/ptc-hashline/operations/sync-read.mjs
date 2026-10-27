/**
 * The stock-read comparator (ticket 03): what the selected DSH source's ordinary
 * text read declares, against what this project's own read declares.
 *
 * The comparison is deliberately narrow, and it is narrow in a way the reader can
 * check: every checkpoint names the file AND the symbol it probes, so "what was
 * compared" is never a whole-file digest.
 *
 * Three kinds of checkpoint:
 *
 *   - TOKEN points: the symbol each side must still declare (a rename or a
 *     removal moves the contract, and that is exactly what is reported).
 *   - VALUE points: the declared numeric caps, compared BY VALUE, so two
 *     spellings of 51200 are the same cap and not a difference. (Reporting that
 *     as a difference would be the "file digest changed" mistake this ticket
 *     forbids.)
 *   - DOCUMENTED differences: the places this project's read deliberately is not
 *     the stock read (content tag, seen guard, larger-file threshold, edit-policy
 *     guidance). Each cites its basis and carries a NEGATIVE probe: if the
 *     upstream concept appears, the documented difference stops holding and the
 *     record turns into pending-analysis.
 *
 * Not compared on purpose: the image tool. It is a separate module upstream and a
 * separate concern here, so the record says so instead of silently dropping it.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/sync-read
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashOf, sha256Of } from './sync-hash.mjs'

/** The area this comparator covers. */
export const STOCK_READ_AREA = 'stock-read'

/** Bumped when a checkpoint's identity changes meaning, not when a value changes. */
export const STOCK_READ_COMPARATOR_VERSION = 2

/** The upstream files this comparison reads, relative to the selected source. */
export const STOCK_READ_FILES = {
  args: 'packages/fs/tool-fs/src/read.ts',
  render: 'packages/fs/tool-fs/src/read-render.ts',
  errors: 'packages/fs/tool-fs/src/error.ts',
  config: 'packages/fs/tool-fs/src/index.ts',
  image: 'packages/fs/tool-fs/src/read-image.ts',
}

/** This project's own read files, relative to the maintenance repository. */
export const OUR_READ_FILES = {
  config: 'packages/tool-read/src/config.ts',
  window: 'packages/tool-read/src/window.ts',
  render: 'packages/tool-read/src/render.ts',
  index: 'packages/tool-read/src/index.ts',
  session: 'packages/tool-read/src/session.ts',
  nextAction: 'packages/tool-read/src/next-action.ts',
}

/**
 * The token contracts: one per comparison point, each naming the symbol on both
 * sides. A symbol that is gone on either side is a real finding.
 */
export const STOCK_READ_CONTRACTS = [
  {
    id: 'read.contract.parameters.args',
    dimension: 'parameters',
    statement: '分页参数仍是 offset / limit，参数解析入口在两侧都还存在',
    ours: { source: OUR_READ_FILES.window, tokens: ['parseReadArgs', 'offset', 'limit'] },
    theirs: { source: STOCK_READ_FILES.args, tokens: ['parseReadArgs', 'offset', 'limit'] },
    recheckWhen: '分页参数或参数解析入口改名时重新评审',
  },
  {
    id: 'read.contract.parameters.config',
    dimension: 'parameters',
    statement: '窗口上限的配置键仍由 tool-fs 的 config 声明，自有 read 的默认值仍在 config 中',
    ours: { source: OUR_READ_FILES.config, tokens: ['DEFAULT_LIMIT', 'DEFAULT_MAX_LINE_LENGTH', 'DEFAULT_MAX_BYTES'] },
    theirs: { source: STOCK_READ_FILES.config, tokens: ['readLimit', 'readMaxLineLength', 'readMaxBytes'] },
    recheckWhen: '窗口上限的配置键改名时重新评审',
  },
  {
    id: 'read.contract.return-value.envelope',
    dimension: 'return-value',
    statement: '返回值仍由「窗口构建 + 渲染」两步组成，两侧都有可定位的构建与渲染函数',
    ours: { source: OUR_READ_FILES.render, tokens: ['readFooter', 'readBody', 'renderEnvelope'] },
    theirs: { source: STOCK_READ_FILES.render, tokens: ['buildWindow', 'formatReadOutput', 'WindowResult'] },
    recheckWhen: '返回值形状或渲染入口变化时重新评审',
  },
  {
    id: 'read.contract.truncation.window',
    dimension: 'truncation',
    statement: '截断仍是「单行字符上限 + 字节上限」两个口径',
    ours: { source: OUR_READ_FILES.window, tokens: ['truncationSuffix', 'maxLineLength'] },
    theirs: { source: STOCK_READ_FILES.render, tokens: ['truncateLine', 'READ_MAX_LINE_LENGTH', 'READ_MAX_BYTES'] },
    recheckWhen: '截断口径或截断提示文本变化时重新评审',
  },
  {
    id: 'read.contract.large-file.streaming',
    dimension: 'large-file',
    statement: '上游 read 仍保留大文件流式读取的门槛常量（本项目没有这条路径）',
    ours: { source: OUR_READ_FILES.config, tokens: ['DEFAULT_SNAPSHOT_MAX_BYTES'] },
    theirs: { source: STOCK_READ_FILES.args, tokens: ['STREAM_MIN_SIZE'] },
    recheckWhen: '上游流式读取的门槛或实现入口变化时重新评审',
  },
  {
    id: 'read.contract.error-handling',
    dimension: 'error-handling',
    statement: '错误处理仍有单一可定位入口：上游在 error.ts，本项目在 next-action 指引',
    ours: { source: OUR_READ_FILES.nextAction, tokens: ['nextActionFor'] },
    theirs: { source: STOCK_READ_FILES.errors, tokens: ['remediateFsError'] },
    recheckWhen: '错误处理入口或错误码集合变化时重新评审',
  },
]

/**
 * The declared numeric caps, compared by value.
 *
 * 50 * 1024 and 51_200 are the same cap; a text digest would call that a change,
 * which would be exactly the false positive this ticket forbids.
 */
export const STOCK_READ_VALUES = [
  {
    id: 'read.value.caps.limit',
    dimension: 'parameters',
    statement: '行数上限的声明值',
    ours: { source: OUR_READ_FILES.config, constant: 'DEFAULT_LIMIT' },
    theirs: { source: STOCK_READ_FILES.args, constant: 'READ_LIMIT' },
    recheckWhen: '行数上限的默认值变化时重新评审（配置面 check:preset 断言两侧一致）',
  },
  {
    id: 'read.value.caps.maxLineLength',
    dimension: 'truncation',
    statement: '单行字符上限的声明值',
    ours: { source: OUR_READ_FILES.config, constant: 'DEFAULT_MAX_LINE_LENGTH' },
    theirs: { source: STOCK_READ_FILES.render, constant: 'READ_MAX_LINE_LENGTH' },
    recheckWhen: '单行字符上限的默认值变化时重新评审',
  },
  {
    id: 'read.value.caps.maxBytes',
    dimension: 'truncation',
    statement: '字节上限的声明值',
    ours: { source: OUR_READ_FILES.config, constant: 'DEFAULT_MAX_BYTES' },
    theirs: { source: STOCK_READ_FILES.render, constant: 'READ_MAX_BYTES' },
    recheckWhen: '字节上限的默认值变化时重新评审',
  },
]

/**
 * The differences this project keeps on purpose, each with the basis that
 * justifies it and a NEGATIVE probe that notices when it stops holding.
 */
export const READ_DOCUMENTED_DIFFERENCES = [
  {
    id: 'read.difference.canonical-tag',
    dimension: 'return-value',
    impact: 'contract',
    disposition: 'keep',
    statement: '自有 read 的 canonical value 返回内容 tag 与 tagged，供 hashline edit 使用；stock read 的值没有 tag 概念',
    ours: { source: OUR_READ_FILES.index, tokens: ['tag:', 'tagged:'] },
    theirs: { sources: [STOCK_READ_FILES.args, STOCK_READ_FILES.render, STOCK_READ_FILES.config], absentTokens: ['tagged', 'contentTag'] },
    basis: 'docs/specs/2026-10-22-ptc-hashline-requirements-spec.md、docs/adr/0002-own-ptc-gate-assets.md',
    reason: 'tag 是 PTC canonical value 的一部分：编辑工具消费它，stock read 不产生 tag',
    recheckWhen: 'stock read 的返回值引入 tag/CAS，或 edit 不再消费 tag 时重新评审',
  },
  {
    id: 'read.difference.seen-guard',
    dimension: 'own-contract',
    impact: 'contract',
    disposition: 'keep',
    statement: '本项目的 seen 是 read 自己的有限守卫（snapshotKeys + 只记完整返回行）；stock read 依赖宿主的 fs-observation-policy',
    ours: { source: OUR_READ_FILES.session, tokens: ['snapshotKeys'] },
    theirs: { sources: [STOCK_READ_FILES.args, STOCK_READ_FILES.render, STOCK_READ_FILES.config], absentTokens: ['snapshotKeys', 'recordSeen'] },
    basis: 'docs/specs/2026-10-22-ptc-hashline-requirements-spec.md、docs/adr/0001-inherit-bounded-seen-guard.md',
    reason: 'seen 是有限守卫，不是权限边界；它属于本项目的 read，而不是宿主观察策略的替代品',
    recheckWhen: '上游把 seen/observation 下沉到 read 工具，或宿主观察策略契约变化时重新评审',
  },
  {
    id: 'read.difference.large-file-threshold',
    dimension: 'large-file',
    impact: 'behavior',
    disposition: 'keep',
    statement: '本项目用 4 MiB 作为「是否生成 tag」的快照门槛；上游 read 另有 10 MiB 的流式读取门槛',
    ours: { source: OUR_READ_FILES.config, constant: 'DEFAULT_SNAPSHOT_MAX_BYTES' },
    theirs: { source: STOCK_READ_FILES.args, constant: 'STREAM_MIN_SIZE' },
    basis: 'docs/specs/2026-10-22-ptc-hashline-requirements-spec.md',
    reason: 'read 会读取全文，4 MiB 是生成 tag 的默认门槛而不是内存上限；大文件流式 read 明确不在首版范围',
    recheckWhen: '上游流式读取的门槛变化，或首版范围决定实现流式 read 时重新评审',
  },
  {
    id: 'read.difference.edit-policy-guidance',
    dimension: 'return-value',
    impact: 'prompt',
    disposition: 'keep',
    statement: '本项目的 read 会在 nextAction 里给出默认编辑策略指引；stock read 没有这条指引',
    ours: { source: OUR_READ_FILES.nextAction, tokens: ['policyGuidance'] },
    theirs: { sources: [STOCK_READ_FILES.render, STOCK_READ_FILES.config], absentTokens: ['policyGuidance'] },
    basis: 'docs/specs/2026-10-24-hashline-default-editing.md',
    reason: '默认编辑策略指引只在本 preset 打开，read 的 defaultEditPolicyGuidance 默认关闭',
    recheckWhen: '指引文案或开关契约变化时重新评审',
  },
]

/** The scope exclusion this area states instead of hiding. */
export const READ_SCOPE_EXCLUSIONS = [
  {
    id: 'read.scope.image-tool',
    dimension: 'scope',
    statement: '图片读取是上游的独立模块（read-image.ts，另有 readImage 开关），本区域不比较它',
    theirs: { source: STOCK_READ_FILES.image, tokens: ['applyReadImageTool'] },
    reason: '票据范围明确：不把独立图片读取工具混进普通文本 read 的对照',
    recheckWhen: '上游把图片读取并回文本 read，或本项目决定提供图片读取时重新评审',
  },
]

/**
 * Evaluate a simple integer expression from a declaration line.
 *
 * Only the shapes these constants use are accepted (integer factors joined by
 * * or +), because a general evaluator would be an execution surface inside the
 * check. Anything else returns undefined and the raw text is compared instead.
 * @param {string} expression the right-hand side of a declaration
 * @returns {number | undefined} the value, or undefined when it is not this shape
 */
export function numericValue(expression) {
  const text = String(expression).replaceAll('_', '').trim()
  if (!/^[0-9*+ ]+$/u.test(text)) return undefined
  const terms = text.split('+').map((term) => term.split('*').reduce((product, factor) => product * Number(factor.trim()), 1))
  const total = terms.reduce((sum, term) => sum + term, 0)
  return Number.isFinite(total) ? total : undefined
}

/** Read one file once per run, with its digest and any problem. */
function readFileCached(cache, absolute) {
  if (cache.has(absolute)) return cache.get(absolute)
  let entry
  try {
    const text = readFileSync(absolute, 'utf8')
    entry = { path: absolute, present: true, text, sha256: sha256Of(text) }
  } catch (error) {
    entry = { path: absolute, present: false, problem: String(error?.code ?? error) }
  }
  cache.set(absolute, entry)
  return entry
}

/** Whether every token appears in a text (case-insensitive, substring). */
function tokensPresent(text, tokens) {
  const lowered = String(text ?? '').toLowerCase()
  return tokens.filter((token) => !lowered.includes(token.toLowerCase()))
}

/**
 * Extract a declared constant's right-hand side from a source text.
 * @param {string} text the source
 * @param {string} constant the constant's name
 * @returns {string | undefined} the expression, or undefined when not declared
 */
export function declaredConstant(text, constant) {
  const pattern = new RegExp('(?:export\\s+)?const\\s+' + constant + '\\s*=\\s*([^\\n;]+)', 'u')
  const match = pattern.exec(String(text ?? ''))
  return match === null ? undefined : match[1].trim()
}

/**
 * Compare the stock read with this project's read.
 * @param {object} context the run's facts
 * @param {object} context.source the resolved DSH identity
 * @param {object} context.project the project baseline
 * @returns {object} the area result
 */
export function compareStockReadArea(context) {
  const cache = new Map()
  const theirs = (relative) => readFileCached(cache, join(context.source.resolvedPath, ...relative.split('/')))
  const ours = (relative) => readFileCached(cache, join(context.project.path, ...relative.split('/')))
  const gaps = []
  const checklist = []
  const differences = []

  const noteUnreadable = (id, entry, role) => {
    gaps.push({ id, status: 'GAP', detail: role + '检查点缺失：' + entry.path + ' 读不出（' + (entry.problem ?? 'unknown') + '）—— 该维度无法核对' })
    checklist.push({
      id,
      object: entry.path,
      impact: 'contract',
      left: { source: 'n/a', identity: 'unknown', present: false },
      right: { source: entry.path, identity: 'unreadable', present: false },
      status: 'unreadable',
    })
  }

  // ── token contracts ────────────────────────────────────────────────────────
  for (const contract of STOCK_READ_CONTRACTS) {
    const ourFile = ours(contract.ours.source)
    const theirFile = theirs(contract.theirs.source)
    if (!ourFile.present) { noteUnreadable(contract.id, ourFile, '本项目'); continue }
    if (!theirFile.present) { noteUnreadable(contract.id, theirFile, '所选来源'); continue }
    const ourMissing = tokensPresent(ourFile.text, contract.ours.tokens)
    const theirMissing = tokensPresent(theirFile.text, contract.theirs.tokens)
    checklist.push({
      id: contract.id,
      object: contract.statement,
      impact: 'contract',
      left: { source: contract.ours.source, identity: sha256Of(contract.ours.tokens.join('|')), present: ourMissing.length === 0 },
      right: { source: contract.theirs.source, identity: theirFile.sha256, present: theirMissing.length === 0 },
      status: ourMissing.length > 0 || theirMissing.length > 0 ? 'only-local' : 'same',
    })
    for (const token of theirMissing) {
      differences.push({
        id: contract.id + '.' + token,
        area: STOCK_READ_AREA,
        object: contract.theirs.source + ' :: ' + token,
        impact: 'contract',
        left: { source: contract.ours.source, identity: sha256Of(token), present: true },
        right: { source: contract.theirs.source, identity: 'absent', present: false },
        change: 'removed',
        disposition: 'pending-analysis',
        reason: '上游 stock read 不再声明 ' + token + '（' + contract.statement + '）：可能是改名或移动，静态检查无法判断语义，按待分析处理',
        recheckWhen: contract.recheckWhen,
        evidence: [contract.theirs.source],
      })
    }
    for (const token of ourMissing) {
      differences.push({
        id: contract.id + '.ours.' + token,
        area: STOCK_READ_AREA,
        object: contract.ours.source + ' :: ' + token,
        impact: 'contract',
        left: { source: contract.ours.source, identity: 'absent', present: false },
        right: { source: contract.theirs.source, identity: theirFile.sha256, present: true },
        change: 'added',
        disposition: 'pending-analysis',
        reason: '本项目的 read 不再声明 ' + token + '（' + contract.statement + '）：这是本端的回归信号，不是上游变化',
        recheckWhen: '本项目 read 的契约恢复或有意调整时重新评审',
        evidence: [contract.ours.source],
      })
    }
  }

  // ── declared caps, compared by value ───────────────────────────────────────
  for (const item of STOCK_READ_VALUES) {
    const ourFile = ours(item.ours.source)
    const theirFile = theirs(item.theirs.source)
    if (!ourFile.present) { noteUnreadable(item.id, ourFile, '本项目'); continue }
    if (!theirFile.present) { noteUnreadable(item.id, theirFile, '所选来源'); continue }
    const ourExpression = declaredConstant(ourFile.text, item.ours.constant)
    const theirExpression = declaredConstant(theirFile.text, item.theirs.constant)
    const ourValue = ourExpression === undefined ? undefined : numericValue(ourExpression)
    const theirValue = theirExpression === undefined ? undefined : numericValue(theirExpression)
    const ourIdentity = ourValue === undefined ? (ourExpression ?? 'absent') : String(ourValue)
    const theirIdentity = theirValue === undefined ? (theirExpression ?? 'absent') : String(theirValue)
    checklist.push({
      id: item.id,
      object: item.statement,
      impact: 'config',
      left: { source: item.ours.source + ' :: ' + item.ours.constant, identity: ourIdentity, present: ourExpression !== undefined },
      right: { source: item.theirs.source + ' :: ' + item.theirs.constant, identity: theirIdentity, present: theirExpression !== undefined },
      status: ourIdentity === theirIdentity && ourExpression !== undefined && theirExpression !== undefined ? 'same' : 'changed',
    })
    if (ourExpression === undefined || theirExpression === undefined || ourIdentity !== theirIdentity) {
      differences.push({
        id: item.id,
        area: STOCK_READ_AREA,
        object: item.statement,
        impact: 'config',
        left: { source: item.ours.source + ' :: ' + item.ours.constant, identity: ourIdentity, present: ourExpression !== undefined },
        right: { source: item.theirs.source + ' :: ' + item.theirs.constant, identity: theirIdentity, present: theirExpression !== undefined },
        // Orientation: added = only the selected source declares it, removed =
        // only this project declares it, changed = both do but they disagree.
        change: ourExpression === undefined ? 'added' : theirExpression === undefined ? 'removed' : 'changed',
        disposition: 'pending-analysis',
        reason: '两端声明值不同（本项目 ' + ourIdentity + '，上游 ' + theirIdentity + '）：' + item.statement + '；数值按声明表达式求值比较，不按文本摘要比较',
        recheckWhen: item.recheckWhen,
        evidence: [item.ours.source, item.theirs.source],
      })
    }
  }

  // ── documented differences, with their negative probes ─────────────────────
  for (const item of READ_DOCUMENTED_DIFFERENCES) {
    const ourFile = ours(item.ours.source)
    // A documented difference probes either several files for a concept that
    // must NOT appear, or one file for a constant that must stay declared.
    const theirSources = Array.isArray(item.theirs.sources) ? item.theirs.sources : [item.theirs.source]
    const theirFiles = theirSources.map((relative) => theirs(relative))
    if (!ourFile.present) { noteUnreadable(item.id, ourFile, '本项目'); continue }
    const missingFile = theirFiles.find((entry) => !entry.present)
    if (missingFile !== undefined) { noteUnreadable(item.id, missingFile, '所选来源'); continue }
    // The OUR side is either a token set or a declared constant; both shapes are
    // handled here so a documented difference can cite either.
    const ourTokens = Array.isArray(item.ours.tokens) ? item.ours.tokens : []
    const ourConstant = item.ours.constant === undefined ? undefined : declaredConstant(ourFile.text, item.ours.constant)
    const ourMissing = item.ours.constant !== undefined
      ? (ourConstant === undefined ? [item.ours.constant] : [])
      : tokensPresent(ourFile.text, ourTokens)
    // Tokens establish concept presence; decisions bind actual contents so a
    // body-only change invalidates review even while those tokens still exist.
    const ourIdentity = item.ours.constant !== undefined
      ? (ourConstant === undefined ? 'absent' : String(numericValue(ourConstant) ?? ourConstant))
      : ourFile.sha256
    // The THEIR side is either "this concept must not appear in these files" or
    // "this constant must still be declared".
    const theirConstant = item.theirs.constant === undefined ? undefined : declaredConstant(theirFiles[0].text, item.theirs.constant)
    const upstreamConcept = item.theirs.constant === undefined ? tokenAppears(theirFiles, item.theirs.absentTokens ?? []) : false
    const upstreamDeclares = item.theirs.constant === undefined ? !upstreamConcept : theirConstant !== undefined
    const theirIdentity = item.theirs.constant !== undefined
      ? (theirConstant === undefined ? 'absent' : String(numericValue(theirConstant) ?? theirConstant))
      : hashOf(theirFiles.map((file, index) => ({ source: theirSources[index], sha256: file.sha256 })))
    // The negative probe, and ONLY the negative probe (the documented difference
    // is different on the two ends BY DESIGN, so identity equality would be a
    // contradiction): the keep holds while our contract is on file AND the
    // upstream still lacks the concept / still declares its own constant.
    const holds = ourMissing.length === 0 && upstreamDeclares
    // Orientation: added = only the selected source has it, removed = only this
    // project has it, changed = both do but they disagree.
    const change = upstreamConcept || (item.theirs.constant !== undefined && theirConstant !== undefined) ? 'changed' : 'removed'
    checklist.push({
      id: item.id,
      object: item.statement,
      impact: item.impact,
      left: { source: item.ours.source, identity: ourIdentity, present: ourMissing.length === 0 },
      right: { source: theirSources.join(' + '), identity: theirIdentity, present: upstreamDeclares },
      status: upstreamDeclares ? 'changed' : 'only-local',
    })
    differences.push({
      id: item.id,
      area: STOCK_READ_AREA,
      object: item.statement,
      impact: item.impact,
      left: { source: item.ours.source, identity: ourIdentity, present: ourMissing.length === 0 },
      right: { source: theirSources.join(' + '), identity: theirIdentity, present: upstreamDeclares },
      change,
      disposition: holds ? item.disposition : 'pending-analysis',
      reason: holds
        ? item.reason
        : '已知差异不再成立：' + (ourMissing.length > 0
          ? '本项目的该契约已不在（' + item.ours.source + '）'
          : item.theirs.constant !== undefined
            ? '上游不再有对应声明（' + theirSources.join(' + ') + '）'
            : '上游出现了本应缺席的概念（' + theirSources.join(' + ') + '）') + '，需要重新评审',
      basis: item.basis,
      recheckWhen: item.recheckWhen,
      evidence: [item.ours.source, ...theirSources],
    })
  }

  // ── the exclusion this area states ─────────────────────────────────────────
  for (const exclusion of READ_SCOPE_EXCLUSIONS) {
    const theirFile = theirs(exclusion.theirs.source)
    if (!theirFile.present) { noteUnreadable(exclusion.id, theirFile, '所选来源'); continue }
    const present = tokensPresent(theirFile.text, exclusion.theirs.tokens).length === 0
    checklist.push({
      id: exclusion.id,
      object: exclusion.statement,
      impact: 'scope',
      left: { source: '本项目 read（纯文本）', identity: 'not-applicable', present: false },
      right: { source: exclusion.theirs.source, identity: present ? theirFile.sha256 : 'absent', present },
      status: 'only-upstream',
    })
    differences.push({
      id: exclusion.id,
      area: STOCK_READ_AREA,
      object: exclusion.statement,
      impact: 'scope',
      left: { source: '本项目 read（纯文本）', identity: 'not-applicable', present: false },
      right: { source: exclusion.theirs.source, identity: present ? theirFile.sha256 : 'absent', present },
      change: 'added',
      disposition: 'not-applicable',
      reason: exclusion.reason,
      recheckWhen: exclusion.recheckWhen,
      evidence: [exclusion.theirs.source],
    })
  }

  differences.sort((one, other) => one.id.localeCompare(other.id))
  const incomplete = gaps.length > 0
  const pending = differences.filter((entry) => entry.disposition === 'pending-analysis').length
  const kept = differences.filter((entry) => entry.disposition === 'keep').length
  return {
    status: incomplete ? 'incomplete' : 'covered',
    detail: incomplete
      ? '有检查点读不出：本区域的比较不完整，不能读作「兼容」'
      : 'stock read 与自有 read 按参数、返回值、截断、大文件、错误处理与自有契约逐点比对：' + String(checklist.length) + ' 个检查点，' + String(differences.length) + ' 条记录（保留 ' + String(kept) + '、待分析 ' + String(pending) + '、不适用 ' + String(differences.length - kept - pending) + '）',
    checks: checklist.length,
    differences,
    checklist,
    gaps,
    recommendations: differences
      .filter((entry) => entry.disposition === 'pending-analysis')
      .map((entry) => ({ id: entry.id, text: '待分析：' + entry.object + ' —— ' + entry.recheckWhen })),
  }
}

/**
 * Whether any of these tokens appears in any of these files.
 * @param {object[]} entries the files
 * @param {string[]} tokens the tokens
 * @returns {boolean} true when at least one token appears
 */
function tokenAppears(entries, tokens) {
  return entries.some((entry) => tokensPresent(entry.text, tokens).length !== tokens.length)
}

/** The comparator this build registers for the stock-read area. */
export const STOCK_READ_COMPARATOR = {
  area: STOCK_READ_AREA,
  version: STOCK_READ_COMPARATOR_VERSION,
  compare: compareStockReadArea,
}
