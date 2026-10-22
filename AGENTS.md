# AGENTS.md — dsh-tool-hashline

本仓库是 **脚手架**，不是可用插件。

## 入口

1. 先读 [`docs/spec/2026-10-22-ptc-hashline-需求规格.md`](./docs/spec/2026-10-22-ptc-hashline-需求规格.md)（**v3 已落实两轮用户决议，实施以它为准**）。它是 FR/NFR/决议/证据索引的权威来源。
2. 再读 [`HANDOFF.md`](./HANDOFF.md)（背景与历史决策；其中 D2 装饰器路线已被否决，见其正文标注）。
3. 术语在 [`GLOSSARY.md`](./GLOSSARY.md)——`seen 行` 与 `observed` 是两套机制，别混用。
4. 背景与选型证据在 [`docs/background/2026-10-22-dsh-hashline-选型分析.md`](./docs/background/2026-10-22-dsh-hashline-选型分析.md)。

## 当前状态

- `packages/hashline`、`packages/tool-edit` 只是上游 npm 包的版本锚点，没有实现；
- `packages/tool-read/src/index.ts` 是 stub，目标是**注册一个完整的 `read`**（不接 `tools/post-execute`，原因见规格 FR-3）；
- 先不要发布，也不要把它挂进日常 profile。
- 只交付 `ptc-hashline` 一个 preset；首版将锁定基线的 ptc-gate persona/watchdog 原样迁入本 bundle、改资源地址，独立部署不依赖 ptc-roles 原项目。

## 硬约束

- 不复制 / 不 fork `@hy-sde-org/dsh-hashline` 与 `@hy-sde-org/dsh-tool-edit` 的源码；用精确版本依赖。
- 不 fork DSH。read 侧**自建**：`tool-fs.read: false` + `packages/tool-read` 注册完整 `read`。
  装饰器路线已证伪——替换 `content` 对 PTC 无效（程序只拿 `value`），替换 `value` 会被 `createSuccessResult` 按 output schema 重校验（`core/tools/src/index.ts:1840-1843`），而 stock `read` 的 schema 是 `additionalProperties: false`。
- `hashline` 和 `tool-edit` 的版本升级必须跑 `tests/compat` 后再改日常 profile。
- 第一个实现任务是规格的 M1：`tool-read` 的 mint / 窗口 / seen 逻辑 + 单测。不要再花时间验证 `tools/post-execute`——该项已验证并否决，证据见规格 §10 与 HANDOFF §11。
- 编辑工具必须仍叫 `edit`：意图门 watchdog 的 `BEHAVIOR_TOOLS` 按名字匹配，改名会让门对编辑静默失效（规格 FR-14）。
- seen 采用上游有限守卫；read 仅新增完整返回行，零完整行用 `[0]`。recovery、REM/block、快照淘汰和错误回显有明确边界，见 FR-7；不要将它描述为全部未见内容的权限边界。

## 常用命令

```powershell
pnpm install
pnpm -r check
pnpm -r test
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
