---
name: ptc-hashline-upgrade
description: PTC Hashline 升级检查与方案入口（仅用户显式调用）。核验调用资格与配置、采集实际运行基线，只读评估官方 DSH、hashline 与 tool-edit 的更新，产出可审阅的升级方案并记录用户同意或拒绝；候选安装、目标切换与回退尚未实现。
disable-model-invocation: true
user-invocable: true
---

# ptc-hashline-upgrade

用户在本模式显式调用 `/ptc-hashline-upgrade` 后，按下面顺序执行。**模型不得自行加载或启动本工作流**；incident 的异常不会自行触发升级检查或上游联网查询。

本 skill 的正文与资源随安装 bundle 交付。下文命令里的 `<base>` 指 `<skill_resources>` 段给出的 base directory（本 skill 自己的目录）；`<base>/../../operations/` 是本 bundle 的运维脚本目录。

## 1. 核验调用资格（不通过就停止）

```bash
node <base>/../../operations/cli.mjs context --session "$DSH_SESSION_ID"
```

- `0` 且 `eligible: true`：继续。
- `2`：**停止**，把 `reason` 与 `evidence` 原样告诉用户。不扫描日志目录、不写证据、不联网、不安装、不改 profile。

调用资格只来自当前调用会话的有效 preset 投影；`ptc` family 标记、目录名、手填 `--preset`、历史会话的 preset 都不算。

## 2. 确认维护仓库与证据目录

先运行 `node <base>/../../operations/cli.mjs config` 读取已保存的配置。

未配置时由用户**明确指定**唯一维护仓库与证据目录，再运行：

```bash
node <base>/../../operations/cli.mjs config --set-maintenance-repo <绝对路径> --set-evidence-dir <绝对路径>
```

相对路径会被拒绝。不要因为当前 cwd 看起来像维护仓库就默认写入。路径失效或不可写时（`roles.<role>.usable` 为 `false`）停止**对应写入**并提示修正；只读分析可继续，不回退到业务 cwd。

## 3. 采集实际运行基线

```bash
node <base>/../../operations/cli.mjs baseline
```

区分三种角色：安装资源根、维护仓库、升级目标。缺失字段记 `unknown`。版本号相同不证明补丁生效；补丁证据只认解析后构建文件里的标记。

## 4. 只读检查与评估（UPG-01/02/08/11）

```bash
node <base>/../../operations/cli.mjs upgrade assess [--sources <json>] [--now <ISO>] [--target maintenance-repository|upgrade-target]
```

- `--sources` 只用于固定的元数据 fixture（离线或受控复现）；不传时使用真实只读查询（`npm view <pkg> dist-tags`、`git ls-remote --heads <url>`）。查询失败只记 `unverified`，绝不写成“最新”，也不得用 install 代替查询。
- `--target` 只选**报告用的角色**（默认 `upgrade-target`）：仅仅说明评估对象，不构成任何切换授权。
- 退出码：`0` 证据完整；`2` 不完整（已写出）或已停止；`3` 用法错误。
- 只写 `<evidenceDirectory>/upgrades/<stamp>/` 三个文件：`assessment.json`、`report.md`、`sources.json`。

读报告时的判据：

- 结论四态按 `insufficient-evidence > defer > recommend-candidate > no-upgrade` 覆盖：任一必需来源不可用只能得 `defer` 或 `insufficient-evidence`，**不得**说成“无需升级”；只有三方已核实的稳定版都没有更新版本才是 `no-upgrade`。
- 每次查询都落在 `sources.json`：`{component, source, queriedAt, kind, version|commit, url, status}`；正式版、预发布、未发布 commit 分开记录。
- 逐项补丁决策按语义给出 `keep` / `redo` / `delete` 与理由（依据候选包文件里的标记），版本号变新本身不构成推荐；无法决策就记 `pending-verification` 并把该组件降到 `defer`。
- 官方 DSH 只给影响面与人工处理建议：不 checkout、不 install、不改全局安装、应用包或启动配置（UPG-08）。官方安装的任何变更都由用户手工完成。
- 关键基线 `unknown`（例如本机解析不到官方宿主）时仍出报告：字段记 `unknown`、候选标 `pendingVerification`、`verified: false`，既不是已核实，也不能据此切换或宣告成功（UPG-11）。
- `recommended: false` 的项（待验证候选、暂缓项、证据不足项）不是执行依据。
- 真实只读运行能从 registry/ref 查询拿到正式版、预发布与 tag/分支 commit，但**取不到候选包文件文本**（那需要下载候选，属于票据 06 的范围）。因此真实的引擎项通常记 `pending-verification` 并降到 `defer`；`--sources` 提供的候选包文本用于离线复现与逐项决策。同理，diff 申报的影响面（`areas`）与上游替代声明（`covers`）需要来源提供，缺失时报告写「来源未申报」，不得推断。

## 5. 提交可审阅的升级方案（UPG-03/05）

只有评估结论是 `recommend-candidate` 且至少一个组件 `recommended: true` 时才出方案：

```bash
node <base>/../../operations/cli.mjs upgrade propose [--assessment <dir|json>] [--target maintenance-repository|upgrade-target] [--now <ISO>]
```

- 默认读取 `<evidenceDirectory>/upgrades/` 下最新的 `assessment.json`；**不重算评估**。没有评估、评估不可读、结论不是 `recommend-candidate`、或没有任何推荐项 ⇒ 退出 `2`，**不写任何方案文件**，并说明下一步是重新 `upgrade assess`。
- propose 会重新采集一次基线：评估记录的组件版本与本次采集不一致（从检查到方案之间已经漂移）⇒ 退出 `2`、不写方案，提示重新评估。
- 退出码：`0` 已写出；`2` 已停止（未写出或写出失败）；`3` 用法错误。
- 只写 `<evidenceDirectory>/upgrades/<proposalId>/` 下的三个文件：`proposal.json`、`proposal.md`、`consent.json`（初始 `status: pending`、`records: []`）。
- `proposalId = <stamp>-<proposalHash 前 12 位>`；`proposalHash` 覆盖 baselineHash、候选组合、逐项补丁决策、目标、scope、验证命令与回退基线。同一批输入同 hash；任一绑定输入变化即另一份方案（另一个目录）。
- `--target` 默认 `maintenance-repository`（它可解析出真实路径）；选 `upgrade-target` 时 path 记 `unknown`。它只是**命名与绑定**，不构成切换授权。
- 候选目录只**命名**（`.../candidate/`），不创建，也不得落在维护仓库工作树里（证据目录若在维护仓库内，propose 直接退出 `2`）。
- 验证命令只从维护仓库 `package.json` 的 `scripts` 只读列举，**不执行、不猜命令**；缺 `scripts` 记 gap。运行前缀取自 `packageManager`，未声明时 `run` 记 `null` 并在缺口里说明，不假设 `pnpm`。列的是仓库声明的**全部**脚本：哪些属于本次候选的门禁由审阅确认，脚本不筛选、不排序判断。
- 回退基线含 commit、dirty、未提交输入（`userInputs`）、lockfile sha256、`patches/*` 摘要与 roles。

把 `proposal.md`（或 `proposal.json`）的要点原样呈现给用户，然后**明确提问**是否执行，并**等待真实用户回复**。

## 6. 记录用户同意或拒绝（UPG-03/05/07 + SCOPE-06）

```bash
node <base>/../../operations/cli.mjs upgrade consent --proposal <proposal.json> --decision approve|reject [--scope candidate-validation|validation-and-switch] --reply "<逐字引述>" [--now <ISO>]
```

- `--reply` 必须是用户**本人这次**的逐字引述，且必须能在**本会话自身的** `user/message` 里找到（`data.source.kind === 'user'`）；找不到 ⇒ 退出 `2`、不写记录。子 agent 的消息、工具输出、别的会话的文本都不算。
- 没有任何“自动批准”入口：`--yes` / `--approved` / `--auto` / `approved:true` 这类参数一律退出 `3`；空引述同样退出 `3`。
- `--decision approve` 默认只授权**候选验证**（记录 scope 为 `{candidateValidation: true, switch: false}`）。仅当用户在同一次回复里**明确**批准两阶段时，才加 `--scope validation-and-switch`（`switch: true`）。`--decision reject` 的记录 scope 为空，且**不得**带 `--scope`。
- 记录绑定 `proposalHash`、`baselineHash`、`target{role,path}`、`scope`、`decision`、`repliedAt`、`reply{quote,source,seq}`、`recorder{sessionId,role}`；**只追加**，不改写旧记录；无记录就是 `pending`。
- 同意只写证据目录树内：方案文件不在 `<evidenceDirectory>/upgrades/` 下（或证据目录不可用）⇒ 退出 `2`、不写记录，不要把方案复制到别处再批准。
- `replyMatches` 大于 `1` 表示这段引述在本会话里不唯一：记录取最后一条 seq，但**必须**把问题问得更精确，不能把一次含糊匹配当成同意。记录只能证明这段文字出现在本会话的用户消息里；用户消息没有逐条时间，所以“是否写在方案之后”由本 skill 的提问与等待保证，脚本不假装能判断。
- 漂移即失效：consent 会重新采集基线并与方案的 `baselineHash` 比对，也会核对 `--proposal` 里的 `proposalHash` 与重建绑定是否一致、目标是否仍指向同一位置；任一不符 ⇒ 退出 `2`、不写记录，并提示重新评估与重新出方案（已提交与未提交输入都算漂移）。
- SCOPE-06：`context` 的 `delegation.mayApproveUpgrade` 不为 `true`（子 agent 会话）⇒ consent 退出 `2`、不写记录。propose 允许子 agent 运行（辅助分析），同意只能来自主会话的用户本人。

**判定含糊/无回复的责任在本 skill，不在脚本：**

- 用户**无回复**、**拒绝**、或回复**含糊**（“你觉得呢”“随便”“先这样吧”）⇒ **都不开始**。含糊或缺失时继续等待，或把同一个问题重问一次；不得自行解释成同意。
- 同一份 `proposalHash` 内已取得明确同意后，不为同一件事重复询问；方案、目标、候选或基线变化后必须重新询问。
- 记录是工作流追溯，**不宣称**能防住本机操作者伪造；宿主无法提供可核验回复时，交还用户用可见提示确认，不自行创造回执。

## 7. 子 agent 的边界（SCOPE-06）

- 用户在主会话显式调用后，同 preset 的子 agent 可以辅助只读取证、基线核对与方案生成（同一 CLI、同一已保存配置）。
- 子 agent **不自行加载或启动**本工作流；只有真实用户在主会话的显式入口算启动。
- 子 agent 的消息、结论或“已同意”自述**不构成用户同意或审批**：`delegation.mayApproveUpgrade` 为 `false` 时不得推进任何写入，consent 入口会直接拒绝。

## 8. 本版本尚未支持的动作

以下能力**尚未实现**（票据 06/07），遇到时直接说明“当前版本未支持”，不得用替代手段：

- 隔离候选的安装与验证：不创建候选目录、不下载或安装候选、不执行验证命令。
- 目标切换、失败回滚，以及任何对 manifest/lockfile/patch/dist/profile 的修改。

在候选验证与执行入口交付前，本 skill 只做只读的资格核验、配置确认、基线采集、更新评估、方案生成与同意记录；不安装、不构建、不改依赖、不改 profile、不切换目标。
