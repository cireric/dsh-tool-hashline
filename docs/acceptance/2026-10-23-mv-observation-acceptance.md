# 运行修复验收记录：MV 目标写入意图 / 快照提交次序

日期：2026-10-23
计划：[2026-10-23-mv-observation-fix-plan](../../.scratch/ptc-hashline/2026-10-23-mv-observation-fix-plan.md)
输入报告：[相对路径 MV/REM 实测报告](../../.scratch/ptc-hashline/2026-10-23-relative-path-mv-rem-report.md)（保留原文）
前序验收：[2026-10-23-runtime-fix-acceptance.md](./2026-10-23-runtime-fix-acceptance.md)（其 MV/REM PASS 的夹具范围见 §6）
决策：[ADR-0004](../adr/0004-mv-create-intent-and-snapshot-order.md)

本记录只陈述本次实际执行过的命令与观察。未执行项列为 GAP，不用配置检查、进程内测试或历史记录替代。

## 1. 判定摘要

| 项 | 判定 | 证据 |
|---|---|---|
| 引擎 commit 次序（move 失败不迁移快照；move 成功后才 relocate/record；快照提交异常不伪装成移动失败） | 通过 | `tests/compat/mv-snapshot-order.spec.ts` 3/3；修复前前两例 2/2 红 |
| 真实 Session + 真实 `fs-observation-policy` + 本地 provider 的 MV 矩阵 | 通过 | `packages/tool-read/tests/integration/mv-observation.spec.ts` 17/17；修复前 9 红 |
| 既有目录/MV/REM 用例（夹具改为默认挂策略） | 通过 | `working-directory.spec.ts` 10/10 |
| PTC 层：run_code 内 MV / MV→REM、部分成功与多节错误保真 | 通过 | `tests/ptc/mv-policy.spec.ts` 4/4 |
| 隔离 profile：两份补丁在解析产物中生效、lockfile 登记 patch_hash、read→PUT→read→MV→read→REM | 通过 | `node scripts/test-profile.mjs` → `EXIT=0` |
| 旧验收 §4 的 MV/REM PASS 覆盖范围 | 已标注（不改写结论） | 见 §6 |
| 真实宿主重挂载 + 新会话 | **GAP** | 见 §8.1 |
| "创建前 sandbox 拒绝"：错误分类与包装 | 通过（注入） | `mv-observation.spec.ts`「keeps a provider sandbox denial visible with its own code」 |
| 真实 sandbox 后端拒绝 | **GAP** | 见 §8.2 |

## 2. 环境与命令

- 仓库：`D:/Project/source/__TEST__/dsh-plugins/dsh-tool-hashline`（Windows，Node 24.19.0，pnpm 11.28.5）。
- `pnpm test:*` 在 workspace-write 下会因 esbuild 以管道 stdio 启动子进程而 `spawn EPERM`；
  本次用等价入口 `node node_modules/vitest/vitest.mjs run --config <cfg>`、
  `node node_modules/typescript/bin/tsc -p <cfg>`、`node scripts/check-preset.mjs`、
  `node scripts/test-profile.mjs`；必要时一次性放宽沙箱。
- 依赖补丁由 `pnpm patch` / `pnpm patch-commit` 生成并落盘（没有手改 `node_modules` 作为交付）。

## 3. 红 → 绿（保留原始失败）

命令：`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts packages/tool-read/tests/integration/mv-observation.spec.ts`

| 用例 | 修复前实际输出 |
|---|---|
| `moves to a target this session never observed` | `edit requires reading "…\mv-new-dest.txt" first`（`FS_NOT_OBSERVED`） |
| `moves to a target already observed as absent` | 先 `read` 目标得到 `cannot read "…\mv-absent-dest.txt": not found`，MV 仍得 `cannot edit "…\mv-absent-dest.txt": not found`（`FS_NOT_FOUND`） |
| `applies a line edit and a move in the same section` | `edit requires reading "…\mv-combo-dest.txt" first` |
| `refuses a target that appears between the stat and the guarded create` | 注入未触发（写入根本没到达 provider），`injected=false` |
| `reports a partial success when the call is cancelled after the target was created` | `ENOENT … open '…\mv-cancel-dest.txt'`（目标从未创建） |
| `reports a partial success when the source delete fails after the target was created` | `ENOENT … open '…\mv-undel-dest.txt'` |
| `still moves with no policy mounted and passes an explicit createIfAbsent` | `expected [ undefined ] to deeply equal [ 'createIfAbsent' ]` |
| `keeps editing the moved file and sees the source as absent` | MV `isError=true` |

修复前该文件 `9 failed | 3 passed`；修复后 `17 passed`。

命令：`node node_modules/vitest/vitest.mjs run --config vitest.compat.config.ts tests/compat/mv-snapshot-order.spec.ts`

| 用例 | 修复前实际输出 |
|---|---|
| `keeps the source snapshot and leaves the destination alone when the move fails` | `expected null to deeply equal { text: 'alpha\nbeta\ngamma\n', …(2) }`（源快照已被 relocate 掉） |
| `moves the snapshot only after the filesystem move succeeded` | `expected 'relocate' to be 'move'`（调用顺序：relocate 先于 move） |

修复前 `2 failed`；修复后 `3 passed`（第 3 例是修复后才加入的快照提交异常用例，无红色基线）。

## 4. 交付的补丁与登记

### 4.1 `patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch`（扩展）

保留原有三点（`inject` 增加 `workingDirectory`、`toolCwdFromExec(exec, ctx)` 读目录服务、
写通 move 两端包含关系），新增 MV 目标创建分支：

1. move 入口先做包含关系检查，再 `signal.throwIfAborted()`；取消时不产生任何磁盘或观察副作用。
2. `stat` 目标；已存在即拒绝（不区分是否被 read 过）。
3. 用本次 stat 结果 `emit('fs/observed', target, { kind: 'absent' }, exec)`，归属同一 session。
4. `fs/write-intent`：只接受 `createIfAbsent`；返回 `replaceIfVersion` 等明确拒绝（`FS_STALE_VERSION`）。
5. `fs.writeText(target, content, { kind: 'createIfAbsent' }, signal, resolveSandbox())`；无 policy 也显式带创建条件。
6. 成功记录目标 `present/version`；删除源前再检查 signal；只在删除成功后记录源 `absent`。
7. 失败分类：并发创建 → `FS_NOT_OBSERVED`（目标保留、源未删）；其他创建失败 → `MoveCreateError`
   （用只读 `stat` 探测并写明"目标存在未核实/不存在/无法探测"，源未删除，不重试）；
   目标已建而删除前取消或删除失败 → `PartialMoveError`（`isError`，含两端路径、阶段、cause 与补救指引）。

8. 多节批次的提交错误沿用引擎既有的包装口径：`Failed to write <path>: <cause>… Sections already written: ….
   Sections not written: …. `。上游 `hashline/execute.js` 自己循环 commit（没有走 `Patcher.apply`），
   原先只抛出失败节自身的错误，调用方看不到"前序节已落盘"；该包装与 `Patcher.apply` 的同名逻辑一致。
   失败节是 MV 时，被包装的正是 `PartialMoveError`（两端路径、阶段、cause 都在）。
9. 创建失败时保留 provider 自己的 `FsErrorCode`（如 `FS_SANDBOX_DENIED`、`FS_PERMISSION_DENIED`），
   只有非 FsError 才降级为 `FS_IO_ERROR`；`PartialMoveError` 固定 `FS_IO_ERROR` + `name='PartialMoveError'`。

普通 `writer.write()` 仍走 `fs/edit-intent`，PUT/replace/patch 的控制语义未变。

### 4.2 `patches/@hy-sde-org__dsh-hashline@0.2.1-alpha.4.patch`（新增）

`Patcher.commit` 的 move 分支改为：`await fs.move(...)` → `snapshots.relocate(...)` →
`record(destination)`。磁盘成功而 relocate/record 失败时抛 `SnapshotCommitError`，
message 明确"磁盘已移动、快照未完整提交"。哈希、seen 合并与 recovery 判据未改。

### 4.3 登记与生效证据

- `pnpm-workspace.yaml` → `patchedDependencies` 含两个精确版本条目；`pnpm-lock.yaml` 记录：
  - `@hy-sde-org/dsh-hashline@0.2.1-alpha.4(patch_hash=f49120b37bf4eefbbc56226bcd99d1226aaa3af863a7f161888990d8abe940dc)`
  - `@hy-sde-org/dsh-tool-edit@0.2.1-alpha.4(patch_hash=747d2d563a24c341bdb9cdb7924bb91f670685eff2bb30d4662ae77240dfbbbd)(c3ea3e44bd2e4f98a99514e9703c33ba)`
- `node scripts/test-profile.mjs` 的解析与标记断言（原文）：

```text
ok resolved hashline package -> D:\Project\source\__TEST__\dsh-plugins\dsh-tool-hashline\node_modules\@hy-sde-org\dsh-hashline\package.json
ok resolved tool-edit package -> D:\Project\source\__TEST__\dsh-plugins\dsh-tool-hashline\node_modules\@hy-sde-org\dsh-tool-edit\package.json
ok patch marker present: hashline MV relocates the snapshot only after the disk move
ok patch marker present: tool-edit MV creates its target through createIfAbsent
ok lockfile registers a patch hash for @hy-sde-org/dsh-hashline@0.2.1-alpha.4
ok lockfile registers a patch hash for @hy-sde-org/dsh-tool-edit@0.2.1-alpha.4
ok one physical hashline instance for read and edit
```

版本号相同不足以证明补丁加载，因此新增了"解析产物里查补丁标记"的断言。

干净安装（独立临时目录，未改动本仓库 `node_modules`）：

```text
pnpm install --offline --store-dir D:\.pnpm-store\v11   # 全新目录，仅有 package.json + pnpm-workspace.yaml + patches/
EXIT=0
安装产物中 "authorizes the snapshot migration" / "const intent = { kind: 'createIfAbsent' }" 各命中 1 次
pnpm-lock.yaml 含 5 处 patch_hash=
打补丁后的 commit 次序：move 在 relocate 之前（干净安装中为 574 / 577 行）
```

## 5. 测试矩阵与实际覆盖

| 场景 | 覆盖 | 断言要点 |
|---|---|---|
| 目标未观察且不存在 | `mv-observation.spec.ts`「moves to a target this session never observed」 | 首次成功；源消失、目标内容一致 |
| 目标已观察为 absent | 同文件「moves to a target already observed as absent」 | 不再报 `FS_NOT_FOUND` |
| 目标存在（未读 / 已读） | 同文件「refuses to overwrite … never read」「… read (observed present)」 | 拒绝覆盖；两端字节不变 |
| stat 后、创建前并发出现目标 | 同文件「refuses a target that appears between the stat and the guarded create」 | provider 的 `createIfAbsent` 拒绝（`FS_NOT_OBSERVED`）；源与并发目标保留 |
| PUT + MV 同一节 | 同文件「applies a line edit and a move in the same section」 | 目标含修改，非目标行不变 |
| 创建前取消 | 同文件「reports a cancel that happens before the create」 | 错误可见；源未删、目标未创建 |
| 目标创建成功、删除前取消 | 同文件「… cancelled after the target was created」 | `isError`；两端路径与部分成功可见；目标内容正确、源仍在 |
| 目标创建成功、删除失败 | 同文件「… source delete fails after the target was created」 | 同上（含 cause） |
| provider 创建结果不确定 | 同文件「marks an unknown create outcome as unverified…」 | 源不删除；报"未核实"；写入只尝试 1 次，不补偿删除 |
| 引擎 move 抛错 | `tests/compat/mv-snapshot-order.spec.ts` 第 1 例 | 以 commit 前为基准，源快照 text/hash/seen 保留，目标无快照 |
| 成功后快照提交次序 | 同文件第 2 例 | 日志顺序 move → relocate → record；源快照不残留 |
| 移动成功后继续编辑 | `mv-observation.spec.ts`「keeps editing the moved file…」 | 目标 read/PUT 可用；源路径 `FS_NOT_FOUND` |
| REM 独立正例 | 同文件「deletes with REM without any prior MV」 | 删除成功，不依赖 MV |
| MV → read → REM | 同文件「completes MV, a read of the moved target, and REM」 | 整链成功 |
| 越界、目录切换、多会话 | `working-directory.spec.ts` 既有用例 | 仍拒绝越界；切换后使用新目录；快照隔离 |
| 无 policy 兼容 | `mv-observation.spec.ts`「still moves with no policy mounted…」 | MV 仍显式传 `createIfAbsent`；`signal` 与解析后的 sandbox policy（本夹具为 `undefined`）同样到达 provider |
| 创建前 provider 失败 | 同文件「reports a provider error that happens before the target is published」 | 原因可见；报告"目标不存在"；源未删、目标未建 |
| 创建前 sandbox 拒绝（模拟） | 同文件「keeps a provider sandbox denial visible with its own code」 | `info.code === 'FS_SANDBOX_DENIED'`；原因与两端状态可见 |
| 快照提交异常（磁盘已移动） | `mv-snapshot-order.spec.ts` 第 3 例 | `SnapshotCommitError` 文案含"磁盘已移动/未提交"；无反向移动；源快照未迁移 |
| PTC：run_code 内 MV | `tests/ptc/mv-policy.spec.ts` 第 1 例 | 程序内 read→MV→read 成功，磁盘一致 |
| PTC：MV→read→REM | 同文件第 2 例 | 程序内整链成功，两端均不存在 |
| PTC：多节部分成功 | 同文件第 3 例 | 外层错误同时含 `Sections already written`、失败节、MV 两端路径与 `partly completed`；首节已落盘、目标保留 |
| PTC：部分成功消息保真 | 同文件第 4 例 | 程序捕获到含两端路径与 `partly completed` 的消息 |

确定性来自受控夹具：并发创建、取消、删除失败、未知结果都在 `ctx.fs.writeText`/`stat` 接缝上
注入**一次**副作用，不使用偶发竞态；没有用内存探针替代真实 provider 的磁盘结果验证。

### 5.1 与《MV / REM 修复后测试计划》ID 的对应

| 计划 ID | 本次实际落点 |
|---|---|
| ENV-01 | §4.3：`test-profile` 的解析路径、补丁标记、lockfile `patch_hash`、引擎单实例，外加 policy 挂载下的 read→PUT→read→MV→read→REM |
| PATH-01 | `working-directory.spec.ts`「keeps the real Session shape and edits a relative header…」（provider 默认目录 = 进程 cwd） |
| MV-01 | `mv-observation.spec.ts`「moves to a target this session never observed」 |
| MV-02 | 「moves to a target already observed as absent」 |
| MV-03 | 「refuses to overwrite an existing target that was never read」「… that was read (observed present)」 |
| MV-04 | 「refuses a target that appears between the stat and the guarded create」 |
| MV-05 | 「applies a line edit and a move in the same section」 |
| MV-06 | 「reports a cancel that happens before the create」+「… provider error that happens before the target is published」+「… sandbox denial visible with its own code」；sandbox 为**注入**，真实后端见 §8.2 |
| MV-07 | 「… cancelled after the target was created」+「… source delete fails after the target was created」+ `tests/ptc/mv-policy.spec.ts`「surfaces a partial move…」 |
| MV-08 | 「marks an unknown create outcome as unverified instead of retrying or deleting」 |
| MV-09 | 「still moves with no policy mounted and passes an explicit createIfAbsent」 |
| SNAP-01 | `mv-snapshot-order.spec.ts`「keeps the source snapshot…when the move fails」 |
| SNAP-02 | 「moves the snapshot only after the filesystem move succeeded」 |
| SNAP-03 | 「reports a disk move whose snapshot commit failed…」 |
| REM-01 | 「deletes with REM without any prior MV」 |
| REM-02 | 「completes MV, a read of the moved target, and REM」+ PTC「completes MV, a read of the moved file, and REM in one program」 |
| REG-01 | `working-directory.spec.ts` 的越界 REM/MV、切目录、多会话用例 |
| REG-02 | `tests/compat/guard.spec.ts` 15 例 + `working-directory.spec.ts` 的 seen 守卫与双键用例 |
| PTC-01 | `tests/ptc/mv-policy.spec.ts` 第 1、4 例 |
| BATCH-01 | 同文件「keeps the already-written section and the partial MV state in one error」 |
| PROMPT-01 | 前序 `persona-preservation` 矩阵（runtime-fix-acceptance §5）；本轮未重跑宿主，见 §8.1 |

## 6. 旧验收范围的修订（不改写结论）

[2026-10-23-runtime-fix-acceptance.md](./2026-10-23-runtime-fix-acceptance.md) §4 的
「MV（会话目录内）通过」「REM（会话目录内）通过」是在
`packages/tool-read/tests/integration/working-directory-harness.ts` **未挂**
`fs-observation-policy` 的夹具下取得的。该夹具当时只证明目录解析与内容结果，
不覆盖真实 profile 的写入意图契约；所以"integration 全绿"与"线上 MV 被拒"可以同时成立。
本次把该夹具改为**默认挂载策略**（`policy: false` 仅作对照），旧记录保留原计数与判定。

## 7. 门禁结果（修复后）

| 命令 | 结果 |
|---|---|
| `pnpm build`（3 个包 tsc 构建） | exit 0 |
| `pnpm -r check` + `tsc -p tsconfig.tests.json` | exit 0 |
| `pnpm test:unit` | 44 passed / 8 files |
| `pnpm test:integration` | 84 passed / 9 files |
| `pnpm test:ptc` | 13 passed / 3 files |
| `pnpm test:compat` | 18 passed / 2 files |
| `node scripts/check-preset.mjs` | OK：不变量、caps、门与资源摘要 |
| `node scripts/test-profile.mjs` | OK：干净 profile 安装、组合、两份补丁标记、read→PUT→read→MV→read→REM、门正负 |

**偶发记录（不掩盖）**：`test:compat` 共跑 18 次全量（每次 2 文件、17–18 例），其中 4 次出现**单例**失败，
每次失败的用例都不同：

| 失败用例 | 捕获到的原文 |
|---|---|
| `cross-session and eviction are known permissive paths (R-7) > lets another session edit with a tag minted here (silent guard skip)`（2 次） | `ReplaceFileW EIO (Win32 1175): …\xsession.txt` |
| `store keys (FR-7) > records the input key and the show-path key and edits through the show path` | 当时该断言没有 message 参数，未保留 |
| `store keys (FR-7) > edits through a relative path read and an absolute path read alike` | 断言已带 message，但该次输出被命令过滤丢弃，未保留 |
| `fs/observed emission (FR-6) > lets the stock write tool replace a file this read observed`（integration 层，同一次四层批跑） | 同上：断言当时无 message，已补标签 |

其余 14 次 compat 全绿（含最后一次连续四层批跑：44 / 84 / 13 / 18）；`guard.spec.ts` 单文件连续 5 次全绿；
integration 单独连续 3 次 84/84。缺失 label 的断言已全部补上 `error?.message`，便于下次直接取原文。
错误文本来自 provider 的原子发布（Windows `ReplaceFileW`），发生在任何 hashline 后处理之前；
本次改动不涉及这些用例的写路径（compat 层没有 MV，`mv-snapshot-order.spec.ts` 是纯内存）。
同类瞬时失败在前两份验收里已有记录（runtime-fix-acceptance §3：三次单例失败；
traceability §代码评审处置：跨进程 tag 一次）。按"不可复现的环境偶发"记录：
不作为通过依据，也不忽略；判定以单独重复运行为准。

## 8. GAP（未执行，不用替代证据）

1. **真实宿主重挂载 + 新会话**：当前 Web 会话所在的 profile（`C:/Users/lenovo/.dsh/profiles/web`、
   `desktop`）没有引用本 bundle，仓库约束也禁止切换日常 profile 或替换宿主服务。
   "禁用/重挂载 → 新会话 → 相对 MV → read → REM"的真实链路**未执行**。
   已做的是隔离 profile 的安装、组合、补丁标记与 read→PUT→read→MV→read→REM（§4.3），它是进程内等价链路，
   不是宿主重挂载。另外：宿主进程里旧模块已在内存中，仅"新开会话"不足以加载新补丁，必须重启宿主。
2. **"创建前 sandbox 拒绝"**：本仓库未安装 `@deepseek-ai/dsh-fs-sandbox`，夹具无法驱动真实
   sandbox 后端。已注入一个 `FsError(…, 'FS_SANDBOX_DENIED')` 并断言错误码与文案保留
   （`mv-observation.spec.ts`「keeps a provider sandbox denial visible with its own code」），
   但这证明的是**错误分类与包装**，不是 sandbox 后端真的拒绝写入。真实 sandbox 场景仍为 GAP。
3. **源删除的版本条件**：provider 未提供条件删除；本次只保证"目标先条件创建、源后删除"，
   不宣称能防住源在读取后被外部替换（§ADR-0004 边界）。

## 9. 回退

按变更分别管理：

1. tool-edit：恢复 move 分支为原 `this.write(to, …) + this.delete(from)` 顺序（不推荐，会重新引入 MV 拒绝），
   并去掉 `hashline/execute.js` 的多节包装；或整体回退补丁文件与 `patchedDependencies` 条目 + lockfile。
   **保留** ADR-0003 的目录补丁内容。
2. hashline：回退 relocate 位置到 `fs.move` 之前，并删除对应补丁登记。
3. 测试：夹具的 `policy` 默认值不要回退成"不挂"——那会让本类回归重新假绿。
4. 旧测试目录 `.scratch/ptc-hashline-postfix-test/` 与原报告保留的 `sample.txt` 不动。
