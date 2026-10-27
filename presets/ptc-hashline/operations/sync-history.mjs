/**
 * Repeat checks and review decisions (ticket 05).
 *
 * A difference is a fact about ONE round. Whether it is new, already known, or
 * governed by a decision someone made earlier is a fact about the RELATION
 * between rounds — so it lives here, and it never enters the round's
 * content-addressed id: identical current inputs must keep an identical checkId
 * whether or not a decision file exists.
 *
 * Three rules shape the module:
 *
 *   - A decision binds an object AND the content identities that were reviewed.
 *     Either end changing puts the decision back in front of the reviewer. There
 *     is no wildcard form, because a broad rule would silently swallow new
 *     objects.
 *   - A decision is never applied when its premise is unproven: "not-applicable"
 *     or "keep" needs CONCRETE content on both sides, so a side that could not be
 *     read this round (unavailable, pending-verification) can neither be declared
 *     not-applicable nor keep an old decision alive.
 *   - A missing history, an unreadable one and an unsupported one are three
 *     different sentences. None of them is "nothing changed".
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/sync-history
 */
import { readdirSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The decision file's format version. */
export const DECISIONS_FORMAT = 'ptc-hashline-sync-decisions/1'

/** The decision file's default name inside the sync evidence directory. */
export const DECISIONS_FILE = 'decisions.json'

/** The four dispositions a decision may carry (the same vocabulary as a difference). */
export const DECISION_DISPOSITIONS = ['follow-up', 'keep', 'pending-analysis', 'not-applicable']

/** Dispositions that assert the reviewed state is settled, so they need a recheck condition. */
export const SETTLED_DISPOSITIONS = ['keep', 'follow-up', 'not-applicable']

/** How a current difference relates to the previous round and to the decisions. */
export const CHANGE_STATUS = ['new', 'unchanged', 'known', 'stale-decision', 'undecided']

/** How a round's difference list relates to the previous one. */
export const HISTORY_STATUS = ['absent', 'unreadable', 'unsupported', 'compared']

/** The round-level verdict the report starts with. */
export const ROUND_VERDICT = ['first-check', 'history-unavailable', 'no-new-changes', 'new-changes', 'decisions-need-review']

/** Identities that assert nothing, so no decision may rest on them. */
const NON_IDENTITIES = new Set(['unavailable', 'pending-verification', 'none-published', 'unknown', ''])

/**
 * Whether an identity is a concrete, comparable value.
 * @param {unknown} value the identity
 * @returns {boolean} true when it names actual content
 */
export function isConcreteIdentity(value) {
  return typeof value === 'string' && !NON_IDENTITIES.has(value)
}

/**
 * The identity pair a difference is judged by.
 * @param {object} difference one difference record
 * @returns {{left: string, right: string}} both ends
 */
function pairOf(difference) {
  return { left: difference?.left?.identity ?? '', right: difference?.right?.identity ?? '' }
}

/**
 * Read and validate a decision file.
 *
 * All or nothing: a file with one bad decision is refused as a whole, because
 * applying the rest would let a typo quietly change which differences are treated
 * as reviewed.
 * @param {{path: string, text?: string}} options where the file is and its text (when already read)
 * @returns {Promise<{status: string, path: string, decisions: Map<string, object>, detail: string}>} the result
 */
export async function readDecisions(options) {
  const path = options.path
  let text = options.text
  if (text === undefined) {
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { status: 'absent', path, decisions: new Map(), detail: '没有审阅决定记录：本轮所有差异都按未决定处理，不会把任何差异当作已知' }
      }
      return { status: 'invalid', path, decisions: new Map(), detail: '决定记录读不出：' + (error instanceof Error ? error.message : String(error)) }
    }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { status: 'invalid', path, decisions: new Map(), detail: '决定记录不是合法 JSON：' + (error instanceof Error ? error.message : String(error)) }
  }
  try {
    return { status: 'loaded', path, decisions: normalizeDecisions(parsed), detail: '' }
  } catch (error) {
    return { status: 'invalid', path, decisions: new Map(), detail: '决定记录格式不受支持：' + (error instanceof Error ? error.message : String(error)) }
  }
}

/**
 * Validate one decision document.
 * @param {unknown} parsed the parsed JSON
 * @returns {Map<string, object>} the decisions by difference id
 * @throws {Error} on the first invalid decision (the caller refuses the whole file)
 */
export function normalizeDecisions(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('the document must be an object')
  if (parsed.format !== DECISIONS_FORMAT) {
    throw new Error('format must be ' + JSON.stringify(DECISIONS_FORMAT) + ' (got ' + JSON.stringify(parsed.format) + ')')
  }
  if (!Array.isArray(parsed.decisions)) throw new Error('"decisions" must be an array')
  const byId = new Map()
  for (const [index, raw] of parsed.decisions.entries()) {
    const where = 'decisions[' + String(index) + ']'
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(where + ' must be an object')
    const id = raw.id
    if (typeof id !== 'string' || id.trim() === '') throw new Error(where + '.id must be a non-empty string')
    // A pattern would be a broad rule, and a broad rule is exactly what lets a
    // new object slip through unnoticed.
    if (/[*?]/u.test(id)) throw new Error(where + '.id must name ONE difference id; wildcards are refused (' + JSON.stringify(id) + ')')
    if (byId.has(id)) throw new Error(where + ' repeats id ' + JSON.stringify(id) + '; one difference has one decision')
    if (!DECISION_DISPOSITIONS.includes(raw.disposition)) {
      throw new Error(where + '.disposition must be one of ' + DECISION_DISPOSITIONS.join(', ') + ' (got ' + JSON.stringify(raw.disposition) + ')')
    }
    if (typeof raw.reason !== 'string' || raw.reason.trim().length < 4) throw new Error(where + '.reason must say why, in at least a few words')
    const identity = raw.identity
    if (identity === null || typeof identity !== 'object') throw new Error(where + '.identity must bind the reviewed content, as {"left": string, "right": string}')
    if (typeof identity.left !== 'string' || typeof identity.right !== 'string') throw new Error(where + '.identity needs both sides as strings')
    if (SETTLED_DISPOSITIONS.includes(raw.disposition) && (typeof raw.recheckWhen !== 'string' || raw.recheckWhen.trim() === '')) {
      throw new Error(where + '.recheckWhen is required for ' + raw.disposition + ': a settled decision has to say when it stops holding')
    }
    if (raw.decidedAt !== undefined && (typeof raw.decidedAt !== 'string' || Number.isNaN(Date.parse(raw.decidedAt)))) {
      throw new Error(where + '.decidedAt must be an ISO date')
    }
    if (raw.evidence !== undefined && (!Array.isArray(raw.evidence) || raw.evidence.some((entry) => typeof entry !== 'string'))) {
      throw new Error(where + '.evidence must be an array of strings')
    }
    if (raw.basis !== undefined && typeof raw.basis !== 'string') throw new Error(where + '.basis must be a string')
    byId.set(id, {
      id,
      disposition: raw.disposition,
      reason: raw.reason,
      identity: { left: identity.left, right: identity.right },
      recheckWhen: typeof raw.recheckWhen === 'string' ? raw.recheckWhen : '',
      basis: typeof raw.basis === 'string' ? raw.basis : '',
      evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
      decidedAt: typeof raw.decidedAt === 'string' ? raw.decidedAt : '',
      reviewer: typeof raw.reviewer === 'string' ? raw.reviewer : '',
    })
  }
  return byId
}

/**
 * Find the newest earlier round in the evidence directory.
 *
 * The newest is the one that matters: an older readable round cannot stand in for
 * the one that failed to read, because "the last thing we saw" is the whole point
 * of a repeat check.
 * @param {{evidenceDirectory: string, format: string}} options where rounds live and the format this build speaks
 * @returns {{status: string, previous: object | null, detail: string}} the history fact
 */
export function readPreviousRound(options) {
  const root = join(options.evidenceDirectory, 'sync')
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { status: 'absent', previous: null, detail: '证据目录里没有更早的检查轮：这是首次检查，无法区分新增与已知' }
    }
    return { status: 'unreadable', previous: null, detail: '证据目录读不出：' + (error instanceof Error ? error.message : String(error)) }
  }
  if (entries.length === 0) {
    return { status: 'absent', previous: null, detail: '证据目录里没有更早的检查轮：这是首次检查，无法区分新增与已知' }
  }
  // A directory name starts with the UTC stamp, so the lexical maximum is the most
  // recent round; the "-2" suffix of the same second sorts after the plain one.
  const newest = entries[entries.length - 1]
  let record
  try {
    record = JSON.parse(readFileSync(join(root, newest, 'sync.json'), 'utf8'))
  } catch (error) {
    return { status: 'unreadable', previous: null, detail: '上一轮记录（' + newest + '）读不出：' + (error instanceof Error ? error.message : String(error)) }
  }
  if (record.reportFormat !== options.format) {
    return { status: 'unsupported', previous: null, detail: '上一轮记录（' + newest + '）的格式是 ' + JSON.stringify(record.reportFormat) + '，本构建读的是 ' + JSON.stringify(options.format) + '：不做历史比较' }
  }
  if (!Array.isArray(record.differences)) {
    return { status: 'unreadable', previous: null, detail: '上一轮记录（' + newest + '）没有差异列表：不做历史比较' }
  }
  return {
    status: 'compared',
    previous: {
      checkId: record.checkId ?? newest,
      checkedAt: record.checkedAt ?? 'unknown',
      status: record.status ?? 'unknown',
      differences: new Map(record.differences.map((difference) => [difference.id, { ...pairOf(difference), disposition: difference.disposition, area: difference.area }])),
    },
    detail: '',
  }
}

/**
 * Classify this round's differences against the previous round and the decisions.
 *
 * A decision is applied per difference, never as a rule: an id that is not in
 * this round's list is an ORPHAN (its object disappeared) and is reported, not
 * dropped.
 * @param {object} options the inputs: differences, decisions, history, decision facts
 * @returns {object} the history section of the record
 */
export function compareWithHistory(options) {
  const previous = options.history.status === 'compared' ? options.history.previous : null
  const currentIds = new Set(options.differences.map((difference) => difference.id))
  const entries = []
  const orphans = []
  for (const difference of options.differences) {
    const pair = pairOf(difference)
    const decision = options.decisions.get(difference.id)
    const prior = previous?.differences.get(difference.id)
    if (decision !== undefined) {
      const sameAsReviewed = decision.identity.left === pair.left && decision.identity.right === pair.right
      // A settled disposition rests on both sides being real content: a side that
      // could not be read this round makes the decision unproven, not valid.
      const concrete = SETTLED_DISPOSITIONS.includes(decision.disposition)
        ? isConcreteIdentity(pair.left) && isConcreteIdentity(pair.right)
        : true
      if (sameAsReviewed && concrete) {
        entries.push({ id: difference.id, area: difference.area, status: 'known', disposition: decision.disposition, decisionId: decision.id, note: '决定绑定的两端内容与本轮一致' })
        continue
      }
      const note = !sameAsReviewed
        ? '决定绑定的内容已变化：本轮 ' + pair.left + ' / ' + pair.right + '，审阅时 ' + decision.identity.left + ' / ' + decision.identity.right
        : '本轮有一端内容没有取得（' + pair.left + ' / ' + pair.right + '），不能确认 ' + decision.disposition + ' 仍然成立'
      entries.push({ id: difference.id, area: difference.area, status: 'stale-decision', disposition: decision.disposition, decisionId: decision.id, note })
      continue
    }
    if (prior === undefined) {
      entries.push({
        id: difference.id,
        area: difference.area,
        status: 'new',
        note: previous === null ? '没有可比较的历史记录，按新增处理' : '上一轮没有这个差异',
      })
      continue
    }
    const unchanged = prior.left === pair.left && prior.right === pair.right
    entries.push({
      id: difference.id,
      area: difference.area,
      status: unchanged ? 'undecided' : 'new',
      previous: { left: prior.left, right: prior.right },
      note: unchanged ? '与上一轮内容一致，但还没有审阅决定' : '两端内容相对上一轮有变化',
    })
  }
  for (const decision of options.decisions.values()) {
    if (currentIds.has(decision.id)) continue
    orphans.push({ id: decision.id, disposition: decision.disposition, note: '决定指向的差异本轮不存在：对象消失或标识改变，需要重新评审' })
  }
  const staleDecisions = entries.filter((entry) => entry.status === 'stale-decision').length + orphans.length
  const newChanges = entries.filter((entry) => entry.status === 'new').length
  const known = entries.filter((entry) => entry.status === 'known').length
  const undecided = entries.filter((entry) => entry.status === 'undecided').length
  // A history that could not be read is NOT "first check": the round cannot tell
  // new from known, and "first check" would imply there was nothing to compare.
  const verdict = staleDecisions > 0
    ? 'decisions-need-review'
    : options.history.status !== 'compared'
      ? options.history.status === 'absent' ? 'first-check' : 'history-unavailable'
      : newChanges > 0 ? 'new-changes' : 'no-new-changes'
  return {
    historyStatus: options.history.status,
    historyDetail: options.history.detail,
    previous: previous === null ? null : { checkId: previous.checkId, checkedAt: previous.checkedAt, status: previous.status },
    decisions: {
      path: options.decisionsPath ?? '',
      status: options.decisionsStatus ?? 'absent',
      count: options.decisions.size,
      detail: options.decisionsDetail ?? '',
    },
    verdict,
    summary: { total: entries.length, new: newChanges, undecided, known, staleDecisions, orphans: orphans.length },
    entries,
    orphans,
  }
}

/**
 * The report section for the history comparison.
 * @param {object} history the compareWithHistory result
 * @returns {string[]} markdown lines (empty when the record carries no history)
 */
export function renderHistorySection(history) {
  if (history === undefined || history === null) return []
  const tick = String.fromCharCode(96)
  const quoted = (value) => tick + (value === undefined || value === null || value === '' ? 'unknown' : String(value)) + tick
  const VERDICT_TEXT = {
    'first-check': '首次检查（没有可比的历史记录）',
    'no-new-changes': '没有新增变化',
    'new-changes': '有新增变化',
    'history-unavailable': '无法完成历史比较',
    'decisions-need-review': '旧决定需要复查',
  }
  const CHANGE_TEXT = {
    new: '新增变化',
    unchanged: '未变化',
    known: '已知差异（决定有效）',
    'stale-decision': '旧决定需复查',
    undecided: '未变化但未决定',
  }
  const HISTORY_TEXT = {
    absent: '没有更早的一轮：本轮是首次检查',
    unreadable: '上一轮记录读不出：无法完成历史比较',
    unsupported: '上一轮记录格式不受支持：无法完成历史比较',
    compared: '已与上一轮比较',
  }
  const lines = []
  lines.push('## 与上一轮的比较')
  lines.push('')
  lines.push('- 结论：**' + (VERDICT_TEXT[history.verdict] ?? history.verdict) + '**')
  const previousText = history.previous === null
    ? ''
    : '（上一轮 ' + quoted(history.previous.checkId) + '，取证时间 ' + quoted(history.previous.checkedAt) + '，状态 ' + quoted(history.previous.status) + '）'
  lines.push('- 历史：' + (HISTORY_TEXT[history.historyStatus] ?? history.historyStatus) + previousText)
  if (history.historyDetail !== '') lines.push('- 说明：' + history.historyDetail)
  const decisionsText = history.decisions.status === 'loaded'
    ? quoted(history.decisions.path) + '（' + String(history.decisions.count) + ' 条）'
    : history.decisions.status === 'absent'
      ? '没有决定记录：本轮所有差异按未决定处理'
      : '决定记录无效：' + history.decisions.detail + '（本轮不应用任何决定）'
  lines.push('- 审阅决定：' + decisionsText)
  lines.push('- 分类计数：新增 ' + String(history.summary.new) + '，已知 ' + String(history.summary.known) + '，未变化未决定 ' + String(history.summary.undecided) + '，旧决定需复查 ' + String(history.summary.staleDecisions))
  lines.push('')
  if (history.entries.length > 0) {
    lines.push('| 差异 | 区域 | 本轮分类 | 说明 |')
    lines.push('|---|---|---|---|')
    for (const entry of history.entries) {
      lines.push('| ' + quoted(entry.id) + ' | ' + quoted(entry.area ?? '') + ' | ' + (CHANGE_TEXT[entry.status] ?? entry.status) + ' | ' + (entry.note ?? '') + ' |')
    }
    lines.push('')
  }
  if (history.orphans.length > 0) {
    lines.push('### 需要重新评审的旧决定')
    lines.push('')
    lines.push('| 决定 | 处置 | 说明 |')
    lines.push('|---|---|---|')
    for (const orphan of history.orphans) {
      lines.push('| ' + quoted(orphan.id) + ' | ' + quoted(orphan.disposition) + ' | ' + orphan.note + ' |')
    }
    lines.push('')
  }
  lines.push('「已知差异」只说明该决定审阅过的内容与本轮一致：它不证明行为兼容，也不让本轮跳过其它检查。')
  lines.push('')
  return lines
}
