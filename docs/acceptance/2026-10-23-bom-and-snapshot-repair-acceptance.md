# BOM 保持、快照异常文案与工具说明修复 —— 验收记录

- 日期：2026-10-23
- 计划：[mv-rem-bom-and-snapshot-repair-plan r2](../../.scratch/ptc-hashline/2026-10-23-mv-rem-bom-and-snapshot-repair-plan.md)
- 输入红测原文：[20261023-1453/RUN-REPORT.md](../../.scratch/ptc-hashline/evidence/20261023-1453/RUN-REPORT.md)（历史报告未改写）
- 本次证据：`.scratch/ptc-hashline/evidence/20261023-1602/`
- 隔离候选根：`.scratch/ptc-hashline-candidate-20261023-1602/repo`

> 2026-10-23 补记：候选根与候选 store（`.scratch/ptc-hashline-candidate-20261023-1602/`，约 145.5 MB）
> 已在工作树清理中删除。本轮的证据与结论仍在 `.scratch/ptc-hashline/evidence/20261023-1602/`（69 个文件），
> 候选可按上表 HEAD 重新复制并在独立 store 中重建；下文对候选根的任何引用均为删除前的记录。

本文件只记录本轮实际执行过的命令与观察。上一轮的 FAIL 仍是 FAIL，本轮的 PASS 是新的运行结果。

## 1. 分层结论（先看这里）

| 层级 | 状态 | 依据 |
|---|---|---|
| **候选修复完成** | **完成** | 候选内三条原红测转绿；BOM-01..14 与 SNAP-R3 通过；完整门禁全绿；隔离 profile 通过；`code-review-and-quality` 审查完成（§7） |
| **原 checkout 整合完成** | **未完成（待用户安排整合窗口）** | 本轮只把源码/测试/补丁/lockfile/文档交回原 checkout；**原 checkout 的安装树未更新**，因此原 checkout 上的 `node_modules` 仍解析旧补丁。§8 |
| **重启后宿主验收完成** | **未完成（待用户重启宿主）** | 需要真正重启测试宿主后在新会话里操作；本轮不自动重启共享宿主、不改日常 profile。§9 |

## 2. 环境

| 项 | 值 |
|---|---|
| 原 checkout HEAD | `aea3c0043babbc08c47510ef119048587378d586`（master），3 个测试文件未提交修改 |
| 候选根 | `.scratch/ptc-hashline-candidate-20261023-1602/repo`（102 个 git 管理文件，跳过 gitlink `dsh-ptc-roles`） |
| 候选 store | `.scratch/ptc-hashline-candidate-20261023-1602/store/v11`（独立于原 checkout 的 `.pnpm-store`） |
| 候选 node_modules | 候选根内 hoisted 安装树；`@hy-sde-org/*` 与 `@dsh-tool-hashline/*` 全部解析在候选根内 |
| Node / pnpm | v24.19.0 / 11.28.5 |
| DSH_CLI | `D:/Project/source/__TEST__/deepseek-harness/apps/cli/lib/bin.js`（`--version` = 0.2.1-rc.2） |
| 沙箱说明 | `pnpm`/`vitest` 在 workspace-write 下 `spawn EPERM`（esbuild 管道 stdio，RUN-REPORT §6 已记录）；按一次性审批逐次提权，未改任何持久配置 |

### 2.1 输入搬运与 hash 核对（A1）

三个未提交测试与被忽略的计划/报告逐个复制进候选，SHA-256 逐个比对一致：

| 文件 | SHA-256 |
|---|---|
| `packages/tool-read/tests/integration/mv-observation.spec.ts` | `bb341171556ce907a13c196a22c80744b0024ebe4edeba6b8fb732258ed08ad6` |
| `tests/compat/mv-snapshot-order.spec.ts` | `2d727b4c690d299ad7ccd6bd051f8052b93bc0642b840b805f6c102511420f68` |
| `tests/ptc/mv-policy.spec.ts` | `6ab84beb86e740c3149cc0617d468dbcad2bfe2596878e70b126600f54654963` |
| 修复计划 r2 | `bec4c47eea94969419b0446eaec1f868a46a5ddc0ebb38137c6ce0b53d85950f` |
| 补测计划 | `67ccab91966d76cac950dfccf57ceaf5cb5654d7c00932f21e01bda6ab560fa7` |
| RUN-REPORT.md | `752f4c8769a9d26980a67994d69b74299bca50592909a557fe1a2642fd2c0ebd` |
| 旧 hashline 补丁 | `f49120b37bf4eefbbc56226bcd99d1226aaa3af863a7f161888990d8abe940dc` |
| 旧 tool-edit 补丁 | `747d2d563a24c341bdb9cdb7924bb91f670685eff2bb30d4662ae77240dfbbbd` |
| 旧 lockfile | `824b1b0cb2170f10fff6556cae4f4af820dc3a88f05aee7c40d961e809c786cd` |

原 checkout 未被写入：候选期间原 checkout 的 `patches/`、`node_modules/` 时间戳与 hash 均未变化。

### 2.2 A2：固定 provider 的 BOM 解码契约（实测）

`04-a2-provider-probe.txt`（候选内 `a2-provider-probe.mjs`，经真实 `Context` 挂载 `LocalFileSystem`）：

| 输入 | 文件字节 | `readText` 结果 | 三字节前缀 |
|---|---|---|---|
| `EF BB BF` + `alpha\r\nbeta\r\n` | 16 | `"alpha\r\nbeta\r\n"`（**已吃掉 1 个 BOM**） | `efbbbf` |
| 无 BOM 的 `alpha\r\nbeta\r\n` | 13 | 原样 13 字符 | `616c70` |
| `EF BB BF EF BB BF` + `alpha\n` | 12 | `"\uFEFFalpha\n"`（只吃 1 个） | `efbbbf` |
| 空文件 / 1 字节 / 2 字节 | 0 / 1 / 2 | `""` / `"A"` / `"AB"` | `""` / `41` / `4142` |
| 仅 `EF BB BF` | 3 | `""` | `efbbbf` |

同时确认 `readBytes` 与 `readByteRange` 在该 provider 上都存在，`stat().version` 是必填的字符串 token。
→ 阶段 A 的退出条件成立：Local provider 消耗恰好一个前导 BOM、range 读取可用、三条原红测可复现。

## 3. 红 → 绿

### 3.1 未修复基线（候选首次构建后，仅应用旧补丁）

| 命令 | 结果 | 证据 |
|---|---|---|
| `pnpm test:integration .../mv-observation.spec.ts` | **1 failed / 22 passed**：全是 BYTES-R1a、BYTES-R1b | `01-red-integration-mv-observation.txt` |
| `pnpm test:compat tests/compat/mv-snapshot-order.spec.ts` | **1 failed / 5 passed**：SNAP-R2 语义例 | `02-red-compat-mv-snapshot-order.txt` |
| `pnpm test:ptc tests/ptc/mv-policy.spec.ts` | 6 passed（当时的 PTC 正例全绿） | `03-red-ptc-mv-policy.txt` |

红测期望值本轮**未放宽**：BYTES-R1a/b 仍是"目标与期望 Buffer 逐字节相等"，SNAP-R2 语义例仍是
"message 不得声称源快照未迁移"。

### 3.2 修复后

| 用例 | 修复前 | 修复后 | 证据 |
|---|---|---|---|
| BYTES-R1a（纯 MV 保持 BOM+CRLF） | FAIL（BOM 丢失） | PASS | `10-bom-stage-b-integration.txt` |
| BYTES-R1b（PUT+MV 只改第二行） | FAIL（BOM 丢失） | PASS | 同上 |
| SNAP-R2 语义例 | FAIL（谎称源快照未迁移） | PASS | `11-snapshot-wording-compat.txt` |
| BOM-01..14（新增 14 例） | — | 全部 PASS | `12-bom-matrix.txt` |
| SNAP-R3（工具层） | 未存在（PART-R1 只注入删除失败） | PASS | `12-bom-matrix.txt` |
| SNAP-R3（PTC 层） | 未存在 | PASS | `13-ptc-snapr3.txt` |
| D3 工具文案契约（2 例） | 未存在 | PASS | `14-d3-contract.txt` |

BOM 矩阵逐项：

| ID | 用例 | 断言 | 结果 |
|---|---|---|---|
| BOM-01 | BOM+CRLF 纯 MV | 目标 Buffer 与源逐字节相等；源消失 | PASS |
| BOM-02 | BOM+CRLF PUT+MV | 见 BYTES-R1b（同一断言，红测转为绿） | PASS |
| BOM-03 | BOM+CRLF 纯 PUT | 原地编辑保持 BOM；CRLF 仍 3 个 | PASS |
| BOM-04 | 无 BOM（PUT / MV 参数化） | 不新增 BOM；字节只按操作变化 | PASS |
| BOM-05 | BOM+LF+中文 | UTF-8 正文、LF、tag 正确；无 BOM 时不加 | PASS |
| BOM-06 | 1/2 字节、空文件、BOM-only | 不越界、不捏造 BOM；空文件不 mint；专用读取返回真实文本 | PASS |
| BOM-07 | 前缀读取失败 | `FS_PERMISSION_DENIED` 原样传播；两端磁盘不变；源快照与目标快照未变 | PASS |
| BOM-07b | 前缀读取期间取消 | `FS_ABORTED`；文件字节不变 | PASS |
| BOM-08 | 文本与前缀读取之间改版本 | `FS_STALE_VERSION`，写入前拒绝；并发写入的内容留在磁盘 | PASS |
| BOM-09 | provider 解码契约对照 | 吞 1 个 BOM、前缀可读、`version` 存在 | PASS |
| BOM-10 | read→edit→read | 前后 tag 与归一化全文一致；行号不因 BOM 偏移 | PASS |
| BOM-11 | 连续两个 BOM | 明确拒绝、无写入/删除/迁移、不进入 recovery | PASS |
| BOM-12 | 单 BOM 与普通文件独立 REM | 均成功；源消失、快照失效 | PASS |
| BOM-13 | REM 的前缀读取失败 | 明确错误；文件仍在；快照未被 commit 失效 | PASS |
| BOM-14 | noop / recovery / preflight | noop 不重写字节；恢复路径仍在 cwd 内并保留 BOM；越界 DEST 仍被拒 | PASS |

## 4. 实际改动

| 文件 | 变更 |
|---|---|
| `patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch` | 新增 `FileReader.readTextPreservingBom`（`session.js` + `session.d.ts`）；`EditFilesystem.readText` 改走该入口；`HASHLINE_GUIDANCE` 增补 MV DEST 基准/不覆盖/嵌套示例；`tool:edit` 系统提示删除 `applies atomically`、改为校验后提交 + MV 两步 + 多节可能部分完成 |
| `patches/@hy-sde-org__dsh-hashline@0.2.1-alpha.4.patch` | `SnapshotCommitError` 文案改为只陈述两端都成立的事实（磁盘已移动 / 记账未完成 / 状态可能部分更新 / 重读目标），保留 `cause`/`name` 与提交次序 |
| `pnpm-lock.yaml` | 由 pnpm 更新两条 `patch_hash`：hashline `fc7153f6…`、tool-edit `b7a1f65e…` |
| `packages/tool-read/tests/integration/mv-observation.spec.ts` | 新增 BOM-01..14、SNAP-R3、D3 文案契约；删除接缝改完整路径匹配并在 `finally` 恢复 |
| `tests/compat/mv-snapshot-order.spec.ts` | SNAP-R1 保留原始 Promise（不再吞错）、屏障在 `finally` 释放并断言最终 resolve；SNAP-R2 两条文案断言改为正向语义 |
| `tests/ptc/mv-policy.spec.ts` | 新增 PTC SNAP-R3；删除接缝改完整路径匹配、`finally` 恢复 |
| `scripts/test-profile.mjs` | `run()` 转发 `options.timeout`（`SIGKILL`）；新增补丁标记（快照文案、保 BOM 读取、adapter 接入、DEST 说明、非原子文案）；驱动新增 BOM+CRLF 的 PUT→MV→REM 字节复查与无 BOM 对照 |
| `README.md`、`AGENTS.md`、`tests/compat/README.md`、`packages/tool-read/tests/README.md` | 补丁范围、BOM 支持范围与成本、升级检查项、用例计数 |
| `docs/adr/0005-bom-preserving-hashline-read.md` | 新 ADR（本轮新架构决策），未改写 ADR-0003/0004 |
| 本文件 | 新验收记录 |

没有改动：tag 算法、全局解码、seen 有限守卫、工具名、MV cwd-relative 路径契约、`createIfAbsent`
覆盖保护、磁盘先于快照的提交次序。

## 5. 门禁（候选，最终状态）

`20-gate-*.txt`，逐条完整 stdout/stderr：

| 命令 | 退出码 | 计数 |
|---|---|---|
| `pnpm build` | 0 | 3 包 tsc |
| `pnpm check` | 0 | build + 3 包 check + `tsc -p tsconfig.tests.json` |
| `pnpm test:unit` | 0 | 44 passed / 8 files |
| `pnpm test:integration` | 0 | 99 passed / **9 skipped** / 9 files |
| `pnpm test:ptc` | 0 | 16 passed / 3 files |
| `pnpm test:compat` | 0 | 21 passed / 2 files |
| `pnpm check:preset` | 0 | 不变量、上限一致、门 enforce、资源摘要 |
| `pnpm test:profile` | 0 | 干净 profile 安装 → `dsh --dump-config` → 7 个补丁标记 → 单实例 → read/PUT/MV/REM + BOM PUT/MV + 无 BOM 对照 → 门正负 |
| `pnpm check:tests` | 0 | `tsc -p tsconfig.tests.json` |

**关于 9 个 skipped**：全部是 `tests/integration/persona-preservation.spec.ts`，跳过条件是该套件
自己声明的外部输入——de-brand 插件目录（`HIDE_HARNESS_IDENTITY_PATH`，默认解析到相邻 checkout 的相对
位置，候选目录下该相对路径不存在）。显式指到该目录后同一套件 **9/9 通过**，`test:integration` 变成
108 passed / 0 skipped（`21-integration-with-persona-plugin.txt`）。它不是本轮改动引入的跳过，
也没有被当成通过。

### 5.1 冻结后的复跑（最终交付物）

补丁与 lockfile 冻结之后（`fc7153f6…` / `b7a1f65e…` / lockfile `bc099526…`，与 lockfile 里
`patchedDependencies` 的两条 hash 逐字一致），删除 `node_modules/@hy-sde-org` 与
`node_modules/.pnpm_patches` 后执行 `pnpm install --frozen-lockfile`，重新解析出的产物与原候选逐字节
相同（`session.js` `5f2b058a…`、`patcher.js` `2404467b…`），然后完整重跑：

| 命令 | 退出码 | 计数 | 日志 |
|---|---|---|---|
| `pnpm build` | 0 | 3 包 | `30-final-build.txt` |
| `pnpm check` | 0 | build + 3 包 + tests tsc | `30-final-check.txt` |
| `pnpm test:unit` | 0 | 44 passed / 8 files | `30-final-unit.txt` |
| `pnpm test:integration` | 0 | **108 passed / 0 skipped / 9 files** | `30-final-integration.txt` |
| `pnpm test:ptc` | 0 | 16 passed / 3 files | `30-final-ptc.txt` |
| `pnpm test:compat` | 0 | 21 passed / 2 files | `30-final-compat.txt` |
| `pnpm check:preset` | 0 | OK | `30-final-check-preset.txt` |
| `pnpm test:profile` | 0 | 全流程 + BOM 字节复查 | `30-final-test-profile.txt` |
| `pnpm check:tests` | 0 | tsc | `30-final-check-tests.txt` |

这一轮把 `HIDE_HARNESS_IDENTITY_PATH` 指向本机 de-brand 插件目录，因此 integration 不再有 skipped。
两次运行（带/不带该变量）都保留，不用一次覆盖另一次。

## 6. 隔离 profile 验收（`test:profile`，`16-test-profile.txt` / `20-gate-test-profile.txt`）

| 断言 | 结果 |
|---|---|
| 干净临时 profile 安装、只发现一个 `ptc-hashline` preset | PASS |
| 两份补丁在**实际解析产物**里（7 个标记） | PASS |
| read/edit 引擎 realpath 单实例 | PASS |
| lockfile 登记两条 `patch_hash` | PASS |
| `dsh --dump-config`（显式 `DSH_CLI`） | PASS |
| read→PUT→read→MV→read→REM | PASS |
| **BOM+CRLF 的 PUT→MV 字节复查**（``\uFEFFalpha\r\nBETA\r\ngamma\r\n``） | PASS |
| **无 BOM 对照**（普通文件不新增标记） | PASS |
| 意图门正负 | PASS |
| 超时转发探针（1.2 s 预算 → `SIGKILL`，耗时 1213 ms） | PASS（`17-timeout-probe.txt`） |

profile 内的 plugin link 指向候选 checkout，依赖解析到候选安装树（`ok resolved ... -> <候选根>/…`）。
该脚本自建的干净 profile 不等于日常 profile 隔离；本轮的依赖隔离依据是 realpath 全部落在候选根内。

## 7. 代码审查（code-review-and-quality）

审查对象：候选相对输入的完整改动（两份补丁、lockfile、测试、脚本、文档）。

| 轴 | 结论 |
|---|---|
| 正确性 | 专用读取入口的错误分类与 plan §4.2 一致：缺失/非普通文件/版本不一致/连续 BOM 各有明确出口，provider 错误原样传播；observing 只在全部检查通过后发出 |
| 成本与契约 | `read` 工具契约未变（仍 1 stat + 1 readText）；新增成本只落在编辑侧，且已在 README/ADR 明示；未把三次读取描述成原子快照 |
| 补丁范围 | 两份补丁累积保留了原有目录/MV/次序 hunk；无 `node_modules` 手改交付；`patch_hash` 与 `patchedDependencies` 一致 |
| 宿主服务使用 | 只用 `ctx.fs`（stat/readText/readByteRange）与既有 `ctx.emit`/`ctx.waterfall`，未直接 `node:fs`、未绕过 `fs.resolve` |
| 测试隔离 | 两处进程级接缝改为完整路径匹配，且都在 `finally` + `onTestFinished` 双保险恢复；SNAP-R3 用实例级 `record` 包装，不动 prototype，不依赖计时 |
| 文案与事实 | 快照错误不再断言任何未经证明的一端状态；工具说明不再承诺整次调用原子 |
| 遗留风险 | 见 §10 |

审查中修正的问题：D3 断言最初写了一个无意义的自反表达式（`expect(...).not.toMatch(/\batomic\b/…)`），
已替换为明确的 `not.toMatch(/atomically/)` + 正向语义断言；BOM-14 最初按"Recovered from a stale file hash"
断言，实测该路径走的是"按文件名 + tag 重绑"，已改为断言那条真实文案与 cwd 内定位。

### 7.1 变异测试（证明测试真的能抓住回归）

按 `code-review-and-quality` Step 2 的要求，用实验而不是阅读来回答"改了代码这些测试会不会红"。
每次只改一处、跑定向套件、再从备份文件恢复并核对 SHA-256 一致：

| # | 变异 | 期望被抓住的用例 | 实际 |
|---|---|---|---|
| 1 | 删除 BOM 恢复（`const text = content`） | BYTES-R1a/b、BOM-01/03/05/06/14 | **7 failed** | 
| 2 | 删除连续 BOM 拒绝（条件恒假） | BOM-11 | **1 failed** |
| 3 | 删除版本一致性检查（条件恒假） | BOM-08 | **1 failed** |
| 4 | 把不实的快照句恢复（"source snapshot was not migrated …"） | compat 三条 + 工具层 SNAP-R3 | **compat 3 failed / integration 1 failed** |
| 5 | 抛原始 record 错误（不包 SnapshotCommitError） | compat 三条 + integration SNAP-R3 + PTC SNAP-R3 | **3 + 1 + 1 failed** |
| 6a | 把 `applies atomically` 写回提示段 | D3 原子性用例 | **1 failed** |
| 6b | 删掉嵌套 DEST 示例 | D3 DEST 用例 | **1 failed** |

日志在 `mutation/`。变异 1 未击中 BOM-04（无 BOM 对照本就期望没有 BOM）与 BOM-07/07b/08/11/12/13
（它们验证错误传播与拒绝语义而非恢复结果），这与各自的设计意图一致，不是漏测。

恢复后 `session.js` 与 `patcher.js` 的 SHA-256 与变异前逐字节相同；随后的干净重装又得到同一 hash。

### 7.2 独立两轴审查后的修补

按 `/code-review` 对 `git diff HEAD` 做了 Standards / Spec 两轴审查。**两轴子代理运行约 50 分钟未回报，请求收尾后仍无输出，已中断；两轴报告由主会话本人完成**，因此独立性打了折扣（已在交付说明里披露）。审查发现 0 项硬违规、2 项部分完成、1 项轻微越界、2 项存疑，其中三项已按建议修掉：

| 发现 | 修法 | 验证 |
|---|---|---|
| **S-2** D3 只断言注册的 description 与提示段，没有断言它进入 PTC SDK——事实成立但没有回归保护 | `tests/ptc/ptc.spec.ts` 新增 "carries the edit tool description into the generated SDK (D3)"：断言 `tools:sdk` 含 DEST 基准、嵌套示例、不覆盖，且不含 `atomically`；同时断言 `tool:edit` 段仍持有非原子文案，防止将来在两种载体之间搬移时静默丢失 | PTC 16 → **17 通过**。变异（把 `PATHS: both the section PATH` 从 description 删掉）→ **该用例单独红**（`52-mutation-sdk-desc.txt`） |
| **S-1** BOM-02 在矩阵里没有归属的用例名 | `BYTES-R1b` 改名带上 `(BOM-02)` 并保留原名主干（20261023-1453 的证据引用仍可对应）；在 BYTES-R1 的说明里写清 ID 映射：R1a 与 BOM-01 是同一场景的不同深度，R1b 承载 BOM-02，BOM-03..14 在下面的专套件 | 纯命名/注释，integration 仍 41 通过 |
| **Standards-4** `seamByteRange` 覆盖 `ctx.fs.readByteRange` 后没有 `restore()`，与旁边的 `refuseSourceDelete` 风格不一致，读者只能自己推断为何安全 | 补文档注释说明：被改的是本用例自建 harness 的 `ctx.fs`，`onTestFinished(dispose)` 会连 provider 一起销毁，且每个调用者都先新建 harness，补丁不会外溢 | 无行为变化 |
| **S-5** BOM-14 的 "preflight" 实际测的是 writer 的 cwd containment | 把注释改成明确说明：上游 `preflightWrite` 在该 port 是文档化的 no-op，真正在写入前跑的守卫是 containment | 无行为变化 |

未修的两项，理由写在这里而不是留白：

- **S-6**（快照文案的"不声称任一端"只能靠否定式断言）——继续加正向断言会把某一种正确表述固化成唯一表述，与 C2"不要固化整段英文"冲突；当前是正向四事实 + 否定三条错误说法的组合，已接受其余句子不受约束。
- **S-3**（`killSignal: 'SIGKILL'` 属自选实现细节）——`timeout` `转发是 §8 的明确要求，`SIGKILL` 只是确保 Windows 上不会留下挂起子进程；保留，理由记录在此。

修补后完整门禁重跑（`60-gate-*.txt`）：build / check / unit 44 / integration 108 / **ptc 17** /
compat 21 / check:preset / test:profile / check:tests 全部退出码 0，且两份补丁与 lockfile 的 SHA-256
与修补前逐字节相同（`fc7153f6…` / `b7a1f65e…` / `bc099526…`）——本轮只动测试与注释，未碰交付补丁。

## 8. 交回原 checkout

已交回：两份补丁、`pnpm-lock.yaml`、三个测试文件、`scripts/test-profile.mjs`、README/AGENTS/
compat README/tool-read tests README、ADR-0005、本验收记录、本轮 `.scratch` 证据。

**未做**：原 checkout 的 `pnpm install`。这是**可验证的事实，不是推测**：

| 检查 | 原 checkout 实际值 |
|---|---|
| `node_modules/@hy-sde-org/dsh-tool-edit` mtime | 2026-10-23 13:48:55（本轮未触碰） |
| 解析产物里有 `readTextPreservingBom` | **False** |
| 解析产物里有 `bookkeeping did not complete` | **False** |
| `pnpm check:tests`（只做类型检查，不依赖运行时） | 0 |
| `pnpm test:integration .../mv-observation.spec.ts` | **15 failed / 26 passed** |

最后一行正是"新测试已交回、旧依赖仍未整合"的状态：失败集合是 BYTES-R1a/b、BOM-01/03/05/06/07/07b/08/11/13/14、
D3 两条、SNAP-R3 工具层——全部依赖新补丁的行为，与"依赖未更新"一致
（`40-original-checkout-integration.txt`；该文件只存在于原 checkout 的证据目录，因为它是原 checkout 的观测）。

因此**原 checkout 整合层未完成**。整合窗口需要：`pnpm install --frozen-lockfile`（用已交回的 lockfile）
→ `pnpm build` → 同一套门禁。按约束不在运行中热改共享依赖、不自动重启宿主。

## 9. 重启后宿主验收（未完成，GAP）

需要用户操作：

1. 真正重启测试宿主（不是新开一个会话）。
2. 新会话选择 `ptc-hashline`。
3. 在新唯一目录里跑：相对 PUT、独立 REM、显式嵌套 DEST 的 MV→read→REM、真实嵌套目标冲突唯一一次 MV、
   以及用夹具创建的 BOM 文件经 hashline PUT/MV 后按字节核验。

本轮未执行，因为自动重启共享宿主要求用户授权，且会打断当前会话。

## 10. 保留 GAP

1. **原 checkout 依赖整合**：见 §8，需整合窗口。
2. **重启后宿主验收**：见 §9。
3. **真实 sandbox 后端拒绝**：仓库未安装 `@deepseek-ai/dsh-fs-sandbox`，MV-06 的 sandbox 分支仍只有
   注入证据（沿用 `docs/acceptance/2026-10-23-mv-observation-acceptance.md` §8.2）。
4. **BOM 支持范围的边界**：只覆盖已核实的 Local provider 与零/单 BOM；连续 BOM 明确拒绝；
   `replace`/`patch`/`apply_patch` 的 BOM 行为未做系统确认（本轮只保证不退化）。
5. **MV 源删除无版本条件**、多节无事务：仍为已接受边界，本轮未改变。
6. **`persona-preservation` 默认 skipped**：需要 `HIDE_HARNESS_IDENTITY_PATH` 指向 de-brand 插件；
   门禁输出保留 skipped 计数，未当作通过。

## 11. 回退

按变更粒度回退：BOM helper 与适配调用、快照文案、说明/测试加固。回退后必须同时把两条
`patch_hash` 与 `patchedDependencies` 恢复为一致状态并经 `pnpm install` 重建解析树。
不要顺带回退 ADR-0003/0004 的目录、MV 创建意图与提交次序修复。已被旧构建去掉的 BOM 不会因代码回退
自动恢复；不要批量重写用户文件补偿。
