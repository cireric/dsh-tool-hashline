# 默认编辑策略：工程验收报告（票据 09）

- 日期：2026-10-24。
- 需求：[默认编辑策略 SRS 1.1](../specs/2026-10-24-hashline-default-editing.md)；计划：[实施计划 r1](../plans/2026-10-24-hashline-default-editing-implementation-plan.md)。
- 范围：票据 01～08 的工程切片；真实模型纪律与推广结论**不在**本报告（见票据 11）。
- 本报告是**本功能**的独立证据，不覆盖同日的运维交付报告（[2026-10-24 交付验收](2026-10-24-delivery-acceptance-report.md)）。

## 判定口径

| 判定 | 含义 |
|---|---|
| PASS | 本条在本机实际执行且通过 |
| FAIL | 本条实际执行且失败（含失败原因） |
| GAP | 本条部分覆盖，缺口已写明 |
| BLOCKED | 本条未执行（缺依赖、缺授权或缺输入） |

**基线对照**：本报告同时给出 main（未改动）checkout 的读数。凡是两边相同读数的失败，都是**先前存在**的失败，不是本功能引入的回归。

## 一、门禁读数（本机，worktree 内）

| 命令 | 读数 | 判定 | 说明 |
|---|---|---|---|
| `pnpm check` | exit 0 | PASS | 构建 + 三个包的 `tsc --noEmit` + 测试类型检查 |
| `pnpm test:unit` | 45 passed | PASS | 含票据 02/03 新增的 citation 单测 |
| `pnpm test:integration` | 37 failed / 369 passed / 9 skipped | FAIL（37 项均为先前存在） | main 基线：39 failed / 303 passed；失败集合比对后**没有新增失败文件**，worktree 多出的 66 个通过项全部来自本功能新增用例 |
| `pnpm test:ptc` | 7 failed / 26 passed | FAIL（7 项均为先前存在） | main 基线同为 7 failed；失败集合逐条相同 |
| `pnpm test:compat` | 1 failed / 20 passed | FAIL（1 项为先前存在） | main 基线同为 1 failed（`REM has no line anchor`） |
| `pnpm check:preset` | OK | PASS | 断言 policy 模块地址、builtin-only 依赖面、persona 摘要 |
| `pnpm test:profile` | FAILED | FAIL（先前存在） | 组装段全 PASS（bundle/资源/单实例/补丁标记/真实 launcher `--dump-config` 全部 ok）；失败在 MV 一步：macOS `/var` → `/private/var` 别名使会话目录与解析目标拼写不同，被编辑器的目录包含检查拒绝。**main checkout 复现同一失败**，与本功能无关 |
| `pnpm test:delivery` | PASS 16 / FAIL 5 / BLOCKED 9 | FAIL（受上列先前存在门禁拖累） | 打包安装、真实 launcher 装配、两条工作流均执行；5 项 FAIL 全部来自 integration/ptc/compat/profile 的先前存在失败 |

## 二、先前存在的失败清单（与 main 逐条相同）

integration 层（5 个文件，37 项）：

- `packages/tool-read/tests/integration/read-edit.spec.ts`、`window-read.spec.ts` —— macOS 临时目录 realpath 别名导致的路径字符串比较失败；
- `tests/integration/operations-candidate-validation.spec.ts`、`operations-target-switch.spec.ts`、`operations-upgrade-assessment.spec.ts` —— 运维工作流的真实 runner/组装用例。

ptc 层：`tests/ptc/mv-policy.spec.ts`（7 项，同一 realpath 别名根因）。

compat 层：`tests/compat/guard.spec.ts` 的 `REM has no line anchor`（1 项）。

## 三、逐条工程证据（按验收 ID）

| ID | 证据位置 | 判定 |
|---|---|---|
| POLICY-01 | `tests/ptc/default-edit-policy.spec.ts`（SDK 含 fallbacks 与三原因；策略段独立存在；未挂载时两者都缺席）+ `tests/ptc/default-edit-policy-user-override.spec.ts`（userSource 字段可选性） | PASS（工程层） |
| POLICY-02 | `default-edit-policy.spec.ts`：单点、重复片段、连续编辑三条，均含独立预期与实际磁盘字节 | PASS（工程层；模型首次选择见 11） |
| POLICY-03 | `default-edit-policy.spec.ts` 重复片段用例：只改第 2 行，第 4 行逐字节不变 | PASS（工程层） |
| POLICY-04 | `default-edit-policy-window.spec.ts` 分页用例；`default-edit-policy-revalidation.spec.ts` recovery 用例 | PASS（工程层） |
| POLICY-05 | `default-edit-policy-snapshot.spec.ts`（N-1/N/N+1、归一化 vs 原始字节、跨会话/cwd/remount/失败读拒绝）+ `default-edit-policy-window.spec.ts`（列截断、零行窗口、无关截断对照） | PASS（工程层） |
| POLICY-06 | `default-edit-policy-revalidation.spec.ts`：引擎 recovery 仍生效；mismatch 契约未改 | PASS（工程层） |
| POLICY-07 | `default-edit-policy-revalidation.spec.ts`：竞争写、取消、引擎失败与策略拒绝分开 | PASS（工程层） |
| POLICY-08 | `default-edit-policy-exceptions.spec.ts`：创建、空文件、纯删除、纯移动、create 形状覆盖、仅空白文件、移动+改内容 | PASS（工程层；专用工具适用性见 11） |
| POLICY-09 | 主 seam 的交错会话、remount 用例；PTC 的 inner/outer 分离。**真实 subagent 工具与真实宿主委派未取得**（本 checkout 无可解析的 tool-subagent 包） | GAP |
| POLICY-10 | `pnpm test:compat`（20 passed）、`check:preset`、`test:profile` 组装段、依赖白名单单测、单实例断言、Intent 门 PTC 用例 | PASS（工程层；1 项 compat 为先前存在失败） |
| POLICY-11 | 各 spec 的拒绝用例均同时断言「provider 写记录为空」与「磁盘字节未变」 | PASS |
| POLICY-12 | 三类原因各自的端到端放行与范围拒绝（snapshot/window/user-override 各一组）；生成 SDK 含新字段 | PASS（工程层） |
| POLICY-13 | `default-edit-policy-window.spec.ts`：无关截断行不降级、目标完整仍走 Hashline、补读后正常编辑 | PASS（工程层） |
| POLICY-14 | `default-edit-policy-revalidation.spec.ts`：no-op 仍报 `No change`；三次失败停止是模型纪律，**未在运行时实现计数器**（按 SRS 要求不新增） | GAP（模型纪律见 11） |
| POLICY-15 | `default-edit-policy-exceptions.spec.ts`：单 BOM 零字节按创建例外、连续 BOM 不按空文件；BOM 保真范围仍限 ADR-0005 | PASS（工程层，保真范围有界） |
| POLICY-16 | `default-edit-policy-mixed.spec.ts`：创建+更新、受限+普通、未使用 fallback、删除后重建、创建后更新、纯 REM+MV | PASS（工程层；删除后重建的引擎拒绝已如实记录） |
| POLICY-17 | `default-edit-policy-diagnostics.spec.ts`：receipt 可重建决定、区分 completed/refused/failed、不复制正文 | PASS |
| POLICY-18 | `default-edit-policy.spec.ts` 载荷互斥用例：三组两两 + 三组并存 + 无效类型掩盖 | PASS |
| POLICY-19 | `default-edit-policy-revalidation.spec.ts`：预检与写入之间注入变化、证据失效后同调用被拒 | PASS（工程层） |
| POLICY-20 | `default-edit-policy.spec.ts`：模块不可加载时普通更新被拒而 Hashline 可用；无 session 被注册层拒绝；未配置策略的行保持上游 schema | PASS（工程层） |
| POLICY-21 | `default-edit-policy-user-override.spec.ts`：真实用户消息可追溯；工具/助手消息、无关 session、歧义引述、方式不符全部拒绝 | PASS（工程层；语义误解见 11） |
| VALUE-01/02 | 方案与驱动：[评测方案](2026-10-24-default-edit-policy-evaluation-protocol.md)、[票据 11 状态](../specs/2026-10-24-default-edit-policy-real-model-evaluation.md)；驱动自检 10 项通过，**真实模型对照未执行**（缺模型/预算/重复数/阈值输入与运行授权） | BLOCKED |

## 四、明确未覆盖（BLOCKED / GAP）

1. **真实 subagent 工具与宿主委派链**（POLICY-09 的最终证明）：本 checkout 解析不到 `@deepseek-ai/dsh-tool-subagent`，夹具不能替代真实委派。票据 04 的父子来源机制已用真实 Session/scope 验证，但「真实 subagent 工具的委派记录」未取得。
2. **真实模型纪律**（POLICY-02/03/04/05/06/07/08/09/13/14/15/17/21 的模型子项）：未运行真实模型，见票据 11。
3. **非 Local provider、真实 sandbox 后端**：未验收，沿用基础规格的既有边界。
4. **`pnpm test:profile` 与 `pnpm test:delivery` 全绿**：受 macOS realpath 别名与运维工作流的先前存在失败拖累；组装段与打包安装段本身通过。

## 五、结论

工程层：票据 01～08 的行为切片在本机真实 ToolRuntime / 真实上游编辑器 / 真实 Local filesystem / 真实 PTC bridge 上可执行且通过，未新增任何先前不存在的失败。

未完成：真实委派（GAP）、真实模型与推广（BLOCKED，票据 11）。**工程通过不等于推广通过**，也不授权任何目标切换、宿主重启或发布。
