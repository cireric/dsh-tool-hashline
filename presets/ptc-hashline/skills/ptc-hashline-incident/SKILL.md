---
name: ptc-hashline-incident
description: PTC Hashline 异常取证入口（仅用户显式调用）。核验当前调用资格、确认维护仓库与证据目录、采集实际运行基线；取证与问题登记尚未实现。
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

## 4. 本版本尚未支持的动作

以下能力**尚未实现**，遇到时直接告诉用户“当前版本未支持”，不要用替代手段假装完成：

- 按会话/seq 范围做完整性检查与 start/settle 配对、异常分类、脱敏事件片段（解码能力本身已在 bundle 内，但配对与分类未实现）。
- 生成 `summary.md`/`incident.json`/`baseline.json` 与 `.scratch/<feature>/issues/` 问题包、`needs-triage` 登记、重复发生关联。
- 任何重放 `MV`/`REM`、清理部分成功现场、现场修实现或自动升级。

只读分析可以继续；写入类动作在对应能力交付前一律不做。