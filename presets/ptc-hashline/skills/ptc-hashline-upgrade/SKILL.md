---
name: ptc-hashline-upgrade
description: PTC Hashline 升级检查入口（仅用户显式调用）。核验调用资格、确认维护仓库与证据目录、采集实际运行基线；只读评估、方案、同意与执行尚未实现。
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

## 4. 本版本尚未支持的动作

以下能力**尚未实现**，遇到时直接说明“当前版本未支持”，不得用替代手段：

- 官方 DSH、hashline、tool-edit 的元数据查询、影响评估与“无需升级/暂缓/推荐候选/证据不足”结论。
- 升级方案（`proposalId`/`proposalHash`、候选组合、逐项补丁决策、验证命令、回退基线）与用户同意记录。
- 隔离候选安装与验证、目标切换、失败回退，以及任何对 manifest/lockfile/patch/dist/profile 的修改。

在同意流程与执行入口交付前，本 skill 只做只读的资格核验、配置确认与基线采集；不安装、不构建、不改依赖、不改 profile、不联网查询版本。