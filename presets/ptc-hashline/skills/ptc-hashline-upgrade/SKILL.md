---
name: ptc-hashline-upgrade
description: PTC Hashline 升级检查与方案入口（仅用户显式调用）。核验调用资格与配置、采集实际运行基线，只读评估官方 DSH、hashline 与 tool-edit 的更新，产出可审阅的升级方案、记录用户同意或拒绝，在获准后于隔离候选树中验证依赖与补丁组合，并在第二阶段同意后把批准的组合切换到指定的那一个 profile 安装树；失败只回退本轮或留证交接。
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
node <base>/../../operations/cli.mjs upgrade propose [--assessment <dir|json>] [--target maintenance-repository|upgrade-target] [--target-path <绝对 profile 目录>] [--now <ISO>]
```

- 默认读取 `<evidenceDirectory>/upgrades/` 下最新的 `assessment.json`；**不重算评估**。没有评估、评估不可读、结论不是 `recommend-candidate`、或没有任何推荐项 ⇒ 退出 `2`，**不写任何方案文件**，并说明下一步是重新 `upgrade assess`。
- propose 会重新采集一次基线：评估记录的组件版本与本次采集不一致（从检查到方案之间已经漂移）⇒ 退出 `2`、不写方案，提示重新评估。
- 退出码：`0` 已写出；`2` 已停止（未写出或写出失败）；`3` 用法错误。
- 只写 `<evidenceDirectory>/upgrades/<proposalId>/` 下的三个文件：`proposal.json`、`proposal.md`、`consent.json`（初始 `status: pending`、`records: []`）。
- `proposalId = <stamp>-<proposalHash 前 12 位>`；`proposalHash` 覆盖 baselineHash、候选组合、逐项补丁决策、目标、scope、验证命令与回退基线。同一批输入同 hash；任一绑定输入变化即另一份方案（另一个目录）。
- `--target` 默认 `maintenance-repository`（它可解析出真实路径）；只写 `--target upgrade-target` 时 path 记 `unknown`，而 `unknown` 永远不是可切换的目标。
- 要真正切换，必须在 propose 时就指名**那一个** profile 安装树：`--target-path <绝对目录>`（已存在、带 `package.json`、且该清单已声明本 bundle）。该路径与被批准的目标清单摘要（`package.json` / `pnpm-lock.yaml` 的 sha256）都进入 `target`，因此进入 `proposalHash`，并被同意记录原样绑定：换一个目标就是另一份方案、另一次同意（UPG-05）。目录不存在、没有 `package.json`、或清单里没有 `dsh-tool-hashline` ⇒ 退出 `2`、不写方案（切换只更新用户指定的那个 profile 安装树，不把本 bundle 装进别人的 profile）。
- 它只是**命名与绑定**，不构成切换授权；切换要第 8 步的第二阶段同意。
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

## 7. 获准后的隔离候选验证（UPG-04/06/09/11/13）

**只有**第 6 步已经记录到 `approve`（scope 含 `candidateValidation`）之后才进入这一步。没有同意记录、最后一条是拒绝、或方案已漂移时，`validate` 会直接退出 `2`：不创建候选目录、不启动任何命令。

```bash
node <base>/../../operations/cli.mjs upgrade validate --proposal <proposal.json> [--now <ISO>] [--timeout-min <n>]
```

- 授权闸门在任何写入与候选命令之前：最后一条同意记录必须是 `approve`、`proposalHash` 与方案一致、`scope.candidateValidation === true`、重新采集的基线（含未提交输入）仍等于方案记录、方案位于 `<evidenceDirectory>/upgrades/` 下、且本会话不是子 agent。任一不符 ⇒ 退出 `2`、零写入、零候选命令（只读的 `git rev-parse`/`git status` 属于基线采集），`next` 说明该重新 `upgrade propose` 还是重新 `upgrade consent`。
- 候选目录就是方案只命名过的那个 `<evidenceDirectory>/upgrades/<proposalId>/candidate/`：本步才创建 `tree/`（维护仓库快照，**含未提交改动**）、`logs/`（每条命令一份完整输出）与 `result.json`，并写同级的 `validation.md`。不创建别的目录。
- 验证的是**批准的**组合，不是基线组合：安装前先把 `candidates[].version` 钉进候选树自己的 `package.json`（只改清单里已声明的依赖；清单没声明的记缺项），装完再比对**解析到的**引擎版本与批准的候选版本（`candidate-versions-match`），并核对引擎之间声明的版本约束（`engine-version-constraints`，只读精确版本/`^`/`~`，其它范围记未求值）。版本对不上 ⇒ `candidate-failed`，不是通过。
- 隔离边界：候选树用自己的 lockfile 与自己的 store（`candidate/.pnpm-store`）。不写维护仓库工作树、不写仓库根 `.pnpm-store`、不写全局 store。
- 逐项补丁按方案里的 `keep` / `redo` / `delete` 执行，并处理版本耦合：`patchedDependencies` 的键与 `patches/*.patch` 文件名都带精确版本，版本一动就一起改名；一个组件整组都是 `delete` 才删除补丁文件与注册行。`pending-verification` 的项**保持未决**（本步不把它收敛成 keep，记缺项）。补丁是否作用于该构建**只**由候选树解析到的构建文件里的标记证明（版本号与该组件的声明都不算证据）；上游是否已实现同一行为（语义回归）由方案依据来源申报判断，本步不测量，报告里记 `semanticRegression: not-measured`。
- 只执行 `changes.verification` 里列出的命令，外加本步自己的核验（解析路径与共享 hashline 实例、候选版本比对、引擎约束、补丁标记证据、补丁摘要、候选树上的 read→edit 短链路）。命令有自己的白名单（`pnpm` / `npm` / `node` 的 `install`/`build`/`test`/`run`/`exec`，或方案自己声明过的脚本名）、超时（`--timeout-min`，默认 15 分钟）与取消（`SIGINT`/`SIGTERM`：已开始的命令被超时或 shell 结束，后面的门禁记为未执行）。**第一条失败即停**，后面的门禁记为未执行。
- 退出码：`0` 仅在方案列出的门禁**全部实际执行且通过**、并且核验项全过（`n/a` 表示没有可测对象，既不算过也不算失败）时；`2` 有失败、超时、跳过、缺项或关键基线 `unknown`（结果已写出）；`3` 用法错误。`--yes` / `--approved` / `--auto` 一类参数仍是 `3`。
- 结论三态：`candidate-verified` / `candidate-failed` / `candidate-incomplete`。关键基线（commit、lockfile、候选版本、解析路径、补丁摘要）或某个未提交输入缺失/读不出 ⇒ `pendingVerification`，最多 `incomplete`；skipped、缺项与 GAP 一律如实写出，且**不计入通过**。
- **报告怎么读**：只有 `candidate-verified` 才能说“满足第二阶段同意的前置条件”。任何情况都**不说**目标已经切换、不说版本已在目标上生效；失败不切换。`scope.switch === false`（默认，只批准候选）时交付报告后**停下来等第二阶段同意**（回到第 6 步补 `--scope validation-and-switch`）；`switch === true`（用户一次明确批准两阶段且范围未变）时不必重复询问，直接进入第 8 步。
- 出现方案外的实现、语义或测试契约改动（报告里 `stop.rule === 'UPG-09'`）⇒ 保留失败现场、停止并另提方案：**不放宽断言、不把测试改绿、不扩大修复范围**。

## 8. 获准后的目标切换（UPG-05/06/07/10/12）

**只有**第 6 步记录到 `approve` 且 `scope.switch === true`、并且第 7 步的候选结论是 `candidate-verified`（读同目录 `candidate/result.json`，不看任何自述）之后，才进入这一步。只批准候选（`scope.switch === false`）时**不改任何目标**：先问用户是否切换，再回到第 6 步补一条 `--scope validation-and-switch`。用户一次明确批准两阶段且范围未变时不重复询问。

```bash
node <base>/../../operations/cli.mjs upgrade switch --proposal <proposal.json> [--now <ISO>] [--timeout-min <n>]
```

- 切换前重新核验、且**在任何写入与进程之前**：最后一条同意记录必须是 `approve`、`proposalHash` 与方案一致、`scope.switch === true`；重新采集的基线（含未提交输入）仍等于 `baselineHash`；方案位于 `<evidenceDirectory>/upgrades/` 下；同意记录里的目标与本方案的目标一致；候选是 `candidate-verified` 且 `pendingVerification` 不为 true；本会话不是子 agent。任一不符 ⇒ 退出 `2`、零写入、零命令，`next` 说明该重新 `upgrade assess` / `upgrade propose` / `upgrade consent` / `upgrade validate`。
- **UPG-10**：维护仓库里被本次切换影响的文件（`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`patches/*`）只要有用户未提交改动就**停止该次切换**；目标 profile 的 `package.json` / `pnpm-lock.yaml` 与方案记录的摘要不一致同样停止。无关改动原样保留：不 stash、不提交、不回退，也不用「HEAD 相同」当证据。
- 落盘顺序固定：**先备份**（方案 `rollback` 的 commit/dirty/userInputs/lockfileSha256/patchFiles/roles + 目标 profile 的两个清单，逐个核对摘要）→ 写本轮写入清单 `switch.json` → 改维护仓库的依赖与逐项补丁（沿用第 7 步的名字/键版本耦合规则）→ `install` → 方案列出的 `build`（方案没列、仓库也没声明则记 `n/a`；仓库声明了而方案没列 ⇒ 记缺项）→ 装目标 profile → 重新采集目标基线。**每一步失败即停**，按下面的回退规则处理。
- 备份不完整（受影响文件读不出、源与副本摘要不一致、两侧清单缺失）⇒ **在改动任何文件之前停止**，不是「备份不了就先改」。
- 备份写 `<proposalId>/backup/`；切换记录写 `<proposalId>/switch.json`（`decision` / `conclusion` / `steps` / `writtenFiles[{path,beforeSha256,afterSha256}]` / `target{role,path}` / `versionsBefore|After` / `engineEvidence` / `sessionId`；只追加：每次写入只增长列表，不改写已有条目），人读报告写 `<proposalId>/switch.md`。`proposal.json`、`consent.json`、`validation.md` 一个字节都不改。
- **UPG-12**：部分失败时先确认目标仍是**本轮写入**的结果（把当前 sha256 与引擎版本比对 `switch.json` 记的 after 值）。仍属本轮 ⇒ 只在方案声明的回退范围内恢复依赖、补丁与安装状态（从 `backup/` 拷回、删掉本轮新建的补丁文件、重装两侧），并核对恢复后 `patchFiles[].sha256` / lockfile 摘要 / 引擎版本回到 baseline，写 `rollback.json`；出现外部改动、备份不全或回退后核对不上 ⇒ 停止、留证、交接，**不覆盖**业务文件与无关改动。回退不做「部分失败自动重试」。
- 结论三态：`switch-applied` / `switch-failed-restored` / `switch-failed-handover`。只有 `switch-applied` 才能说「目标已按批准方案切换」；`switch-failed-restored` 要写清恢复了什么、保留了什么；`switch-failed-handover` 要写清哪一步开始不明、交给用户看 `switch.json` / `rollback.json` 的哪一段。没实测到的一律记 GAP，**不当成功**。
- 退出码：`0` 仅当切换的全部步骤实际执行且目标核验通过（目标 profile 解析到的引擎版本等于候选版本、`patchEvidence` 的标记结论成立、read/edit 共享同一物理 hashline 实例、目标内 read→edit 短链路通过）；`2` 有失败、停止、回退中或交接（记录已写出）；`3` 用法错误。
- 活依赖不热改：不杀进程、不重启或关闭 DSH、不改其它 profile、不动官方 DSH 安装。用户先安排停止窗口（D11），切换后的重启由用户自己执行。
- 第 7 步的语义回归口径不变：切换只证明机械结果，不声称上游已实现同一行为。

## 9. 子 agent 的边界（SCOPE-06）

- 用户在主会话显式调用后，同 preset 的子 agent 可以辅助只读取证、基线核对与方案生成（同一 CLI、同一已保存配置）。
- 子 agent **不自行加载或启动**本工作流；只有真实用户在主会话的显式入口算启动。
- 子 agent 的消息、结论或“已同意”自述**不构成用户同意或审批**：`delegation.mayApproveUpgrade` 为 `false` 时不得推进任何写入，consent、validate 与 switch 入口都会直接拒绝（候选验证与目标切换都归主会话）。

## 10. 边界与不做的事

检查、评估、方案、同意、隔离候选验证、目标切换与本轮回退/交接都在上面几步里，本版本没有「尚未实现的升级动作」。

不在本 skill 范围内的：真实宿主交付验收（打包安装、真实 launcher 装配、模式隔离与两条工作流的全链路）由仓库门禁 `pnpm test:delivery` 执行，证据写进 `docs/acceptance/`，不是运行时动作；本 skill 运行时也不假装做过那次验收。

仍然恒定的边界：不改其它 profile、不动官方 DSH 安装、不杀进程、不重启或关闭 DSH、不做「部分失败自动重试」、不放宽任何断言。
