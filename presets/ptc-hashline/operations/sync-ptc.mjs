/**
 * The PTC comparator (ticket 02): what the selected DSH source's ptc preset
 * declares, against what this project's preset declares.
 *
 * Both ends are the SAME kind of file — a preset patch layer — so the comparison
 * is object by object: the preset's own identity, one checkpoint per plugin row,
 * one per configuration leaf, one per prompt, plus the contract files this
 * preset depends on. A change is reported at the object that changed, never as
 * "the file digest moved".
 *
 * What this comparator may claim: content changed. What it may NOT claim: the
 * behaviour still works. A difference nobody has decided on stays
 * pending-analysis, and a contract file whose tokens are all present is recorded
 * as an identity, not as a compatibility verdict.
 *
 * The keep list is deliberately narrow: it names objects, cites the specification
 * or ADR that justifies the difference, and states the re-check trigger. It is
 * not a rule that silences a region — any object the list does not name is
 * reported, which is how new upstream content stays visible.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/sync-ptc
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashOf, sha256Of, stableJson } from './sync-hash.mjs'
import { parseYamlSubset } from './sync-yaml.mjs'

/** The area this comparator covers. */
export const PTC_AREA = 'ptc'

/** Bumped when a checkpoint's identity changes meaning, not when a value changes. */
export const PTC_COMPARATOR_VERSION = 2

/** The DSH-side file this comparison reads (relative to the selected source). */
export const PTC_UPSTREAM_PRESET = 'packages/bundle/web-app/presets/ptc.patch.yml'

/** This project's own preset (relative to the maintenance repository). */
export const PTC_LOCAL_PRESET = 'presets/ptc-hashline/preset.patch.yml'

/**
 * The contract files this preset's rows depend on, with the exact tokens that
 * make each dependency checkable.
 *
 * A token is a STATIC presence probe: its disappearance is a signal that the
 * contract moved, and its presence is not evidence that semantics are
 * unchanged. Both statements are printed in the report.
 */
export const PTC_CONTRACTS = [
  {
    id: 'ptc.contract.tool-subagent',
    source: 'packages/subagent/tool-subagent/src/index.ts',
    statement: '本项目委派行依赖该文件定义这些配置键（provider / toolName / maxDepth / modelSelectionSettings / backgroundMode）；任一键缺失即表示依赖未满足',
    tokens: ['provider', 'toolName', 'maxDepth', 'modelSelectionSettings', 'backgroundMode'],
    recheckWhen: '该文件不再出现所列任一配置键时，重新评审本契约与依赖它的保留差异',
  },
  {
    id: 'ptc.contract.ptc-runtime-types',
    source: 'packages/ptc-runtime/ptc-runtime/src/types.ts',
    statement: 'PTC 程序 API 的绑定与运行结果类型仍在此声明（PtcBindingNamespace / PtcRunResult / PtcJsonValue）',
    tokens: ['PtcBindingNamespace', 'PtcRunResult', 'PtcJsonValue'],
    recheckWhen: 'PTC 运行时类型改名或移动时重新评审本契约',
  },
  {
    id: 'ptc.contract.tool-presentation',
    source: 'packages/core/agent-tool-presentation/src/index.ts',
    statement: 'tool-presentation 仍提供 ptc 呈现模式与 presentAs 入口',
    tokens: ["'ptc'", 'presentAs'],
    recheckWhen: '呈现模式的枚举或入口变化时重新评审本契约',
  },
  {
    id: 'ptc.contract.system-prompt',
    source: 'packages/core/system-prompt/src/index.ts',
    statement: '提示变量插值契约（{{variable}}，严格解析）仍由 system-prompt 提供；persona 与本 preset 的提示文本依赖它',
    tokens: ['{{variable}}', 'prompt variable'],
    recheckWhen: '提示变量的解析规则或错误行为变化时重新评审本契约',
  },
  {
    id: 'ptc.contract.persona',
    source: 'packages/preset/persona/src/index.ts',
    statement: 'persona 行仍以 prefix / suffix 两个配置键贡献提示文本',
    tokens: ['prefix', 'suffix'],
    recheckWhen: 'persona 行的配置键改名或语义变化时重新评审本契约',
  },
]

/**
 * The differences this project keeps on purpose.
 *
 * Every entry names ONE object, cites the authority that justifies it, and
 * states when the decision must be looked at again. Nothing here may be a
 * pattern that covers a region: an object that is not named is reported.
 */
export const PTC_KEEP_LIST = [
  {
    id: 'ptc.row.tool-read',
    expect: { left: true, right: false },
    basis: 'docs/specs/2026-10-22-ptc-hashline-requirements-spec.md、docs/adr/0002-own-ptc-gate-assets.md',
    reason: '自有 read 取代 stock read：read 由本项目提供并向 PTC canonical value 返回 tag（FR-11）',
    recheckWhen: 'stock read 的参数、返回值、截断或错误契约变化，或上游把 read 行改成可开关的配置时重新评审',
  },
  {
    id: 'ptc.row.tool-edit',
    expect: { left: true, right: false },
    basis: 'docs/specs/2026-10-22-ptc-hashline-requirements-spec.md、docs/specs/2026-10-24-hashline-default-editing.md',
    reason: '编辑工具换成上游 hashline-aware editor，并挂载本项目默认编辑策略',
    recheckWhen: 'tool-edit 的 mode 或 contentPolicyModule 契约变化时重新评审',
  },
  {
    id: 'ptc.row.intent-gate-watchdog',
    expect: { left: true, right: false },
    basis: 'docs/adr/0002-own-ptc-gate-assets.md',
    reason: 'Intent gate 看门狗是本项目自有资产，上游 PTC 没有该行',
    recheckWhen: '看门狗判据或 tools/pre-execute 契约变化时重新评审',
  },
  {
    id: 'ptc.row.ptc-hashline-operations-skills',
    expect: { left: true, right: false },
    basis: 'docs/specs/2026-10-23-ptc-hashline-operations-skills.md',
    reason: '两份运维 skill 由本项目 bundle 内的第二个 filesystem provider 提供',
    recheckWhen: 'skill provider 的注册契约或交付方式变化时重新评审',
  },
  {
    id: 'ptc.row.delegation>tool-ralph',
    expect: { left: true, right: false },
    basis: 'presets/ptc-hashline/preset.patch.yml（workflow-ptc 行的说明）',
    reason: '保留 ralph 工具，同时把第二个模型编排面 tool-workflow 关掉',
    recheckWhen: '上游 workflow-ptc / tool-ralph 契约变化时重新评审',
  },
  {
    id: 'ptc.row.delegation>tool-subagent-codex',
    expect: { left: true, right: false },
    basis: 'presets/ptc-hashline/preset.patch.yml（subagent provider 行的说明）',
    reason: '预留 codex provider 行并默认 disabled，宿主未安装该 provider 时不得因此获得工具',
    recheckWhen: 'provider 名或 backgroundMode 取值变化时重新评审',
  },
  {
    id: 'ptc.row.delegation>tool-subagent-claude-code',
    expect: { left: true, right: false },
    basis: 'presets/ptc-hashline/preset.patch.yml（subagent provider 行的说明）',
    reason: '预留 claude-code provider 行并默认 disabled，理由同上',
    recheckWhen: 'provider 名或 backgroundMode 取值变化时重新评审',
  },
  {
    id: 'ptc.row.delegation>workflow-ptc',
    expect: { left: true, right: true },
    basis: 'presets/ptc-hashline/preset.patch.yml（workflow 行的说明）',
    reason: 'PTC 模式用 run_code 作为模型编排面：保留 workflow 引擎供 ralph 使用，同时关闭 tool-workflow',
    recheckWhen: '上游恢复 tool-workflow 或改变 workflow 引擎的默认状态时重新评审',
  },
  {
    id: 'ptc.preset.id',
    expect: { left: true, right: true },
    basis: 'presets/ptc-hashline/preset.patch.yml',
    reason: '本 preset 是独立的 preset id（ptc-hashline），与宿主自带的 ptc 不是同一个选择项',
    recheckWhen: 'preset id 的命名规则或选择器契约变化时重新评审',
  },
  {
    id: 'ptc.config.tool-fs.read',
    expect: { left: true, right: false },
    basis: 'docs/specs/2026-10-22-ptc-hashline-requirements-spec.md（FR-11）',
    reason: '同一 agent scope 内不能有两个 read provider，stock read 必须关闭',
    recheckWhen: '上游给 read 行加上独立的开关键时重新评审',
  },
  {
    id: 'ptc.config.tool-fs.edit',
    expect: { left: true, right: false },
    basis: 'docs/specs/2026-10-22-ptc-hashline-requirements-spec.md（FR-11）',
    reason: 'stock edit 由 hashline-aware tool-edit 取代',
    recheckWhen: '上游给 edit 行加上独立的开关键时重新评审',
  },
  {
    id: 'ptc.config.tool-fs.readLimit',
    expect: { left: true, right: false },
    basis: 'docs/specs/2026-10-22-ptc-hashline-requirements-spec.md（FR-10 / R-1）',
    reason: '窗口上限与自有 read 显式对齐，check:preset 断言两者相等',
    recheckWhen: '上游窗口上限的默认值或键名变化时重新评审',
  },
  {
    id: 'ptc.config.tool-fs.readMaxLineLength',
    expect: { left: true, right: false },
    basis: 'docs/specs/2026-10-22-ptc-hashline-requirements-spec.md（FR-10 / R-1）',
    reason: '窗口上限与自有 read 显式对齐，check:preset 断言两者相等',
    recheckWhen: '上游窗口上限的默认值或键名变化时重新评审',
  },
  {
    id: 'ptc.config.tool-fs.readMaxBytes',
    expect: { left: true, right: false },
    basis: 'docs/specs/2026-10-22-ptc-hashline-requirements-spec.md（FR-10 / R-1）',
    reason: '窗口上限与自有 read 显式对齐，check:preset 断言两者相等',
    recheckWhen: '上游窗口上限的默认值或键名变化时重新评审',
  },
  {
    id: 'ptc.config.persona.prefix',
    expect: { left: true, right: true },
    basis: 'docs/adr/0002-own-ptc-gate-assets.md',
    reason: 'persona 前缀换成 orchestrator persona（Phase-0 意图门、委派判据、证据门与交接行）',
    recheckWhen: 'persona 行的 prefix 语义或提示变量契约变化时重新评审',
  },
  {
    id: 'ptc.config.persona.suffix',
    expect: { left: true, right: false },
    basis: 'docs/adr/0002-own-ptc-gate-assets.md',
    reason: '额外追加工作目录提示；上游 ptc 行没有 suffix',
    recheckWhen: 'persona 行的 suffix 语义变化时重新评审',
  },
  {
    id: 'ptc.config.delegation>tool-subagent.maxDepth',
    expect: { left: true, right: false },
    basis: 'presets/ptc-hashline/preset.patch.yml（maxDepth 语义说明）',
    reason: 'depth-1 角色不得再生成 depth-2 孙会话；maxDepth: 1 是最紧的仍允许编排者委派的取值',
    recheckWhen: '委派深度的计算或 maxDepth 契约变化时重新评审',
  },
  {
    id: 'ptc.preset.name',
    expect: { left: true, right: false },
    basis: 'presets/ptc-hashline/preset.patch.yml',
    reason: '本 preset 有自己的显示名（PTC Hashline Mode）',
    recheckWhen: 'preset 身份字段的语义变化时重新评审',
  },
  {
    id: 'ptc.preset.description',
    expect: { left: true, right: false },
    basis: 'presets/ptc-hashline/preset.patch.yml',
    reason: '本 preset 的描述说明 PTC + 意图门 + hashline 的组合，上游 ptc 行没有描述',
    recheckWhen: 'preset 身份字段的语义变化时重新评审',
  },
  {
    id: 'ptc.preset.order',
    expect: { left: true, right: true },
    basis: 'presets/ptc-hashline/preset.patch.yml',
    reason: '选择器里的排序位置不同（10 与 2）',
    recheckWhen: 'preset 排序规则变化时重新评审',
  },
]

/** The keep list indexed by difference id. */
const KEEP_BY_ID = new Map(PTC_KEEP_LIST.map((entry) => [entry.id, entry]))

/**
 * Whether a leaf's path reads as prompt text rather than as configuration.
 * @param {string} path the dotted path inside one row's config
 * @param {unknown} value the leaf value
 * @returns {boolean} true when the checkbox is a prompt
 */
function isPromptLeaf(path, value) {
  const leaf = path.slice(path.lastIndexOf('.') + 1).replace(/\[\d+\]$/u, '')
  if (['section', 'description', 'prefix', 'suffix', 'instructions'].includes(leaf)) return true
  return typeof value === 'string' && value.includes('\n')
}

/**
 * Normalise one row's own shape — everything EXCEPT its config.
 *
 * Keeping every other key matters: a row-level field nobody expected (an extra
 * marker, a new scalar) is still part of that row, so it must change the row's
 * identity. Config is excluded because it has its own per-key checkpoints, which
 * is what keeps a nested change localised instead of reported as a new row.
 * @param {object} row the parsed row
 * @returns {object} the comparable shape
 */
function rowShape(row) {
  const { config, ...rest } = row ?? {}
  void config
  return { name: null, disabled: null, group: null, isolate: null, ...rest }
}

/**
 * Read a preset patch file into the shape this comparison uses.
 * @param {string} absolute the file path
 * @param {string} label which end this is (for the record)
 * @returns {object} the model, or a named problem
 */
export function readPresetModel(absolute, label) {
  let text
  try {
    text = readFileSync(absolute, 'utf8')
  } catch (error) {
    return { label, path: absolute, present: false, problem: 'the file is ' + String(error?.code ?? error) }
  }
  const sha256 = sha256Of(text)
  let document
  try {
    document = parseYamlSubset(text)
  } catch (error) {
    // A file the subset reader cannot follow is a GAP, never 'no change'.
    return { label, path: absolute, present: true, sha256, problem: 'not readable by the subset reader: ' + (error instanceof Error ? error.message : String(error)) }
  }
  let preset
  try {
    preset = presetRowOf(document)
  } catch (error) {
    return { label, path: absolute, present: true, sha256, problem: error instanceof Error ? error.message : String(error) }
  }
  const rows = []
  const walk = (plugins, parent) => {
    for (const row of plugins) {
      const path = [...parent, String(row?.id ?? 'unknown')]
      rows.push({ id: path.join('>'), path, row })
      if (Array.isArray(row?.config)) walk(row.config, path)
    }
  }
  walk(preset.config.plugins, [])
  // Two rows with the same id path would silently collapse into one Map entry
  // and hide the other row's checkpoints. Refuse instead of guessing.
  const seenIds = new Set()
  for (const entry of rows) {
    if (seenIds.has(entry.id)) {
      return { label, path: absolute, present: true, sha256, problem: 'duplicate row id ' + JSON.stringify(entry.id) + ': refusing instead of collapsing two objects into one checkpoint' }
    }
    seenIds.add(entry.id)
  }
  return {
    label,
    path: absolute,
    present: true,
    sha256,
    preset: {
      id: preset.config.id ?? null,
      name: preset.config.name ?? null,
      order: preset.config.order ?? null,
      description: preset.config.description ?? null,
    },
    rows,
  }
}

/**
 * The single preset row of one patch document.
 * @param {unknown} document the parsed patch
 * @returns {object} the row carrying config.plugins
 * @throws {Error} when the document does not carry exactly one such row
 */
function presetRowOf(document) {
  const entries = Array.isArray(document) ? document : [document]
  const candidates = []
  for (const entry of entries) {
    const rows = Array.isArray(entry?.insert) ? entry.insert : [entry]
    for (const row of rows) {
      if (Array.isArray(row?.config?.plugins)) candidates.push(row)
    }
  }
  if (candidates.length !== 1) throw new Error('expected exactly one preset row with config.plugins, found ' + String(candidates.length))
  return candidates[0]
}

/**
 * The leaves of one value, as dotted paths.
 * @param {unknown} value the value
 * @param {string} prefix the path so far
 * @param {object[]} out the collector
 * @returns {object[]} the leaves
 */
function leavesOf(value, prefix, out) {
  if (Array.isArray(value)) {
    if (value.length === 0) out.push({ path: prefix, value })
    for (let index = 0; index < value.length; index += 1) leavesOf(value[index], prefix + '[' + String(index) + ']', out)
    return out
  }
  if (value !== null && typeof value === 'object' && value.__tag === undefined) {
    const keys = Object.keys(value).sort()
    if (keys.length === 0) out.push({ path: prefix, value })
    for (const key of keys) leavesOf(value[key], prefix === '' ? key : prefix + '.' + key, out)
    return out
  }
  out.push({ path: prefix, value })
  return out
}

/**
 * One checkpoint: an object with both ends' identities.
 * @param {object} options the checkpoint's facts
 * @returns {object} the checkpoint
 */
function checkpoint(options) {
  const left = options.left
  const right = options.right
  const equal = left.present === right.present && left.identity === right.identity
  return {
    id: options.id,
    object: options.object,
    impact: options.impact,
    left,
    right,
    status: equal ? 'same'
      : left.present && right.present ? 'changed'
        : right.present ? 'only-upstream' : 'only-local',
  }
}

/** The identity of one comparable value. */
function identityOf(value) {
  return hashOf(value)
}

/** A difference record for one checkpoint that is not equal. */
function differenceOf(item, options) {
  const keep = KEEP_BY_ID.get(item.id)
  const change = item.status === 'changed' ? 'changed' : item.status === 'only-upstream' ? 'added' : 'removed'
  // A keep entry binds the presence of BOTH ends: its reason cites one specific
  // situation ("upstream has no such row"), and an object that appeared or
  // disappeared is a DIFFERENT situation. It goes back to review instead of
  // being swallowed by the keep (ticket 02: new/lost objects are never eaten).
  const holds = keep !== undefined
    && item.left.present === keep.expect.left
    && item.right.present === keep.expect.right
  return {
    id: item.id,
    area: PTC_AREA,
    object: item.object,
    impact: item.impact,
    left: item.left,
    right: item.right,
    change,
    disposition: holds ? 'keep' : 'pending-analysis',
    reason: holds
      ? keep.reason
      : keep === undefined
        ? '两端内容不一致（' + item.status + '），静态摘要只能证明内容变化：' + options.semantics + '；未判定前保持待分析'
        : '已知保留不再成立：保留理由所述的对象在场情况变了（本项目 ' + String(item.left.present) + ' / 来源 ' + String(item.right.present)
          + '，当初记录为本项目 ' + String(keep.expect.left) + ' / 来源 ' + String(keep.expect.right) + '），需要重新评审',
    ...keep === undefined ? {} : { basis: keep.basis },
    recheckWhen: keep === undefined
      ? '取得行为依据（契约文件、上游说明或测试）后重新判定；本项在判定前不得当作已适配'
      : keep.recheckWhen,
    evidence: [item.left.source, item.right.source],
  }
}

/**
 * Compare the two presets and their contract files.
 *
 * @param {object} context the run's facts
 * @param {object} context.source the resolved DSH identity (with resolvedPath)
 * @param {object} context.project the project baseline (with path)
 * @returns {object} the area result
 */
export function comparePtcArea(context) {
  const left = readPresetModel(join(context.project.path, ...PTC_LOCAL_PRESET.split('/')), 'this project')
  const right = readPresetModel(join(context.source.resolvedPath, ...PTC_UPSTREAM_PRESET.split('/')), PTC_UPSTREAM_PRESET)

  const gaps = []
  const checklist = []
  const differences = []
  if (left.problem !== undefined) gaps.push({ id: 'ptc.left', status: 'GAP', detail: '本项目的 preset 读不出（' + left.path + '）：' + left.problem })
  if (right.problem !== undefined) gaps.push({ id: 'ptc.right', status: 'GAP', detail: '所选 DSH 来源的 ptc preset 读不出（' + right.path + '）：' + right.problem })

  // The preset's own identity fields.
  for (const field of ['id', 'name', 'order', 'description']) {
    const leftValue = left.preset === undefined ? undefined : left.preset[field]
    const rightValue = right.preset === undefined ? undefined : right.preset[field]
    checklist.push(checkpoint({
      id: 'ptc.preset.' + field,
      object: 'preset.' + field,
      impact: 'composition',
      left: { source: PTC_LOCAL_PRESET, identity: left.preset === undefined ? 'unknown' : identityOf(leftValue), present: left.preset !== undefined && leftValue !== null && leftValue !== undefined },
      right: { source: PTC_UPSTREAM_PRESET, identity: right.preset === undefined ? 'unknown' : identityOf(rightValue), present: right.preset !== undefined && rightValue !== null && rightValue !== undefined },
    }))
  }

  if (left.rows !== undefined && right.rows !== undefined) {
    const leftRows = new Map(left.rows.map((entry) => [entry.id, entry]))
    const rightRows = new Map(right.rows.map((entry) => [entry.id, entry]))
    const ids = [...new Set([...leftRows.keys(), ...rightRows.keys()])].sort()
    for (const id of ids) {
      const one = leftRows.get(id)
      const other = rightRows.get(id)
      checklist.push(checkpoint({
        id: 'ptc.row.' + id,
        object: 'row ' + id,
        impact: 'composition',
        left: { source: PTC_LOCAL_PRESET, identity: one === undefined ? 'absent' : identityOf(other === undefined ? one.row : rowShape(one.row)), present: one !== undefined },
        right: { source: PTC_UPSTREAM_PRESET, identity: other === undefined ? 'absent' : identityOf(one === undefined ? other.row : rowShape(other.row)), present: other !== undefined },
      }))
      if (one === undefined || other === undefined) continue
      // Config leaves are compared only where BOTH ends carry the row: an added
      // row's whole config is already covered by the row checkpoint.
      if (Array.isArray(one.row?.config) || Array.isArray(other.row?.config)) continue
      const leftLeaves = new Map(leavesOf(one.row?.config ?? null, '', []).map((leaf) => [leaf.path, leaf.value]))
      const rightLeaves = new Map(leavesOf(other.row?.config ?? null, '', []).map((leaf) => [leaf.path, leaf.value]))
      const paths = [...new Set([...leftLeaves.keys(), ...rightLeaves.keys()])].filter((leafPath) => leafPath !== '').sort()
      for (const leafPath of paths) {
        const leftValue = leftLeaves.get(leafPath)
        const rightValue = rightLeaves.get(leafPath)
        const prompt = isPromptLeaf(leafPath, leftValue ?? rightValue)
        checklist.push(checkpoint({
          id: 'ptc.config.' + id + '.' + leafPath,
          object: 'config ' + id + ' :: ' + leafPath,
          impact: prompt ? 'prompt' : 'config',
          left: { source: PTC_LOCAL_PRESET, identity: leftLeaves.has(leafPath) ? identityOf(leftValue) : 'absent', present: leftLeaves.has(leafPath) },
          right: { source: PTC_UPSTREAM_PRESET, identity: rightLeaves.has(leafPath) ? identityOf(rightValue) : 'absent', present: rightLeaves.has(leafPath) },
        }))
      }
    }
  }

  // The contract files this preset's rows depend on.
  for (const contract of PTC_CONTRACTS) {
    const absolute = join(context.source.resolvedPath, ...contract.source.split('/'))
    let text
    try {
      text = readFileSync(absolute, 'utf8')
    } catch (error) {
      gaps.push({ id: contract.id, status: 'GAP', detail: '契约检查点缺失：' + contract.source + ' 读不出（' + String(error?.code ?? error) + '）—— 该条声明与依赖它的差异都无法核对' })
      checklist.push({
        id: contract.id,
        object: contract.source,
        impact: 'contract',
        left: { source: '本项目依赖声明', identity: identityOf(contract.tokens), present: true },
        right: { source: contract.source, identity: 'unreadable', present: false },
        status: 'unreadable',
      })
      continue
    }
    const lowered = text.toLowerCase()
    const missing = contract.tokens.filter((token) => !lowered.includes(token.toLowerCase()))
    if (missing.length === 0) {
      checklist.push({
        id: contract.id,
        object: contract.source,
        impact: 'contract',
        left: { source: '本项目依赖声明', identity: identityOf(contract.tokens), present: true },
        right: { source: contract.source, identity: sha256Of(text), present: true },
        status: 'same',
      })
      continue
    }
    for (const token of missing) {
      checklist.push({
        id: contract.id + '.' + token,
        object: contract.source + ' :: ' + token,
        impact: 'contract',
        left: { source: '本项目依赖声明', identity: identityOf(token), present: true },
        right: { source: contract.source, identity: 'absent', present: false },
        status: 'only-local',
      })
      differences.push({
        id: contract.id + '.' + token,
        area: PTC_AREA,
        object: contract.source + ' :: ' + token,
        impact: 'contract',
        left: { source: '本项目依赖声明', identity: identityOf(token), present: true },
        right: { source: contract.source, identity: 'absent', present: false },
        change: 'removed',
        disposition: 'pending-analysis',
        reason: '契约标记 ' + token + ' 在所选来源的该文件中不再出现（' + contract.statement + '）：可能是改名或移除，静态检查无法判断语义，按待分析处理',
        recheckWhen: contract.recheckWhen,
        evidence: [contract.source],
      })
    }
  }

  for (const item of checklist) {
    if (item.status === 'same' || item.status === 'unreadable') continue
    // A contract item already produced its own record above.
    if (item.impact === 'contract') continue
    differences.push(differenceOf(item, { semantics: semanticsOf(item) }))
  }
  differences.sort((one, other) => one.id.localeCompare(other.id))

  const incomplete = gaps.length > 0
  const decided = differences.filter((entry) => entry.disposition !== 'pending-analysis').length
  return {
    status: incomplete ? 'incomplete' : 'covered',
    detail: incomplete
      ? '有一端读不出或契约检查点缺失：本区域的比较不完整，不能读作「无变化」'
      : '两端 preset 与 ' + String(PTC_CONTRACTS.length) + ' 个契约检查点已逐一比对：' + String(checklist.length) + ' 个检查点，' + String(differences.length) + ' 条差异（保留 ' + String(decided) + '、待分析 ' + String(differences.length - decided) + '）',
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
 * What a difference means in static terms, phrased so nobody reads it as a verdict.
 * @param {object} item the checkpoint
 * @returns {string} the sentence
 */
function semanticsOf(item) {
  if (item.status === 'only-upstream') return '所选来源有该对象而本项目的副本没有：可能我们的副本早于该行，也可能上游新增了它'
  if (item.status === 'only-local') return '本项目声明了该对象而所选来源没有声明：它在该来源上的效果未经验证，可能被静默忽略或已被改名'
  return '两端都存在但内容不同'
}

/** The comparator this build registers for the ptc area. */
export const PTC_COMPARATOR = {
  area: PTC_AREA,
  version: PTC_COMPARATOR_VERSION,
  compare: comparePtcArea,
}

/** Export the stable-json helper through this module for the comparator's tests. */
export { stableJson }
