# 联合模型证据采集与对账（旧案例须先复核）

> 文档状态（2026-10-28）：采集步骤可供复用；每会话生成次数及声明修复预算描述属于旧案例。执行前以复核后的模型清单为准，本文不独立维护预算，不构成执行授权。 现行范围和公共工作顺序见[联合工作入口](2026-10-28-intent-gate-repair-implementation-plan.md)，最新执行状态见[状态索引](../acceptance/2026-10-23-current-status-and-evidence-index.md)。

<details>
<summary>展开原方案与操作步骤（按当时时点阅读）</summary>

日期：2026-10-28
依据：[联合清单](2026-10-28-joint-real-model-evaluation-manifest.md)（判据与预算）、[机器可读案例](2026-10-28-joint-real-model-cases.json)、`scripts/evaluation/joint-plan.mjs`（计划/对账）、`scripts/extract-runtime-evidence.mjs`（证据提取）、`scripts/tool-usage-judgement.mjs`（工具路径判读）。

## 0. 前置

1. 用户已填 `approval.json`（模板：[joint-approval.example.json](../../scripts/evaluation/joint-approval.example.json)），`joint-plan --approval` 报 `ready`（exit 0）。
2. 用一个**一次性 profile/宿主**，绝不指向日常宿主；每个案例两个独立会话（`a` / `b`），互不复用上下文。
3. 每条对话最多 6 次模型生成（含最多一次声明修复）；触到任一条上限就停并保留部分结果。

## 1. 目录约定（与 `joint-plan` 的 `evidenceSlots` 一致）

```
<本轮证据根>/
  case-G1/a/session.jsonl      # 会话原始 artifact（可为 zstd 帧）
  case-G1/a/report.json        # extractor 的报告（含 accounting / toolPath）
  case-G1/b/...
  case-T3/a/...
  joint-plan.json              # --approval 生成的 ready 计划
  runs.json                    # 每会话一条 { caseId, session, report }
  reconciliation.json          # --runs 生成的对账表
```

## 2. 跑一条会话并拿到 artifact

1. 以独立 `DSH_HOME` 启动一次性宿主（不要用日常 profile），选择 **PTC Hashline Mode**，工作目录固定为案例的 fixture 目录。
2. 按案例 `input` 的顺序逐条发送（`G8` 的第二条「继续」、`G9` 的选项点击都要按原文执行；多轮输入之间**不要**插入额外提示）。
3. 记下会话 id（宿主输出/inbox 均可见），跑完后让会话落盘。
4. 会话文件位置由 `presets/ptc-hashline/operations/session-log.mjs` 的 `sessionDirectory(sessionsRoot, cwd, sessionId)` 决定（`readSessionArtifact` 负责读；运维 skill `/ptc-hashline-incident` 用的是同一套解码器）。把它复制到第 1 节的路径。

## 3. 生成报告（声明 + 成本 + 工具路径三合一）

```powershell
node scripts/extract-runtime-evidence.mjs \
  --source  <本轮证据根>/case-G1/a/session.jsonl \
  --session <会话 id> \
  --tasks   docs/plans/2026-10-28-joint-real-model-cases.json \
  --out     <本轮证据根>/case-G1/a/report.json
```

- `--tasks` 直接用联合案例文件即可：判读只处理 `line: "tool"` 的条目（`tasksOf` 会跳过 gate 条目）。
- 报告里三块都要看：`evidence.status`（会话证据是否完整）、`accounting`（三阶段成本，unknown 保持 unknown）、`toolPath`（该案例的路径判读；非工具案例为 `null`）。
- **退出码 2 = 会话证据不完整**（撕裂帧、坏行、seq 漏洞）。不要改报告去凑；按清单把该会话记 GAP 并查明原因。

## 4. 汇总 runs.json 并对账

```powershell
# runs.json 形状见 scripts/evaluation/joint-runs.example.json（示例，不是结果）
node scripts/evaluation/joint-plan.mjs \
  --cases docs/plans/2026-10-28-joint-real-model-cases.json \
  --runs  <本轮证据根>/runs.json \
  --out   <本轮证据根>/reconciliation.json
```

`reconciliation.json` 给出每会话一行：声明（`issues/repairs/accepted`）、成本（`attempts/tokens/usageUnknown`）、工具路径（`verdict/provenBypass/candidates/unknowns`），外加 `totals` 与 `gaps`（**没跑的会话一定出现在 gaps 里**，不会被静默跳过）。

## 5. 语义轴仍需人判

`reconciliation.json` 只承载机器事实。语义（解释是否有依据、差异是否改变工作、问题是否必要、是否重复问已知事实、回答前是否推进、是否无条件承诺上线）按联合清单 §5 的冻结判据表人工/编码审查，逐条写进当日验收报告；判读不匹配固定句子。

## 5b. 先做一次干跑演练（可选但推荐）

```powershell
node scripts/evaluation/joint-rehearsal.mjs --root .scratch/<本轮>/rehearsal
```

它用**固定夹具**（不是模型输出）把第 2～4 步跑一遍：写两条 session artifact → 提取器报告 → `runs.json` → 对账，并在 `consistent: true` 时退出 0。演练通过只说明**流水线与命令形状没问题**，不说明模型行为；`--tasks` 指到联合案例文件是被演练验证过的用法（`tasksOf` 会跳过 `line: "gate"` 的条目）。

## 6. 硬规则

- 每条会话两个独立上下文；不追加样本；不挪分母；失败就记 FAIL。
- 报告与 artifact 一律不改写；GAP 就是 GAP，不用「已知限制」替代证据。
- 真实模型只在这份操作单下跑；`test:host-gate`/`test:surface-gate`/`test:delivery` 是固定适配器门禁，两者不能互相代替。

</details>
