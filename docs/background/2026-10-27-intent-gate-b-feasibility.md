# 方案 B：请求级意图声明与执行前校验的可行性

日期：2026-10-27。状态：核心链路离线验证通过，产品交付与效果未验收。本文承接[机制研究与方案比较](2026-10-27-intent-gate-effectiveness-and-options.md)，不替代现行规格。

后续文档状态：用户已完成需求访谈、确认共同理解及系统级测试 seam，权威需求已迁入[正式规格](../specs/2026-10-27-intent-gate-b-requirements.md)；[原评审稿入口](../evidence/README.md#本地原始证据 "本地归档原件：.scratch/intent-gate/2026-10-27-b-requirements-draft.md")保留迁移和历史快照位置，具体技术参数留工程评审。本报告保留可行性调查时的证据范围，不将规格发布视为实现或效果通过。

## 结论

**在当前实际安装的 DSH `0.2.1-rc.2` 上，方案 B 的核心链路可通过官方插件扩展点组合实现，无需复制、fork 或修改宿主。** 已验证在工具程序执行前暂存模型输出、缺声明时丢弃旧调用、记录纠正上下文并有限重生成；无工具答案同样可覆盖。

这不是现成的“成功输出校验后重试”接口。候选实现需要组合 `llm/stream`、`agent/request-error` 与公开 Session 追加接口，用专属策略失败终态触发重生成。该组合的工程代价、失败分类和其他插件兼容性必须纳入需求，不应只更换现有门的工具名判断。

结论分级：核心机制可行 **PASS**；真实 launcher/完整 preset 组合、跨生命周期、流式体验与 provider 兼容 **GAP**；最终理解正确率与任务收益 **GAP**。方案 B 是已选择的研究方向，具体行为尚未定稿，未获得产品实施或目标切换授权。

需求草稿保存在 [本地草稿](../evidence/README.md#本地原始证据 "本地归档原件：.scratch/intent-gate/2026-10-27-b-requirements-draft.md")，被 Git 忽略、不随 clone 交付。草稿用于下一轮对齐，尚不迁入 `docs/specs/`。

## 调查范围与身份

本轮新增的是当前安装产物的接口/时序核验和真实 AgentLoop 离线探针。上一轮只证明 watchdog 识别规则，本轮不重复声明历史会话复验，不把上轮 PTC 编辑失败改写为通过。

实际解析的 `dsh-agent-loop`、`dsh-agent`、`dsh-llm`、`dsh-tools`、`dsh-agent-loop-testkit` 均为 `0.2.1-rc.2`，realpath 位于本仓库 `node_modules`。版本、入口摘要、命令、退出码及逐场景结果见[证据摘要 JSON](../acceptance/README.md#历史原件 "归档原件：docs/evidence/2026-10-27-intent-gate-b-feasibility.json")。没有使用上游最新版本代替锁定组合，也没有构建宿主、联网或调用真实模型。

## 扩展点是否够用

以下行号对应证据摘要锁定的本机安装产物，不是跨版本恒定位置。

| 接口 | 当前源码产生点 | 能力与限制 |
|---|---|---|
| `llm/stream` | `dsh-llm/lib/types/index.d.ts:34–45`；`lib/index.js:2393–2397` | 官方 waterfall，可包装和暂存下游流；向 loop 交付前检查。loop 生成的请求深冻结，不能暗改请求内容 |
| `agent/pre-step` | `dsh-agent/lib/types/runtime-types.d.ts:296–310` | 生成前识别用户输入、维护请求状态并注入提醒；看不到尚未生成的输出 |
| `agent/request-error` | 同文件 `:334–356`；loop `lib/index.js:1136–1147` | 错误 finish 后允许返回 retry；没有针对成功输出的不合格重试专用语义 |
| Session `append` / `deriveMessages` | `dsh-session/lib/types/index.d.ts:277`；loop `lib/index.js:1274–1281` | 纠正 notice 正式入日志与 surface 后，下一次请求能重建它；不偷改冻结请求 |
| `agent/assistant-stream` / `session/event` | agent runtime-types `:358–368`；现有 watchdog | 观察或发布入口，不能可靠撤回已经显示/提交的内容 |
| `tools/pre-execute` | `dsh-tools/lib/types/index.d.ts:47` | 检查外层 run_code 可阻止程序启动；不能覆盖纯答案，也不能撤回已展示文字 |
| `agent/turn-stopping` | agent runtime-types `:370–392` | 能在纯答后 steer 再生成一步；检查时答案已生成，不满足先检查再展示 |

`dsh-agent-loop/lib/index.js:1079–1093` 消费 stream；`:1156–1169` 先提交助手消息，再筛选并执行 tool-call。故在官方 stream waterfall 暂存尚未交付的全部内容，可以在整段工具程序派发前校验，且与所调用的 shell/read/edit 名称无关。

本轮修复候选的链路是：

```text
真实用户请求 → 模型生成 → stream wrapper 暂存
  合格：原样放行 → loop 提交消息 → 派发工具或结束纯答
  缺声明：原内容/旧调用不放行 → 策略失败 finish
      → 正式追加纠正 notice → request-error 返回 retry
      → 从日志重建请求 → 模型重新生成 → 再次校验
```

直接在 wrapper 抛异常不会进入上述重试接口。`agent.inject` / `steer` 也不能替代同一步内部重试的正式追加，因为 inbox 到下一次 pre-step 才消费；这些区别由源码及探针中的重试请求内容断言确认。

## 离线探针结果

命令：`node .scratch/intent-gate/intent-b-feasibility-probe.mjs`。最终退出码 **0**；6 场景 PASS。由已安装的官方 testkit 挂真实 AgentLoop、ToolRuntime 和工作目录契约，PTC 使用仓库的进程内测试 carrier，适配器只返回固定 chunks。marker 是内存计数工具，未启动真实 shell 或编辑业务文件。

| 场景 | 观察到的行为 | 证明范围 |
|---|---|---|
| valid-tool | 声明跨 chunks 拆分仍放行；一次 run_code 内两次 marker 执行，后续收尾不重复要求声明 | 正常派发与同请求续步；fixture replayState 保留 |
| repair-tool | 首次旧程序 0 tool/call，纠正入日志后重新生成；仅新程序执行两次 marker | 整段程序执行前拦截，不在内层派发时中断 |
| repair-text | 首次纯答没有成为助手消息/正文流；第二次纯答放行，无工具 | 无工具路径也可修复 |
| repair-exhausted | 一次修复后仍不合格，2 请求后终止，0 tool/call | 在当前孤立组合下有界失败；没有无限重试 |
| cancel-buffer | 缓冲中取消，0 tool/call、0 marker，无额外修复 | 仅证明此取消时点不派发；取消计费与完整生命周期未证明 |
| second-user-request | 同会话第二个真实用户回合重新要求声明；前轮合格不能免除第二轮检查 | 两个独立用户回合；不等于同 turn steering/合并输入覆盖 |

探针还断言：纠正文本出现在重建后的冻结请求中；不合格内容不成为 `assistant/message`，也不经 `agent/assistant-stream` 发布为正文；非取消场景每次请求的 fixture usage 都交付，包括被拒 attempt。原始正常 provider finish 和被拒 blocks 仅留本地证据，不转挂到新答案。

该探针采用固定前缀判据，只验证接口位置与流程，不验证具象化理解质量。探针、原始输出和安装身份留在 `.scratch/intent-gate/`；正式 JSON 保存脚本 SHA-256 与脱敏摘要。这些本地材料不随 clone 交付，缺失时不能宣称已重跑。

## 尚未跨过的工程限制

1. **没有策略重试专用终态。** `LlmFailure.code` 接受 string，但接口说明以 provider/transport 失败为背景。候选专属 code 必须明确是插件校验拒绝，不得伪报 provider、网络或模型服务失败。是否接受这种组合还是申请上游专用接口，需对齐。
2. **重试插件可能放大预算。** 探针没有挂真实 launcher 的全部重试/压缩/计费插件。耗尽时不能把专属错误简单交回通用重试，须按实际 waterfall 顺序验证“最多一次修复”等策略确实成立。
3. **全量缓冲增加等待。** 当前探针缓存首请求整次输出，包含长推理与工具参数，合格后集中交付。显示首字时间推迟，loop 重打时间戳也使旧 TTFT 读数变化。正式方案应区分 provider 生成、校验与用户可见时间，缓存大小、时间上限和是否改用仅缓冲首行均待定。
4. **取消的成本未闭合。** 探针取消后没有向 loop 放行已缓存 usage，不能把它记作 0 Token/0 费用；应保留已知成本或明确 unknown。provider error、超时、max-tokens 与半成品内容必须保留原始语义，不应一律归类为缺声明。
5. **审计有两份事实。** provider 已正常返回，插件因声明不合格暂不接受。需保留原终态/usage 与插件判定，区分原始输出和正式对话；不能删除已消耗的成本，也不能让被拒调用生成假的工具结果。
6. **会话归属还需实现。** `llm/stream` 也服务辅助调用。应以真实 loop 身份、受管 agent/session 与输入来源限定范围；不能凭 provider/model 全局处理。子代理、非目标 preset、compaction、session-title、并发与恢复都需独立验证。
7. **用户输入不总等于 turn。** 活跃期间 steering 可能在同一 turn 增加真实用户输入。请求应结合真实用户消息身份判定，机器 notice 不应重置，用户修正不应被旧声明覆盖。探针目前只验证分开两轮，不解决全部输入合并规则。
8. **持久化与展示不等于人类确认。** 可在 loop 正式展示前暂存，但未测试浏览器、CLI、telemetry 是否有其他上游旁路展示。默认继续执行也不提供用户行动前纠偏窗口；需另定关键歧义如何等待。

## 需求草稿应如何收敛

建议将目标行为与实现选择分开：用户要的是及时、具体、可修正的理解，不是必须采用合成 LLM 错误码。草稿将请求范围、声明内容、先校验后派发、有界修复、成本保真与独立授权列为候选需求；具体标记、例外、缓冲模式和失败 UI 列为待对齐项。

主推候选为本地插件组合，若完整宿主验证显示失败分类/重试无法可靠隔离，再评估上游新增成功输出校验扩展点。纯外层工具拒绝只算缩减覆盖的备选，不能静默替代方案 B。

现行[基础规格 FR-1 与非目标](../specs/2026-10-22-ptc-hashline-requirements-spec.md)、[ADR-0002](../adr/0002-own-ptc-gate-assets.md)保持有效。选定实施后才修订基线、摘要检查与验收；本轮不改 persona/watchdog、不安装、不重启、不切换目标，不恢复已收尾的付费评测。

## 本轮验证记录

- PASS：官方接口与实际解析身份核验；最终离线探针 6 场景，命令退出码 0。证据见上述 JSON。
- GAP：真实 launcher/完整 preset/真实 PTC 进程后端、provider 与 UI、通用重试组合、取消成本、同轮 steering/并发/恢复/压缩/子代理、语义效果与真实费用。
- 未执行：产品实现、正式交付门禁、真实模型效果试验与日常目标切换。

本轮文档、摘要和本地需求草稿的链接与最终 Diff 检查另行执行，不将可行性探针扩大为产品验收。
