# 默认编辑策略：对照评测方案与运行驱动（票据 10）

- 日期：2026-10-24。
- 依据：[SRS §7](../specs/2026-10-24-hashline-default-editing.md)、[实施计划 r1](../plans/2026-10-24-hashline-default-editing-implementation-plan.md)。
- 状态：**方案与驱动已实现，协议尚未冻结**。本票交付的是「运行之前能把条件钉住」的能力，不是评测结果。
- 不授权：真实模型运行、目标切换、宿主重启或发布。

## 1. 为什么需要这一票

SRS §7.1 要求评测执行前发布并冻结：模型与参数、实际依赖与补丁、样本与重复、顺序、预算、正确性/成本通过条件。§7.2 固定了分母、批次边界与成本口径。把这些规则写在散文里无法阻止「看完结果再改分母」，所以它们被实现为可执行的检查。

## 2. 组成

| 模块 | 职责 |
|---|---|
| [`scripts/evaluation/protocol.mjs`](../../scripts/evaluation/protocol.mjs) | 必需字段、必需任务族、canonical hash、冻结与漂移检测 |
| [`scripts/evaluation/counting.mjs`](../../scripts/evaluation/counting.mjs) | 四类目标互斥、首次方式五态、批次/重试规则、成本 unknown 规则 |
| [`scripts/evaluation/driver.mjs`](../../scripts/evaluation/driver.mjs) | `freeze`（校验后落盘 hash）与 `check`（用冻结协议校验报告） |
| `pnpm eval:freeze` / `pnpm eval:check` | 上述两条命令的仓库入口 |
| [`tests/unit/evaluation-protocol.spec.ts`](../../tests/unit/evaluation-protocol.spec.ts) | 10 项驱动自检 |

## 3. 冻结什么（必需字段）

| 字段 | 含义 | 缺失后果 |
|---|---|---|
| `id`、`createdAt` | 本次评测的身份与时间 | 不能冻结 |
| `comparison` | 至少两个对照臂（当前 auto 与新增策略） | 不能冻结 |
| `model` | `provider` / `model` / `parameters` | 不能冻结 |
| `dependencies` | 实际依赖与补丁版本 | 不能冻结 |
| `samples` | `repetitions`、`seed` | 不能冻结 |
| `order` | 执行顺序安排 | 不能冻结 |
| `budget` | `maxModelRequests`、`maxTotalTokens` | 不能冻结 |
| `passConditions` | `minFirstCandidateCorrect`、`maxTotalTokensPerTask` | 不能冻结 |
| `tasks` | 每项含 `id/family/initial/prompt/expected`，且覆盖 SRS §7.3 的 13 个任务族 | 不能冻结 |

**具体数值不在本文编造**：模型、重复数、预算与阈值必须由维护者在运行前给出。驱动只保证「给了就能钉住、缺了就不许跑」。

## 4. 计数口径（实现为检查）

- 四类目标互斥：已知适用 / 有依据例外 / 无需修改 / 适用性 unknown。
- 已知适用采用率 = 首次尝试选择 Hashline 的已知适用目标 / 已知适用目标总数；**非 Hashline、未尝试与方式 unknown 均留在分母中**。
- 分母为零记「不适用」（`adoptionRate: null`），不记 0% 或 100%。
- 批次必须声明 `attempt`；`attempt > 0` 必须给出 `retryOf`，首次尝试不得自称重试——这就是「修正不得事后并入首批」的执行点。
- 成本字段未测到必须写字符串 `"unknown"`，不接受缺项或伪造的 0。

## 5. 驱动如何拒绝

`check` 会重新计算报告声明的分母并与目标列表比对：一份「把非 Hashline 首次尝试从分母里拿掉」的报告会以 exit 2 被拒。协议被改动而 hash 未更新同样 exit 2（漂移即失效）。

## 6. 明确未做

- **协议未冻结**：本文不含任何模型、重复数、预算或阈值。
- **没有真实模型运行**：VALUE-01/02 的真实对照属于票据 11。
- 驱动的自检只证明口径正确，**不能**计为模型通过。
