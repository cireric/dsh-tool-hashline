# AGENTS.md — dsh-tool-hashline

本仓库是一个**可构建、可安装的 bundle**（尚未发布、未接入日常 profile）。

## 入口

1. 先读 [`docs/spec/2026-10-22-ptc-hashline-requirements-spec.md`](./docs/spec/2026-10-22-ptc-hashline-requirements-spec.md)（**v3 已落实两轮用户决议，实施以它为准**）。它是 FR/NFR/决议/证据索引的权威来源。
2. 再读 [`HANDOFF.md`](./HANDOFF.md)（背景与历史决策；其中 D2 装饰器路线已被否决，见其正文标注）。
3. 术语在 [`GLOSSARY.md`](./GLOSSARY.md)——`seen 行` 与 `observed` 是两套机制，别混用。
4. 背景与选型证据在 [`docs/background/2026-10-22-dsh-hashline-selection-analysis.md`](./docs/background/2026-10-22-dsh-hashline-selection-analysis.md)。

## 当前状态

- `packages/tool-read` 已是完整实现（mint / 窗口 / seen / 卡片 / 提示），入口为 `dist/index.js`；
  `packages/hashline`、`packages/tool-edit` 仍是版本锚点。
- 根包是 bundle：`dsh.bundle.patch` 指向 `presets/ptc-hashline/preset.patch.yml`；preset 自带
  persona 与 watchdog 资产，摘要由 `check:preset` 校验。
- 交付命令：`pnpm build`、`pnpm check`、`pnpm test:unit`、`pnpm test:integration`、
  `pnpm test:ptc`、`pnpm test:compat`、`pnpm check:preset`、`pnpm test:profile`。
- 仍不发布、不挂日常 profile；验收口径见 `docs/acceptance/2026-10-23-acceptance-traceability.md`，
  运行修复（D1 目录 / D2 persona）的实测见 `docs/acceptance/2026-10-23-runtime-fix-acceptance.md`，
  MV 写入意图与快照次序的实测见 `docs/acceptance/2026-10-23-mv-observation-acceptance.md`。
- 真实策略回归：集成夹具默认挂载 `fs-observation-policy`（`createRealSessionHarness`），
  MV/REM 矩阵在 `packages/tool-read/tests/integration/mv-observation.spec.ts`（41 例，含 PATH、BYTES/BOM-01..14、
  PART-R1、SNAP-R3 与工具文案契约），引擎 commit 次序在 `tests/compat/mv-snapshot-order.spec.ts`（6 例），
  PTC 层在 `tests/ptc/mv-policy.spec.ts`（5 例，含 SNAP-R3）与 `tests/ptc/ptc.spec.ts`
  （含"编辑工具说明进入 PTC SDK"的 D3 断言）；
  `test:profile` 断言两份补丁在解析产物中生效，并跑 read→PUT→read→MV→read→REM，外加 BOM+CRLF 的 PUT/MV
  字节复查与无 BOM 对照。BOM 的支持范围与受限输入见
  [新验收记录](./docs/acceptance/2026-10-23-bom-and-snapshot-repair-acceptance.md)。

## 硬约束

- 不复制 / 不 fork `@hy-sde-org/dsh-hashline` 与 `@hy-sde-org/dsh-tool-edit` 的源码；用精确版本依赖。
  两个包都通过 `pnpm patchedDependencies` 打本地补丁：
  - `dsh-tool-edit`：有效工作目录 + MV 两端包含关系（[ADR-0003](./docs/adr/0003-effective-working-directory.md)）
    + MV 目标走 `fs/write-intent`/`createIfAbsent`、部分成功报错与多节"已写/未写"包装
      （[ADR-0004](./docs/adr/0004-mv-create-intent-and-snapshot-order.md)）
    + hashline 适配器专用保 BOM 读取（[ADR-0005](./docs/adr/0005-bom-preserving-hashline-read.md)）
    + 工具说明里的 MV DEST 基准与"非整次调用原子"表述；
  - `dsh-hashline`：`Patcher.commit` 先移动磁盘、再迁移快照（[ADR-0004](./docs/adr/0004-mv-create-intent-and-snapshot-order.md)），
    且 `SnapshotCommitError` 只陈述两端都成立的失败事实。
  升级时先看上游是否已修好，再决定删/重做补丁；不得只改 `node_modules`。
- 不 fork DSH。read 侧**自建**：`tool-fs.read: false` + `packages/tool-read` 注册完整 `read`。
  装饰器路线已证伪——替换 `content` 对 PTC 无效（程序只拿 `value`），替换 `value` 会被 `createSuccessResult` 按 output schema 重校验（`core/tools/src/index.ts:1840-1843`），而 stock `read` 的 schema 是 `additionalProperties: false`。
- `hashline` 和 `tool-edit` 的版本升级必须跑 `tests/compat` 后再改日常 profile。
- 第一个实现任务是规格的 M1：`tool-read` 的 mint / 窗口 / seen 逻辑 + 单测。不要再花时间验证 `tools/post-execute`——该项已验证并否决，证据见规格 §10 与 HANDOFF §11。
- 编辑工具必须仍叫 `edit`：意图门 watchdog 的 `BEHAVIOR_TOOLS` 按名字匹配，改名会让门对编辑静默失效（规格 FR-14）。
- seen 采用上游有限守卫；read 仅新增完整返回行，零完整行用 `[0]`。recovery、REM/block、快照淘汰和错误回显有明确边界，见 FR-7；不要将它描述为全部未见内容的权限边界。

## 常用命令

```powershell
pnpm install
pnpm check
pnpm test:unit; pnpm test:integration; pnpm test:ptc; pnpm test:compat
pnpm check:preset
pnpm test:profile
```

## 参考

- DSH 工具管线：`D:\Project\source\__TEST__\deepseek-harness\packages\core\tools\src\index.ts`
- DSH stock read：`D:\Project\source\__TEST__\deepseek-harness\packages\fs\tool-fs\src\read-render.ts`
- hy-sde fork read（参考实现）：`https://github.com/hy-sde/deepseek-harness` → `packages/fs/tool-fs/src/read.ts`

## Agent skills

### Issue tracker

Issues live as local markdown under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map 1:1 to labels of the same name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
