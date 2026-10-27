# 上游同步检查 — 票据 02 PTC 变化检查验收

日期：2026-10-27
状态：本票交付范围 PASS（ptc 区域从 not-covered 变为 covered）；整体同步检查仍 **不完整**（stock read、引擎两项未交付，见票据 03～04）
运行平台：Windows（唯一实跑平台）。macOS/Linux 保留 GAP。

需求权威：[上游同步需求规格](../specs/2026-10-27-upstream-sync-requirements.md)。本文件只记录本票的执行结果、证据位置与未覆盖范围。

## 1. 本票交付的行为

同一个公开入口（`pnpm sync:check`），ptc 区域现在真的比较：

| 两端 | 来源 |
|---|---|
| 本项目 | `presets/ptc-hashline/preset.patch.yml`（维护仓库内） |
| 所选 DSH | `packages/bundle/web-app/presets/ptc.patch.yml`（与本票之外的来源身份同一份 checkout） |

### 有限检查清单（逐对象，不是整文件摘要）

| 检查点类别 | 标识形状 | 数量（真实来源那一轮） |
|---|---|---|
| preset 自身身份 | `ptc.preset.<id/name/order/description>` | 4 |
| 工具行的存在与形状（含嵌套组） | `ptc.row.<id 路径>` | 36 |
| 每一行配置的每个叶子（含嵌套与数组元素） | `ptc.config.<id 路径>.<键路径>` | 30 |
| 契约文件（依赖声明逐项探针） | `ptc.contract.<名称>[.<标记>]` | 5 |
| 合计 | — | **75 个检查点** |

契约检查点映射到可定位来源（都已在本机 checkout 里核对过键/类型确实存在）：

| 契约 | 来源文件 | 探针标记 |
|---|---|---|
| 委派行的配置键 | `packages/subagent/tool-subagent/src/index.ts` | provider / toolName / maxDepth / modelSelectionSettings / backgroundMode |
| PTC 程序 API 类型 | `packages/ptc-runtime/ptc-runtime/src/types.ts` | PtcBindingNamespace / PtcRunResult / PtcJsonValue |
| 呈现模式 | `packages/core/agent-tool-presentation/src/index.ts` | 'ptc' / presentAs |
| 提示变量插值 | `packages/core/system-prompt/src/index.ts` | {{variable}} / prompt variable |
| persona 行的提示键 | `packages/preset/persona/src/index.ts` | prefix / suffix |

探针是**静态存在性**检查：标记消失是契约移动的信号；标记存在**不**证明语义兼容。两条都写进报告正文。

## 2. 差异记录的公共约定（票据 05 消费）

每条差异都带：稳定标识 `id`、区域、影响面（composition / config / prompt / contract）、对象、两端内容身份（`left.identity` / `right.identity`，即该对象内容的 sha256）、变化方向（added / removed / changed）、处置（follow-up / keep / pending-analysis / not-applicable）、理由、依据（保留项引用规格或 ADR）、复查条件、证据来源。

处置的判据是写死的，不是猜的：

- **keep** 只来自 `PTC_KEEP_LIST`，逐条列出对象、引用依据、写明复查条件；一个条目只覆盖它自己那一行，没有任何与区域同宽的规则。
- **pending-analysis** 是默认值：静态摘只证明内容变化，取得行为依据前不给结论。
- 新增或消失的对象不会落进任何保留规则，因此一定出现在报告里。

本票的「保留」条目**没有**内嵌上一次评审的内容哈希：单轮检查只能给出现两端的身份，跨轮的内容绑定由票据 05 的决定记录完成。这一点在报告与本文都写明，不把单轮结果说成「旧决定仍然有效」。

## 3. 真实来源那一轮的结果（2026-10-27）

来源：`D:\Project\source\__TEST__\deepseek-harness`，commit `687f282e8625c6b8d11ff58211a90524be2e4317`，工作树干净。

| 项 | 值 |
|---|---|
| 检查编号 | `20261027-090000-574ffc8fbfd6` |
| ptc 区域状态 | covered |
| 检查点 / 差异 | 75 / 28 |
| 处置分布 | 保留 20、待分析 8 |
| 缺口（gaps） | 0 |
| 整体状态 / 退出码 | incomplete / 2（stock read 与引擎仍未覆盖） |
| 本地证据 | `.tmp/sync-smoke/evidence/sync/20261027-090000-574ffc8fbfd6/`（被 Git 忽略，不随 clone 交付） |

### 需要处理的 8 条待分析项（本票只报告与分诊，不改代码）

| 差异 | 影响 | 事实 | 待确认 |
|---|---|---|---|
| `ptc.config.delegation>tool-subagent.backgroundMode` | config | 本项目声明该键，所选来源未声明 | 该键在 0.2.1-rc.2 宿主上的实际效果（可能被静默忽略） |
| `ptc.config.delegation>tool-subagent-fork.backgroundMode` | config | 同上 | 同上 |
| `ptc.contract.tool-subagent.backgroundMode` | contract | 契约探针确认该键不在 `tool-subagent/src/index.ts` | 是否改名/移除，或我们的取值需要改写 |
| `ptc.config.planning>plan-mode.section` | prompt | 两端计划模式提示文本不同（上游 2358 字符，本项目 2340 字符） | 上游这版提示的改动是否要跟进 |
| `ptc.row.time-context` | composition | 上游有该行，本项目副本没有 | 是否补上时间上下文行 |
| `ptc.row.tool-schedule` | composition | 上游有该行，本项目副本没有 | 是否补上调度行 |
| `ptc.row.tool-plugin-manager` | composition | 上游有该行（默认 disabled），本项目副本没有 | 是否需要预留该 disabled 行 |
| `ptc.row.tool-plugin-market` | composition | 同上 | 同上 |

前三条是同一个根因（`backgroundMode` 依赖未满足），按对象分别记录，符合「差异按对象」的约定；没有合并成一条概览。

## 4. 取证只把上游当数据

- YAML 读取器是无依赖的**子集**实现（`sync-yaml.mjs`），只读这两份 preset 使用的方言；遇到子集外的结构直接报错并给出行号，绝不猜。
- 自定义标签 `!!js` 一律**捕获为文本**（`{ __tag, value }`），从不求值。用例里把上游标签写成 `process…writeFileSync(<哨兵路径>…)`，跑完后哨兵文件必须不存在，同时该行以内容是摘要的形式出现在检查点里。
- 来源缺失、结构不合法、契约文件读不出，都进 GAP 并把区域标 incomplete —— 不会读成「无变化」。

## 5. 执行结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 构建与类型检查 | `pnpm check` | PASS，exit 0（含 `tsc -p tsconfig.tests.json`） |
| 集成层 | `vitest run --config vitest.integration.config.ts` | PASS，39 文件 / 489 例（本票新增 10 例；票据 01 的 22 例按新覆盖契约更新后仍通过） |
| 单元层 | `pnpm test:unit` | PASS，297 例 |
| 兼容层 | `pnpm test:compat` | PASS，21 例 |
| PTC 层 | `pnpm test:ptc` | PASS，33 例 |
| preset 形状与内建依赖白名单 | `pnpm check:preset` | PASS（新增的三个模块已纳入 node: 内建白名单） |
| 真实来源一轮 | `node scripts/sync-check.mjs --now 2026-10-27T09:00:00Z` | 完整执行，exit 2（未覆盖区域） |

本票覆盖的验收项：SYNC-03，并持续满足 SYNC-08（用例对来源树做整树摘要比对，前后一致；证据根下只有本轮两个文件）。

## 6. 未覆盖 / GAP

| 项 | 状态 | 说明 |
|---|---|---|
| 行为兼容结论 | GAP | 本票只做静态内容比较；「相同」不证明行为一致，「不同」也不证明不兼容。要行为依据必须另做验证。 |
| 保留项跨轮内容绑定 | GAP | 属票据 05（决定记录 + 复查）。本票给出现两端的身份，供其绑定。 |
| stock read / 引擎区域 | GAP | 票据 03 / 04。 |
| macOS / Linux 实跑 | GAP | 未执行；模拟路径不冒充平台通过。 |
| `pnpm test:delivery` | GAP | 按票据 06 统一执行。 |

## 7. 下一步

票据 03「stock read 能力对照」：在同一入口下把 stock-read 区域从 not-covered 翻成 covered，按参数、返回值、截断、大文件与错误处理建立有限检查清单，并与自有 read 的规格依据对照。
