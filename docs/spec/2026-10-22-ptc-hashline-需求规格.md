# ptc-hashline 需求规格

- 日期：2026-10-22（v3，需求闭环审查后修订）
- 状态：**v3 已落实两轮用户决议，可据此拆实施计划；实现与交付验收尚未完成**
- 基线：DSH `0.2.1-rc.2`；`@hy-sde-org/dsh-hashline@0.2.1-alpha.4`、`@hy-sde-org/dsh-tool-edit@0.2.1-alpha.4`
- 迁入基线：`cireric/dsh-ptc-roles` 的 `ptc-gate` preset（克隆于 `.scratch/dsh-ptc-roles`，commit `3d8f36eb8`）；仅迁入 gate 所需 patch、persona、watchdog 与验收依据，不整合五角色系统
- 术语：见 [`GLOSSARY.md`](../../GLOSSARY.md)（tag / seen 行 / observed / show path / store key / 零行窗口 / 行为改变型回合）
- 上游依据：[选型分析](../background/2026-10-22-dsh-hashline-选型分析.md)、[HANDOFF](../../HANDOFF.md)
- v2 变更：19 项审核决议（§7.2）落地，并据实测修正 9 处与引擎行为不符的描述（§10 证据索引已补）
- v3 变更：有限守卫、完整行 seen、独立 gate 资源、单 preset、首版基线行为、全文读取成本及长行补救七项决议（§7.3）；补齐 canonical nextAction、部署与验收矩阵

---

## 1. 目标

提供一个 agent preset **`ptc-hashline`**，让一个会话同时具备：

1. **PTC 模式**——模型只直接调 `run_code`，其余工具以 SDK 函数形式在程序内调用；
2. **意图门**——每个「会改变行为」的用户回合，助手消息首行给出 `Intent: <bucket> — …` 的意图复述；
3. **hashline 编辑闭环**——可 mint 的文本 `read` 返回 tag；同 session、快照仍在、文件未漂移且锚点已完整返回时，合法且实际改变内容的 `edit` 首次即可落盘。seen 保护严格采用上游有限守卫，范围见 FR-7；不承诺全部未见内容不可修改。

第 1、2 项首版保持 `ptc-gate` 基线行为，资源由本仓库独立交付；第 3 项是新增能力。PTC 的 seen 是工具返回的完整行，不等于程序已把所有内容打印到模型上下文。

## 2. 非目标

- 不 fork / 不修改 DSH 本体；不 vendor 宿主内部实现。
- 不重新实现 hashline 引擎（解析、patcher、hash、snapshot store 一律用上游包）。
- 不实现图片 / PDF / 目录 / 附件形态的 `read`——这些留在 `tool-fs` 的 `read_image` 等工具。
- 不做 AST / LSP（沿用 `tool-edit` 自带的可选能力）。
- 首版不改迁入的 `ptc-gate` 意图门判据、persona 正文和 watchdog 正文；后续独立演进须另行修订基线与验收。
- 不提供独立 `ptc-gate` picker 项，只交付 `ptc-hashline`。
- 本期不做发布（`private: true`，包名仍为 `@dsh-tool-hashline/*` 占位）。

## 3. 使用场景

> 用户在新会话选择 `ptc-hashline`，说「把 src/main.ts 里第 10 行的 foo 改成 bar」。助手首行输出
> `Intent: fix — 用户要修正 main.ts 第 10 行的调用名（because: 点名了文件与行号）; I will 读取该文件再打补丁。`
> 然后一次 `run_code`：`const r = await tools.read({file_path:'src/main.ts'})` 拿到 `r.tag`，
> 紧接着 `await tools.edit({input:'[src/main.ts#' + r.tag + ']\nPUT 10.=10:\n+bar'})`，首次成功。

大文件（`tagged: false`）走显式降级：

> `read` 返回 `tagged:false` 与 `nextAction` 提示后，模型改用 `await tools.edit({old_string, new_string})`
> 或 `{edits}` 走替换 / 补丁模式——这条路径不消耗 tag，也不受 seen 守卫约束（见 FR-9、Q-01）。

## 4. 部署形态

- 本仓库变成一个 **bundle**：`package.json` 增加 `dsh.bundle.patch` → `./preset/ptc-hashline/preset.patch.yml`。
- 该 patch 文件声明一行 `@deepseek-ai/dsh-agent-preset`，`config.id = ptc-hashline`。
- `config.plugins` = `ptc-gate` 基线 plugins 列表 + 三处功能 delta（§4.1）+ 资源定位 delta（§4.2）。
- 安装 = 构建本仓库插件产物 + profile 依赖中 `link:` 本 bundle 及可解析的插件包 + 将 bundle 包名登记到 `dsh.profile.bundles` + `pnpm install` + 一次真正的重新挂载。
- **上游基线 commit `3d8f36eb8def861c3f2aa7d5f7b4983d96c92341`**（`cireric/dsh-ptc-roles`，2026-10-02）必须写进 patch 文件头，供漂移检查比对。

> ⚠️ 过时信息：`HANDOFF.md` §10 的「复制 preset 到 `~/.dsh/.agent-presets/`」在 0.2.0 起已失效
>（官方 `editing-cordis-compositions` skill："Nothing reads that directory any more."）。本规格以 bundle 为准，
> `presets/agent.cordis.yml` 一并废止。

### 4.1 preset delta（相对 `ptc-gate`）

`ptc-gate` 的 `tool-fs` 行**没有任何 config**（`preset.patch.yml:101-102`），所以 delta 是**改既有行的 config**，不是加行：

| # | 行 | 变更 |
|---|---|---|
| 1 | `tool-fs` | 加 `config: { read: false, edit: false, readLimit: 2000, readMaxLineLength: 2000, readMaxBytes: 51200 }`（`write`、`readImage` 保持开启） |
| 2 | `tool-fs` 之后 | 插入 `tool-read` 行（`@dsh-tool-hashline/tool-read`，config 见 FR-10，三个上限与上一行**同值**） |
| 3 | `tool-read` 之后 | 插入 `tool-edit` 行（`@dsh-tool-hashline/tool-edit`，`mode: auto`） |

其余配置行为（包括 `tool-presentation: mode: ptc`、`tool-subagent: maxDepth: 1`、gate enforce）不动；persona/watchdog 的资源地址按 §4.2 改写。

> 为什么必须是「复制」而不是「继承」：patch 层按行 id **整体覆盖** config，`config.plugins` 不是
> `cordis:group`，没有「向别人的数组插一行」的语法（官方 skill 原文：*The override replaces the complete
> `config`, so restate `id`, `plugins` and every other field*）。代价是漂移，见 §9 R-1。
>
> 注意：`tool-fs: read: false` 的语义是**该工具从不注册**（`tool-fs/src/index.ts:74-75`），不是注册后再摘除；
> 因此同名冲突只可能来自我们重复挂载 `tool-read`，见 FR-11。

### 4.2 独立资源与加载契约

- 将基线 `personas/orchestrator.md`、`intent-gate-watchdog.mjs` 迁入 `preset/ptc-hashline/` 对应位置，正文逐字保持；保留来源、SHA 与原有归属声明。
- persona 的 `createRequire(baseUrl).resolve(...)` 改为解析本 bundle 的 `package.json`；watchdog 模块地址改为本 bundle 的子路径。根包必须允许这些子路径与 package.json 被解析。
- 交付物、安装和测试不要求 `@cireric/dsh-ptc-roles`、原项目目录或 `.scratch/dsh-ptc-roles` 存在。原项目可以弃置。
- 三个 workspace 包提供可被目标宿主加载的构建后 JavaScript 入口及类型声明；安装步骤显式建立 profile 对 tool-read、tool-edit 的可解析依赖。不能以 Vitest 能加载 src/index.ts 代替宿主可加载证明。
- 基线核验材料保存在本仓库：基线 patch、两项资源的摘要和来源说明；比较脚本允许 preset id/展示元数据、§4.1 功能差异、此节资源地址差异，其他配置变化失败。persona/watchdog 正文摘要不符失败；三个 read 上限不一致失败。
- 漂移检查指本仓库相对锁定基线的变化，不要求联网追踪已弃置项目的最新版本。未来变更 gate 行为时更新基线说明与契约测试。

**验收**：干净临时 profile 安装并登记 bundle 后只发现一个本项目 preset `ptc-hashline`；不安装原项目仍可加载 persona/watchdog/read/edit；在真实宿主中执行 PTC read→edit 和缺意图门的负向场景。

## 5. 功能需求

### FR-1 意图门继承（不改判据）

preset 必须携带 `ptc-gate` 的 `persona`（`personas/orchestrator.md`，含 Phase 0 意图门）与
`intent-gate-watchdog` 插件，且 `config.gate` 保持 `enforce`。

**验收**：新会话首轮做一次会改变行为的动作时，承载该动作的消息首行是 `Intent: <bucket> — …`；
缺门行时 `tools/pre-execute` 拒绝**一次**并给出理由（watchdog 每轮最多拒绝一次，`intent-gate-watchdog.mjs:440-442`）。
PTC 下的内层派发同样被拦（`denyHeader` 会标注 inner dispatch，`:220-226`）。

### FR-2 PTC 呈现

preset 必须含 `tool-presentation` 且 `mode: ptc`。

**验收**：模型直接发 `read` 调用被判 `UNKNOWN_TOOL`；程序内 `await tools.read(...)` 正常返回。

### FR-3 tag 必须出现在 `value` 里（本项目的核心变更）

`read` 的 canonical `value` 必须包含 tag，因为 PTC 下程序拿到的是 `value` 而不是渲染文本
（`core/tools/src/ptc.ts:571-573`：`resolve({ isError:false, value: result.value })`；渲染内容只进 session log，
且 log 事件不会重新进入模型上下文，`core/tools/src/types.ts:55-59`）。

```ts
{
  path: string; tag: string | null; tagged: boolean;
  offset: number; lines: {number:number;text:string}[]; totalLines: number;
  nextAction: string | null;
}
```

成功返回必须满足：`tagged:true` 对应 4 位大写十六进制 tag；`tagged:false` 对应 `tag:null` 与非空 nextAction。完整且可 mint 的普通窗口 `nextAction:null`；截断行或零返回行的受限窗口，即使 tagged=true，也必须有补救指引。nextAction 与 tag 的 nullable schema 均使用 oneOf，并进入 PTC SDK，不能只写进 content。

指引按原因给出：空文件用 write 创建内容；无 session 说明无法共享快照并引导显式替换/补丁；超过快照上限引导替换/补丁；长行截断按 FR-5；字节上限导致零返回行时提示调高 maxBytes（必要时联动 maxLineLength）并重挂载，避免重复请求相同 offset。

**可空字段的写法约束**：`tag` 必须声明为 `oneOf: [{type:'string'},{type:'null'}]`，**不能**写成
`type: ['string','null']`——宿主拒绝 type 数组（`core/tools/src/json-schema.ts:303-306`），
且会让生成的 SDK 类型退化成 `unknown`（`ts-types.ts:240-246`）。先例：`tool-fs/src/write.ts:93-98`。

**验收**：`const r = await tools.read({file_path})` 后 `r.tag` 等于用引擎对同一文件独立算出的
`computeFileHash(normalizeToLF(stripBom(raw).text))`；生成的 PTC SDK 类型里 tag 和 nextAction 均显示为 `string | null`。通过真实 run_code 验证可读取两字段，覆盖完整、截断和全部不 mint 原因。

> 为什么两条替换路径都不可行（v2 补全证据）：
> 1. **替换 `content`** 可行，但 PTC 完全不看 content（`ptc.ts:571-573`），模型拿不到 tag；
> 2. **替换 `value`** 会被 `createSuccessResult` 用 `tool.output.schema` **重新校验**
>    （`core/tools/src/index.ts:1840-1843`），而 stock `read` 的 schema 是 `additionalProperties: false`
>    （`tool-fs/src/read.ts:86-88`），多一个 `tag` 直接抛 `ToolOutputError`。
> 结论：只能自建 `read`。

### FR-4 渲染文本带 header

`content` 必须保持 stock 信封形状，header 插在 `<content>\n` 之后：

```
<path>/abs/src/main.ts</path>
<type>file</type>
<content>
[src/main.ts#A1B2]
1: ...
```

**验收**：tagged=true 时 header 出现在纯文本 body 首行；tagged=false 时不生成 header。信封仍能被 stock 的 `presentResult` 正则解析；nextAction 非空时也在正文给出指引，规范字段仍以 value 为准。

### FR-5 窗口语义（与 stock 逐项对齐）

| 项 | 要求 | stock 依据 |
|---|---|---|
| 默认行数 | `readLimit`，默认 2000 | `read.ts:15` |
| 单行截断 | `readMaxLineLength`，默认 2000，截断后缀沿用 stock 文案 | `read-render.ts:11,69-71` |
| 窗口字节上限 | `readMaxBytes`，默认 51200（50 KiB）；触顶时 footer 用 stock 的 `(Output capped. Showing lines X-Y. Use offset=Y+1 to continue.)` | `read-render.ts:14,83-86,155-158` |
| footer 正常态 | `(Showing lines A-B of N. Use offset=B+1 to continue.)` / `(End of file - total N lines)` | `read-render.ts:159-161` |
| `limit` 超上限 | 抛错，文案同 stock（`limit must be less than or equal to N`） | `read.ts:59` |
| `offset` 越界 | **抛 `FS_NOT_FOUND`**，文案同 stock（`offset N is out of range for "…" (M lines)`）；不返回空窗口、不 mint | `read-render.ts:96-98` |

**验收**：3 行文件默认全返回；`limit:1, offset:2` 只返回第 2 行且 footer 提示 `offset=3`；
`offset:99`（3 行文件）返回 `isError` 且错误码为 `FS_NOT_FOUND`；默认配置下单个 200 KB 长行触发列截断，**不要求**触发字节 capped footer；多条未超列限的行累计超过 51200 字节时触发 capped footer。maxBytes 小于首条展示行字节数时得到零行窗口。

**完整行规则与补救**：仅列截断前后文本完全相同的返回行可新增 seen，截断后缀不能作为文件内容或 seen 证据。read 参数仍只有 file_path/offset/limit，不提供列分页。截断窗口的 nextAction 提示：调高 maxLineLength（必要时 maxBytes）并重新挂载后再读，或显式 replace/patch 降级；同配置重复 read 不会揭示剩余列。

空白行、尾换行、BOM 与 CRLF 的窗口行号须与 stock 对照；tag 与 seen 快照使用 FR-9 的归一化文本，不能因为归一化新增虚构的末尾行。

### FR-6 必须发 `fs/observed`

成功读取后同步发 `ctx.emit('fs/observed', target, { kind:'present', version }, exec)`；
目标不存在时发 `{ kind:'absent' }`（stock 行为，见 `read-target.ts:26-28`）。`version` 来自本次唯一一次 `stat`。

**理由**：`fs-observation-policy` 常驻；未经观察的文件，后续 stock `write` 会被 `FS_NOT_OBSERVED` 拒绝
（策略 owner 是会话，键是目标 realpath 的 `targetKey`——注意这与 FR-7 的 store key **不是同一个键**）。

**验收（含阴性对照）**：read 之后用 stock `write` 改同一文件成功；把 emit 去掉后同一场景报 `FS_NOT_OBSERVED`。

### FR-7 snapshot 记录与 seen 语义

- **store key** 必须用 `path.resolve(cwd, filePath)`，与 `tool-edit` 同源；`cwd` 取 `exec.agent?.session?.cwd`，
  缺省 `process.cwd()`（与 `tool-edit` 完全一致，见 `tool-edit/dist/session.js:26-31`）。
  **不得**改用 `ctx.workingDirectory` 服务——两边的键必须逐字相同，否则编辑端查不到快照。
- **返回路径也要命中**：模型可抄 value.path 作为 edit 的 filePath，因此必须记录 `path.resolve(cwd, value.path)`。输入路径解析键与此键不同（例如符号链接/路径大小写规范化）时，在两个不同键下记录同文本与本次完整行集合；相同键仅记录一次，不另读文件、不自行合并 seen。不要改 edit 的键算法，也不要只按 observed 的 targetKey 推断键一致。
- **seen 集合由引擎合并**：`store.record()` 命中同 hash + 同文本时调用 `mergeSeenLines`（`snapshots.js:68-75,159-169`），
  是**并集**。我们只传本次窗口完整返回的行号，**不要**自己预合并，也不要为相同键的重复读另造记录。
- **零完整行传 `[0]`**：包括零行窗口与所有返回行都列截断的窗口。引擎空集等于“守卫关闭”；行号 0 永不合法，使没有既有 seen 的快照保持初始限制。此举不撤销已有 seen，也不承诺永久拒绝：上游错误完整回显行后会扩充 seen，原样重试可成功；截断回显不应扩充。单测须覆盖首次拒绝、错误揭示后重试、截断揭示及无哨兵放行的对照。
- **无 session 不 mint**：`exec.agent?.session` 缺失时 `getSessionSnapshotStore` 会返回一次性 store
  （`session-store.js:36-44`），记进去的 seen 永远不会被编辑端读到。此时必须 `tagged:false`、`tag:null`，
  并在 `nextAction` 里说明原因。
- **空文件不 mint**（`normalized.length === 0`）；归一化文本 UTF-8 字节数 ≥ `snapshotMaxBytes` 不 mint（见 FR-9）。
- **跨 session 不生效**：快照按 session 存；用别的 session（例如子代理）产出的 tag 去编辑，
  引擎按内容找到不到快照时**静默跳过** seen 检查（`patcher.js:756-763`）——编辑会**成功**。这是引擎行为，
  本规格不试图绕过，但必须写进文档并纳入风险清单（R-7）。
- **有限守卫边界**：同 session 快照淘汰也可能失去 seen 约束；recovery 不要求原锚点 seen；REM 没有行锚点，block 检查原始 anchor 而非整个解析块；mismatch 会记录不附 seen 的当前全文快照。replace/patch/stock write 不受 hashline seen 约束。保留上游这些行为，不宣称 seen 是全部受影响内容的权限边界。

**验收**：read 之后相关键的 `store.head(key).hash === tag`；文件未漂移、快照保留时，用该 tag 首次改**未 seen 锚点**被拒；
先读 1–50 行、再读 400–450 行，之后改第 3 行与第 420 行**都成功**（并集）；
无 session 场景 `tagged === false`；跨 session、同 session 淘汰、recovery 修改未见锚点、REM/block 及 mismatch 后重试分别记录上游边界。相对路径、绝对路径及返回 show path 均须走 read→edit 测试；符号链接可用时覆盖别名与目标路径，平台不支持时明确报告该用例未执行。

### FR-8 引擎单实例

`read` 与 `tool-edit` 必须 import 到同一个物理模块，否则 `getSessionSnapshotStore` 的模块级
WeakMap 分裂成两个空 Map，seen-line 守卫**静默失效**（patcher 在 snapshot 缺失时跳过检查）。

**验收**：`realpath(require.resolve('@hy-sde-org/dsh-hashline', {paths:[tool-read Dir]}))` 与
`...{paths:[tool-edit Dir]}` 相等；两包声明同一精确版本。

### FR-9 边界

| 情形 | 要求 |
|---|---|
| UTF-8 BOM / CRLF | 先 `stripBom` 再 `normalizeToLF`；tag 必须与引擎一致（`computeFileHash` 内部只 trim 行尾 `[ \t\r]`，**不**去 BOM，所以 `stripBom` 必须在算哈希之前） |
| 归一化文本 UTF-8 字节数 ≥ `snapshotMaxBytes`（4 MiB） | 不 mint：`tagged:false`、`tag:null`，仍返回窗口内文本，并给 nextAction 引导走无 tag 的替换/补丁模式；以本次 readText 得到的文本计算，stat.size 不作为快照门槛的最终依据 |
| 空文件 | 不 mint，返回空窗口 + `totalLines:0` |
| 文件不存在 / 无权限 / 非 UTF-8 | 返回 `isError`，错误码与文案同 stock（见 FR-14）；不伪造 tag |
| 非普通文件（目录等） | `isError` + `FS_NOT_REGULAR_FILE`（`read-target.ts:30-32`），不 mint |
| 二进制 | `isError` + `FS_NOT_TEXT`（`fsio.ts:396-398`），**不得** mint |
| 读后文件被外部改动 | 分两档：**锚点级编辑** → 拒绝（`MismatchError`，除非 recovery 成功）；**head/tail 插入** → 带 `HEADTAIL_DRIFT_WARNING` **放行**。验收必须分别断言这两档，不能笼统写「被拒」 |

> 4 MiB 闸门由**我们**实现：`SNAPSHOT_MAX_BYTES` 只在 `session-store.js:28` 定义，两个上游包内零引用，
> 引擎并不拦超限文件。

**验收**：上表每行一条用例；外部改动拆为 recovery 成功、recovery 失败、head/tail 告警三条；快照阈值覆盖 N-1/N/N+1 个归一化 UTF-8 字节，并含多字节字符及 stat.size 未知的情况。

### FR-10 配置

```ts
export interface Config {
  enabled?: boolean          // 默认 true；false 时该行不注册 read（见下方联动说明）
  snapshotMaxBytes?: number  // 默认 4194304，归一化文本 UTF-8 字节数达到此值即不 mint
  maxBytes?: number          // 默认 51200（50 KiB），单次窗口字节上限，语义同 host 的 readMaxBytes
  limit?: number             // 默认 2000，语义同 host 的 readLimit
  maxLineLength?: number     // 默认 2000，语义同 host 的 readMaxLineLength
}
```

- **默认值来源**：NFR-4 禁止自建 tool-read 运行时 import `@deepseek-ai/*`，插件读不到 `tool-fs` 的 config。
  因此三个默认值以常量镜像（2000 / 2000 / 51200），并在 preset 里把 `tool-fs` 的同名项与 `tool-read` 的项
  **写成相同数值**；漂移检查脚本断言两处相等（R-1 的一部分）。
- **`enabled:false` 的联动**：自建 read 不注册且 stock read 关闭时，该会话没有 read，这是有意的排障状态。恢复 stock read 时必须同时禁用自建 read；恢复自建 read 时必须关闭 stock read。两者同时开启会冲突，正常部署必须恰好开启一个。
- 数值配置必须为有限正整数，非法值在挂载时失败并指出配置项，不静默修正。三个窗口上限在两处保持同值。

**验收**：配置项全部生效；把 preset 里两处的 `readLimit` 改成不同值后，漂移检查脚本报错。

### FR-11 与 stock `read` 的互斥

`tool-fs` 的 `read` 必须关闭（§4.1 #1）。同一 agent scope 内出现两个 `read` 会使 preset 挂载失败
（`core/tools/src/index.ts:747-749`：`tool "read" is already registered in this scope`，普通 `Error`，无错误码）。

**验收**：故意在同一 preset 里同时打开两者，挂载必须失败且错误文案与之相符。

### FR-12 投影对齐（v2 新增）

自建 `read` 必须补齐 stock `applyReadTool` 的两项投影，缺一即视为功能退化：

1. **系统提示段** `tool:read`：仅当本 scope 内 `read` 存在时注册，文案沿用 stock
   （`read.ts:69-75`：*Use the read tool — not shell commands like cat — to inspect text files…*）；
2. **`presentationMeta`**：返回 `{ path, offset, lines, totalLines }`，识别出的 lang 一并保留（`read.ts:124-133`），供 read 卡片渲染；
   同时 `presentResult` 继续返回 `card: 'read'`。

**验收**：非 PTC 会话的系统提示里能看到该段文字；Web 端 read 卡片显示行号与 footer；
把提示段删掉后，提示文本消失（负向对照）。

### FR-13 拒后指引（v2 新增）

编辑被拒时，错误必须是**可回正**的，而不是只说"不行"：

- 缺 tag → 沿用上游文案（含 `use [path#tag] from your latest read/search output`，`messages.js:374-376`）；
- tag 不匹配 → 沿用上游错误，必须带**当前磁盘内容 tag**及 re-read 指引；它不等于任意时刻的 store.head。测试不强求中文文案；
- 快照缺失导致的**静默放行**不属于"被拒"，由 FR-7 的"无 session 不 mint"与 R-7 处理，此处只要求文档声明。

**验收**：三条路径各一条用例；mismatch 错误文本中包含独立计算的当前 4 位 tag 与有效的 read/re-read 指引。未见锚点错误另断言完整回显后可重试、截断回显仍需补救；这些回显是 seen 的另一来源。

### FR-14 工具名与错误码契约（v2 新增）

- 编辑工具**必须注册为 `edit`**：watchdog 的 `BEHAVIOR_TOOLS` 按名字匹配（`intent-gate-watchdog.mjs:143-148`），
  改名会让意图门对编辑静默失效；`read` 同理保持 `read`（虽不在 `BEHAVIOR_TOOLS` 内，但被 persona 当作只读工具引用）。
- 自建 read 的不存在、非普通文件、二进制/非法 UTF-8 错误分别保留 `FS_NOT_FOUND` / `FS_NOT_REGULAR_FILE` / `FS_NOT_TEXT`。无权限、取消及其他 provider 错误保留原错误码与原因，不伪装为未找到；用同 provider 的 stock read 作对照。
- stock 的 `error.ts` 只在其 mutation 调用处改写 `FS_NOT_OBSERVED` / `FS_STALE_VERSION`，不会自动改写本插件错误；本 read 对 provider 错误直接传播，由 ToolRuntime 生成 isError。type-only 依赖限制下自行产生的 read 错误也须把 code/message 保留给 runtime。

**验收**：`tools` 列表里能看到 `read` 与 `edit`；把编辑工具改名为 `edit_hashline` 后，带编辑的回合不再被门拦下（负向对照）；
三类错误各一条用例，另加可控 provider 的无权限、取消错误，断言 isError 与原 code/message。

## 6. 非功能需求

| # | 要求 |
|---|---|
| NFR-1 | **确定性**：同一内容永远得到同一 tag；跨进程稳定 |
| NFR-2 | **代价**：有效普通文本读取一次 stat + 一次 readText；同次调用不重复读；不引入流式读。明确接受大文件/size 未知文件全文驻留内存的成本，4 MiB 只限制快照，不是读取内存上限 |
| NFR-3 | **失败可见**：自建 tool-read 不允许空 catch，异常原因进入工具错误；构建/核验脚本失败以非零退出码与原因报告。迁入 watchdog 首版保留基线 warn/catch 行为，不宣称其每个内部异常都进工具返回值，另由契约回归覆盖 |
| NFR-4 | **依赖面**：仅约束自建 tool-read：不运行时 import `@deepseek-ai/*`，只允许 type-only import；第三方运行时能力只经精确锁定的 hashline（可经 workspace 锚点 re-export），Node 内置模块允许。上游 tool-edit、迁入 gate 与测试夹具不受此条限制 |
| NFR-5 | **测试**：纯函数与窗口逻辑有单测；read→edit 闭环、seen 守卫（含 `[0]` 哨兵与并集）、无 session 不 mint、投影对齐，各有真实 `ToolRuntime` 的集成测试 |
| NFR-6 | **可回归**：M3 的判定必须是脚本（见 §8），人工实测只作冒烟 |

## 7. 已拍板决议

### 7.1 原始待决策点（v1 §8）

| # | 结论 |
|---|---|
| D-1 | (a) 本仓库变成 bundle 并声明 `ptc-hashline`；漂移检查脚本自己写 |
| D-2 | v3 替代原并存方案：仅交付 ptc-hashline，ptc-gate 成为其内置能力 |
| D-3 | (a) `tag: string \| null` + `tagged: boolean` |
| D-4 | (a) 只做文本 read；图片走 `read_image` |
| D-5 | 上游基线 commit `3d8f36eb8def861c3f2aa7d5f7b4983d96c92341`，写入 patch 文件头 |

### 7.2 审核新增（v2）

| # | 结论 | 落点 |
|---|---|---|
| Q-01 | 无 tag 文件保留 `replace`/`patch` 显式降级，read 返回 `nextAction` 指引 | FR-9 |
| Q-02 | 多次读的 seen 取并集；由引擎 `mergeSeenLines` 负责，我们不预合并 | FR-7 |
| Q-03 | `read` 参数面与 stock 同参；`offset` 越界**照搬抛错** | FR-5 |
| Q-04 | 默认 `limit` 取 `readLimit`，不偏离 stock | FR-10 |
| Q-05 | `enabled:false` 接受，但必须与 `tool-fs.read` 联动并写明 | FR-10 |
| Q-06 | 跨 session 各自独立；无 `agent.session` 时**拒绝 mint** | FR-7 |
| Q-07 | M3 判定改为脚本化集成测试，人工只作冒烟 | §8 / NFR-6 |
| Q-08 | 补齐 `tool:read` 系统提示段与 `presentationMeta` | FR-12 |
| Q-09 | 三个默认值镜像常量 + preset 两处同值 + 漂移断言 | FR-10 |
| Q-10 | 编辑 mismatch 带当前磁盘内容 tag 与重读指引（v3 澄清 head 含义） | FR-13 |
| Q-11 | FR-9 补"外部改动/tag 漂移"，写成"拒 vs 告警"对照 | FR-9 |
| Q-12 | 同步改写 `AGENTS.md` 与 `HANDOFF.md` 的装饰器路线（已完成） | 见两文件 |
| Q-13 | 零行窗口保留 `[0]` 哨兵，写成显式约定 + 单测 | FR-7 |
| Q-14 | 补 `readMaxBytes`（50 KiB）与 capped footer | FR-5 |
| Q-15 | 配置项拆为 `snapshotMaxBytes` / `maxBytes`，避免同名不同义 | FR-10 |
| Q-16 | store key 的 `cwd` 严格照 `tool-edit`：`session.cwd ?? process.cwd()` | FR-7 |
| Q-17 | 错误码复刻 stock + 编辑工具名必须为 `edit` | FR-14 |
| Q-18 | 建 `GLOSSARY.md`，明确 seen 行 ≠ observed | GLOSSARY.md |
| Q-19 | 投影与契约面各配负向验收 | FR-12 / FR-14 |

### 7.3 闭环审查决议（v3，两轮用户确认）

| # | 结论 | 落点 |
|---|---|---|
| C-01 | 接受有限守卫，收窄总目标并列明 recovery、REM/block、淘汰等边界 | §1、FR-7、ADR-0001 |
| C-02 | 只有完整返回行新增 seen；零完整行用 [0]，不撤销既有 seen | FR-5/7、GLOSSARY |
| C-03 | 独立整合 ptc-gate，原项目可弃置，不额外安装 ptc-roles | §4.2、ADR-0002 |
| C-04 | 本期接受全文 readText 的内存成本 | NFR-2 |
| C-05 | 只交付 ptc-hashline 一个 preset | §2、D-2 |
| C-06 | 首版 persona/watchdog 保持基线正文和行为，只迁资源地址；以后独立演进 | §4.2、NFR-3 |
| C-07 | 长行通过配置重挂载或显式 replace/patch 补救；截断窗口也返回 nextAction | FR-3/5 |

## 8. 交付里程碑

| 里程碑 | 内容 | 判定（全部可脚本化） |
|---|---|---|
| M1 | `tool-read` 实现 + 单测（mint / 窗口 / 字节上限 / 大文件 / 空文件 / 零行窗口哨兵 / fs-observed） | `pnpm exec vitest run` 全绿 |
| M2 | bundle + 独立 gate 资源 + JS/类型构建产物 + 基线核验与安装脚本 | 只允许 §4 声明的差异；干净 profile 无原项目依赖可发现并挂载唯一 preset |
| M3 | read→edit 首次成功、有限守卫、并集、无 session、意图门、工具名与 PTC SDK | 真实 ToolRuntime + 真正 run_code + profile 验收脚本通过；人工仅作冒烟 |
| M4 | BOM/CRLF/阈值/长行/零行/外部漂移三档/投影负向与回放/编辑后继续编辑 | 集成测试覆盖且验收矩阵逐项可追溯 |

### 8.1 验收追溯与命令契约

以下是实施期必须提供的脚本接口，**当前脚手架尚未实现这些命令**。根 `pnpm -r check`、`pnpm -r test` 继续保留；新增根 build 必须真正产出插件 JS 和声明。实现后用例 ID/文件名补入本表，不以人工演示代替脚本判定。

| 检查组 / 命令 | 覆盖需求 | 必须包含的判定 |
|---|---|---|
| 单元 / `pnpm test:unit` | FR-3/5/7/9/10、NFR-1/2 | tag 跨进程一致；窗口/字节/列截断；BOM/CRLF/空白/尾换行；N-1/N/N+1；完整行 seen；配置非法值；一次 stat/readText |
| 宿主集成 / `pnpm test:integration` | FR-1/4/6–14、NFR-3/5 | 正常锚点首次编辑；未见锚点首次拒；并集；[0] 与错误回显；路径两键；无 session；单实例；observed 阴性；错误对照；投影提示/卡片/回放；编辑结果新 tag 后继续编辑 |
| PTC / `pnpm test:ptc` | FR-1/2/3/13/14 | 真正 run_code 拿 tag/nextAction 并编辑；SDK nullable 类型；原生 read UNKNOWN_TOOL；inner dispatch enforce；缺门拒一次；改名负向 |
| 基线 / `pnpm check:preset` | §4、FR-8/10/11 | 独立基线摘要；仅允许列出的差异；三个上限同值；资源和包解析；重复 read 挂载失败 |
| 干净部署 / `pnpm test:profile` | §4、FR-1/2、M2/3 | 构建→临时 profile 依赖及 bundles 登记→安装→宿主重挂载→唯一 preset→真实 PTC 编辑；原项目/clone 不可用仍通过 |
| 上游兼容 / `pnpm test:compat` | FR-7/8/9/13、R-2/4/7/8 | tests/compat 锁定跨 session/同 session 淘汰/recovery/REM/block/mismatch 重试的实际行为；每次升级先过此 gate |

权限或平台能力导致用例未运行时报告具体缺项；必要验收缺项不能计为通过。边界放行用例应明确断言“已知放行”，不与正常未见锚点拒绝用例互相替代。

## 9. 风险

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R-1 | gate 资源或 preset 发生非预期变动 | 首版行为偏离已确认基线 | 本仓库保存来源、摘要与比较材料；只允许声明差异；不依赖原项目继续存在 |
| R-2 | 引擎出现两个物理实例（版本漂移 / linker 变化） | seen 守卫**静默**失效 | FR-8 的 realpath 断言进测试 |
| R-3 | **PTC 下 seen 是工具展示事实**：窗口完整行可能只 print 了两行 | seen 不证明模型实际收到全部内容 | 文档写明口径；默认上限保持 stock；首版不为此改 persona 正文 |
| R-4 | `tool-edit` 仍是 alpha，`getSessionSnapshotStore` / key 约定可能变 | 记录逻辑要跟 | 锁精确版本；升级先跑 `tests/compat` |
| R-5 | `write` 仍走 `tool-fs`，与自建 read 的观察记录不同步 | 写被拒 | FR-6 强制 emit，并有阴性对照测试 |
| R-6 | preset 是静态的，改完必须真正重新挂载 | 改了不生效、误判成 bug | 每次改完做一次进程重启并记录 |
| R-7 | 跨 session 或同 session 快照淘汰后缺 seen，mismatch 还可能产生无 seen 快照 | 后续 tag 匹配可放行 | 无 session 不 mint；声明有限保护而非权限边界；compat 固定这些行为 |
| R-8 | recovery、REM/block、错误回显的保护范围与普通行锚点不同 | 未见内容可能被修改，首次拒绝也可能在揭示后重试成功 | FR-7 明确接受的上游行为；分别断言，不声称严格全部行保护 |
| R-9 | 全文读取超大或 size 未知文件 | 内存与延迟随文件增长，4 MiB 不限读内存 | 本期显式接受；文档与 nextAction 不宣称有界读取；以后改变须重开 NFR-2 |

## 10. 证据索引

| 结论 | 出处 |
|---|---|
| PTC 程序只拿 `value`，content 仅进 log 且不回灌上下文 | `core/tools/src/ptc.ts:571-573`、`core/tools/src/types.ts:55-59` |
| 替换 `value` 会用 output schema 重校验（故无法注入 tag） | `core/tools/src/index.ts:1840-1843` |
| stock read 输出 schema 封闭 | `fs/tool-fs/src/read.ts:86-88` |
| stock read 的入参只有 file_path/offset/limit，上限来自插件 config | `fs/tool-fs/src/read.ts:80-84`、`tool-fs/src/index.ts:36-54` |
| stock read 的默认上限：2000 行 / 2000 字符 / 50 KiB | `read.ts:15`、`read-render.ts:11,14` |
| offset 越界抛 `FS_NOT_FOUND` | `read-render.ts:96-98` |
| read 发 `fs/observed`（present / absent） | `read.ts:163`、`read-target.ts:26-28` |
| read 还注册了 `tool:read` 提示段与 `presentationMeta` | `read.ts:69-75,124-133` |
| 未观察的文件被策略拒绝 | `fs/fs-observation-policy/README.md`、`fs-observation-policy/src/index.ts:78-88` |
| 同名工具同 scope 冲突 | `core/tools/src/index.ts:747-749` |
| `read: false` = 从不注册 | `tool-fs/src/index.ts:74-75` |
| preset 覆盖语义 / `.agent-presets` 已废止 | `packages/preset/agent-preset/skills/editing-cordis-compositions/SKILL.md:54-66` |
| 引擎常量与 API 可用（`SNAPSHOT_MAX_BYTES=4194304`、`formatHashlineHeader`、`computeFileHash`） | `session-store.js:28`、`format.js:80,97-124` |
| `SNAPSHOT_MAX_BYTES` 在两个上游包内**零引用**（闸门须自建） | 全包 grep 仅 `session-store.js:28` |
| `record()` 对同内容做 seen 并集 | `snapshots.js:68-75,159-169` |
| 空 seen 集 = 守卫关闭；无内建哨兵 | `patcher.js:682-684,173-175` |
| 缺 tag 硬失败 / 快照缺失则静默跳过 / mismatch 走 recovery 或告警 | `patcher.js:102-106`、`756-763`、`809-829` |
| tool-edit 的 replace/patch 不碰 store，可作无 tag 降级 | `dsh-tool-edit/dist/index.js:48-59` |
| tool-edit 归一化绝对路径、键为 `path.resolve(cwd, path)` | `dist/hashline/input.js:83-91`、`dist/hashline/filesystem.js:50-52` |
| `exec.session` 不存在，须用 `exec.agent?.session` | `core/tools/src/index.ts:327-353`、`tool-edit/dist/session.js:109` |
| 可空字段只能用 `oneOf` 表达 | `core/tools/src/json-schema.ts:303-306`、`ts-types.ts:176-195`、`tool-fs/src/write.ts:93-98` |
| `ptc-gate` 的 tool-fs 行无 config；上游 SHA | `.scratch/dsh-ptc-roles/preset/ptc-gate/preset.patch.yml:101-102`、HEAD `3d8f36eb8` |
| watchdog 的 BEHAVIOR_TOOLS 含 `write`/`edit`，每轮最多拒一次 | `intent-gate-watchdog.mjs:143-148,440-442` |
| 复制 preset 的机械约束（10 空格缩进、watchdog 逐字一致、EXPECTED_COMPOSITION 登记） | `dsh-ptc-roles/scripts/deploy-preset.cjs:49-58,142-148,164-172` |
| profile 必须登记 bundles；资源按 profile 包名解析 | 原基线 `scripts/deploy-preset.cjs:239-241,279-281`；`preset.patch.yml:66,362` |
| 列截断先于字节上限 | stock `read-render.ts:69-86` |
| 错误完整回显可扩充 seen；recovery 不检查原 seen；REM/block 只按原 anchor | `hashline/dist/patcher.js:724-728,803-827,474-482`；`dist/input.js:282-307` |
| 快照默认有 256 路径/4 版本/64 MiB 限制；缺 seen 放行 | `hashline/dist/snapshots.js:59-66`；`patcher.js:682-684,761-763` |
| mismatch 提供当前 hash/英文重读指引，并记录无 seen 当前快照 | `hashline/dist/mismatch.js:75-82`；`patcher.js:742-748,645-646` |
| local processPath 返回 targetKey，可能与输入路径不同 | stock `fs-local/src/index.ts:134-142`；`fsio.ts:154-166` |

## 附录 A：preset delta 的具体写法（草案）

```yaml
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
            config:
              read: false           # 自建 read 接管；否则同 scope 重名，挂载失败
              edit: false           # tool-edit 接管 stock edit
              # write / readImage 保持默认开启
              readLimit: 2000       # 与下方 tool-read.limit 必须同值（漂移检查断言）
              readMaxLineLength: 2000
              readMaxBytes: 51200

          - id: tool-read
            name: '@dsh-tool-hashline/tool-read'
            config:
              limit: 2000           # 镜像 host 的 readLimit
              maxLineLength: 2000   # 镜像 host 的 readMaxLineLength
              maxBytes: 51200       # 镜像 host 的 readMaxBytes
              snapshotMaxBytes: 4194304

          - id: tool-edit
            name: '@dsh-tool-hashline/tool-edit'
            config:
              mode: auto
              formatOnWrite: false
              diagnosticsOnEdit: false
```

## 附录 B：不在本期范围

- `grep` / `glob` 的 tag 化（上游 fork 里 `grep` 也 mint tag，本期不做）。
- `read` 的附件与图片通道。
- 发布到 npm、README 双语；迁入 gate 的已有来源/归属声明仍按 §4.2 保留。
- `ptc-roles` 那五个角色子代理的任何整合。
- 跨 session 的 seen 共享（引擎不支持，且非目标）。
- 严格禁止全部未见内容编辑、大文件有界内存、列分页、独立 ptc-gate preset。
