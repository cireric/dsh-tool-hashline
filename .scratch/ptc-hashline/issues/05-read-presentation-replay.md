# 05: read 提示与卡片在回放后仍可用

**What to build:** 非 PTC 会话能获得 scope 正确的 read 提示，实时和回放卡片显示路径、行号、语言和 footer；tag 与已有 nextAction 在纯文本投影中仍可读。

**Blocked by:** 01 — 普通文本 read→edit 首次成功。

**Status:** ready-for-agent

**Spec:** [权威规格入口](../spec.md)；FR-4/12、NFR-5。

- [ ] 注册 stock tool:read 系统提示及对应顺序；只在当前 scope 可见 read 时提供文字，不因其他 scope 的工具状态误显。
- [ ] presentationMeta 保存 path、offset、lines、totalLines，并保留可识别的 lang；持久化数据可在回放中重建 read 卡片。
- [ ] presentResult 返回 card=read；tagged=true 的 header 位于 content 内首行，tagged=false 不渲染假 header；已有非空 nextAction 同时在正文可见。
- [ ] 实时及回放卡片行号、窗口范围、footer 与 canonical value 一致；空窗口和带补救指引的 value 夹具亦能投影。
- [ ] malformed meta、缺失 meta、无法匹配的信封及错误结果按 stock 行为降级，不在回放中抛异常。
- [ ] 禁用 read 后提示消失；删掉提示段的阴性对照也能检出提示缺失。以真实 ToolRuntime/系统提示集成验证，不只断言静态字符串。
- [ ] 投影、卡片与回放验证纳入 test:integration；后续组合后的真实受限/降级窗口由最终验收共同覆盖，不要求本票等待 02/03 的业务实现。
