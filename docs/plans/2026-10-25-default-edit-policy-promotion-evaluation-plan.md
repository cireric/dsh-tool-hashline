# 默认编辑策略：推广评测方案

- 日期：2026-10-25（r2）。r1 是 2026-10-24 的「对照评测方案与运行驱动（票据 10）」，本文并入并改写为整体方案。
- 依据：[SRS §7](../specs/2026-10-24-hashline-default-editing.md)、[实施计划 r1](2026-10-24-hashline-default-editing-implementation-plan.md)（M6）。
- 状态：**推广评测方案已定稿；尚无已执行的正式冻结对照。** 后续已有独立 [E3 真实模型冒烟](../acceptance/2026-10-25-default-edit-policy-effectiveness-e3-01.md)，它不属于本方案 S1 正式对照，也不证明推广收益。
- 不授权：真实模型运行、目标切换、宿主重启或发布（均需用户当次明确同意）。

## 1. 这份方案覆盖什么

整体评测 = 从「能不能跑」到「该不该推广」的完整链路，分三个阶段。SRS §7.1 要求「执行前发布并冻结评测方案」，指的是这一整条链路，而不是某一个实现切片。

| 阶段 | 目的 | 产出 | 可否用于推广结论 |
|---|---|---|---|
| S0 探针 | 测可行性、成本量级、模型是否会卡死或绕过 | 探针报告 | **否** |
| S1 正式对照 | SRS §7.3 的完整对照 | 正式报告 | 是（唯一依据） |
| S2 推广判定 | 按冻结条件判「推广 / 收窄 / 证据不足」 | 结论段 | 是 |

**为什么要有 S0**：SRS §7.1 禁止「看完结果再定阈值」。正式协议的预算与阈值只能凭经验猜——猜低了跑不完，猜高了白烧钱。S0 是在冻结正式协议**之前**取得这些量的唯一诚实方式。S0 与 S1 是两份独立冻结的协议，因此不存在「同一份协议事后改分母」。

## 2. 冻结什么（SRS §7.1 的九项，逐项对照实现）

SRS §7.1 列出九项必须在执行前冻结的内容。下表说明每一项由什么承载，以及**驱动是否真的强制**——不把「写了字段」当成「校验过了」。

| SRS §7.1 要求 | 协议字段 | 驱动强制？ | 说明 |
|---|---|---|---|
| 实际依赖及补丁 | `dependencies` | 仅要求存在 | 驱动不校验版本或补丁摘要；由 §5 的独立核对负责 |
| 模型与参数 | `model.provider` / `.model` / `.parameters` | 是 | 三者缺一即拒绝冻结 |
| 工具配置 | — | **否（已知缺口）** | 协议目前无该字段，见 §7 |
| 任务初始内容 | `tasks[].initial` | 是 | 非空字符串 |
| 独立预期结果 | `tasks[].expected` | 是 | 非空字符串 |
| 样本与重复安排 | `samples.repetitions` / `.seed` | 是 | 正整数 |
| 执行顺序 | `order` | 是 | 非空 |
| 预算 | `budget.maxModelRequests` / `.maxTotalTokens` | 是 | 正整数 |
| 正确性/成本通过条件 | `passConditions.minFirstCandidateCorrect` / `.maxTotalTokensPerTask` | 是 | 数值 |

另有三项驱动强制、SRS 未单列但 S0/S1 必需：`id`、`createdAt`、`comparison`（≥2 臂）、`tasks`（非空）。

**具体数值不在本文编造**：模型、重复数、预算与阈值由维护者在执行前给出。驱动只保证「给了就能钉住、缺了就不许跑」。

## 3. 任务覆盖（SRS §7.3）

正式协议必须覆盖 13 个族：single-point / repeated-fragment / multi-site / consecutive-edits / external-change / unrelated-long-line / target-long-line / restricted-degradation / large-rewrite / already-satisfied / creation / user-override / special-tool。

每个任务必须给出 `initial`（初始内容）与 `expected`（独立预期）；**用实际 diff 判正确，不用工具成功或模式名称判正确**。

S0 探针可只覆盖子集，但必须声明它不证明什么。当前驱动**未实现** kind 区分（见 §7），因此 S0 协议在补上该能力前无法通过 `freeze`。

## 4. 计数口径（SRS §7.2，实现为检查）

- 四类目标互斥：known-applicable / declared-exception / no-change-needed / applicability-unknown。
- 已知适用采用率 = 首次尝试 Hashline 的已知适用目标 / 已知适用目标总数；非 Hashline、未尝试、方式 unknown **均留在分母**。
- 分母为零记「不适用」（`adoptionRate: null`），不记 0% 或 100%。
- 批次必须声明 `attempt`；`attempt > 0` 必须给出 `retryOf`——这是「修正不得事后并入首批」的执行点。
- 成本未测到必须写字符串 `"unknown"`，不接受缺项或伪造的 0。
- 另记全程 Hashline / 非 Hashline / 混合 / 未尝试 / unknown 五态，不以首笔代表全程。

## 5. 执行前的独立核对（驱动之外，必须另行确认）

驱动只校验协议与报告的形状与口径，**不证明**下列事实。S1 开始前必须另行确认并写进报告：

1. `dependencies` 与实际解析一致：引擎版本、物理 realpath、补丁标记（读解析后的构建文件，不认版本号）。
2. 工具配置与冻结值一致：read 的 caps、edit 的 mode、policy 是否挂载。
3. 两臂差异只有一处：policy 行挂载与否；其余 preset 行必须相同。
4. 独立会话、独立工作目录、相同初始内容。

## 6. 用法

1. 写 `protocol.json`。
2. `pnpm eval:freeze protocol.json --out frozen.json`——缺项即 exit 2，并列出每一处缺口。
3. 按冻结顺序与重复安排在独立会话执行。
4. 按 §4 口径填 `report.json`。
5. `pnpm eval:check frozen.json report.json`——分母不符、批次错标、成本伪造均 exit 2。
6. 结论只能落在「建议推广 / 建议收窄默认范围 / 证据不足」三者之一；仅采用率提高不构成收益。

## 7. 已知缺口（补齐前不得执行 S0/S1）

下表的驱动、安装包与凭据可用性记录方案制定时的环境，本轮文档整理未重新检查凭据或安装状态。后续固定适配器宿主回归与独立 E3 冒烟已执行，见[当前索引](../acceptance/2026-10-23-current-status-and-evidence-index.md)；它们不证明正式对照驱动已就绪。开始 S0/S1 前须重新核对下列缺口。

| 缺口 | 影响 | 补齐方式 |
|---|---|---|
| 无可用驱动 | 无法跑 preset 会话 | headless bundle 不组合 agent-preset registry（`headless/cordis.patch.yml` 中 `agent-preset` 匹配数 0），源码明确拒绝 preset 会话（`headless/src/index.ts:219`）；只有 web-app 组合它。路线见 §8 |
| 无 kind 字段 | S0 探针无法冻结 | 协议加 kind（probe / formal），probe 必须声明其 limits |
| 无「工具配置」字段 | SRS §7.1 该项未被强制 | 协议加 `tools` 字段并由驱动校验，或由 §5 第 2 条独立核对并在报告声明 |
| `dependencies` 仅存在性 | 补丁未生效不会被发现 | §5 第 1 条独立核对 |
| 无 LLM provider 包 | 本仓库无法发真实请求 | `node_modules/@deepseek-ai/dsh-llm-deepseek` 不存在（checkout 内有源码） |
| 无模型凭据 | 同上 | 环境内 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `DSH_API_KEY` 均 unset |

## 8. 驱动路线（待用户选择）

1. **手动在 Web UI 跑**：可跑，但人工记录引入偏差，且拿不到自动 token 读数。
2. **给 headless 加 preset 支持**：改 DSH 上游，违反本仓库「不改官方框架」原则，需用户明确同意。
3. **基于 `agent-loop-testkit` 的进程内驱动**：插件侧，符合原则；需 provider 包与凭据；约 1–2 天。

## 9. 现状

- 协议：**未冻结任何正式协议**。
- 本推广方案运行：**零次正式对照调用**；另有独立 E3 真实模型冒烟，不计入本方案结果。
- S0 探针草案（5 族、deepseek-v4.1-flash、100 请求 / 1.2M tokens）保存在被忽略的 `.scratch/hashline-default-editing/probe/`，未入库、未执行，且因 §7 的 kind 缺口当前无法冻结。

## 10. 边界

- 工程通过（票据 09）不等于推广通过；本方案不预判收益。
- 历史使用观察不是已完成 A/B；样本少或环境不可比时只报观察，不作统计推广。
- 推广结论不替代目标切换的当次用户授权。
