# 有效工作目录：目录服务是唯一来源，上游 edit 用本地精确补丁对齐

日期：2026-10-23
状态：已采纳（runtime-fix-plan 阶段 B/D）

## 背景

真实宿主里 `read` 的相对路径能打开会话工作区的文件，但 `edit` 的相对路径、REM、MV 都落到宿主进程目录（实现 checkout），
报 `File not found` 或 `Cannot delete …: outside the working directory …`。

原因不是两个工具"各有一套算法"，而是上游算法本身读错了属性：

- DSH Session 只在 `header.cwd` 上保留**初始**目录；会话当前目录是 `workingDirectory` 投影，
  可随 `working-directory/change` 变化（`packages/session/working-directory/src/index.ts:117-152`）。
- 上游 `tool-edit` 的 `toolCwdFromExec` 读 `exec.agent?.session?.cwd`，真实 Session 没有该属性，
  于是恒回退 `process.cwd()`（原版 `dist/session.js:26-31`）。
- 早期 read 刻意镜像了这个算法（规格 v3 FR-7 旧文），所以两边的 key 都指向进程目录；只有 show path
  的绝对键偶然救回一部分读取后的编辑。

## 决策

1. **唯一来源**：read 与 edit 都取一次 `workingDirectory` 的有效目录（有 agent 时
   `ensure`/`get(agent.session)`，无 agent 回退 `process.cwd()`），并把这一个值用于路径解析、
   canonical/store key、recovery 范围与 REM/MV 包含关系。禁止克隆 Session 或注入 `session.cwd`。
2. **上游不 fork**：`@hy-sde-org/dsh-tool-edit` 以精确版本 + `pnpm patchedDependencies` 的本地补丁接入
   （`patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch`）。补丁只做三件事：
   `inject` 增加 `workingDirectory`；`toolCwdFromExec(exec, ctx)` 改读目录服务；`writer.move` 对
   写通分支也检查目标端在会话目录内（原版会绕过包含关系）。
3. **read 侧同步**：`packages/tool-read/src/session.ts` 删除旧的 `session.cwd` 辅助函数；read 只算一次 cwd，
   解析和 `snapshotKeys` 共用。`[0]` 哨兵、双键记录（输入键 + show path 键）与"无 session 不 mint"不变。

## 维护边界

- 补丁是**精确版本绑定**的：升级 `dsh-tool-edit` 前先检查上游是否已修好目录来源与 MV 包含关系；
  已修好则删除补丁、更新 `tests/compat/README.md` 的基线行并重跑完整门禁；未修好则重做补丁，
  不得只改 `node_modules`。
- `pnpm-lock.yaml` 记录 `patch_hash`；干净安装必须解析到打补丁的包。隔离 profile 验收要记录
  `edit` 实际解析到的路径与补丁是否生效。
- 升级或更换目录服务语义（例如 `get` 变成异步）时，read 的同步取值与补丁的同步调用必须一起改；
  `createEditSession` 是同步的，优先保持 `get`。
- **已知边界**：`edit` 用同步 `get`，不做目录存在性恢复；`read` 用 `ensure`，目录消失时会恢复并提交
  `working-directory/change`。若将来需要 edit 也恢复，按计划阶段 B3 在仍保留完整 agent 的异步 execute 入口
  调用 `ensure`，把已解析 cwd 显式传给 `EditSession`；不要对上游精简后的 `{session}` 伪 agent 调用 `ensure`。
- 回退 D1 时同时回退：补丁文件与 `patchedDependencies` 登记、read 的 cwd 算法与测试、lockfile。
  只回退一侧会让 read 与 edit 的 store key 再次分裂（FR-8 静默失效）。

## 后果

- 相对路径、REM、MV 在真实 Session 中可用；目录切换后的后续操作使用新目录；多会话互不串目录。
- 越界 REM/MV 仍被拒绝；补丁没有放宽包含关系。
- 上游升级多了一项显式检查；测试基线从"原版本"变成"原版本 + 本地补丁"。
