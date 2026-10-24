# 默认编辑策略：真实模型对照评测（票据 11）

- 日期：2026-10-24。
- 依据：[SRS §6/§7](../specs/2026-10-24-hashline-default-editing.md)、[评测方案与驱动](2026-10-24-default-edit-policy-evaluation-protocol.md)、[工程验收报告](../acceptance/2026-10-24-default-edit-policy-engineering.md)。
- 判定：**BLOCKED** —— 缺少运行前必须由维护者给出的输入。本票没有真实模型读数，也不给出任何推广结论。

## 1. 为什么是 BLOCKED 而不是「待办」

SRS §7.1 规定：模型与参数、样本与重复、执行顺序、预算、正确性/成本通过条件，必须在**运行前**冻结，且不得看完结果再改。SRS §8 同时规定本需求不授权自动实施真实运行。

驱动（`pnpm eval:freeze`）会拒绝冻结任何缺项协议，因此「先跑起来再补条件」在工具层就不可能。当前缺的输入全部属于用户/维护者决策，不是实现缺口。

## 2. 逐项缺什么

| 必需输入（SRS §7.1） | 当前状态 | 谁能给 |
|---|---|---|
| 对照臂的实际组合（当前 auto vs 新增策略，是否另设仅纠正指令组） | 未指定 | 维护者 |
| `model.provider` / `model.model` / `model.parameters` | 未指定 | 维护者（并需可用凭据与预算） |
| `samples.repetitions` / `samples.seed` | 未指定 | 维护者 |
| `order`（重复与顺序安排） | 未指定 | 维护者 |
| `budget.maxModelRequests` / `budget.maxTotalTokens` | 未指定 | 维护者 |
| `passConditions.minFirstCandidateCorrect` / `maxTotalTokensPerTask` | 未指定 | 维护者 |
| 运行授权（真实模型调用、可能的费用） | **未授予** | 用户 |

**这些值不能由实现者代填**：填了就等于「跑完再定阈值」，正是 SRS 明令禁止的做法。

## 3. 已就绪的部分（可执行、已自检）

| 能力 | 证据 |
|---|---|
| 协议冻结与漂移拒绝 | `scripts/evaluation/protocol.mjs`；`tests/unit/evaluation-protocol.spec.ts` |
| 分母/批次/成本口径的执行化 | `scripts/evaluation/counting.mjs`；同一 spec |
| 报告与协议不一致即拒绝 | `driver.mjs check` 的分母重算；spec 中的「删掉非 Hashline 尝试」用例 |
| 可追溯的调用事实来源 | 票据 08 的 policy receipt（`tool-edit/policy-receipt`） |
| 工程侧行为正确 | [工程验收报告](../acceptance/2026-10-24-default-edit-policy-engineering.md) |

## 4. 拿到输入后的执行顺序

1. 写 `protocol.json`（覆盖 13 个任务族），`pnpm eval:freeze protocol.json --out frozen.json`。
2. 按冻结顺序与重复安排，在**独立会话**执行全部对照，保留失败、未尝试、unknown、例外与预期守卫冲突样本。
3. 用独立预期与实际 diff 判定业务正确；按 `counting.mjs` 的口径填报告。
4. `pnpm eval:check frozen.json report.json`：被拒则修报告，**不改协议**。
5. 结论只能落在「建议推广 / 建议收窄默认范围 / 证据不足」三者之一；只有采用率提高不构成收益。

## 5. 边界

- 工程通过（票据 09）不等于推广通过；本票的 BLOCKED 也不否定工程结论。
- 本票不执行真实目标切换、宿主重启或发布。
- 若将来真实运行发现模型纪律问题（例如未先核验就重试、误用旧 tag 行号），按 SRS 记录为模型偏离，不回改工程验收口径。
