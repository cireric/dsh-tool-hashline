---
name: ptc-hashline-incident
description: PTC Hashline 异常取证入口（仅用户显式调用）。核验调用资格、确认维护仓库与证据目录、采集运行基线，并从指定会话/seq 范围生成脱敏摘要与 needs-triage 问题包；重复关联与 upgrade 工作流尚未实现。
disable-model-invocation: true
user-invocable: true
---

# ptc-hashline-incident

用户在本模式显式调用 `/ptc-hashline-incident` 后，按下面顺序执行。**模型不得自行加载或启动本工作流**：普通工具报错、自然语言任务相似、文件位于本仓库，都不构成启动条件。未显式调用时，本工作流不产生任何文件、网络或安装副作用。

本 skill 的正文与资源随安装 bundle 交付。下文命令里的 `<base>` 指 `<skill_resources>` 段给出的 base directory（本 skill 自己的目录）；`<base>/../../operations/` 是本 bundle 的运维脚本目录。

## 1. 核验调用资格（不通过就停止）

1. 用 `run_code` 调用 `bash` 执行下列命令；**会话 ID 只能从宿主 shell 管理的变量读取**，`run_code` 内的 `process.env` 不是读取入口：

   ```bash
   node <base>/../../operations/cli.mjs context --session "$DSH_SESSION_ID"
   ```

2. 退出码与结果：
   - `0` 且 `eligible: true`、`evidence.effectivePreset` 为 `ptc-hashline`：继续第 2 步。
   - `2`（`status` 为 `wrong-preset` 或 `context-unverified`）：**停止**。把结果里的 `reason` 与 `evidence` 原样告诉用户，不要换其它路径重试，不要扫描日志目录、不写证据、不联网、不安装。

3. 判据：调用资格只来自**当前调用会话**的有效 preset 投影（header 初值加后续 selection 事件，见 `evidence.headerPreset` / `selectedPreset` / `selectionSeq`）。header 的 family 标记 `ptc`、目录名、用户手填的 `--preset` 都不能替代它；历史目标会话的 `ptc-hashline` 也不能替代当前调用资格。

## 2. 确认维护仓库与证据目录

1. 运行 `node <base>/../../operations/cli.mjs config` 读取已保存的配置。
2. 若尚未配置，请用户**明确指定**唯一维护仓库与证据目录，再运行：

   ```bash
   node <base>/../../operations/cli.mjs config --set-maintenance-repo <绝对路径> --set-evidence-dir <绝对路径>
   ```

   不要因为当前 cwd 看起来像维护仓库就默认写入；不要向业务项目目录猜写。相对路径会被拒绝。
3. 配置路径失效或不可写时：`roles.<role>.usable` 为 `false`，停止**对应写入**并提示用户修正；只读分析可以继续，但不得回退到当前业务 cwd。

## 3. 采集实际运行基线

```bash
node <base>/../../operations/cli.mjs baseline
```

输出里的每个字段都要按来源区分：

- `roles.installation`：本 bundle 的安装资源根（当前运行的是哪份代码）。
- `roles.maintenanceRepository`：承载依赖与补丁维护的工作树（不等于安装资源根，也不等于 cwd）。
- `roles.upgradeTarget`：用户同意后才应用变更的目标。
- `versions` / `resolvedPaths` / `realpaths`：版本号、解析到的清单、以及实际加载的物理目录。
- `repository`：维护工作树的 `commit`、`dirty`、`changedPaths`、lockfile 与 patch 文件的 sha256。
- `session`：本次调用会话记录的 `provider`/`model`/`preset` 及投影来源。

无法获得的字段一律是字符串 `"unknown"`，不要用推测值填补；`unknown` 数组列出本次缺口。**版本号相同不是补丁生效证据**：`engines.*.patch.status` 来自解析后构建文件里的标记，取值 `patched`/`unpatched`/`partial`/`unknown`。

## 4. 生成脱敏摘要与问题包（INC-01..06）

用户显式调用后，按用户指定的**当前或历史目标会话**与 seq 范围生成证据包；范围不明时先请用户指明，不要隐式扫描其它会话：

```bash
node <base>/../../operations/cli.mjs incident --target-session "<会话 ID>" [--target-cwd "<会话工作目录>"] [--seq-min N --seq-max M] [--user-report "<用户对异常的描述>"] [--user-evidence "<独立字节/diff/测试证据>"] [--feature <slug>]
```

- 默认目标是本次调用会话；`--target-session` / `--target-cwd` 指向被分析的历史会话，**它不能替代调用资格**（资格只来自本次会话的 preset 投影）。
- 会话 ID 取用户明确给出的值或宿主 shell 的 `$DSH_SESSION_ID`；`--target-session`/`--target-cwd` 的别名是 `--session`/`--cwd`。`--user-report` 陈述“工具成功但结果不对”，`--user-evidence` 记录用户独立核验的字节/diff/测试结论（INC-03）；两者都不伪造 `isError`。`--feature` 指定问题包写到 `.scratch/<feature>/issues/`（默认 `ptc-hashline-operations-skills`）；`--now` 仅供测试固定时间戳。
- 输出目录：证据目录下 `incidents/<时间戳>-<会话>/`，含 `summary.md`、`incident.json`、`baseline.json`、`excerpt.json`（最小脱敏事件片段与源摘要）。源日志只读，不复制业务全文。
- 退出码：`0` 覆盖完整并已写出证据包；`2` 表示证据不完整（**已写出**，但不得读成“健康”）或流程停止（视 `status` 为 `stopped`/`read-only`/`missing`/`unsupported-generation`，此时不写证据）。停止原因在 `reason`，缺口在 `gaps`。
- 事件按 `subCallId` 配对；内层失败即使被程序 catch、外层 `run_code` 成功也会保留（INC-01）。`complete`/`completed` 不单独构成成功判据（INC-04）。
- 分类与严重度分开：`expected-refusal`（预期拒绝）、`model-parameter-error`（模型参数错误）、`environment-problem`（环境问题）、`suspected-implementation-defect`（疑似实现缺陷）、`partial-success`（部分成功）、`cancelled`（取消）、`insufficient-evidence`（证据不足）、`success`。
- 预期拒绝与取消只进 `summary.md`；疑似实现缺陷、部分成功与用户报告的结果不符会自动登记 `<维护仓库>/.scratch/<feature>/issues/NN-*.md`，`Status: needs-triage`，写明证据与假说（INC-06）。重复发生关联尚未实现（票据 03），不要声称已关联历史问题。
- 脱敏：参数、首行、路径中的凭据与家目录一律掩码；源文件不修改，不重放 MV/REM、不清理部分成功现场、不现场修实现、不自动升级。证据目录不是备份，长期归档由用户管理。

## 5. 本版本尚未支持的动作

以下能力**尚未实现**，遇到时直接告诉用户“当前版本未支持”，不要用替代手段假装完成：

- 重复发生的关联（跨基线关联已有问题、保留独立发生记录）：票据 03。
- upgrade 的只读评估、方案、用户同意、候选验证、目标切换与回退（票据 04—07）。
- 完整真实宿主交付验收；外发、自动清理、重放 `MV`/`REM`、现场修实现或自动升级（票据 08 与规格边界）。

只读分析可以继续；写入类动作在对应能力交付前一律不做。