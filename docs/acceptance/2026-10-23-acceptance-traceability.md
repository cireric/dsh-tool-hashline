# ptc-hashline 验收追溯（2026-10-23）

本文件把规格 v3 的每条需求映射到可执行用例与最近一次结果。判定只认脚本输出；
人工冒烟不作为通过依据。

> 本页的“最近结果”属于原验收轮次。当前结论、后续门禁与证据范围统一见[当前验收与证据索引](2026-10-23-current-status-and-evidence-index.md)；本地 `.scratch` 不随 clone 交付，不能把本页旧 GAP 当作当前状态。

> **2026-10-23 运行修复（D1/D2）之后**：下面的命令计数是**修复前基线**，保留原样。
> 修复后的门禁结果、真实 Session 目录矩阵与 persona 装配矩阵见
> [2026-10-23-runtime-fix-acceptance.md](./2026-10-23-runtime-fix-acceptance.md)。两份记录不合并：旧结果不改写成新通过。
>
> **2026-10-23 MV 观测修复之后**：MV/REM 在真实 `fs-observation-policy` 下的矩阵、两份依赖补丁的
> 生效证据与最新门禁计数见
> [2026-10-23-mv-observation-acceptance.md](./2026-10-23-mv-observation-acceptance.md)
> （integration 84 / ptc 13 / compat 18）。上面的计数仍按原样保留。

## 命令与最近结果

| 命令 | 最近结果 |
|---|---|
| `pnpm build` | exit 0（3 个包产出 dist JS + d.ts） |
| `pnpm check` | exit 0 |
| `pnpm test:unit` | 45 passed |
| `pnpm test:integration` | 45 passed |
| `pnpm test:ptc` | 9 passed |
| `pnpm test:compat` | 16 passed |
| `pnpm check:preset` | exit 0（仅允许差异；把 tool-read.limit 改 1000 的阴性对照 exit 1） |
| `pnpm test:profile` | exit 0（干净 profile 安装、dsh 组合、read→edit 落盘、门正负） |

## 功能需求

| 需求 | 用例（文件::用例） | 判定 |
|---|---|---|
| FR-1 意图门继承 | `tests/ptc/gate.spec.ts`「denies the first…」「allows the behavior action…」「leaves a read-only program…」；`scripts/test-profile.mjs` 门支 | 通过：缺行拒一次、合法桶放行、只读回合不动 |
| FR-2 PTC 呈现 | `tests/ptc/ptc.spec.ts`「denies a model-direct read as UNKNOWN_TOOL…」 | 通过 |
| FR-3 tag 在 value 中 / nextAction / oneOf | `tests/ptc/ptc.spec.ts`（tag/nextAction/SDK）、`tests/unit/next-action.spec.ts`、`tests/integration/read-edit.spec.ts`「declares nullable…oneOf」 | 通过；tag=引擎独立计算值 |
| FR-4 渲染 header | `tests/integration/read-edit.spec.ts`「mints the engine tag…」、`tests/integration/presentation.spec.ts` | 通过：header 在 `<content>` 首行，tagged=false 无假 header |
| FR-5 窗口语义 | `tests/unit/window.spec.ts`（14 例）、`tests/integration/window-read.spec.ts` | 通过：分页/列截断/字节封顶/零行/越界 FS_NOT_FOUND |
| FR-6 fs/observed | `tests/integration/observed.spec.ts`（正/负对照） | 通过：stock write 成功 vs 未观察 FS_NOT_OBSERVED |
| FR-7 快照与 seen（目录来源与 store key 同源） | `tests/unit/seen-set.spec.ts`、`tests/integration/window-read.spec.ts`「path resolution vs store key」「seen guard…」、`tests/integration/working-directory.spec.ts`（真实 Session 的相对/绝对/替换/补丁/REM/MV/切目录/多会话/守卫哨兵）、`tests/compat/guard.spec.ts`（并集/双键/连续编辑/跨 session/淘汰/recovery/REM/无 resolver 的 block 拒绝） | 通过：有限守卫边界逐条断言；cwd 契约见 ADR-0003 |
| FR-8 引擎单实例 | `tests/unit/engine-identity.spec.ts`；`scripts/test-profile.mjs` 的 profile realpath 断言 | 通过 |
| FR-9 边界（BOM/CRLF/阈值/空/错误/漂移） | `tests/integration/untagged.spec.ts`（14 例）、`tests/compat/guard.spec.ts` drift 三档 | 通过：N-1/N/N+1、多字节、size 未知、mismatch/head-tail |
| FR-10 配置 | `tests/unit/config.spec.ts`、`tests/integration/window-read.spec.ts` 生效/非法、`check:preset` 同值断言 | 通过 |
| FR-11 read 互斥 | `tests/integration/window-read.spec.ts`「registers nothing…」「leaves stock read…」「fails the mount…」 | 通过（root scope 文案与 per-agent 文案差异已在票 02 记录） |
| FR-12 投影对齐 | `tests/integration/presentation.spec.ts`（提示段/meta/lang/回放/降级） | 通过 |
| FR-13 拒后指引 | `tests/compat/guard.spec.ts` mismatch 文案、`tests/ptc/gate.spec.ts` 程序内 mismatch | 通过：当前 tag + 英文重读指引 |
| FR-14 工具名与错误码 | `tests/ptc/gate.spec.ts` 改名负向、`tests/integration/untagged.spec.ts` 错误码、`tests/integration/observed.spec.ts` | 通过 |

## 非功能需求

| 需求 | 用例 | 判定 |
|---|---|---|
| NFR-1 确定性 | `tests/integration/read-edit.spec.ts`「keeps the tag stable across processes」+ 引擎 unit | 通过 |
| NFR-2 代价 | 同文件「one stat and one readText」；`untagged.spec.ts`「large file with one stat…」 | 通过（全文读取成本已在 README 声明） |
| NFR-3 失败可见 | 无空 catch；`untagged.spec.ts` 错误码/取消；脚本失败非零退出 | 通过 |
| NFR-4 依赖面 | `packages/tool-read/tests/unit/dependencies.spec.ts`（AST 扫描 src 与 dist，附阴性对照） | 通过（按 C-08 修订，见下） |
| NFR-5 测试 | 上述五档命令 | 通过 |
| NFR-6 可回归 | 全部判定为脚本；`pnpm test:profile` 可重复 | 通过 |

## §4 安装契约

| 契约 | 证据 |
|---|---|
| 根 bundle 声明 + 唯一 preset | `pnpm check:preset`；`pnpm test:profile` 的 `dsh --dump-config` 输出只有 `ptc-hashline` |
| 独立 persona/watchdog（摘要 + 来源） | `check:preset` 的 sha256 断言 |
| 干净 profile 可解析 bundle/资源/read/edit | `test:profile` 的 resolve 与 realpath 断言 |
| stock read/edit 关闭、三上限同值 | `check:preset` |
| 构建产物可被宿主加载 | `pnpm build` + profile 内子进程加载 dist 并 read→edit |

## NFR-4（2026-10-23 修订，C-08）

用户批准按“契约面”解释，规格 §6 NFR-4 与 §7.3 已同步修订：

> 自建 tool-read 的运行时依赖仅限 Node 内置模块、精确锁定的 hashline（可经 workspace 锚点
> re-export），以及宿主**契约面** `@deepseek-ai/dsh-tools`（`defineTool`）与
> `@deepseek-ai/dsh-fs`（`FsError`）；其余 `@deepseek-ai/*` 一律 type-only。禁止导入宿主实现包
> （`dsh-tool-fs`、`dsh-fs-local` 等）或读取宿主 read 配置。

理由：注册工具必须用官方 `defineTool`；结构化错误码要求 `HarnessError` 子类（`FsError`），
否则 FR-9/FR-14 的 `FS_*` 码必然退化。两处都已是 peerDependency，且未触及任何宿主实现或配置。

守卫：`packages/tool-read/tests/unit/dependencies.spec.ts` 用 TypeScript AST 提取**值导入**（忽略
type-only）并断言白名单；同时对 `dist/*.js` 复检。阴性对照：向 `src/session.ts` 临时加入
`import { x } from '@deepseek-ai/dsh-tool-fs'` → 2 个用例失败，移除后 3 个用例全绿。

## 明确未执行项（不计为通过）

1. **block 编辑（`PUT N*`）**：应用链路未接 tree-sitter `blockResolver`。现已固定“无 resolver 时明确拒绝、磁盘不变”
   的基线行为（`tests/compat/guard.spec.ts`）；**具备 resolver 时的 block 语义仍未覆盖**（上游可选能力）。
2. **完整宿主进程 + 真实模型**：已确认 headless 组合不含 preset 名单（`bundle/headless/src/index.ts:213-219,336`），
   preset 挂载只在 Web/API 层（`session-controller/src/agent.ts` 的 `composeAgent`），因此该项需要 Web profile + mock/真实模型。
   现状、证据与两条落地路径见 [host-run-deferred](./2026-10-23-host-run-deferred.md)；仍未执行，不计通过。
3. **PTC 进程隔离/沙箱**：`test:ptc` 使用进程内 `PtcRuntime` 载体，覆盖 schema→SDK、value 传递、
   内层 dispatch 与 `tools/pre-execute`；Node 子进程隔离、超时与沙箱属于 `dsh-ptc-runtime-node`，
   未覆盖。
4. **符号链接**：本机执行了 symlink 用例（通过）；在无符号链接权限的平台上该用例会打印
   `SKIP symlink case` 并按缺项处理。
5. 迁移 watchdog 的内部 warn/catch 行为按基线保留（NFR-3 例外），未逐条断言每个内部异常。

## 复核命令

```powershell
pnpm build; pnpm check
pnpm test:unit; pnpm test:integration; pnpm test:ptc; pnpm test:compat
pnpm check:preset; pnpm test:profile
```

以上均为 0 退出即通过；任一失败会打印原因并以非零退出。

## 代码评审处置（2026-10-23，两轴并行评审后）

已修复：

1. **相对路径解析**：`read` 现在用 `ctx.workingDirectory.ensure(agent)` 解析目标（与 stock 一致），
   snapshot key 仍用 tool-edit 的 `session.cwd ?? process.cwd()`；新增
   `window-read.spec.ts`「path resolution vs store key」用**真实形状的 session**（只有 header.cwd）
   同时验证两者。
   > **2026-10-23 运行修复后已取代**：`session.cwd` 算法在真实 Session 中恒失效，edit 因此落到进程目录。
   > 现在 read 与 edit 共用 `workingDirectory` 的有效目录（edit 由本地依赖补丁对齐），见
   > [ADR-0003](../adr/0003-effective-working-directory.md) 与
   > [运行修复验收](./2026-10-23-runtime-fix-acceptance.md)。本段保留为当时记录。
2. **空 catch**：`render` 改为全函数 `renderLimit()`，回放非法 limit 时回退到配置上限，不吞异常。
3. **check:preset 豁免过宽**：persona 只允许 `prefix` 差异、watchdog 只允许 `name` 差异，其余逐字比较；
   并断言 `tool-read`/`tool-edit` 紧接 `tool-fs` 之后插入。
4. **资源摘要跨平台**：摘要改为对 LF 归一化文本计算（源码是 CRLF；checkout 行尾不应改变判定），
   `check:preset` 的摘要常量已注明。
5. **符号链接用例不再“绿色跳过”**：能力探测失败时用 `it.skipIf` 显示为 skipped；本机能力可用，实际执行。
6. **`test:profile` 的 DSH CLI 不再硬编码**：`$DSH_CLI` → 兄弟 checkout → 报告 GAP；README 已写明。
7. **精确版本**：`tool-read` 的 peer/dev 依赖改为精确版本（`0.2.1-rc.2` / cordis `4.0.5-alpha.2`）。
8. **`[0]` 的编辑级拒绝**：新增「rejects an edit to a line that was only returned truncated」用例。

仍开放：`PUT N*` block（无 resolver）、真实模型下的宿主 PTC 一轮与 PTC 子进程隔离。另：一次全量运行中 `test:integration` 出现 1 次瞬时失败（跨进程 tag 用例），
随后 3 次连续复跑全绿；未观察到可复现的抖动。

最近一次全量：`check` 0、unit 45、integration 45、ptc 9、compat 16、check:preset 0、test:profile 0。
