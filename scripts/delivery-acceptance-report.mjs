/**
 * The report writer: one row per acceptance claim, plus the sections the spec
 * asks a delivery report to separate.
 * @module dsh-tool-hashline/scripts/delivery-acceptance-report
 */

/**
 * Redact one value for a delivered document.
 *
 * The report ships in the repository, so a run's temporary directories and the
 * operator's home must not travel with it: they are evidence of WHERE this ran,
 * not of WHAT it proved. The placeholder keeps the shape readable.
 * @param {unknown} value any cell value
 * @returns {string} the printable text
 */
export function redact(value) {
  return String(value)
    // A doubled separator is how a Windows path appears once it is embedded in
    // JSON, so the separator run is matched, not a single character.
    .replaceAll(/[A-Za-z]:(?:[\\/]{1,2})[Uu]sers(?:[\\/]{1,2})[^\\/\s]+(?:[\\/]{1,2})[Aa]pp[Dd]ata(?:[\\/]{1,2})[Ll]ocal(?:[\\/]{1,2})[Tt]emp(?:[\\/]{1,2})[^\\/\s,;"']+/gu, '<temp>')
    .replaceAll(/\/tmp\/[^\/\s,;"']+/gu, '<temp>')
    .replaceAll(/[A-Za-z]:(?:[\\/]{1,2})[Uu]sers(?:[\\/]{1,2})[^\\/\s,;"']+/gu, '<home>')
    .replaceAll(/\/home\/[^\/\s,;"']+/gu, '<home>')
}

/** Render one row list as a markdown table. */
function table(rows, columns, pick) {
  const lines = ['| ' + columns.join(' | ') + ' |', '|' + columns.map(() => '---').join('|') + '|']
  for (const row of rows) lines.push('| ' + pick(row).map((value) => redact(value).replaceAll('|', '\\|')).join(' | ') + ' |')
  return lines.join('\n')
}

/** Group the recorded rows by acceptance id, keeping report order. */
export function byAcceptanceId(rows, acceptanceIds) {
  const grouped = new Map()
  for (const id of acceptanceIds) grouped.set(id, [])
  for (const row of rows) {
    if (!grouped.has(row.id)) grouped.set(row.id, [])
    grouped.get(row.id).push(row)
  }
  return grouped
}

/**
 * One acceptance id's verdict from its rows: any FAIL is FAIL, else any GAP is
 * GAP, else any row at all is PASS. No row at all is BLOCKED, never a silent pass.
 * @param {object[]} rows that id's rows
 * @returns {string} the verdict
 */
export function verdictOf(rows) {
  if (rows.length === 0) return 'BLOCKED'
  if (rows.some((row) => row.ok === false)) return 'FAIL'
  if (rows.some((row) => row.gap === true)) return 'GAP'
  return 'PASS'
}

/** The whole report, as markdown. */
export function renderReport(run) {
  const grouped = byAcceptanceId(run.rows, run.acceptanceIds)
  const counts = { PASS: 0, FAIL: 0, GAP: 0, BLOCKED: 0 }
  const summaryRows = []
  for (const [id, rows] of grouped) {
    const verdict = verdictOf(rows)
    counts[verdict] += 1
    summaryRows.push({ id, verdict, parts: rows.length })
  }
  const lines = []
  lines.push('# PTC Hashline 运维 skills：真实宿主交付验收报告（票据 08）')
  lines.push('')
  lines.push('运行时间：' + run.startedAt)
  lines.push('')
  lines.push('本报告由 [delivery-acceptance.mjs](../../scripts/delivery-acceptance.mjs) 在本机真实安装上执行一次得到；每条判定都附退出码或实测值。它 **不是** 一次真实上游升级：固定候选与一次性 profile 是规格 D16/UPG-13 规定的验收形态。')
  lines.push('')
  lines.push('## 判定汇总')
  lines.push('')
  lines.push(table(summaryRows, ['验收 ID', '判定', '用例数'], (row) => [row.id, row.verdict, row.parts]))
  lines.push('')
  lines.push('合计：PASS ' + counts.PASS + ' / FAIL ' + counts.FAIL + ' / GAP ' + counts.GAP + ' / BLOCKED ' + counts.BLOCKED + '。')
  lines.push('')
  lines.push('判定口径：同一 ID 下任一用例失败即 FAIL；否则任一条如实记录的缺口即 GAP；否则至少一条实测通过即 PASS；没有用例即 BLOCKED。')
  lines.push('')
  const packRows = run.rows.filter((row) => row.id === 'PACK-01')
  lines.push('## 安装与装配（PACK-01）')
  lines.push('')
  lines.push(packRows.length === 0 ? '_本次运行没有安装阶段记录。_'
    : table(packRows, ['环节', '判定', '实测'], (row) => [row.part, row.ok === false ? 'FAIL' : 'PASS', row.detail]))
  lines.push('')
  // The spec asks the report to separate six areas, not only to key rows by ID:
  // a reader must be able to see "does the switch/rollback area have evidence at
  // all?" without cross-referencing every ID below.
  lines.push('## 按规格要求的六类分开列')
  lines.push('')
  const sections = run.sections ?? []
  lines.push(sections.length === 0 ? '_本次运行没有声明分区。_'
    : table(sections.map((section) => {
      const sectionRows = section.ids.flatMap((id) => grouped.get(id) ?? [])
      return {
        title: section.title,
        ids: section.ids,
        verdict: sectionRows.length === 0 ? '未测' : verdictOf(sectionRows),
        cases: sectionRows.length,
      }
    }), ['类别', '覆盖的验收 ID', '判定', '用例数'], (row) => [row.title, row.ids.join(', '), row.verdict, row.cases]))
  lines.push('')
  lines.push('## 逐条证据')
  lines.push('')
  for (const [id, rows] of grouped) {
    lines.push('### ' + id + ' — ' + verdictOf(rows))
    lines.push('')
    if (rows.length === 0) {
      // "No row" is never left bare: either the spec's owner is named, or the ID is
      // recorded as unmeasured by anything this run knows about.
      const owner = run.owners?.[id]
      lines.push(owner === undefined
        ? '本次运行没有产生该 ID 的用例，也没有登记其归属：这一项在本轮**未被任何证据覆盖**。'
        : '本次运行不测该 ID；它的证据在 ' + owner + '。本轮**不**据此声明该项通过。')
      lines.push('')
      continue
    }
    lines.push(table(rows, ['用例', '判定', '实测'], (row) => [row.part, row.gap === true ? 'GAP' : row.ok === false ? 'FAIL' : 'PASS', row.detail]))
    lines.push('')
  }
  lines.push('## 本轮回归门禁')
  lines.push('')
  lines.push(run.gates.length === 0 ? '_未运行门禁。_'
    : table(run.gates, ['命令', '退出码', '记录'], (row) => [row.command, row.exitCode, row.note]))
  lines.push('')
  lines.push('## 未覆盖 / 边界')
  lines.push('')
  for (const boundary of run.boundaries) lines.push('- ' + boundary)
  lines.push('')
  lines.push('## 报告怎么读')
  lines.push('')
  lines.push('- 评估的结论只对本次查到的元数据成立：`verified` 为 false 时最多到 `recommend-candidate`，绝不得说成「无需升级」，也不据此宣告升级成功（UPG-11）。')
  lines.push('- 候选验证与目标切换的安装 runner 是注入的：`result.json` / `switch.json` 里记 `runner.source: injected`。它们证明的是流水线在批准输入上的行为，不是真实依赖安装成功。')
  lines.push('- 目标切换只作用于一次性 profile 安装树；日常 profile、其它 profile 与官方 DSH 安装均未改动。')
  lines.push('- 本文件由脚本生成，手工修改会在下一次运行中被覆盖；要改措辞请改 `scripts/delivery-acceptance-report.mjs`。')
  lines.push('')
  return lines.join('\n')
}

/**
 * A compact, machine-readable summary of the same run.
 *
 * The same redaction rules apply as in the markdown report: this file ships in
 * the repository too, so a run's temporary directories and the operator's home
 * never travel with it.
 * @param {object} run the finished run
 * @returns {object} the summary
 */
export function renderSummary(run) {
  const grouped = byAcceptanceId(run.rows, run.acceptanceIds)
  return {
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    install: run.install === undefined ? undefined : {
      bundleRoot: redact(run.install.bundleRoot),
      profile: redact(run.install.profile),
    },
    verdicts: Object.fromEntries([...grouped].map(([id, rows]) => [id, verdictOf(rows)])),
    sections: (run.sections ?? []).map((section) => {
      const sectionRows = section.ids.flatMap((id) => grouped.get(id) ?? [])
      return { title: section.title, ids: section.ids, verdict: sectionRows.length === 0 ? 'unmeasured' : verdictOf(sectionRows), cases: sectionRows.length }
    }),
    rows: run.rows.map((row) => ({ ...row, part: redact(row.part), detail: redact(row.detail) })),
    gates: run.gates,
    boundaries: run.boundaries,
    counts: run.rows.reduce((totals, row) => {
      const verdict = row.gap === true ? 'GAP' : row.ok === false ? 'FAIL' : 'PASS'
      totals[verdict] = (totals[verdict] ?? 0) + 1
      return totals
    }, {}),
  }
}