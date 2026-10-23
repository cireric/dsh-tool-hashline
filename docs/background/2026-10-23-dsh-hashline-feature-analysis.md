# dsh hashline 功能分析：社区/上游 vs 本地 dsh-tool-hashline

> **定位：功能盘点与后续方案研究快照（归档整理于 2026-10-23）**。本文记录锁定版本的能力线索、对比及建议，不是当前功能承诺、权威需求或已批准路线图。声明/配置可用不等于本机运行验收；是否实施建议由[正式规格](../spec/2026-10-22-ptc-hashline-requirements-spec.md)及后续已确认需求决定。当前已验证范围见[验收索引](../acceptance/2026-10-23-current-status-and-evidence-index.md)。文中代码路径均相对仓库根。

> 生成方式：以本地已安装的社区上游包（`node_modules/@hy-sde-org/dsh-hashline`、
> `@hy-sde-org/dsh-tool-edit`，版本 **0.2.1-alpha.4**）的 `dist/*.d.ts`、`README.md`、`package.json`、
> 端口出处注释，以及本仓库的规格/补丁/预设为证据，逐项比对后落盘。

## 0. 结论速览（TL;DR）

本地 `dsh-tool-hashline` 通过「版本锚点」完整继承了社区 rich edit 工具的全部四种模式与
hashline 引擎能力，再叠加三层本地增量：**自建 read（mint tag）**、**PTC 意图门/persona**、
**精确补丁硬化（工作目录 / MV / BOM / 快照次序）**。

社区侧最值得下版本落地/参考的，按优先级：

| 优先级 | 功能 | 现状 | 一句话理由 |
|---|---|---|---|
| **P0** | LSP `formatOnWrite` + `diagnosticsOnEdit` | 上游有，本地 preset 显式关闭 | 翻一个 config 即得「写前格式化 + 写后诊断」，零引擎改动 |
| **P0** | TypeScript 7 native LSP（`typescriptNative`） | 上游有（opt-in），本地未配置 | TS7 下 `typescript-language-server` 会初始化失败，需 `tsc --lsp --stdio` 兜底 |
| **P1** | tree-sitter **块定位**（`PUT N*` / `CUT N*` / `replace_block N:`） | 上游原始有、移植为 stub（返回 null） | 解锁「按语法块替换/剪切」，当前降级为纯行区间或直接抛错 |
| **P1** | tree-sitter **语法探针**（`parsesCleanly` / `enclosingBoundaries`） | 上游原始有、移植为 stub（false / 空） | 解锁「写后语法一致性放行」与更强的边界修复 |
| **P1** | `grep` / `glob` 的 tag 化 | 上游 fork 的 `read`/`grep` 已 mint tag，本地明确「本期不做」 | 让 grep 结果也能直接进 `edit` 锚点，扩大闭环覆盖面 |
| **P2** | 替换/补丁模式的 BOM 保真与 seen 一致性 | 本地仅 hashline 模式做 BOM 保真 | 四模式行为统一，减少「换个模式就丢 BOM/丢 seen」的坑 |
| **P2** | 将 noop-loop-guard / clipboard / fuzzy 等继承能力用测试固化 | 已继承但无本地回归 | 防上游升级悄悄退化 |

详细依据见 §7；逐项对比矩阵见 §6。

## 1. 分析范围与信息来源

### 1.1 「社区」的边界

本分析中的「dsh 社区 hashline」指可被本地 bundle 直接消费的上游工件，按可信度排序：

1. **已安装的 npm 包**（运行时真实依赖，最权威）：`@hy-sde-org/dsh-hashline@0.2.1-alpha.4`、
   `@hy-sde-org/dsh-tool-edit@0.2.1-alpha.4`。两者 `repository` 均指向
   `https://github.com/hy-sde/dsh-tool-edit`（`packages/hashline` 与 `packages/tool-edit` 目录）。
2. **端口出处**：两个包均为 oh-my-pi（`https://github.com/can1357/oh-my-pi`）的移植/二次开发，
   版权注明 Mario Zechner（2025）与 Can Bölük（2025-2026），MIT。
3. **上游 fork 参考实现**：hy-sde 的 `deepseek-harness` fork 提供带 mint tag 的 `read`/`grep`
   （本仓库 AGENTS.md 与规格附录 B 均引用；本地选择自建 read 而非 vendor fork）。

> 说明：本会话网络出口不可靠，故社区功能清单以「已安装并锁定版本的上游包类型声明 + 端口出处注释 + 本仓库规格引用的上游证据」为准，
> 而非依赖实时抓取社区论坛。对同一精确版本而言，这是比 README/论坛更贴近真实 API 的证据面。

### 1.2 本地对照物

- 规格：[`docs/spec/2026-10-22-ptc-hashline-requirements-spec.md`](../spec/2026-10-22-ptc-hashline-requirements-spec.md)（v3，权威 FR/NFR/决议）。
- 背景选型：[`docs/background/2026-10-22-dsh-hashline-selection-analysis.md`](2026-10-22-dsh-hashline-selection-analysis.md)。
- 决策：[`docs/adr/0003`](../adr/0003-effective-working-directory.md) / [`0004`](../adr/0004-mv-create-intent-and-snapshot-order.md) / [`0005`](../adr/0005-bom-preserving-hashline-read.md)。
- 补丁：`patches/@hy-sde-org__dsh-hashline@0.2.1-alpha.4.patch`、`patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch`。
- 预设/只读：`presets/ptc-hashline/preset.patch.yml`、`packages/tool-read/**`。

## 2. 社区 hashline 生态总览

- **`dsh-hashline`**：自 oh-my-pi 移植的「**行锚定补丁引擎**」，零运行时依赖，是 rich `edit` 背后的
  纯核心（解析/落盘/快照/守卫）。**它不注册任何工具**，只导出引擎 API。
- **`dsh-tool-edit`**：以 `dsh-hashline` 为依赖的「**富编辑工具插件**」，注册单个 `edit` 工具，
  供四种模式 + 内嵌 LSP，可选替换宿主内置 `str_replace_editor`/stock `edit`。
- 两者同为 `private` 的社区发布形态前的 alpha 产物，但已是可被宿主加载的完整 JS + `.d.ts`；
  `dsh-tool-edit` 自带 `cordis.patch.yml` 与 `examples/agent-preset/`。

### 与本地的关系

本地**不 fork、不 vendor** 这两个包（见 AGENTS.md 硬约束），而是：
- `packages/hashline` / `packages/tool-edit` 作为「版本锚点」精确锁定上游版本（0.2.1-alpha.4）；
- 用 `pnpm patchedDependencies` 打两份本地精确补丁（§5.4）；
- `packages/tool-read` 自建一个完整的 `read`（上游 fork 虽有，但因 PTC 只拿 `value` 的机制约束，必须自建）。

## 3. 社区 hashline 引擎功能清单（@hy-sde-org/dsh-hashline）

引擎导出 22 个模块（`dist/index.d.ts` 全量 re-export）：`apply` `block` `clipboard` `diff-preview`
`format` `fs` `hash` `input` `line-diff` `lru` `messages` `mismatch` `normalize` `parser` `patcher`
`prefixes` `recovery` `session-store` `snapshots` `stream` `syntax` `syntax-chain` `tokenizer` `types`。

### 3.1 补丁语言（语法面）

由 `tokenizer`/`parser` 解析，`parser` 产出的语义如下（`types.d.ts` 的 `Edit` 判别联合）：

- **Header**：`[path#tag]`，tag 为 4 位十六进制内容哈希，是快照 store 的指针。
- **整块替换** `PUT N.=M:`：含 body（`+` 文本行）替换 N–M（闭区间）。
- **插入** `PUT <N:` / `PUT >N:`（行前/行后插入），等价 cursor `before_anchor`/`after_anchor`；另有 `bof`/`eof`。
- **块操作** `PUT N*:` / `PUT >N*:` / `CUT N*`：以「起始行所在的语法块」为跨度，需 `BlockResolver`。
- **剪切到寄存器** `CUT N-M @r` / `CUT N* @r`：捕获区间到剪贴板。
- **粘贴** `PUT <N @r` / `>N @r` / `N-M @r` 及块解析形式：从寄存器读出后落盘。
- **文件级操作**：`REM`（删除）、`MV DEST`（移动/改名）。

### 3.2 引擎能力

| 能力 | 证据/要点 |
|---|---|
| 快照 store + tag | `session-store`/`snapshots`：内容哈希 tag ↔ 归一化文本；`record()` 对同内容做 seen 并集（`snapshots.js:68-75,159-169`） |
| seen-line 守卫 | `PatcherOptions.enforceSeenLines` 默认 `true`；锚点只允许落在「mint 该 tag 的 read/search 完整返回的行」上；`false` 时退化为纯内容哈希校验 |
| tag 漂移恢复 | `recovery`：mismatch 走恢复或 head/tail 告警；mismatch 带当前磁盘内容 tag 与重读指引（`mismatch.js:75-82`） |
| 多 section 原子预检 | `Patcher.prepare` 先对每个 section 全量 in-memory apply，全部通过才写盘（all-or-nothing）；另有 `preflight` 供 CI dry-run |
| BOM/换行保真 | patcher 以 LF 归一化 + 去 BOM 计算，落盘时 `persisted` 还原原 BOM 与 CRLF/LF（`PatchSectionResult.persisted`） |
| 剪贴板寄存器 | 匿名寄存器批次内局部；命名寄存器（`@name`）由宿主持有、可跨批次/跨文件搬运内容 |
| 流式输入/预览 | `splitPatchInput`、`streamHashLines`（`startLine`/`maxChunkLines`/`maxChunkBytes`）、`parsePatchStreaming`、`Tokenizer.feed` 分块 |
| 紧凑 diff 预览 | `buildCompactDiffPreview`（added/removed 行统计 + 长 run 省略） |
| 边界修复 | `apply` 中 `repairBoundaryVariants`：错位替换边界做候选搜索修复（等值/缩进/纯闭合括号形状门 + tree-sitter 校验） |
| 纯函数 apply | `applyEdits(text, edits, options)` 无 I/O，可单测；`onEmptyPaste` throw/drop、`path` 供语言推断 |

### 3.3 原始 oh-my-pi 能力中被「存根」降级的部分

这是「社区有、移植后暂时没有」的关键面——也是下版本最实质的引擎级增量：

1. **tree-sitter 块定位被 stub**（`tool-edit/dist/hashline/block-resolver.d.ts`）：原始用 `@oh-my-pi/pi-natives` 的
   `blockRangeAt` 解析 `N*` 的语法块；移植后 `nativeBlockResolver` 恒返回 `null`。后果：
   - 无显式 resolver 时，`replace_block N:` **直接抛错**（`patcher.d.ts`：*when omitted, any replace_block N: edit throws*）；
   - `N*` 相关操作降级为普通行区间语义，或作为 mismatch/range 错误浮出。
2. **tree-sitter 语法探针被 stub**（`dsh-hashline/dist/syntax.d.ts`）：原始 `enclosingBoundaries`/`parsesCleanly`
   用原生语法树做边界保证与「写后是否可语法解析」的放行判据；移植后分别恒返回 `[]` 与 `false`。
   后果：任何「结构性重写是否放行」的判据失效，边界修复只能靠等值/缩进/候选搜索（非语法校验）。
3. **block-context 退化为词法括号扫描**（`tool-edit/dist/block-context.d.ts`）：原始优先用 `enclosingBlockBoundaries`，
   移植后只剩括号配对的 fallback 扫描器。

> 这三处受同样的根因约束：**宿主没有原生/树 sitter 语言解析器**，接口已按「可替换」预留（`TODO(tree-sitter)`），
> 一旦有 native/wasm 解析器即可原地接回，不必动 patcher 主体。

## 4. 社区 rich edit 工具功能清单（@hy-sde-org/dsh-tool-edit）

注册 **单一 `edit` 工具**，`mode` 由配置固定、按参数字段 presence 判别（`dispatchMode`）。

### 4.1 四种模式（`EditMode = auto | hashline | replace | patch | apply_patch`）

| 模式 | 入参形状 | 关键能力 |
|---|---|---|
| `hashline` | `{input}`（`[path#tag]` section 文档） | 走 §3 引擎；多 section 预检；seen 守卫；BOM/换行保真 |
| `replace` | `{path, old_string, new_string, replace_all?}` | 渐进式模糊匹配（见 4.2）；出现次数预览 |
| `patch` | `{path, edits:[{op, rename?, diff?}]}` | create/delete/update/rename；`previewPatch`/`dryRun`/`allowCreateOverwrite` |
| `apply_patch` | `{input}`（Codex `*** Begin Patch` 信封） | `parseApplyPatch` + 流式解析 + `firstMatch` 绑定 + A/M/D 汇总 |
| `auto` | 任意 | `dispatchMode` 按字段 presence 判别（本地 preset 即用 `auto`） |

### 4.2 replace 模式的渐进模糊匹配（值得参考的高价值点）

`replace.d.ts` 揭示上游不是简单字符串替换，而是一套**递减严格度**的策略链：

`exact → trim-trailing → trim → comment-prefix → unicode → prefix → substring → fuzzy → fuzzy-dominant → character`

配套：Levenshtein 相似度（默认阈值 `DEFAULT_FUZZY_THRESHOLD = 0.95`）、`excludedRanges`（排除已匹配区间以免重复命中）、
`MatchOutcome.occurrences/occurrenceLines/occurrencePreviews`（多命中的定位与预览）、`EditMatchError`（带 closest 候选回显）。

### 4.3 apply_patch（Codex 信封）

- `parseApplyPatch`：把 `*** Begin Patch / Add File / Update File / Move to / Delete File / End Patch` 解析为按文件条目；
- `parseApplyPatchStreaming`：容错解析（缺标志/半截 hunk），仅供 TUI 预览；
- `firstMatch`：上下文无关 hunk 在重复出现时绑到「上一 hunk 之后的首个等值/归一化匹配」；
- 汇总：rename 记入 `modified`（原始路径），`formatApplyCodexPatchSummary` 输出 A/M/D。

### 4.4 patch 模式

`create/delete/update` + `rename`；`previewPatch`（不落盘的预览）、`dryRun`、`allowCreateOverwrite`
（JSON `patch` 模式允许 create 覆盖已有文件做整体重构，而 apply_patch 信封严格禁止覆盖）。

### 4.5 LSP 写通：format-on-write + diagnostics-on-edit（本地关掉了）

内嵌一个「只覆盖文本同步子集」的轻量 LSP 客户端（`lsp/client.d.ts`）：`initialize / didOpen / didChange /
textDocument/formatting / publishDiagnostics`。由 `lsp/writethrough.d.ts` 的 `createWritethrough` 把「写前格式化 + 写后诊断汇总」
织进每种模式的写路径，**语言服务器不可用时优雅降级为 pass-through**（绝不因 LSP 失败阻断编辑）。

- `formatOnWrite`：写前用 formatter 格式化；
- `diagnosticsOnEdit`：写后收集诊断，`summarizeDiagnostics` 按严重度计数（error/warning/info/hint），`diagnosticsDeduplicate` 去重；
- 每文件 diff 卡片：`computeHunkDiffs`（3 行上下文）随 result 返回，供 `presentResult` 的 before/after 卡片。

### 4.6 TypeScript 7 native LSP（opt-in）

TypeScript 7 移除 `lib/tsserver.js`，`typescript-language-server` 包装器会在 TS7 项目 `initialize` 失败。
`lsp/typescript.d.ts` + `provider` 提供 `typescriptNative` 开关：按 workspace 检测 TS 安装，无 `lib/tsserver.js` 时
改用工作区自带 `tsc --lsp --stdio`，否则保持 `lspCommand`；未设置时完全关闭（对齐上游 commit `530664c8f5`）。

### 4.7 其它工具级能力

- **noop-loop-guard**（`hashline/noop-loop-guard.d.ts`）：per-session 按路径+输入哈希计数，连续 3 次字节相同 no-op 编辑后
  从软提示升级为**抛 tool failure**（上游 issue #2081 记过 182 次相同 no-op）。
- **session store**（`hashline/store.d.ts`）：把快照 store 提升到稳定的 agent-session 对象上，**与 read 工具共享**——
  read 记录它展示的行，edit 的 patcher 用同一个 store 校验 tag，跨调用的 read→edit 才闭合。
- **diff 工具**（`diff.d.ts`）：`generateDiffString`/`structuredPatchHunks`（GNU 风格 `@@`）/`parseDiffHunks`。

## 5. 本地 dsh-tool-hashline 现状

### 5.1 bundle 结构

| 件 | 角色 |
|---|---|
| `packages/hashline`、`packages/tool-edit` | 上游版本锚点（0.2.1-alpha.4，不 vendor） |
| `packages/tool-read` | **自建**完整 `read`：mint tag / 窗口 / seen / 卡片 / 提示 |
| `patches/` | 两份精确版本补丁（§5.4） |
| `presets/ptc-hashline/` | preset + `personas/orchestrator.md` + `intent-gate-watchdog.mjs` |

### 5.2 自建 read（本地独有增量）

因为 PTC 下程序只拿 `value`、渲染只进 log 不回灌上下文（`core/tools/src/ptc.ts:571-573`），
本地自建 read 把 tag 放进 canonical `value`（`{path, tag, tagged, offset, lines, totalLines, nextAction}`）。
要点：mint（归一化文本哈希 == 引擎 tag）、窗口（2000 行/2000 列/50 KiB）、seen（只记完整返回行，零完整行记 `[0]` 哨兵）、
卡片（`presentationMeta` + `tool:read` 提示段）、提示（按原因给 `nextAction`）。

### 5.3 preset 关键配置

```yaml
tool-fs:   { read: false, edit: false, readLimit: 2000, readMaxLineLength: 2000, readMaxBytes: 51200 }
tool-read: { limit: 2000, maxLineLength: 2000, maxBytes: 51200, snapshotMaxBytes: 4194304 }
tool-edit: { mode: auto, formatOnWrite: false, diagnosticsOnEdit: false }
```

即：**四种模式全开（`mode: auto`），但 LSP 写通两项显式关闭**。snapshot 闸门 `snapshotMaxBytes` 由本地自建
（上游常量 `SNAPSHOT_MAX_BYTES=4194304` 在两个包内零引用，引擎并不拦超限文件）。

### 5.4 补丁硬化（本地相对上游的增量）

| 补丁 | 相对上游的增量 |
|---|---|
| `dsh-hashline` | MV 时**先移动磁盘、再迁移快照**；快照记账失败报诚实 `SnapshotCommitError`（只陈述两端都成立的事实，不回滚） |
| `dsh-tool-edit` | ① `inject` 增 `workingDirectory`，`toolCwdFromExec` 读目录服务（修 D1：上游读 `session.cwd` 恒空、相对路径落到进程 cwd）；② MV 两端包含关系检查覆盖写通分支；③ MV 目标走 `fs/write-intent`/`createIfAbsent`（改 `edit-intent`，修 fs-observation-policy 下 MV 到新路径被拒）；④ `moveCreateError`/`partialMoveError` 诚实报告半程移动；⑤ `readTextPreservingBom` 保 BOM 读取（拒连续 BOM、变动报 `FS_STALE_VERSION`）；⑥ 多 section 部分写入状态回显；⑦ 工具说明写入 MV DEST 基准与「非整次调用原子」 |

### 5.5 PTC 意图门 / persona（本 bundle 的功能面）

- 意图门 watchdog（`gate: enforce`）：每个「会改变行为」的用户回合，助手消息首行 `Intent: <bucket> — …`，缺则每轮最多拒一次；
- `tool-presentation: mode: ptc`：模型只直接调 `run_code`，其余工具以程序内 `tools.*` 呈现；
- 独立 gate 资源（不依赖 `@cireric/dsh-ptc-roles` 继续存在）。

### 5.6 明确非目标（规格 §2 / 附录 B）

AST/LSP（沿用 tool-edit 自带的可选能力）、图片/PDF/目录/附件 read、`grep`/`glob` tag 化、跨 session seen 共享、
发布到 npm、严格「全部未见内容不可改」、大文件有界内存、列分页、独立 ptc-gate preset。

## 6. 逐项对比矩阵

| 功能 | 社区上游 | 本地 | 判定 |
|---|---|---|---|
| hashline 四种模式 | 有 | `mode:auto` 全开 | 已继承 |
| replace 渐进模糊匹配（阈值 0.95） | 有 | 未在 preset 显式覆盖，走上游默认 | 已继承/建议固化默认 |
| apply_patch（Codex 信封 + firstMatch） | 有 | `auto` 下可用 | 已继承 |
| patch（preview/dryRun/create-overwrite） | 有 | `auto` 下可用 | 已继承 |
| **LSP formatOnWrite + diagnosticsOnEdit** | 有 | preset **显式 `false`** | **可开启（P0）** |
| **TypeScript 7 native LSP** | 有（opt-in） | 未配置 | **可表面（P0）** |
| 剪贴板命名寄存器（跨文件/跨批次） | 有 | 经锚点继承 | 已继承（建议加回归） |
| noop-loop-guard（3 次升级失败） | 有 | 经锚点继承 | 已继承（建议加回归） |
| 快照 store + seen 守卫 + recovery | 有 | 继承 + 本地 read 喂 seen | 已继承（本地闭环） |
| 多 section 原子预检 / dry-run | 有 | 继承 | 已继承 |
| BOM/换行保真 | 有（引擎） | 本地再加 hashline 专用保 BOM 读 | 已强化（hashline 模式） |
| **tree-sitter 块定位 `N*`** | 原始有 / 移植 stub | 同 stub（继承上游） | **可实现（P1，需 native）** |
| **tree-sitter 语法探针** | 原始有 / 移植 stub | 同 stub | **可实现（P1，需 native）** |
| **grep / glob tag 化** | 上游 fork 有 | 明确「本期不做」 | **下版本候选（P1）** |
| 自建 read（mint tag 进 value + PTC） | 上游 fork 有类似 | **本地自建** | **本地独有** |
| PTC 意图门 + persona | 社区有（cireric/dsh-ptc-roles） | 独立整合 | **本地独有交付** |
| MV 工作目录 / intent / 半程报告 | 上游缺失（D1 根因） | **本地补丁修复** | **本地独有硬化** |

## 7. 下版本值得实现/参考的功能（分级）

### P0 —— 翻配置/表面化即得，零引擎改动

1. **开启 LSP `formatOnWrite` + `diagnosticsOnEdit`**：上游已内置并优雅降级，本地只需把 preset 两处 `false` 改开
   （并确认 `npx --yes typescript-language-server --stdio` 的可用性与冷启动代价）。收益：写前格式化 + 写后诊断卡片，
   且失败不阻断编辑（pass-through）。
2. **表面 `typescriptNative`**：TS 7 项目下包装器 `initialize` 会失败，配 `typescriptNative: {}` 让检测逻辑自动选
   `tsc --lsp --stdio`。属一键 config，风险低。
3. **把继承能力固化为回归测试**：noop-loop-guard、剪贴板命名寄存器、fuzzy 策略链、apply_patch `firstMatch` 等
   目前「经锚点白拿」，无本地断言。在上游升版时最易悄悄退化，应并入 `tests/compat`。

### P1 —— 需一定工程，解锁实质能力

4. **接回 tree-sitter 块定位**：为 `PatcherOptions.blockResolver` 提供一个宿主侧解析器（native 或 wasm），即可解锁
   `PUT N*` / `CUT N*` / `replace_block N:` 语义；这是社区原始功能里最直接影响编辑体验的一块。
5. **接回 tree-sitter 语法探针**：`parsesCleanly`/`enclosingBoundaries` 恢复后，可做「写后语法一致性放行」与结构级边界修复，
   把当前 `N*` 的兜底降级提升为结构级。
6. **`grep`/`glob` tag 化**：让 grep/glob 命中也能 mint tag、直接进 `edit` 锚点，扩大 read→edit 闭环的覆盖面
   （上游 fork 已实现，规格附录 B 明确本期不做）。

### P2 —— 可选 / 较大专项

7. **四模式行为统一**：把 BOM 保真与 seen 一致性从 hashline 模式扩展到 replace/patch/apply_patch（目前 BOM 保真仅 hashline）。
8. **流式/大文件 read 与列分页**：引擎具备 `streamHashLines` 但 read 工具侧无流式；属规格 R-9 明确接受的专项。
9. **紧凑 diff 预览 / 流式 hashline 输入**：引擎已有，可表面化到渲染与输入。

### 不建议在本仓库自行实现的（保持「引擎一律用上游」）

- 重写 hashline 解析 / patcher / hash / snapshot store（规格 §2 非目标）；
- 自行实现 AST/LSP（沿用 tool-edit 自带可选能力）；
- 跨 session seen 共享（引擎不支持，非目标）。

## 8. 参考来源索引

| 结论 | 出处 |
|---|---|
| 上游两包版本与出处 | `node_modules/@hy-sde-org/dsh-hashline/package.json`、`.../dsh-tool-edit/package.json` |
| 引擎 22 模块导出 | `dsh-hashline/dist/index.d.ts` |
| 补丁语言 Edit 判别联合 / 剪贴板 / 块定位 | `dsh-hashline/dist/types.d.ts` |
| patcher 能力（seen/预检/BOM/commit） | `dsh-hashline/dist/patcher.d.ts` |
| 语法探针 stub | `dsh-hashline/dist/syntax.d.ts` |
| 树 sitter 块定位 stub | `dsh-tool-edit/dist/hashline/block-resolver.d.ts` |
| 四模式 / Config（fuzzy/enforceSeen/LSP） | `dsh-tool-edit/dist/index.d.ts`、`dist/session.d.ts` |
| 渐进模糊匹配策略链 | `dsh-tool-edit/dist/replace.d.ts` |
| apply_patch / patch / Codex firstMatch | `dist/apply-patch.d.ts`、`dist/patch.d.ts` |
| LSP 客户端 / 写通 / TS7 native | `dist/lsp/client.d.ts`、`writethrough.d.ts`、`typescript.d.ts` |
| noop-loop-guard / session store | `dist/hashline/noop-loop-guard.d.ts`、`store.d.ts` |
| 本地 FR/NFR/非目标/附录 B | `docs/spec/2026-10-22-ptc-hashline-requirements-spec.md` |
| 本地补丁硬化 | `patches/@hy-sde-org__dsh-hashline@0.2.1-alpha.4.patch`、`patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch` |
| 本地预设配置 | `presets/ptc-hashline/preset.patch.yml` |
