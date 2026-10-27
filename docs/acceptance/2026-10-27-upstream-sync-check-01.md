# 上游同步检查 — 票据 01 本机来源闭环验收

日期：2026-10-27
状态：本票交付范围 PASS；整体同步检查 **不完整**（PTC、stock read、引擎三项比较尚未交付，见票据 02～04）
运行平台：Windows（本次唯一实跑平台）。macOS/Linux 保留 GAP。

需求权威：[上游同步需求规格](../specs/2026-10-27-upstream-sync-requirements.md)。本文件只记录本票的执行结果、证据位置与未覆盖范围，不构成第二份需求正文，也不构成升级或目标切换授权。

## 1. 本票交付的公开入口

```powershell
pnpm sync:check                    # 一轮检查，写出报告与结构化记录
pnpm sync:check --checkout <绝对路径>   # 本次来源（最高优先级）
pnpm sync:check --set-checkout <绝对路径> # 保存本机来源，供以后每轮复用
pnpm sync:check --now <ISO-8601>   # 固定检查时间戳（复现与测试）
```

等价的直接入口是 `node scripts/sync-check.mjs [flags]`。检查是维护仓库动作：不挂载 preset、不回答任何会话、不需要模型凭据，也不调用模型。

### 来源选择（SYNC-01）

| 层级 | 来源 | 说明 |
|---|---|---|
| 1 | `--checkout` | 本次显式路径 |
| 2 | `DSH_CHECKOUT` | 环境变量 |
| 3 | 本机配置 | `node presets/ptc-hashline/operations/cli.mjs config --set-dsh-checkout <绝对路径>` |

第一个**存在**的层决定来源。该层不可用（不存在、不是绝对路径、断链、不是目录、没有 DSH 清单）时直接停止并列出原因与每次尝试，**不**换用下一层，也**不**扫描磁盘。三者都没有时报告缺少配置并给出下一步。相对路径一律拒绝：它只会静默地等于当前目录。

配置存在同一个运维配置 store（`$DSH_HOME/state/ptc-hashline-operations/config.json`）的 `sync` 命名空间下，因此本机配置天然在仓库之外、不进版本控制；两个既有写角色（维护仓库、证据目录）的探活语义未改变。可复制的模板见 [config.template.json](../../presets/ptc-hashline/operations/config.template.json)。

### 输出与格式版本

| 项 | 值 |
|---|---|
| 报告目录 | `<evidenceDirectory>/sync/<checkId>/` |
| 文件 | `report.md`（人读）、`sync.json`（结构化记录） |
| 记录标识 | `tool: ptc-hashline-operations-sync`、`version: 1` |
| 报告格式 | `ptc-hashline-upstream-sync/1` |
| checkId | `<UTC 时间戳>-<内容哈希前 12 位>`；同一批输入同哈希，输入变化即另一个 id |
| 目录唯一性 | id 相同（同秒同输入）时追加 `-2`、`-3`，每轮产物独立保留、不改写历史 |

`sync.json` 记录：检查时间、状态与原因、来源身份（来源层、输入路径、实际解析目录、是否用户链接、版本声明、commit、工作树、快照性质、相关输入摘要）、本项目基线（精确依赖声明、锁定依赖、补丁身份、实际安装解析）、覆盖清单、差异（本票为空）、建议、缺口。

### 退出码

| 码 | 含义 |
|---|---|
| 0 | 全部比较区域已覆盖且无阻塞来源（本票尚未达到） |
| 2 | 已停止（三个来源层都没有给出 DSH 目录，未写任何产物）或不完整（已写出报告） |
| 3 | 用法错误（未知参数、缺少值、位置参数） |

## 2. 覆盖范围（本票的诚实边界）

| 区域 | 状态 | 本票行为 |
|---|---|---|
| source | covered | 取来源身份、本项目基线、相关输入摘要；真实来源那一轮 18 个检查点 |
| ptc | not-covered | 票据 02 交付；本轮**没有比较**，报告不得读作已同步 |
| stock-read | not-covered | 票据 03 交付 |
| engines | not-covered | 票据 04 交付 |

因此本票所有真实运行都以 `status: incomplete`、退出码 2 结束，并在报告正文写明「本轮没有差异记录：这不是「已同步」的结论」。这是设计如此，不是失败。


> 后续更新（票据 02～04）：ptc、stock-read、engines 三个区域均已交付比较器，本表反映的是票据 01 当轮的状态。另有一处契约细化：**命名了但不可用**的 DSH 目录不再整体停止——依赖源码树的三个区域记 GAP 并标不完整，engines 区域照常比较（它不需要源码树），整体仍标不完整；只有「三个来源层都没给出目录」才停止且不写产物。见[票据 04 验收](2026-10-27-upstream-sync-check-04.md)第 2 节。

## 3. 执行结果

| 检查 | 命令 | 结果 | 证据 |
|---|---|---|---|
| 构建与类型检查 | `pnpm check` | PASS（exit 0） | 构建 + 三包 check + `tsc -p tsconfig.tests.json` |
| 集成层（含本票 22 例） | `vitest run --config vitest.integration.config.ts` | PASS（38 文件 / 479 例，exit 0） | 本票新增 [operations-sync-check.spec.ts](../../tests/integration/operations-sync-check.spec.ts) |
| 单元层 | `pnpm test:unit` | PASS（22 文件 / 297 例，exit 0） | — |
| 兼容层 | `pnpm test:compat` | PASS（2 文件 / 21 例，exit 0） | — |
| PTC 层 | `pnpm test:ptc` | PASS（9 文件 / 33 例，exit 0） | — |
| preset 形状与内建依赖白名单 | `pnpm check:preset` | PASS（exit 0） | 新增 `operations/sync.mjs` 已纳入「只允许 node: 内建与同目录模块」清单 |
| 真实来源一轮检查 | `node scripts/sync-check.mjs --now 2026-10-27T03:00:00Z` | 完整执行，退出 2（预期：未覆盖区域） | 本地证据 `.tmp/sync-smoke/evidence/sync/20261027-030000-6774eb27eb4e/`（被 Git 忽略，不随 clone 交付） |

本票覆盖的验收项：SYNC-01、SYNC-02、SYNC-08。SYNC-06 的重复运行比对、SYNC-09/10/11 属票据 05/06。

### 真实来源那一轮的关键读数（2026-10-27）

- 来源层 `config`，输入与实际解析目录均为 `D:\Project\source\__TEST__\deepseek-harness`，非链接。
- 版本声明 `@deepseek-ai/dsh-root 0.2.1-rc.2`；commit `687f282e8625c6b8d11ff58211a90524be2e4317`；工作树 `clean` → 快照性质「工作树干净：内容对应该 commit」。
- 6 个相关输入全部 `present`：`packages/bundle/web-app/presets/ptc.patch.yml` 与 `packages/fs/tool-fs/src/index.ts`、`read.ts`、`read-render.ts`、`read-target.ts`、`error.ts`。
- 本项目基线：精确声明 `@hy-sde-org/dsh-hashline 0.2.1-alpha.4`、`@hy-sde-org/dsh-tool-edit 0.2.1-alpha.4`；锁定依赖 5 项与声明一致；`patches/` 两个补丁各带 sha256，`patchedDependencies` 两条键按精确版本绑定；实际解析到的引擎版本同为 0.2.1-alpha.4，标记证据 `patched`。
- 缺口（gaps）：空。整体状态仍为 `incomplete`，原因只有未覆盖区域。

### 无副作用（SYNC-08）

- 自动化用例对来源树与维护仓库树做**整树路径 + sha256 快照**，检查前后逐项相等；证据根下只出现 `sync/<checkId>/{report.md,sync.json}` 两个文件。
- 真实来源那一轮前后 `git -C <DSH> status --porcelain` 完全一致（脚本内实测 `dsh-tree-unchanged=True`）。
- 检查不写来源源码、依赖声明、锁文件、补丁、日常 profile 或任何用户链接；不安装、不切换目标、不发网络请求（本票的来源是本机目录）。

## 4. 实现要点

- 核心在 `presets/ptc-hashline/operations/sync.mjs`（配 `sync.d.mts`），公开入口在 `scripts/sync-check.mjs`（配 `sync-check.d.mts`）。检查复用既有 baseline 采集（`collectBaseline` / `readRepositoryState`）与既有配置 store，不新建第二套基线或配置机制。
- 配置写入集中在一个 writer：`config --set-dsh-checkout` 通过新增的 `saveSettings` 写入 `sync` 命名空间，两个既有写角色的探活语义不变。
- 覆盖清单里的「已覆盖」只由**实际交付的比较器**或本票的身份记录产生；没有比较器的区域固定 `not-covered`。票据 02～04 落地比较器时，该区域才会翻成 covered。
- 子进程采集默认走**文件描述符**而不是管道：受限沙箱会以 EPERM 拒绝命名管道，child_process 的默认管道捕获在那种环境里会让所有 git 事实变成 unknown。该约定只在 `sync.mjs` 内使用；既有 `baseline` / `upgrade` 路径未改动（见第 5 节）。

## 5. 未覆盖 / GAP / 待查

| 项 | 状态 | 说明 |
|---|---|---|
| macOS / Linux 实跑 | GAP | 本票只在 Windows 实跑。三平台相关逻辑有可执行用例（绝对路径、拒绝相对路径、链接解析、记录哈希与键序无关），但模拟路径不冒充其他平台通过。 |
| `pnpm test:delivery`（真实打包宿主验收） | GAP | 本票是维护入口 + 运维模块变更，不涉及 preset 装配；按票据 06 的交付门禁统一执行，不在本票声明。 |
| 重复运行与历史比较 | GAP | 属票据 05；本票只保证每个 id 一个独立目录、不改写历史。 |
| PTC / stock read / 引擎比较 | GAP | 属票据 02～04，报告显式列 not-covered。 |
| `baseline` / `upgrade` 的 git 采集仍用管道 | 观察项 | 同一受限沙箱下会把它们的 commit/dirty 记成 unknown。本票未改动那些路径（改动会波及既有验收契约），只把同步检查自己的采集改成描述符捕获。是否推广由后续票据按需要决定。 |

## 6. 下一步

票据 02「PTC 变化检查」：在同一个公开入口下把 `ptc` 区域从 `not-covered` 翻成 covered，输出带稳定标识与两端内容身份的差异记录，并把初始保留差异（独立 persona/watchdog、自有 read/edit）绑定到规格或 ADR。
