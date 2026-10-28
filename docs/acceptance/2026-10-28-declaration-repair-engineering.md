# 意图门声明专用修复：工程验收（2026-10-28）

日期：2026-10-28
范围：请求级意图门（方案 B）唯一一次自动修复的形态变更——从「同一步内重试同一回复」改为「声明专用生成 + 同一请求的业务续步」。
上游依据：[实施计划](../../.scratch/intent-gate/2026-10-28-declaration-repair-implementation-plan.md)（本地）、[取证报告](../../.scratch/intent-gate/forensics-2026-10-28/report.md)（本地）、[规格 IG-B-05/06/07/17/18](../specs/2026-10-27-intent-gate-b-requirements.md)、[ADR-0006](../adr/0006-declaration-only-repair-and-business-continuation.md)。

本文件只声明本轮实际取得的证据。真实模型效果（IBG-AC-12 / R 系列中的「降低真实失败率」）未执行，见 GAP。

## 1. 结论

- 唯一一次自动修复现在是一个**工具目录为空的声明步骤**：该请求在适配器边界被观察到 `tools: []`（IG08-01/IG02-01/IG02-02/IG01-05…）。
- 声明合格并**先发布**，随后同一请求在下一步拿回完整工具目录继续工作（IG08-01：声明消息的日志位置早于任何 `dispatch-start`）。
- 声明专用步骤仍不合格时是**协议暂停**：预算保持已用、零发布、零派发、零磁盘副作用、无第三次生成（IG08-02/IG01-05/06/07/IG02-03）。
- 取消发生在声明步骤期间时不续步、不发布（IG08-03）；通用重试策略不能换来第二次修复（IG02-09）。
- 诊断按类别记录，且不含被拒正文（IG08-04）。

接口组合（P0）在官方 seam 上成立，未见需要 fork 宿主或改冻结请求的缺口。

## 2. P0：官方接口组合与源码锚点

| 需要的能力 | 采用的官方入口 | 锚点 |
|---|---|---|
| 该次请求不提供行动工具 | `system-prompt/assemble` waterfall（工具 schema 每步只在 pre-step 组装一次，返回的 assembly 是权威值） | `packages/core/system-prompt/src/index.ts:31,614-690`（宿主 checkout `deepseek-harness`） |
| 同一步内重试无法改工具 | `agent/request` 的 `LlmCallConfig` 只有 provider/model/effort/temperature/maxTokens/stop，且 `step()` 复用 pre-step 的 assembly | `packages/llm/llm/src/call-config.ts:18-37`、`packages/core/agent-loop/src/agent.ts:441-470` |
| 声明步骤作为独立的一次生成 | 公开 `agent.followup`（next-turn + wake），由 `agent/status === 'idle'` 触发 | `packages/core/agent/src/runtime-types.ts`（followup/steer/inject 文档）、`agent-loop/src/agent.ts:236-260` |
| 声明发布后同请求续步 | `agent/turn-stopping` serial 上 `agent.steer`（「listener that objects steers … fresh steering runs another step」） | `packages/core/agent/src/runtime-types.ts`（agent/turn-stopping 文档）、`agent-loop/src/agent.ts:378-392` |
| 失败恢复入口 | `agent/request-error`（默认 undefined = 终态） | `agent-loop/src/agent.ts:520-540` |
| 状态可重建 | 会话事件日志（`session.snapshotEvents()`）＋插件消息的固定前缀区分 | `intent-gate-watchdog.mjs`（foldEvent / REPAIR\_NOTICE\_PREFIX） |

实测否决：在 `session/event` 里调用 `agent.inject()` 被宿主拒绝（"session append cannot reenter while another append is being published"），故续步改在 turn 停止边界投递（见宿主证据 `host-a/host-result.json` 的 `logs`）。

P0 探针（插件 seam，可重跑）：`node .scratch/intent-gate/evidence/2026-10-28-declaration-repair/p0-probe.mjs` → exit 0，输出 `p0-probe-output.txt`。它逐步打印：正常步工具目录 → 被扣下的尝试（零发布/零调用）→ request-error 终态 → 修复 followup → 声明步工具目录 `[]` → 违规工具 = 协议暂停且工具目录复原 → 声明接受（逐块原样 replay）→ 续步提示 → 业务步工具目录复原且程序可派发。

## 3. 实现变更

- `presets/ptc-hashline/intent-gate-watchdog.mjs`
  - 新增声明专用阶段：`declarations` map（`declaration → publishing → continuation-due`）、`system-prompt/assemble` 过滤工具、`agent/status` 打开修复、`agent/turn-stopping` 投递续步、`session/event` 只在声明提交后置下一阶段。
  - 新上限 `maxDeclarationChars: 2000`（声明正文上限，与 provider 生成上限分开）；违规工具（`tools-in-declaration`）与超长正文（`declaration-too-long`）作为协议暂停类目。
  - 预算推导按消息类型区分：只有 `REPAIR_NOTICE_PREFIX` 开头的插件消息计入 `repairsThisRequest`，续步提示不计（旧日志逐字兼容）。
  - 新增结构化诊断 `attemptDiagnostic()`（阶段、失配类别、原 finish.kind、各块计数、正文空标志、预算、usage、耗时、有效上限），不保存被拒正文/reasoning/工具参数；失败走 `logger.warn`，接受走 `logger.info`。
  - 用户文案：首次失配改为「正在自动重新生成声明（1/1）」，no-text 改为「没有可计入正文的非空文本」，协议暂停文案为「意图声明未能生成，工作尚未执行」。
- `presets/ptc-hashline/personas/orchestrator.md`：Phase 0 的修复段落改为「声明专用、无工具、声明后不重复声明」。
- `presets/ptc-hashline/preset.patch.yml`：行内声明 `maxDeclarationChars` 并更新注释；`scripts/check-preset.mjs` 钉住新上限与两个资产摘要（`685f8eda…` / `29c0d73d…`，按 LF 归一化）。
- 测试：`tests/unit/intent-gate-declaration.spec.ts` 新增 6 条（上限、声明专用文案、协议暂停文案、续步文案与前缀、诊断不含正文）；`tests/integration/intent-gate-request-scope.spec.ts` 重写修复段并新增 9 条（工具目录为空、协议暂停、正文上限 vs 截断、steering 优先、通知不花预算、取消、真实输入作废未开始的声明阶段）；`scripts/test-intent-gate-host.mjs` 增 4 条 IG08 与逐请求 `tools` 记录、50 条既有/新用例对齐到新契约；`scripts/test-intent-gate-surface.mjs` 对齐声明先于业务、两次被扣下的 turn。
- 文档：规格 IG-B-05/06/07 修订 + IG-B-17/18 与 IGB-AC-13/14/15、[ADR-0006](../adr/0006-declaration-only-repair-and-business-continuation.md)、GLOSSARY（声明修复 / 声明专用修复 / 业务续步 / 协议暂停）、README 与[文档导航](../README.md)、[当前验收索引](2026-10-23-current-status-and-evidence-index.md)。

## 3b. P1 工程设计清单对照（计划 §4 P1 要求项）

计划要求工程设计逐项给出下列内容；每一项的落点如下，避免「实现里有、文档里查不到」。

| 要求项 | 决定 | 落点 |
|---|---|---|
| 阶段识别 | 三个阶段 `declaration → publishing → continuation-due`，各自只由一件事推进：修复预算被花掉、声明消息提交、turn 到达停止边界 | 模块 `declarations` map + 四个阶段监听器（`system-prompt/assemble`、`agent/status`、`session/event`、`agent/turn-stopping`）；ADR-0006 决定 1/4 |
| 请求关联 | 一切以 `sessionId` 为键；续步消息带本插件的 `source.kind`，因此不被当作人类输入 | `isHumanInput`（只认 `user` / `user-question-reply`） |
| 事件版本 | 不新增会话事件类型、不改 schema；两阶段通知靠**固定文本前缀**区分（`REPAIR_NOTICE_PREFIX` / `CONTINUATION_NOTICE_PREFIX`），旧日志无需迁移 | 模块常量 + 单元/集成用例 |
| 幂等提交/调度 | 预算在「决定修复」时扣除（一次请求最多一次）；续步只在 `continuation-due` 且 turn 停止边界投递一次，投递后立刻清除阶段；`scheduled` 标记防二次打开 | `gateStream` / `agent/turn-stopping` |
| 旧记录兼容 | 旧日志里的通知全部以修复前缀开头，计数结果与旧行为一致；无通知的旧日志照旧 | `foldEvent` + 集成用例「通知不花预算」 |
| 恢复可信性 | 预算/等待/结论从日志推导；阶段是唯一的内存态，遇 turn 边界或真实用户输入即清除；不可信记录按 `INTENT_STATE_UNTRUSTED` 停下 | ADR-0006 后果第 3 条；IG06-01～03 |
| 错误分类 | 协议暂停（`INTENT_DECLARATION_REPAIR_EXHAUSTED`，文案不同）/ 机制上限（`INTENT_DECLARATION_LIMIT`、`INTENT_GATE_ERROR`）/ 宿主原始终态（取消、网络、截断）三者互不改写 | `DECLARATION_PAUSES` 单一来源 + IG02-05/06/07、IG08-02 |
| 声明输出上限 | `maxDeclarationChars = 2000`（正文），随 preset 行声明并被 `check:preset` 钉住 | 模块 `DEFAULT_LIMITS` + `preset.patch.yml` |
| 生成上限 | **不新增** `maxTokens` 之类的生成上限：截断按 provider 原始终态处理，绝不算声明不合格（避免「先耗尽推理预算再判声明无效」） | ADR-0006 决定 3；IG02-07 |
| 时间/缓存上限 | 沿用暂存口径：`maxBufferedChars = 262144`、`maxBufferMs = 120000`；命中即机制停止，不放行未校验正文 | `DEFAULT_LIMITS` + IG01-12/IG02-08 |

## 4. 验证命令与退出码

| 命令 | 退出码 | 覆盖 |
|---|---|---|
| `pnpm check` | 0 | 构建 + 三包 `tsc` + `tsc -p tsconfig.tests.json` |
| `pnpm test:unit` | 0 | 331 tests / 23 files（含 `intent-gate-declaration` 34 条） |
| `pnpm test:integration` | 0 | 579 tests / 44 files（含 `intent-gate-request-scope` 41 条） |
| `pnpm test:ptc` | 0 | 33 tests / 9 files |
| `pnpm test:compat` | 0 | 21 tests / 2 files |
| `pnpm check:preset` | 0 | 行内上限 = 模块默认值、资产摘要、preset 形状 |
| `node scripts/test-intent-gate-host.mjs --pack <dir> IG01,IG02,IG08` | 0 | 27 用例；记录 `only` 与打包安装身份 |
| `node scripts/test-intent-gate-host.mjs <profile> <dir> IG03,IG04` | 0 | 14 用例（同一打包安装复用） |
| `node scripts/test-intent-gate-host.mjs <profile> <dir> IG05,IG06,IG07` | 0 | 9 用例 |
| `node scripts/test-intent-gate-surface.mjs <profile> <dir>` | 0 | 3 用例（客户端线边界） |
| `pnpm test:delivery` | 见第 7 节 | 完整交付门禁 |

宿主证据（原始）：`.scratch/intent-gate/evidence/2026-10-28-declaration-repair/` 下 `host-a/host-result.json`（27）、`host-b/`（14）、`host-c/`（9）、`surface/surface-result.json`（3）、`p0-probe-output.txt`。三段宿主运行合起来覆盖全部 50 条用例、互不重叠（每段记录 `only` 过滤器）；分段的唯一原因是单次运行需要落在工具的单次时限内，不是选择性取样。

## 5. 逐条验收（计划 §5 矩阵）

| ID | 场景 | 结果 | 证据 |
|---|---|---|---|
| R01 | 首次响应合格 | PASS | IG01-01/02/03/04：单次请求、正文/参数/replay/usage 保真；IG01-02 续步不重复声明 |
| R02 | missing-marker → 声明合格 → 业务答案 | PASS | IG02-01（3 次生成：扣下 / 声明 / 业务，声明先发布）、IG03-08、IG06-02 |
| R03 | no-text/empty → 声明合格 → 工具 | PASS | IG02-02（被拒程序零启动、只有业务程序执行一次、`effects=1`）、IG08-01（声明消息早于 `dispatch-start`） |
| R04 | 专用声明仍无正文/缺标记/违规工具 | PASS | IG08-02（违规工具：零调用/零派发/零副作用、`REPAIR_EXHAUSTED`）、IG01-05/06/07、IG02-03 |
| R05 | 不合格临时 delta、最终块覆盖 | PASS | IG01-08、IG01-04 |
| R06 | 修复或续步期间 provider 异常 | PASS | IG02-06（NETWORK 保持原码、零 repair）、IG02-07（截断保持 `max-tokens`）、IG02-05（取消） |
| R07 | 专用输出/缓存/时间/生成边界 | PASS（有界） | IG02-08（暂存字符上限）、integration 的 `maxDeclarationChars` 用例（24 字符 → 协议暂停，正文带上限数值）、IG02-07（截断 ≠ 声明不合格） |
| R08 | 声明通过后用户追加新约束 | PASS | IG05-01～04、integration 的「声明生成期间到达的人类输入 → 不投递续步」 |
| R09 | 四个阶段中断点恢复/取消 | 部分 PASS / GAP | 取消：IG08-03（声明步骤期间取消 → 不发布、不续步、预算不退还）；**「声明已提交、续步未投递」**：集成用例 `re-publishes and replays nothing when the process dies between the declaration commit and the continuation`（停在该点后重载同一日志：不重放、不二次发布、阶段不残留、工具目录复原、预算不重置，下一次真实输入重新获得声明机会）；重载：IG06-01～03。**GAP**：真实进程 kill 需要重启宿主，未执行 |
| R10 | 新用户继续、社交、澄清等待、独立请求、多会话 | PASS | IG03-01～09、IG04-01～05、IG07-01/02、IG01-10/11/13 |
| R11 | 成本、诊断与旧日志读取 | PASS（宿主侧） | IG02-10（无 usage 保持 unknown）、IG02-03（两次被拒尝试各有 durable attempt 记录）、IG08-04（诊断含类别与计数、不含被拒正文）；旧日志兼容由 `REPAIR_NOTICE_PREFIX` 前缀读取保证（integration 用例覆盖前缀区分） |
| R12 | 日志到真实呈现端 | 部分 PASS / GAP | `scripts/test-intent-gate-surface.mjs`：客户端线上「被扣下的正文零可见」「声明先于业务」「耗尽请求只显示失败」，`surface-result.json` PASS。**GAP**：真实 CLI/浏览器渲染（含失败提示的外观）未在本轮启动宿主内执行 |

## 6. 已知代价与限制（交接）

- **被扣下的首次尝试以策略失败结束**：用户在收到声明与工作之前会看到一次失败提示。这是「先扣下、再修复」的直接代价；如需消除，需要宿主提供「不结束 turn 的扣下」入口，属重对齐事项，不在本轮。
- **声明步骤是一个独立 turn**：预算、成本、取消、持久化都走正式通道，但会话日志里会多一个 turn 边界。恢复路径按保守解释处理，不会把「声明已接受」推导成「业务完成」。
- **崩溃即停**：声明已提交而续步未投递时，恢复不自动续步（不重放、不二次发布）；用户重新发一次请求即获得新的声明机会。
- **正文上限是产物上限**，不是生成上限：超长按协议暂停处理，截断按 provider 原始终态处理；高 reasoning 模式先消耗推理预算的问题用「正文上限 + 生成上限分开」表达，不用很小的 `maxTokens` 制造假截断。
- 真实模型效果（误读率、任务成功率、等待成本）未测，固定适配器只证明流程契约。
- 声明阶段的判定收敛为单一来源（`DECLARATION_PAUSES`：正文缺失类 + 违规工具 + 超长正文共享同一个协议暂停码，其余保留各自机制码），因此「暂停与否」只有一处定义，失败码与用户文案不会分叉。
- **过程注记**：计划建议「先为关键失败链建立定向失败测试再转绿」，本轮先完成实现再补齐定向用例（单元 6 条、集成 9 条、宿主 4 条），没有把既有用例的期望当作新契约的证据。
- 宿主验收分三段运行（27 + 14 + 9），仅因为单次运行要落在工具的单次时限内；每段记录其 `only` 过滤器，三段互不重叠、合起来覆盖 50 条。

## 7. 交付门禁

`pnpm test:delivery` 退出码 **0**：21 PASS / 0 FAIL / 9 BLOCKED（BLOCKED 为既有的「无对应宿主进程而未执行」条目：INC-02/03/04、UPG-02/05/08/09/10/11），九道门禁 `pnpm build`、`pnpm -r check`、`pnpm check:tests`、`pnpm test:unit`、`pnpm test:integration`、`pnpm test:ptc`、`pnpm test:compat`、`pnpm check:preset`、`pnpm test:profile` 全部 exit 0。逐项记录见同日[交付报告](2026-10-28-delivery-acceptance-report.md)与[机器摘要](2026-10-28-delivery-acceptance-summary.json)（本轮重新生成，取代同日早些时候的旧报告）；本轮没有安装/重启日常宿主、没有发布、没有切换升级目标、没有调用付费模型。
