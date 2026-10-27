# 上游同步检查 — 票据 05 重复检查与审阅决定验收

日期：2026-10-27
状态：本票交付范围 PASS（重复运行可辨认首次 / 无新增 / 已知 / 新增 / 旧决定需复查）；历史与决定记录均为只读输入
运行平台：Windows（唯一实跑平台）。macOS/Linux 保留 GAP。

需求权威：[上游同步需求规格](../specs/2026-10-27-upstream-sync-requirements.md)（SYNC-06，用户故事 18～21、23、26）。

## 1. 本票交付的行为

同一个公开入口（`pnpm sync:check`）现在会读两样东西：**上一轮的记录**与**维护者的审阅决定**，然后给每条差异一个跨轮分类：

| 分类 | 含义 |
|---|---|
| 新增变化 | 上一轮没有这条差异，或两端任一内容身份变了 |
| 未变化但未决定 | 与上一轮一致，但还没有审阅决定（**不是**「已知」） |
| 已知差异 | 有决定，且决定绑定的两端内容身份与本轮一致 |
| 旧决定需复查 | 有决定，但任一端内容变了；或该端本轮没有取得内容；或决定指向的对象本轮不存在 |
| 首次检查 | 没有更早的一轮：本轮不区分新增与已知 |
| 无法完成历史比较 | 上一轮记录读不出或格式不受支持：本轮不假装比较过 |

轮级结论取其一：`first-check` / `history-unavailable` / `no-new-changes` / `new-changes` / `decisions-need-review`。

**每轮产物独立**：本轮只写自己的 `report.md` 与 `sync.json`，从不回写历史；历史比较只读上一轮目录。

## 2. 决定记录的格式（维护者手动维护）

默认位置 `<证据目录>/sync/decisions.json`，可用 `--decisions <文件>` 指定。模板见 [decisions.template.json](../../presets/ptc-hashline/operations/decisions.template.json)。

```json
{
  "format": "ptc-hashline-sync-decisions/1",
  "decisions": [
    {
      "id": "ptc.preset.id",
      "disposition": "keep",
      "reason": "本 preset 的 id 有意与上游不同（PTC 变体）",
      "identity": { "left": "<本轮 report 里该项目身份>", "right": "<本轮 report 里来源身份>" },
      "recheckWhen": "上游 preset id 或本项目 preset id 变化时重新评审",
      "basis": "docs/specs/2026-10-27-upstream-sync-requirements.md",
      "evidence": ["docs/acceptance/2026-10-27-upstream-sync-check-05.md"],
      "decidedAt": "2026-10-27",
      "reviewer": "maintainer"
    }
  ]
}
```

| 字段 | 必填 | 规则 |
|---|---|---|
| `format` | 是 | 必须等于 `ptc-hashline-sync-decisions/1`，否则整份记录被视为无效 |
| `id` | 是 | 必须是一条差异的**完整标识**；含 `*` / `?` 的通配写法被拒绝（宽泛规则会静默吞掉新对象） |
| `disposition` | 是 | `follow-up` / `keep` / `pending-analysis` / `not-applicable` 之一 |
| `reason` | 是 | 至少几个字：决定必须说明理由 |
| `identity` | 是 | `{left, right}` 两端字符串，抄自本轮报告的「本项目身份 / 来源身份」；两端任一变化即触发复查 |
| `recheckWhen` | 决定已定型时必填 | `keep` / `follow-up` / `not-applicable` 必须写复查条件 |
| `basis` / `evidence` / `decidedAt` / `reviewer` | 否 | 依据、证据路径、决定日期、决定人 |
| 重复 id | 不允许 | 一条差异只有一个决定，重复即整份无效 |

**整份生效或整份无效**：只要一条不合法，本轮不应用任何一条决定（不会用一半规则决定哪些差异算已知），报告写明「决定记录无效」及原因。

## 3. 三条不可放宽的规则

1. **决定只绑定它审阅过的内容**。两端身份与本轮一致才算「已知」；任一变化都回到「旧决定需复查」。
2. **没有内容就不能认定不适用或确认有效**。`keep` / `follow-up` / `not-applicable` 要求两端都是真实内容身份；本轮读不出（`unavailable`、`pending-verification`、`none-published`）时，该决定记为需复查，而不是继续有效——真实来源下 7 条补丁差异的来源身份就是 `pending-verification`，用它们做决定必然触发复查。
3. **新对象永远不会被旧规则吞掉**。上一轮没有的差异一律新增；决定指向的对象消失时列入「需要重新评审的旧决定」，不会被静默丢弃。

## 4. 维护者操作

| 步骤 | 动作 |
|---|---|
| 1 | 运行 `pnpm sync:check`，读 `<证据目录>/sync/<checkId>/report.md` 的差异表与「与上一轮的比较」 |
| 2 | 对要留下/跟进的差异，把该行的「本项目身份 / 来源身份」抄进 `decisions.json` 的 `identity`，写 `disposition` 与 `reason`（定型决定另写 `recheckWhen`） |
| 3 | 再跑一轮检查：应看到该差异变为「已知差异（决定有效）」，其余保持「未变化但未决定」或「新增变化」 |
| 4 | 看到「旧决定需复查」时，重新判断并把 `identity` 更新为新一轮取值、改 `reason` 或改 `disposition`；不再需要时删除该条 |
| 5 | 需要跨机器共享或随仓库交付时，把 `--decisions` 指向版本控制里的文件；决定记录本身**只读**，检查不会修改它 |

## 5. 取证与边界

| 项 | 状态 | 说明 |
|---|---|---|
| 历史读取 | 只读 | 只读上一轮目录的 `sync.json`，不写、不改、不删 |
| 决定读取 | 只读 | 只读 `--decisions` 指向的文件；缺失 = 「没有决定」，非法 = 「整份无效」 |
| 内容身份稳定性 | 已验证 | 加不加决定文件，同一输入的 `checkId` / `contentHash` 不变（用例 `keeps the checkId content-addressed`） |
| 每轮独立 | 已验证 | 两轮并存，第一轮记录字节不变 |

## 6. 执行结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 构建与类型检查 | `pnpm check` | PASS，exit 0 |
| 测试类型检查 | `tsc -p tsconfig.tests.json` | PASS，exit 0 |
| 集成层 | `vitest run --config vitest.integration.config.ts` | PASS，42 文件 / 524 例（本票新增 14 例） |
| 单元 / 兼容 / PTC 层 | `pnpm test:unit` / `test:compat` / `test:ptc` | PASS |
| preset 形状与内建依赖白名单 | `pnpm check:preset` | PASS（`sync-history.mjs` 已纳入） |
| 真实来源两轮 | `node scripts/sync-check.mjs --now …` 各一次 | 第 1 轮 first-check（43 条新增）；写入 1 条 keep 决定后第 2 轮 no-new-changes（已知 1、未变化未决定 42），exit 0 |

## 7. 未覆盖 / GAP

| 项 | 状态 | 说明 |
|---|---|---|
| 真实来源总验收与交付门禁 | GAP | 票据 06。 |
| 决定记录的跨机器分发 | 不在本票 | 决定文件路径可外置，但分发方式属维护者流程。 |
| macOS / Linux 实跑 | GAP | 未执行；目录名排序依赖 UTC 戳，逻辑与平台无关但未实跑。 |

## 8. 下一步

票据 06「真实来源验收与交接」：用真实 DSH 来源与真实发布源跑完整检查、重复运行确认稳定性、执行 `pnpm test:delivery`，并把全部票据状态与未覆盖范围汇总进正式验收索引。
