# 独立整合 ptc-gate

2026-10-22 用户确认：本仓库整合 ptc-gate 所需资源，不依赖 ptc-roles 原项目继续存在或安装在 profile 中。选择自行承接 gate 资源的维护成本，以获得独立部署能力；不整合五角色子代理。

迁入资源的基线为规格已锁定的 commit `3d8f36eb8def861c3f2aa7d5f7b4983d96c92341`。第二轮用户确认：只交付 ptc-hashline 一个 preset；首版保持 persona/watchdog 正文和行为，只修改资源地址，之后由本仓库独立演进。来源、摘要及契约测试保存在本仓库，验证不依赖原项目继续存在。

2026-10-27 后续演进说明：用户已确认[请求级意图门方案 B](../specs/2026-10-27-intent-gate-b-requirements.md)的需求与系统级测试 seam。独立交付原则不变；上述首版正文冻结针对原迁入基线，后续实现按新规格一并迁移 persona/watchdog、资源摘要与契约测试。新规格尚未实现或验收，不构成安装或目标切换授权。

2026-10-27 进度：票据 01 已按该规格迁移 persona/watchdog 与资源摘要基线（判据改为请求级暂存校验），见[票据 01 工程验收](../acceptance/2026-10-27-intent-gate-b-01-declare-before-publish.md)；票据 02 加上有界修复与成本责任边界，见[票据 02 工程验收](../acceptance/2026-10-27-intent-gate-b-02-bounded-repair.md)；票据 03 加上输入例外（整句精确比对，语义仍由 persona 承担），见[票据 03 工程验收](../acceptance/2026-10-27-intent-gate-b-03-input-exceptions.md)；票据 04 加上澄清等待（由宿主 `ask_user_question` 开启/结算）与回答路由，见[票据 04 工程验收](../acceptance/2026-10-27-intent-gate-b-04-clarification-wait.md)；票据 05 加上中途纠正优先（读宿主 steering 队列、扣下陈旧调用、内层派发拒绝），见[票据 05 工程验收](../acceptance/2026-10-27-intent-gate-b-05-steering-before-dispatch.md)；票据 06 把门的全部状态改为从会话事件日志推导（恢复/重载/压缩保留等待、预算与最新约束，不可信记录停下并说明），见[票据 06 工程验收](../acceptance/2026-10-27-intent-gate-b-06-log-derived-state.md)；票据 07 完成完整交付验收、逐条规格映射与客户端呈现边界穿透，见[票据 07 工程验收](../acceptance/2026-10-27-intent-gate-b-07-full-contract-evidence.md)。真实模型效果（IGB-AC-12）、压缩实跑与浏览器截图仍为 GAP；日常 profile 未切换。
