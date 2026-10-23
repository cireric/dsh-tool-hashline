# HANDOFF — dsh-tool-hashline

> 交接文档。目标读者：下一个会话里的实现者（人或 agent）。
> 先读这份，再读背景报告：`docs/background/2026-10-22-dsh-hashline-选型分析.md`。
> **当前状态（2026-10-23）：8 票已实现，全部脚本化验收通过；仍未发布、未接入日常 profile。** 入口命令与已知缺项见 `README.md` 与 `docs/acceptance/2026-10-23-验收追溯.md`。
>
> **2026-10-22 v3 更新**：实施先读[需求规格](docs/spec/2026-10-22-ptc-hashline-需求规格.md)。两轮用户决议已落实：上游有限守卫、仅完整行新增 seen、全文读取成本、长行配置/显式降级；只交付 ptc-hashline，自带 intent gate 资源，首版保持基线行为。本文未重写的历史方案不覆盖规格 v3；当前验收以规格 §8.1 为准。

## 1. 一句话目标

在 **官方 DSH（stock，0.2.1-rc.2 起）** 上打通 omp 风格的 hashline 闭环：

1. `read` 的输出带 `[path#TAG]`；
2. 模型把 TAG 抄进 `edit` 的 section header；
3. `edit` 首次尝试就能校验通过并落盘；
4. 文件未漂移、快照保留时，未 seen 的行锚点首次被拒；保护范围遵循上游有限守卫，见规格 FR-7。

**不 fork DSH，不复制 hy-sde 的 hashline / tool-edit 源码。**

## 2. 为什么需要这个仓库

- `@hy-sde-org/dsh-hashline` 是纯引擎：解析、patcher、hash、snapshot store，**不注册任何工具**。
- `@hy-sde-org/dsh-tool-edit` 只注册一个 `edit` 工具，**不注册 `read`**。
- read 侧的 `snapshotTags` 只存在于 hy-sde 的 fork `hy-sde/deepseek-harness` 的 `packages/fs/tool-fs`，没有随 npm 插件发布。
- 因此 stock DSH 上 `hashline` 模式没有 tag 来源；直接装 `dsh-tool-edit` 时只有 `replace` / `patch` / `apply_patch` 可用。

本仓库只拥有 **read 集成层**；引擎和 edit 用上游 npm 包锁定版本。

## 3. 非目标

- 不 vendor / 不 fork `hashline`、`tool-edit` 的源码。
- 不维护 DSH fork。
- 不重新实现 edit 的补丁语言、block resolver、register、recovery。
- 不做 AST / LSP（先沿用上游 `tool-edit` 自带的可选 LSP）。

## 4. 架构决策

### D1：依赖上游，而不是复制

`packages/hashline` 和 `packages/tool-edit` 只是**版本锚点**：

- `packages/hashline` 重新导出 `@hy-sde-org/dsh-hashline`，让内部 import 只依赖本仓库的包名；
- `packages/tool-edit` 重新导出 `@hy-sde-org/dsh-tool-edit`，让 preset 只挂一个稳定的包名；
- 两者都不复制一行上游实现。

升级方式：改 `package.json` 的精确版本 → `pnpm install` → 跑 `tests/compat`。
不要用 `^`（上游仍在 alpha/rc）。

### D2：自建 `read`（v2 定案；装饰器路线已否决）

> **2026-10-22 审核结论**：本节的装饰器方案**不能实现目标**，仅作历史记录保留。
> 两条替换路径都不通：
> 1. 替换 `content` 可行，但 PTC 下程序只拿 `value`（`core/tools/src/ptc.ts:571-573`），模型看不到 tag；
> 2. 替换 `value` 会被 `createSuccessResult` 用 `tool.output.schema` **重校验**（`core/tools/src/index.ts:1840-1843`），
>    stock `read` 的 schema 是 `additionalProperties: false`（`tool-fs/src/read.ts:86-88`），多一个 `tag` 直接抛 `ToolOutputError`。
>
> 定案：`tool-fs.read: false` + `packages/tool-read` 注册完整 `read`（即原来的「备选方案」）。
> 权威口径见 `docs/spec/2026-10-22-ptc-hashline-需求规格.md` 的 FR-3 / FR-5 / FR-7 / FR-12。

~~不替换 `read` 工具，只在它返回后~~（已否决，以下为历史设计）：

- 对小于 `SNAPSHOT_MAX_BYTES`（4 MB）的文件，用 `ctx.fs` 读全文；
- 计算 4-hex tag；
- 把 tag 和“模型可见的行号”记进 `getSessionSnapshotStore(session)`；
- 在 `<content>` 换行之后插入一行 `[path#TAG]`；
- 返回 `{ kind: "accept", content: [...] }`。

~~这样 stock `read` 的窗口、截断、观测、卡片全部保留，不需要重写 read。~~ **这个前提只对非 PTC 会话成立；PTC 下模型拿不到 content，所以不成立。**

**定案方案（v2）**：
在 `tool-fs` 上配置 `read: false`，由 `packages/tool-read` 注册一个完整的 `read`。
代价是要自己实现窗口、footer、presentResult，约 400–600 行。

### D3：三包结构，但只有 `tool-read` 有代码

```text
dsh-tool-hashline/
  packages/
    hashline/      # 版本锚点：re-export @hy-sde-org/dsh-hashline
    tool-edit/     # 版本锚点：re-export @hy-sde-org/dsh-tool-edit
    tool-read/     # 唯一有实现的包：完整 read（mint / 窗口 / seen / 投影）
  tests/compat/
```

如果以后觉得两个锚点包多余，可以合并成一个 `tool-hashline` 包；三包不是硬性要求。

### D4：版本与补丁策略

- 精确版本（例如 `0.2.1-alpha.4`），不用 `^`；
- 每次升级先跑 `tests/compat`，再改日常 profile；
- 需要改上游行为时，优先用 pnpm `patchedDependencies` 打小 patch，不 fork：

```yaml
# pnpm-workspace.yaml
patchedDependencies:
  "@hy-sde-org/dsh-tool-edit@0.2.1-alpha.4": patches/dsh-tool-edit.patch
```

## 5. 关键事实（实现前必须知道）

| 事实 | 证据 |
|---|---|
| stock `read` 输出 `<path>…</path><type>file</type><content>N: text…</content>`，没有 tag | DSH `packages/fs/tool-fs/src/read-render.ts:152-169` |
| stock `tool-fs` 有 `read` / `readImage` / `write` / `edit` 独立开关 | DSH `packages/fs/tool-fs/src/index.ts:26-54` |
| `tools/post-execute` 可以替换 `content` **或** `value`，但两者不能同时；替换 `value` 会用 output schema 重校验（stock `read` 封闭，故无法注入 `tag`）；替换 `content` 对 PTC 无效 | DSH `packages/core/tools/src/index.ts:1789-1827`、`1840-1843` |
| 工具是 registry 终端条目，没有“包装已有工具”的公开接口 | DSH `packages/core/tools/src/index.ts:143-199` |
| hy-sde 的 `edit` 只注册 `edit` | `hy-sde/dsh-tool-edit` `packages/tool-edit/src/index.ts:344-345` |
| hy-sde 的 fork read 负责 mint tag | `hy-sde/deepseek-harness` `packages/fs/tool-fs/src/read.ts:262-306`、`read-render.ts:209-218` |
| 引擎的 store 是 per-session 共享的 | `packages/hashline/src/session-store.ts:31-50` |
| `edit` 的 snapshot 路径是 `path.resolve(cwd, filePath)` | `hy-sde/dsh-tool-edit` `packages/tool-edit/src/hashline/filesystem.ts:69-90` |
| tag = 4-hex、整篇 normalized 文本的 xxh32 低 16 位 | `packages/hashline/src/format.ts:110-133` |
| 缺 tag 会直接抛错；snapshot 不存在时 seen-line 检查会跳过 | `packages/hashline/src/patcher.ts:178-181`、`818-819` |
| `edit` 的 `replace` / `patch` 模式不依赖 hashline tag | `packages/tool-edit/src/index.ts:120-155` |

### 5.1 两个必须区分的路径

- **show path**：`read` 的 `value.path`（`ctx.fs.processPath(target)`，规范绝对路径）。
- **store key**：`tool-edit` 用 `path.resolve(cwd, filePath)`；自建 read 必须记录模型会使用的返回路径键，输入解析键不同时还记录该键，详见规格 FR-7。observed 的 realpath 身份不等于编辑侧路径键。

### 5.2 已知的失败模式（装饰器要避免）

- 缺 tag → `Missing hashline snapshot tag for …`，模型会反复 re-read；
- 编一个 tag → mismatch 报错会把真实 hash 告诉模型；第二次重试能写进去，但 snapshot 不存在，seen-line 守卫被跳过。

现行目标是让可 mint 文本的 read 带可用 tag；不 mint 与截断窗口均在 canonical value 返回 nextAction。seen 不作为严格权限边界。

## 6. 装饰器设计（⚠️ v2 起整体作废，仅作历史记录）

> 本节及 §6.1–6.6 描述的方案已被否决（见 D2）。保留它是为了记住「为什么不行」，
> 实施时**不要**照此实现；现行口径见 `docs/spec/2026-10-22-ptc-hashline-需求规格.md`。

### 6.1 触发条件

```ts
if (exec.name !== "read") return next()
if (result.isError) return next()
const value = result.value as ReadValue | undefined
if (value === undefined) return next()
```

`ReadValue` 的字段：`path: string`、`offset: number`、`lines: { number: number; text: string }[]`、`totalLines: number`。

### 6.2 铸造 tag

```ts
const target = await ctx.fs.resolve(value.path, { cwd })
const raw = await ctx.fs.readText(target, exec.signal)
const normalized = normalizeToLF(stripBom(raw).text)
const tag = computeFileHash(normalized)
const seen = value.lines.map(l => l.number)
const store = getSessionSnapshotStore(exec.agent?.session)
store.record(path.resolve(cwd, value.path), normalized, seen.length > 0 ? seen : [0])
```

规则：

- 只对 `normalized` 字节数小于 `SNAPSHOT_MAX_BYTES`（4 MB）的文件做；
- 空文件不 mint（`normalized.length === 0` 跳过）；
- 没有显示任何行时用 `[0]` 哨兵（表示“一行都没看过”），**不要**传空数组；空数组在引擎里是“不限制”。

### 6.3 插入 header

```ts
const marker = "<content>\n"
const at = text.indexOf(marker)
if (at < 0) return next()
const header = formatHashlineHeader(value.path, tag)
// 幂等：已经存在 [path#TAG] 就不重复插
const bodyStart = at + marker.length
if (text.startsWith(header, bodyStart)) return next()
const withHeader = text.slice(0, bodyStart) + header + "\n" + text.slice(bodyStart)
return { kind: "accept", content: [{ type: "text", text: withHeader }] }
```

注意：header 必须放在 `<content>` 里面，不能放到 `<path>` 前面；否则 `read` 的 `presentResult` 正则无法解析，Web 卡片会退化。

### 6.4 失败处理

- 任何异常都 `return next()`，绝不让装饰器阻断 `read`；
- 不属于文本 read（多个 content block、非 text）→ 跳过；
- 文件不存在 / 无权限 / 非 UTF-8 → 跳过。

### 6.5 配置（建议）

```ts
export interface Config {
  enabled?: boolean
  maxBytes?: number // 默认 SNAPSHOT_MAX_BYTES
}
```

### 6.6 边界与坑

- **列截断**：`read` 可能按 `readMaxLineLength` 截断单行。被截断的行不能算 seen；如果无法从 `value` 判断，先保守跳过（见 §11 未决问题）。
- **offset/limit**：部分读取也要 mint，`seen` 只记录窗口内的行；这正是 omp 的语义。
- **streamed / 超大文件**：不 mint，保持原输出。
- **CRLF / BOM**：先 `stripBom` 再 `normalizeToLF`，与 patcher 的 read 约定一致。
- **agentless**：`exec.agent` 可能为空；此时没法把 store 绑定到 session，跳过或让 `getSessionSnapshotStore(undefined)` 的 scratch store 只活一次。
- **双重 tag**：如果上游以后自己加了 read tag，装饰器要检测并让位，避免两行 header。

## 7. 目录说明

```text
.
├── HANDOFF.md                  # 本文档
├── README.md
├── package.json                # private workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── hashline/               # re-export 上游引擎
│   ├── tool-edit/              # re-export 上游 edit 插件
│   └── tool-read/              # 完整 read 实现（dist 入口）
│       ├── src/index.ts
│       └── tests/README.md     # 测试用例清单
└── tests/compat/               # 跨 DSH 版本的集成测试（待建）
```

## 8. 里程碑

> 本节保留早期规划记录；当前切分、范围与脚本接口仅以规格 v3 §8/§8.1 为准，本期不发布。

### M0 — 脚手架（本次）

- [x] 目录、workspace、包声明、preset 示例、HANDOFF
- [ ] `pnpm install` 能解析上游包（下个会话先做）

### M1 — 自建 read MVP（1–2 天）

- [ ] `mintTag` 纯函数 + 单测（含 BOM / CRLF / 4 MiB 闸门）
- [ ] 窗口逻辑（offset/limit/字节上限/footer）+ 单测
- [ ] 注册 `read`：value 带 tag、`fs/observed`、store.record（含 `[0]` 哨兵）
- [ ] 在一个临时 profile 里验证：read 输出带 tag，`edit` 首次成功

> 规格里的 M1–M4（`docs/spec/…-需求规格.md` §8）是权威切分，本节仅供粗粒度参考。

### M2 — 边界与集成测试（2–3 天）

- [ ] offset/limit、BOM、CRLF、空文件、超大文件
- [ ] 未见行拒绝、tag 过期恢复
- [ ] 与 `tool-edit` 的 store identity / canonical path 测试

### M3 — 打包与发布（1 天）

- [ ] `check` / `test` / `build` 三个 gate
- [ ] preset 文档、README 双语、LICENSE/THIRD-PARTY
- [ ] 版本矩阵：DSH 0.2.1-rc.2 + 后续 rc

## 9. 测试计划

> 以下为历史测试线索；当前验收以规格 v3 §8.1 为准。尤其不能把 post-execute 实验或直接 ToolRuntime 调用当成完整 PTC/profile 验收。

### 单元

- `computeFileHash` 与上游一致；
- `normalize`（BOM/CRLF）后 tag 稳定；
- header 插入位置正确、幂等；
- `[0]` 哨兵 vs 空数组的行为。

### 集成（参考 hy-sde 的 `packages/tool-edit/tests/hashline.spec.ts`）

挂载真实的 `SystemPrompt` + `ToolRuntime` + `AgentRegistry` + `LocalFileSystem` + `FsPolicy` + `tool-fs` + `tool-edit` + decorator：

1. `read` 小文件 → 输出包含 `[path#TAG]`；
2. 用该 tag + 行号 `edit` → 首次成功；
3. 用该 tag 但未显示的行 → 被拒绝；
4. 文件被外部修改 → tag mismatch，重读后恢复；
5. 4 MB 以上文件 → 不 mint，`edit` 仍可用 replace 模式；
6. 两次 `read` 同一内容 → 同一个 tag（read fusion）。

### 兼容矩阵

- DSH 0.2.1-rc.2（当前）；
- 下一个 rc / minor：只跑 `tests/compat`，不追全部单测。

## 10. 安装与验证

```powershell
cd D:\Project\source\__TEST__\dsh-plugins\dsh-tool-hashline
pnpm install
pnpm -r check
pnpm -r test
```

挂载（v2）：本仓库走 **bundle** 方式——profile 里 `link:` 本仓库 + `pnpm install` + 一次真正的重新挂载，
preset 由 `dsh.bundle.patch` 声明（见规格 §4）。v3 还要求构建 JS/类型入口、profile 可解析插件依赖、登记 `dsh.profile.bundles` 并重新挂载；仅安装 link 不会激活 bundle。preset 的 persona/watchdog 解析本 bundle。
~~把 `presets/agent.cordis.yml` 复制到 `~/.dsh/.agent-presets/dsh-tool-hashline/`~~ —— 0.2.0 起该目录不再被读取。

```powershell
dsh --profile <name> --dump-config   # 应看到 tool-read-hashline 与 tool-edit 行
```

验证脚本（手工）：让 agent 读 `src/main.ts` 第二行，然后 `edit` 它；观察第一次调用是否成功。

### 10.1 本机环境注意事项（2026-10-22 实测）

Windows + pnpm 11.28.5 + Node 24.19.0。踩过的六个坑已经固定在配置里，**不要随手改回去**：

- `.npmrc` 锁 `store-dir=.pnpm-store`：全局 store 在 C 盘，跨盘无法硬链接，pnpm 会中途回退并留下半链接的树。
- `pnpm-workspace.yaml` 的 `nodeLinker: hoisted`：本机没有符号链接权限，pnpm 退化成 junction，
  而 Node 的 ESM 解析器不跟随 junction（`fs.realpathSync` 返回逻辑路径），
  于是任何被链接包的传递依赖都报 `ERR_MODULE_NOT_FOUND`。
- `strictDepBuilds: false` + `ignoredBuiltDependencies: [esbuild]`：否则 `pnpm install` 以 exit 1 结束。
  pnpm 11 已不读 `package.json` 的 `pnpm` 字段，配置只认 `pnpm-workspace.yaml`。
- `packages/tool-read/tsconfig.json` 去掉了 `rootDir`/`outDir` 并设 `noEmit`：`check` 要同时类型检查
  `src` 与 `tests`，两者不在同一 rootDir 下。M3 做发布时再拆 build/check 两份配置。
- **沙箱内不能跑 `pnpm -r check/test`**：pnpm 执行 lifecycle 脚本要 spawn 子进程，vitest 的
  Vite 在 Windows 上还要 `exec('net use')` 探测网络盘，两者在 workspace-write 下一律 `EPERM`。
  在普通 shell 里跑，或临时放宽沙箱；`tsc` 本身可以直接调 `node_modules\.bin\tsc.cmd`。
- `@dsh-tool-hashline/*` 的 `main` 指向 `src/index.ts`，裸 `node` 会拒绝
  （`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）；单测里经 vitest 引用即可。

## 11. 风险 / 未决问题

1. ~~**`post-execute` 能否稳定替换 read 的 content？**~~ **已验证通过（2026-10-22，DSH 0.2.1-rc.2）。**
   见 `packages/tool-read/tests/post-execute.spec.ts`（5 个用例）。结论与两条实现约束：

   - 用 `{ kind: 'accept', content: [...] }` 替换 **content** 可行：`value` 与 `meta` 原样保留，
     `presentResult` 的信封正则仍匹配，read 卡片正常（卡片行号来自 `meta`，不受影响；
     header 只出现在卡片的纯文本 body 里）。
   - **不能用 `{ kind: 'accept', value: ... }` 作为注入点**：那条路径会重跑 `render()` 与
     `presentationMeta()`（`createSuccessResult`），header 会被重新渲染的正文冲掉。
     `PostToolDecision` 也禁止同时给 `value` 和 `content`。
   - **结论（2026-10-22 复核定案）：D2 装饰器路线否决，改为自建 `read`。** 替换 `value` 还会被
     `createSuccessResult` 按 `tool.output.schema` 重校验（`core/tools/src/index.ts:1840-1843`），stock `read`
     的 schema 是 `additionalProperties: false`（`tool-fs/src/read.ts:86-88`），注入 `tag` 必抛 `ToolOutputError`；
     而 `content` 注入在 PTC 下模型根本看不到（`ptc.ts:571-573` 只回 `value`）。权威口径见规格 FR-3。
   - `post-execute` 在 `render`/`presentationMeta` 之后、`finalizeContent` 之前运行
     （`core/tools/src/index.ts:1649-1666`），所以监听器看到的是已渲染的文本。
2. **列截断口径已定（v3）。** 自建 read 在窗口构建时保留完整性信息，只把完整返回行新增到 seen；截断窗口用 nextAction 引导配置重挂载或 replace/patch 显式降级。没有列分页，同配置重复读不会揭示后半段。
3. ~~**`ctx.fs.stat` 是否可用。**~~ **可用（`@deepseek-ai/dsh-fs` 0.2.1-rc.2）。** `ctx.fs.stat(target, signal)`
   返回 `Promise<FsInfo | undefined>`，`FsInfo.size` 可用于读前判断 4 MB 上限；
   `ctx.fs.readText(target, signal)` 直接返回 `string`（不是 `{text}`），先 `stripBom` 再 `normalizeToLF`。
   引擎侧常量已核对：`SNAPSHOT_MAX_BYTES = 4194304`（4 MiB），`formatHashlineHeader('/a/b.ts','A1B2')` → `[/a/b.ts#A1B2]`。
4. **上游 tool-edit 升级。** 它仍是 alpha；`getSessionSnapshotStore` / path 约定若变，read 侧的记录逻辑要跟。
5. ~~**上游以后自带 read tag。**~~ 自建 `read` 后此项已不适用；若上游 stock `read` 将来自带 tag，改回「装饰器让位」反而更省，届时再评估。
6. **双 read 提供者。** 如果用户同时装了 hyperion 或 fork，可能有两套 tag；文档要写明只启用一套。
7. **发布 scope。** 目前包名用 `@dsh-tool-hashline/*` 占位；发布前换成你的 npm scope。

## 12. 新会话第一小时

1. 读本文档 + 背景报告 §3.1 / §3.1.1。
2. `pnpm install`，确认 `@hy-sde-org/dsh-hashline` 与 `@hy-sde-org/dsh-tool-edit` 能解析。
3. 打开 `packages/tool-read/src/index.ts`，按规格 FR-3/FR-5/FR-7 实现 `read`：先写 mint 与窗口纯函数 + 单测。
4. 注册工具并接 `fs/observed`；照 hy-sde 的 `hashline.spec.ts` 确认 store identity（FR-8）。
5. 在临时 profile 做一次「read → edit」闭环；再验证 `[0]` 哨兵与并集语义。

> 不要再去验证 `tools/post-execute`：已证伪（D2）。

## 13. 参考

- 背景报告：`docs/background/2026-10-22-dsh-hashline-选型分析.md`
- hy-sde 引擎与 edit：<https://github.com/hy-sde/dsh-tool-edit>
- hy-sde fork（read 侧参考）：<https://github.com/hy-sde/deepseek-harness> `packages/fs/tool-fs/src/read.ts`
- DSH 工具管线：`D:\Project\source\__TEST__\deepseek-harness\packages\core\tools\src\index.ts`
- DSH stock read：`D:\Project\source\__TEST__\deepseek-harness\packages\fs\tool-fs\src\read-render.ts`
- omp 原版 prompt：`clones/oh-my-pi/crates/pi-edit/prompts/hashline.md`（工作区克隆）

---

**给下一个会话的提醒**：先读规格 v3，再按 M1 实现自建 read。FR-7 的完整行、[0]、并集、双路径键和有限守卫边界，FR-14 的工具名 edit，以及 §4.2 的独立 gate 资源最容易静默出错。实现与验收尚未完成；当前 stub 注释仍是被否决的历史方案，不能按其 TODO 开发。
