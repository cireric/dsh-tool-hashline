# 上游同步检查 — 票据 06 真实来源验收与交接

日期：2026-10-27
状态：**Windows 真实来源范围 PASS**；全范围仍保留明确 GAP（macOS/Linux 未实跑、候选包内容未取得、目标切换未授权）
运行平台：Windows（唯一实跑平台）

需求权威：[上游同步需求规格](../specs/2026-10-27-upstream-sync-requirements.md)。本文件是六张票据的最终验收记录，也是**当前唯一权威的同步检查状态**；票据 01～05 的验收文档各自记录当轮事实。

## 1. 本次真实验收的输入条件

| 项 | 值 |
|---|---|
| 本机 DSH 来源 | `D:\Project\source\__TEST__\deepseek-harness`（真实本机源码，`git rev-parse HEAD` = `687f282e8625c6b8d11ff58211a90524be2e4317`，工作树 0 个改动路径） |
| 来源层 | `config`（`DSH_HOME` 指向隔离配置目录，配置里记的是上面这个真实路径） |
| 引擎发布来源 | 真实 npm registry 只读查询（`npm view <pkg> versions dist-tags --json`），未使用任何固定响应 |
| 本项目基线 | HEAD `ae32d61e2cd988a6a7c10852b18ad57f8f5a84fd` + 未提交改动的 41 个条目 |
| 模型凭据 / 付费请求 | 无（检查路径不调用模型） |
| 证据目录 | `.tmp/sync-smoke/evidence`（Git 忽略；本轮新增四轮目录，见下表） |

**日常 profile 未被触碰**：这台机器的 `%USERPROFILE%\\.dsh\\state\\ptc-hashline-operations\\config.json` 不存在，也没有被创建；检查只在隔离的 `DSH_HOME` 下读写自己的证据目录，未执行 `--set-checkout`。


## 2. 真实运行（五轮）

| 轮 | checkId | 命令 | 退出码 | 状态 | 复验判读 |
|---|---|---|---|---|---|
| A 首轮 | `20261027-020208-c6e2e9fca6ae` | `node scripts/sync-check.mjs` | 0 | complete | first-check（无历史） |
| B 重复 | `20261027-020210-792f542b5080` | 同上 | 0 | complete | no-new-changes（43 条全部未变化未决定） |
| C 带决定 | `20261027-020228-47adfcace1df` | 同上（证据目录内 `sync/decisions.json` 有 1 条） | 0 | complete | no-new-changes（已知 1、未变化未决定 42） |
| D 部分失败 | `20261027-020230-3ca7fc095e91` | 同上 `--sources <外部来源边界夹具>` | 2 | incomplete | engines 不完整 + `engines.tool-edit: BLOCKED`；source / ptc / stock-read 照常 covered |
| E 收尾 | `20261027-020709-89e67b31bb43` | 同上（无夹具） | 0 | complete | no-new-changes（已知 1、未变化未决定 42，与 C 同判读） |

### 首轮覆盖（A）

| 区域 | 检查点 | 差异 |
|---|---|---|
| 本机来源与本项目基线 | 18 | 0 |
| PTC 工具组成、配置、提示与契约 | 75 | 28 |
| stock read | 14 | 5 |
| 引擎发布与补丁影响 | 11 | 10 |

### 首轮身份（A）

- DSH：`@deepseek-ai/dsh-root` `0.2.1-rc.2`，commit `687f282e8625c6b8d11ff58211a90524be2e4317`，工作树 `clean`，快照性质 `clean-checkout`（工作树干净，内容对应该 commit）。
- 本项目精确锚点：`@hy-sde-org/dsh-hashline` `0.2.1-alpha.4`、`@hy-sde-org/dsh-tool-edit` `0.2.1-alpha.4`（两处 `exact: true`）。
- 本地补丁：2 个文件，2 项绑定，`problems: []`。

## 3. 逐项处置意见（43 条）

| 处置 | 条数 | 内容 |
|---|---|---|
| 保留差异 `keep` | 24 | PTC 侧有意保留的配置/行/契约（persona 前缀后缀、tool-fs 上限与开关、delegation 上限、preset 描述等）+ stock read 的 4 条已有关联差异（canonical tag、seen 守卫、4 MiB 快照门槛 vs 10 MiB 流式门槛、编辑策略指引） |
| 待分析 `pending-analysis` | 18 | 见下两小节 |
| 不适用 `not-applicable` | 1 | `read.scope.image-tool`（上游图片读取是独立模块，本区域不比较） |

### PTC 待分析 8 条（票据 02 已定性的同一批）

| 差异 | 含义与下一步 |
|---|---|
| `ptc.config.delegation>tool-subagent.backgroundMode`、`ptc.config.delegation>tool-subagent-fork.backgroundMode`、`ptc.contract.tool-subagent.backgroundMode` | 本项目在 PTC 配置里声明了 `backgroundMode`，所选来源的 `tool-subagent` 配置类型没有这个字段（根因同一处，三行同源）：取得行为依据或上游确认后再定处置 |
| `ptc.config.planning>plan-mode.section` | plan-mode 提示段内容不同：需要与宿主 plan-mode 的实际提示行为对齐后再判 |
| `ptc.row.time-context`、`ptc.row.tool-schedule`、`ptc.row.tool-plugin-manager`、`ptc.row.tool-plugin-market` | 上游 PTC 有而我们没有的行：属能力差距，是否跟进由维护者决定，不自动补齐 |

### 引擎待分析 10 条

| 差异 | 含义与下一步 |
|---|---|
| `engines.hashline.update` / `engines.tool-edit.update` | 固定 `0.2.1-alpha.4` → 候选 `0.2.1-rc.3`（两包均未发布正式版）：有版本更新、影响待查 |
| `engines.hashline.patch[0..1]`、`engines.tool-edit.patch[0..4]` | 7 处本地补丁在候选里是否仍需保留未知：候选包文本不在只读查询范围，须由受控候选验证判定 |
| `engines.combination` | 两包候选同落 `0.2.1-rc.3`：组合兼容性只能由受控候选验证证明 |

报告正文（`report.md`）含每条差异的稳定标识、对象、两端内容身份、影响、处置、理由、复查条件与证据位置；`sync.json` 是同一事实的结构化形式。

## 4. 重复运行的判读（真实来源）

| 观察 | 事实 |
|---|---|
| B 轮对 A 轮 | 43 条差异两端身份全部一致 → `no-new-changes`，全部记「未变化但未决定」（**不是**「已知」） |
| C 轮对 B 轮 | 证据目录内 1 条 `keep` 决定（`ptc.preset.id`，绑定两端内容身份）→ `known 1 / undecided 42` |
| 真实来源是否变化 | **没有**：A～D 四轮之间 DSH HEAD 与工作树未变，两个引擎包的已发布版本集合也未变（`0.2.1-rc.3` 始终是最高候选） |
| 「新增变化」类的真实证据 | 本机在验收期间没有任何真实上游改动，而修改官方 DSH 源码或伪造来源都不是本票授权范围。该判读由夹具用例证明（`tests/integration/operations-sync-history.spec.ts`：新增对象、任一端变化、对象消失），并在此**明确标注为夹具证据，不是真实来源发生的变更**。 |

## 5. 副作用核验（SYNC-08）

| 项 | 验收前 | 验收后 | 结论 |
|---|---|---|---|
| DSH 来源树 | HEAD `687f282…`，0 个改动路径 | 同 | 未修改 |
| 本项目工作树 | HEAD `ae32d61…`，41 个改动条目 | 同（同一集合） | 未修改 |
| 依赖 / 锁定 / 补丁 | `0.2.1-alpha.4` ×2，`patches/` 2 项已绑定 | 同 | 未安装、未升级、未改锁定 |
| profile / 用户链接 | 未触碰（日常 profile 目录不存在且未被创建） | 同 | 未切换、未创建链接 |
| 新增文件 | 只在证据目录内（Git 忽略） | 同 | 只写本轮报告与结构化记录 |
| 模型请求 | 无 | 无 | 检查路径不含模型调用；外部访问仅 `npm view` 只读查询与本地 `git` 读取 |
| 固定响应边界 | 仅 D 轮（部分失败边界用），A～C 全部真实查询 | — | 真实验收未被固定响应替代 |

## 6. 验收场景映射（规格 SYNC-01～SYNC-11）

| ID | 场景 | 结果 | 证据 |
|---|---|---|---|
| SYNC-01 | 三层来源优先级；缺配置 / 无效路径 / 断链明确报错，不扫描不回退 | PASS | 票据 01 文档；`operations-sync-check.spec.ts`（优先级、缺配置停止不写、无效路径拒绝） |
| SYNC-02 | 普通目录与用户链接解析；本地修改保留 commit/dirty/摘要；身份缺失记 unknown | PASS | 票据 01；同上（dirty 快照、链接、unknown 分支） |
| SYNC-03 | PTC 工具/配置/提示/契约变化可定位；新增不被吞；未知待分析 | PASS | 票据 02；本轮 75 检查点 / 8 条待分析 |
| SYNC-04 | stock read 参数/返回值/截断/大文件/错误进入差异；与 PTC 同来源 | PASS | 票据 03；本轮 14 检查点 / 5 记录（上限按值全相同） |
| SYNC-05 | 引擎稳定/预发布候选区分；更新依据；不误报兼容 | PASS | 票据 04；本轮 11 检查点 / 10 记录（两包无正式版，候选 `0.2.1-rc.3`） |
| SYNC-06 | 首次与重复运行一致输出；新增可辨认；内容改变触发复查；历史缺失不伪装 | PASS | 票据 05；本轮 A→B→C 三轮 |
| SYNC-07 | 发布源失败而 DSH 可读时继续本地检查；反向同样；缓存不掩盖 | PASS | 票据 04；本轮 D 轮（engines BLOCKED、本地三区域照常） |
| SYNC-08 | 检查前后来源树、依赖、补丁、profile、链接未变；只生成报告与取证；无模型请求 | PASS | 第 5 节前后对照 |
| SYNC-09 | 报告可为选定跟进项提供身份/差异/待办；来源变化令旧输入失效；不能绕过候选验证与切换授权 | PASS（交接路径见第 7 节） | 报告字段 + 既有候选验证输入绑定用例（`operations-candidate-validation.spec.ts`） |
| SYNC-10 | Windows 真实 DSH 与真实发布源完成一次完整检查，逐项意见与待办；重复检查可核验 | PASS | 第 2～4 节（四轮真实运行） |
| SYNC-11 | 三平台路径/配置/报告逻辑纳入自动化测试；按实跑平台留证；模拟不冒充实跑 | PASS（Windows）+ **GAP（macOS/Linux 未实跑）** | 三个平台相关的自动化：路径拒绝与平台分隔符（`operations-sync-check.spec.ts` 三平台用例块）、配置读取与证据目录、报告渲染；macOS/Linux 明确未执行 |

## 7. 交接：把跟进项交给既有受控流程

报告是**依据**，不是同意记录。维护者按下面顺序把一轮身份交给既有流程（不新增流程、不自动安装）：

| 步骤 | 命令 / 动作 | 交接内容 |
|---|---|---|
| 1 | 读 `.tmp/sync-smoke/evidence/sync/<checkId>/report.md` 的差异表与「与上一轮的比较」 | checkId、来源身份、差异标识与两端内容身份、处置与复查条件 |
| 2 | 选定跟进项（例如 `engines.hashline.update` + `engines.tool-edit.update`：`0.2.1-alpha.4` → `0.2.1-rc.3`） | 本轮 checkId 与候选版本 |
| 3 | 走既有升级评估：`node presets/ptc-hashline/operations/cli.mjs upgrade assess`（内部实现评估、生成提案） | 检查报告里的版本与补丁清单作为输入依据 |
| 4 | 维护者审阅提案并显式同意（consent 记录 `scope.candidateValidation`） | 未同意前不安装、不切换 |
| 5 | 受控候选验证：`upgrade validate`（隔离树 + 真实门禁），先读候选包字节再判补丁 keep/redo/delete | 补丁判定从「待验证」变成实据 |
| 6 | 目标切换由维护者另行授权 | 检查与本票都不构成切换授权 |

**旧证据不能给新输入背书**：候选验证绑定提案哈希与采集时的输入摘要，输入变了必须重跑——这条由既有用例证明，本票不重造（`operations-candidate-validation.spec.ts`：`refuses a proposal whose payload changed after it was written`、`refuses a drifted baseline — an edited lockfile AND a new untracked file both count`）。同步检查这边对称的一条：检查记录内容寻址，输入变则 `checkId` 与 `contentHash` 变（`keeps the record content-addressed` 用例）。

## 8. 门禁结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 构建与类型检查 | `pnpm check` | PASS，exit 0 |
| 测试类型检查 | `tsc -p tsconfig.tests.json` | PASS，exit 0 |
| 集成层 | `vitest run --config vitest.integration.config.ts` | PASS，42 文件 / 525 例 |
| 单元 / 兼容 / PTC 层 | `pnpm test:unit` / `test:compat` / `test:ptc` | PASS |
| preset 形状与内建依赖白名单 | `pnpm check:preset` | PASS，exit 0 |
| 真实打包宿主验收 | `pnpm test:delivery` | PASS，exit 0（PASS 21 / FAIL 0 / GAP 0 / BLOCKED 9，与 2026-10-26 基线逐 ID 相同） |

## 9. 重跑（本轮最终 diff 的证据）

| 检查 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 构建与类型检查 | `pnpm check` | 0 | PASS |
| 测试类型检查 | `tsc -p tsconfig.tests.json` | 0 | PASS |
| 集成层 | `vitest run --config vitest.integration.config.ts` | 0 | PASS，42 文件 / 525 例 |
| 单元层 | `vitest run --config vitest.unit.config.ts` | 0 | PASS |
| 兼容层 | `vitest run --config vitest.compat.config.ts` | 0 | PASS |
| PTC 层 | `vitest run --config vitest.ptc.config.ts` | 0 | PASS |
| preset 形状与内建依赖白名单 | `pnpm check:preset` | 0 | PASS |
| 真实打包宿主验收 | `pnpm test:delivery` | 0 | PASS 21 / FAIL 0 / GAP 0 / BLOCKED 9（31 个验收 ID 全部有结论） |
| 真实来源一轮（本轮最终） | `node scripts/sync-check.mjs`（`DSH_HOME` 指向隔离配置） | 0 | complete，checkId `20261027-020709-89e67b31bb43` |

### 交付门禁的读法

- `pnpm test:delivery` 打包四个交付包、装进一次性 `DSH_HOME`、用真实 launcher 装配 profile 并跑既有门禁，写出 [2026-10-27 交付验收报告](2026-10-27-delivery-acceptance-report.md) 与同名 summary。
- 它的 9 个 `BLOCKED` 是「没有用例执行」的既有验收 ID（INC-02/03/04、UPG-02/05/08/09/10/11），与 2026-10-26 那轮**逐 ID 相同**，不是本次改动引入；FAIL 0、GAP 0。
- 该门禁的 ID 集属运维 skills 规格（SCOPE/PACK/INC/UPG），**不含**本票的 SYNC-01～11；同步检查的验收证据是第 2～6 节的真实四轮，不是这个门禁。
- 打包内容已核验：`npm pack --dry-run` 的 tarball 含 `presets/ptc-hashline/operations/sync-{hash,yaml,ptc,read,engines,run,history}.mjs`、对应 `.d.mts` 与 `decisions.template.json`。`scripts/sync-check.mjs` **不在** tarball 内（`files` 只含 `presets`、`package.json`、`README.md`）：`pnpm sync:check` 是**维护仓库**命令，不是安装后命令——这是设计边界，不是缺口。

### 一次未配置来源的真实运行（顺带验证了 SYNC-01）

门禁脚本里有一次调用没有设置 `DSH_HOME`，落到本机默认配置目录；该目录没有同步检查配置，运行因此 **exit 2、`status: stopped`、未写任何产物**，报告原因指向缺配置——这正是 SYNC-01 规定的「缺配置明确报错、不扫描不回退」，随后带配置的重跑写出了完整轮。

## 10. 仍未覆盖的范围

| 项 | 状态 | 说明 |
|---|---|---|
| macOS / Linux 实跑 | GAP | 逻辑有自动化覆盖，平台实跑未执行；不以模拟路径冒充。 |
| 引擎候选包内容 | GAP | 只读元数据查询不取包字节：7 处补丁与组合影响停在待验证。 |
| 大文件流式读取 | GAP | 上游有 10 MiB 流式路径，本项目无；只记保留差异，未实现。 |
| 真实来源「新增变化」 | GAP | 验收期间上游无变化；该类由夹具用例证明。 |
| 目标切换 / 实际升级 | 不在本票 | 需维护者当次授权，检查报告不构成同意。 |
| 付费模型评测 | 未执行 | 授权边界明确不启动。 |
