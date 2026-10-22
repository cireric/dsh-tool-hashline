# 05: read 提示与卡片在回放后仍可用

**What to build:** 非 PTC 会话能获得 scope 正确的 read 提示，实时和回放卡片显示路径、行号、语言和 footer；tag 与已有 nextAction 在纯文本投影中仍可读。

**Blocked by:** 01 — 普通文本 read→edit 首次成功。

**Status:** done (2026-10-23)

**Spec:** [权威规格入口](../spec.md)；FR-4/12、NFR-5。

- [x] 注册 stock tool:read 系统提示及对应顺序；只在当前 scope 可见 read 时提供文字，不因其他 scope 的工具状态误显。
- [x] presentationMeta 保存 path、offset、lines、totalLines，并保留可识别的 lang；持久化数据可在回放中重建 read 卡片。
- [x] presentResult 返回 card=read；tagged=true 的 header 位于 content 内首行，tagged=false 不渲染假 header；已有非空 nextAction 同时在正文可见。
- [x] 实时及回放卡片行号、窗口范围、footer 与 canonical value 一致；空窗口和带补救指引的 value 夹具亦能投影。
- [x] malformed meta、缺失 meta、无法匹配的信封及错误结果按 stock 行为降级，不在回放中抛异常。
- [x] 禁用 read 后提示消失；删掉提示段的阴性对照也能检出提示缺失。以真实 ToolRuntime/系统提示集成验证，不只断言静态字符串。
- [x] 投影、卡片与回放验证纳入 test:integration；后续组合后的真实受限/降级窗口由最终验收共同覆盖，不要求本票等待 02/03 的业务实现。
## Comments

- 2026-10-23 实现完成。新增 `src/lang.ts`（镜像宿主语言表，115 个后缀），`presentationMeta` 持久化 `path/offset/lines/totalLines/lang`，`presentResult` 透传 `lang`；提示段在工具注册之后登记，禁用时不再产出。
- 证据：`pnpm test:unit` 42 passed（新增 `tests/unit/lang.spec.ts`：逐个后缀与宿主 `readLangHintForPath` 对齐，含大小写/双分隔符/dotfile/prototype 安全）；`pnpm test:integration` 43 passed（新增 `tests/integration/presentation.spec.ts` 6 例）。
- 覆盖：真实 `ctx.systemPrompt.assemble()` 中存在 `tool:read` 文案，`enabled:false` 时该段为空且 `read` 未注册（阴性对照）；`meta` 与 canonical value 一致且带 `lang:'ts'`；live 与 JSON 回放投影完全相等（`tsx`）；tagged=false 正文无假 header 且含 replace/patch 指引；空窗口投影不抛错；malformed/missing meta、非信封文本、错误结果与语义非法窗口（line 1 < offset 2）一律降级 `undefined`。
- 说明：语言表以镜像而非运行时导入宿主 `@deepseek-ai/dsh-util-code-language` 实现（NFR-4），漂移由单测强制失败暴露。
