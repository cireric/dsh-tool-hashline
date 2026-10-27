# 上游同步检查 — 票据 03 stock read 能力对照验收

日期：2026-10-27
状态：本票交付范围 PASS（stock-read 区域从 not-covered 变为 covered）；整体同步检查仍 **不完整**（引擎发布比较未交付，见票据 04）
运行平台：Windows（唯一实跑平台）。macOS/Linux 保留 GAP。

需求权威：[上游同步需求规格](../specs/2026-10-27-upstream-sync-requirements.md)。本文件只记录本票的执行结果、证据位置与未覆盖范围。

## 1. 本票交付的行为

同一个公开入口（`pnpm sync:check`），stock-read 区域现在真的比较，且两端用的是**同一选定 DSH 来源**（与 ptc 区域同一份 checkout、同一个来源身份字段）：

| 两端 | 来源 |
|---|---|
| 本项目 | `packages/tool-read/src/{config,window,render,index,session,next-action}.ts` |
| 所选 DSH | `packages/fs/tool-fs/src/{read,read-render,error,index,read-image}.ts` |

### 有限检查清单（每个检查点都指名文件与符号）

| 维度 | 检查点 | 探测的东西 |
|---|---|---|
| 参数 | `read.contract.parameters.args` | 两侧都仍有 `parseReadArgs` 与 offset / limit |
| 参数 | `read.contract.parameters.config` | 上游仍有 readLimit / readMaxLineLength / readMaxBytes；本项目仍有三个默认值常量 |
| 返回值 | `read.contract.return-value.envelope` | 上游仍有 `buildWindow` / `formatReadOutput` / `WindowResult`；本项目仍有 footer/body/envelope 三个渲染入口 |
| 截断 | `read.contract.truncation.window` | 上游仍有 `truncateLine` 与两个上限常量；本项目仍有 `truncationSuffix` 与 `maxLineLength` |
| 大文件 | `read.contract.large-file.streaming` | 上游仍有 `STREAM_MIN_SIZE`；本项目仍有 `DEFAULT_SNAPSHOT_MAX_BYTES` |
| 错误处理 | `read.contract.error-handling` | 上游仍有 `remediateFsError`；本项目仍有 `nextActionFor` |
| 截断/参数（值） | `read.value.caps.limit` / `.maxLineLength` / `.maxBytes` | 三个上限**按数值比较**，不按文本摘要比较 |
| 自有契约 | `read.difference.*`（4 条） | tag / seen / 大文件门槛 / 编辑策略指引，各带依据与复查条件 |
| 范围 | `read.scope.image-tool` | 图片读取是上游独立模块，本区域不比较 |

真实来源那一轮：**14 个检查点、5 条记录**（保留 4、不适用 1）、0 缺口。

### 上限按值比较（不把写法差异当功能变化）

上游写 `50 * 1024`，本项目写 `51_200`。文本摘要会说「不同」，而它们都是 51200。检查器对常量声明做受限求值（只接受整数因子与 `*` / `+`，不接受的表达式退回文本比较），因此真实来源那一轮显示：

| 上限 | 本项目 | 上游 | 状态 |
|---|---|---|---|
| 行数 | 2000 | 2000 | 相同 |
| 单行字符 | 2000 | 2000 | 相同 |
| 字节 | 51200 | 51200 | 相同 |

这同时说明：**两端窗口上限今日一致**，与 `check:preset` 对两侧上限相等的断言互相印证；它不是「行为兼容」的证明。

### 记在案上的已有差异（每条引用规格/ADR）

| 差异 | 本项目 | 上游 | 依据 |
|---|---|---|---|
| `read.difference.canonical-tag` | canonical value 返回 `tag` / `tagged` | 无 tag 概念（负向探针：tagged / contentTag 都不出现） | 基础规格、ADR-0002 |
| `read.difference.seen-guard` | `snapshotKeys` 的有限 seen 守卫 | 依赖宿主观察策略（负向探针：snapshotKeys / recordSeen 都不出现） | 基础规格、ADR-0001 |
| `read.difference.large-file-threshold` | 4 MiB 是**生成 tag 的快照门槛** | 10 MiB 是**流式读取门槛** | 基础规格（大文件流式 read 不在首版范围） |
| `read.difference.edit-policy-guidance` | nextAction 带默认编辑策略指引 | 无该指引（负向探针 policyGuidance） | 默认编辑策略 SRS |
| `read.scope.image-tool` | 纯文本 read | 独立 `read-image.ts` 模块 | 票据范围：不混入独立图片读取工具 |

每条都带**负向探针**：一旦上游出现了 tag、seen 或该指引，或恒定常量消失，记录自动从「保留」变成「待分析」并说明原因——已知差异不会遮蔽新变化。用例 `names a regression on OUR side…` 专门验证「本项目侧丢了契约也会被点名」，且理由写的是本端回归，不是上游变化。

## 2. 差异记录的公共约定（与 ptc 区域一致）

标识、区域、影响面（contract / config / behavior / prompt / scope）、对象、两端内容身份、变化方向、处置、理由、依据、复查条件、证据来源。方向约定：

- `added` = 只在所选来源存在
- `removed` = 只在本项目存在
- `changed` = 两端都有但内容不同

票据 05 直接消费这个记录做重复比较与决定管理；本票不依赖它完成。

## 3. 取证边界

- 只读：5 个上游文件与本项目 6 个文件都是只读取文本做符号探针，不构建、不执行、不改动。
- 用例对来源树做整树摘要比对（前后一致），证据根下只有本轮 `report.md` / `sync.json`。
- 检查点读不出（文件缺失/改名）→ 该点记 GAP、区域标 incomplete，**不会**读成「兼容」。

## 4. 执行结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 构建与类型检查 | `pnpm check` | PASS，exit 0 |
| 集成层 | `vitest run --config vitest.integration.config.ts` | PASS，40 文件 / 496 例（本票新增 7 例；票据 01 的 22 例按新覆盖契约更新） |
| 单元层 | `pnpm test:unit` | PASS |
| 兼容层 | `pnpm test:compat` | PASS |
| PTC 层 | `pnpm test:ptc` | PASS |
| preset 形状与内建依赖白名单 | `pnpm check:preset` | PASS（`sync-read.mjs` 已纳入 node: 内建白名单） |
| 真实来源一轮 | `node scripts/sync-check.mjs --now 2026-10-27T14:00:00Z` | 完整执行，exit 2（引擎区域未覆盖） |

| 覆盖 | 状态 | 检查点 | 差异 |
|---|---|---|---|
| 本机来源与本项目基线 | covered | 18 | 0 |
| PTC 工具组成、配置、提示与契约 | covered | 75 | 28（保留 20 / 待分析 8） |
| stock read | covered | 14 | 5（保留 4 / 不适用 1） |
| hashline / tool-edit 发布与补丁 | not-covered | 0 | 0 |

本地证据：`.tmp/sync-smoke/evidence/sync/20261027-140000-78108932355e/`（被 Git 忽略，不随 clone 交付）。

## 5. 未覆盖 / GAP

| 项 | 状态 | 说明 |
|---|---|---|
| 行为兼容结论 | GAP | 只有静态符号探针与数值比较：符号存在不证明行为一致，符号消失也只说明契约位置变了。 |
| 大文件流式读取本身 | GAP | 上游有 `STREAM_MIN_SIZE` 流式路径，本项目没有；本票只把它记为保留差异，未做任何实现（票据边界明确不实现流式改造）。 |
| 保留项跨轮内容绑定 | GAP | 属票据 05。 |
| 引擎发布比较 | GAP | 票据 04。 |
| macOS / Linux 实跑 | GAP | 未执行；模拟路径不冒充平台通过。 |
| `pnpm test:delivery` | GAP | 按票据 06 统一执行。 |

## 6. 下一步

票据 04「引擎发布更新与补丁影响评估」：复用既有发布查询边界，补齐已发布版本枚举与语义版本排序，分别列出稳定版与预发布候选，给出固定版本到候选的更新依据与两个引擎的组合/补丁影响；部分来源失败时保留独立完成的本地结果。
