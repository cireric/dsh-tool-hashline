---
name: ptc-hashline-upgrade
description: PTC Hashline 升级检查入口（仅用户显式调用）。核验调用资格与配置、采集实际运行基线，并只读评估官方 DSH、hashline 与 tool-edit 的更新；方案、同意与执行尚未实现。
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

## 5. 子 agent 与用户同意（SCOPE-06）

- 用户在主会话显式调用后，同 preset 的子 agent 可以辅助只读取证与基线核对（同一 CLI、同一已保存配置）。
- 子 agent **不自行加载或启动**本工作流；只有真实用户在主会话的显式入口算启动。
- 子 agent 的消息、结论或“已同意”自述**不构成用户同意或审批**。升级方案、同意范围与执行一律交回主会话，由用户本人确认；`context` 输出里的 `delegation.mayApproveUpgrade` 为 `false` 时不得据此推进任何写入。

## 6. 本版本尚未支持的动作

以下能力**尚未实现**，遇到时直接说明“当前版本未支持”，不得用替代手段：

- 升级方案（`proposalId`/`proposalHash`、候选组合、验证命令、回退基线）与用户同意记录。
- 隔离候选安装与验证、目标切换、失败回退，以及任何对 manifest/lockfile/patch/dist/profile 的修改。

在同意流程与执行入口交付前，本 skill 只做只读的资格核验、配置确认、基线采集与更新评估；不安装、不构建、不改依赖、不改 profile、不切换目标。
