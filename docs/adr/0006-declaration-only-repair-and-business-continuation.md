# ADR-0006：声明专用修复与同请求业务续步

> 2026-10-28 用户最新确认取代下文的格式硬门与自动修复决定：保留六桶和 Intent 对话规范，每次真实用户输入（包括澄清答案、追问、纠正与继续）后的回复都重新声明当前理解，同轮内部工具步骤不重复；缺少/错误句首不扣留回复、不生成 Failed、不自动补声明或续轮。关键歧义先分析调查，再正常提问并等待用户；用户回答后更新 Intent 并继续。保留独立的工具权限、问题等待与 steering 执行检查。下文自动修复/先校验后展示章节仅作历史记录，不能用来恢复旧行为。

日期：2026-10-28
状态：已接受（用户选择修复方案 B）；**2026-10-28 经联合修复计划 P0 复核后修订**（见文末「修订」一节：修复形态不变，请求层呈现要求仍未满足，澄清等待改为按问题身份判定）

## 背景

请求级意图门把「唯一一次自动修复」实现为同一步内的重试：`agent/request-error` 返回 `{kind:'retry'}`，循环用会话日志重建请求再生成一次。实测的失败链是 missing-marker → repair 1/1 → **no-text** → exhausted：修复请求仍被指供全部工具，模型于是又交出一次只含工具调用的回复，机械检查看不到正文，请求在没有工作时停下。取证见 `.scratch/intent-gate/forensics-2026-10-28/report.md`（本地材料）。

## 决定

1. 唯一一次修复是**声明专用生成**，不是重试同一回复。它由同一受管主 agent 完成、经公开 `agent.followup`（driver 空闲后）作为一个新 turn 打开，且该步的请求**不提供任何工具**。
2. 工具目录只能在 `system-prompt/assemble` 上改：工具 schema 每步只在 pre-step 组装一次，同一 step 内的重试复用这份 assembly，而 `agent/request` 的 `LlmCallConfig` 不含 tools（`@deepseek-ai/dsh-llm` call-config.ts）。因此「去掉工具」必须伴随「换一个 step」。
3. 声明专用阶段的输出约定：首行 `Intent:` + 非空正文，正文不超过 `maxDeclarationChars`（默认 2000，随 preset 声明并被 `check:preset` 钉住）。正文上限是对产物的上限，**不**改 provider 的生成上限：截断仍按 provider 原始终态处理（IG-B-10）。
4. 声明合格后先提交并发布，再由**同一请求**续步：在 `agent/turn-stopping` 上 `agent.steer` 一条续步提示（循环文档化的「让 turn 继续」入口），下一步 pre-step 领取它，于是业务生成拿回完整工具目录且不重复声明。不能在 `session/event` 里注入：追加期间再追加会被宿主拒绝（实测 "session append cannot reenter while another append is being published"）。
5. 修复失败即协议暂停：预算保持已用、零发布、零派发、无第三次生成。已知限制：被扣下的首次尝试以策略失败结束，用户会看到一次失败提示后收到声明与工作；这是「先扣下、再修复」的代价，记录在验收文件中。

## 后果

- 修复成本从「一次额外完整生成」变为「一次仅声明的生成 + 一次业务生成」，正常首次合格路径不变（R01）。
- 两条插件消息（修复提示、续步提示）由同一 producer 发出，靠固定前缀区分；派生预算只把修复提示计入，因此新增通知不会悄悄花掉预算。
- 崩溃/重启无法自动续步：声明已在记录里、工作未执行时按保守状态停下，不重放、不二次发布。该缺口在验收文件中记为 GAP，而不是被解释为通过。
- 需要重新对齐时先改本 ADR 与规格 IG-B-05/06/07/17/18，再改实现；不允许以「更小的产物」静默替代。

## 备选与否决

- **同一步重试但撤销工具**：接口不支持（见决定 2），除非 fork 宿主或改冻结请求，两者都被禁止。
- **保留工具 + 派发前拒绝**：功能上零执行，但模型仍会把唯一一次修复花在工具调用上，正是被修复的缺陷。
- **在 hook 里递归请求模型**：绕过生命周期、取消、成本与恢复契约。
- **伪造用户「继续」**：伪装真实输入，禁止。

## 修订 2026-10-28（联合修复计划 P0：恢复路线复核与澄清等待）

依据：[意图门修复实施计划](../plans/2026-10-28-intent-gate-repair-implementation-plan.md) P0/P2、[工具路径修复计划](../plans/2026-10-28-ptc-hashline-tool-routing-repair-plan.md)、规格 IG-B-05/14/16/19/20、[本轮工程验收](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-28-joint-repair-engineering.md")。

### 1. 「首次失配先显示一次失败」这一代价：复核结论是仍然存在，而且是接口缺口

原决定第 5 条把「被扣下的首次尝试以策略失败结束，用户会看到一次失败提示」记为已接受的代价。P0 要求重新对齐，复核结果如下（宿主 checkout 0.2.1-rc.2 @ 687f282，只读源码 + 本地探针）：

| 候选路线 | 复核结果 | 依据 |
|---|---|---|
| A. 同 turn 内正式进入新 step（工具目录可在同 turn 重建） | **技术上不可用**：一次「非 error」结束必然把本次生成提交为 `assistant/message`（空正文也不例外），而 error/aborted 结束才以 `assistant/attempt` 记下这次尝试；后者是终态，唯一的非终态出口是 `agent/request-error` 返回 `retry`，而重试复用同一步已组装的工具。因此「扣下这一次 + 同 turn 换一个 step」只能靠伪造一条空 `assistant/message`（计划明确禁止，且会在模型历史里留下一条空助手消息） | `packages/core/agent-loop/src/agent.ts:506-527`（error/aborted → `assistant/attempt` → `agent/request-error` → 非 retry 即 throw）、`agent.ts:529-550`（非 error 一律 append `assistant/message`，然后 `toolCalls.length === 0 → completed`）、`agent.ts:315-367`（step 与 preStep 的关系：新 step 只在完成一步后由 steering 打开，assemble 每 step 一次）、`packages/llm/llm/src/call-config.ts`（`LlmCallConfig` 无 tools） |
| B. 请求层聚合多个真实 turn，并把失败呈现为「恢复中」 | **需要 Client 面呈现**：用户看到的文案在客户端平面（`packages/client/ui-chat/src/client/locale.ts` 的 `message.turnError`）。DSH 有公开的「已安装 Client 模块 / Plugin Manager」扩展点，因此*原则上*可以不改宿主本体地加一个呈现插件；但本仓库当前没有 Client 面资产，本轮环境也无法运行浏览器或真实宿主来证明它 | 同上 locale 锚点；`packages/extensions/README.md`（Client 模块由 Plugin Manager 安装，process-local 定义不持久） |
| C. 两条都不满足 | **本项按 C 处理**：请求层呈现要求（IG-B-05/IG-B-20、FIX-08、IGB-AC-18）记为 BLOCKED，缺口是「一个 Client 面恢复状态插件 + 真实 UI 穿透验证」，两项都不在本轮可验证范围内 | 见本轮验收第 4、7 节 |

仍然不变的部分：修复形态（声明专用生成 + 同请求续步）、预算、成本与恢复契约都不因此改变；被扣下的尝试照旧零发布、零派发。**不允许**为了「看起来没有失败」去隐藏错误码、删历史失败、伪造助手正文或伪造用户输入。

### 2. 澄清等待：从会话级布尔值改为按问题身份与所属请求判定

原实现的缺陷（本轮修复前实测）：等待只有一个会话级布尔值，且在任何真实用户输入造成的 pre-step 上被无条件清空，因此「问题 q1 未结算 + 用户只说『继续』+ 回复带合格 Intent 和工具调用」会通过；同时外层 `tool/result` 事件并不携带工具名，等待实际上从未被问题自己的结果结算过。

决定：

1. 等待按**问题身份**记录：外层 `tool/call` 的 `callId`、PTC 内层 `tool/ptc-dispatch-start` 的 `subCallId`（以及它的 `rootCallId`）。结算只认同一身份：`tool/result` 的 `message.toolCallId`、`tool/ptc-dispatch` 的 `subCallId`、或宿主 `user-question-reply` 消息的 `source.callId`。错 id、陈旧结果、另一个工具的结算都不解锁。
2. 等待**属于提问的那个请求**：每个实质用户输入开一个新请求；裸致谢/裸继续属于当前请求（不是新请求），因此问题待答时它们既不豁免声明、也不解锁动作；独立的新请求可以推进，旧问题仍留在记录上，稍后由它自己的答案结算。
3. 一切都从会话日志推导，重载/恢复后同样成立；旧记录里的会话级布尔值仍按「仍在等待」读取，不会被解释成解锁。

### 3. 提问与业务动作分开（IG-B-19）

只承载 `tools.ask_user_question` 的 `run_code` 程序是允许的；该程序拿到答案后，同一 `run_code` 根调用内的后续业务派发在 `tools/pre-execute` 被拒绝（依据是该问题自己的 `tool/ptc-dispatch` 结算事件与它的 `rootCallId`）。依赖答案的工作必须由处理答案之后的新生成发起。这不是文件系统隔离：原生 `fs`/`child_process` 旁路仍属已知边界。
