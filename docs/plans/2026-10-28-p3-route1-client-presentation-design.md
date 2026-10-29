# P3 路线 1 历史设计（已停止）

> 文档状态（2026-10-28）：路线 1 曾获选并实现规则核心，浏览器未完成；随后用户取消格式硬门与自动修复/续轮，本路线停止，不再要求补齐浏览器接线。 现行范围和公共工作顺序见[联合工作入口](2026-10-28-intent-gate-repair-implementation-plan.md)，最新执行状态见[状态索引](../acceptance/2026-10-23-current-status-and-evidence-index.md)。

<details>
<summary>展开原方案与操作步骤（按当时时点阅读）</summary>

日期：2026-10-28
## 1. 要解决的问题（一句话）

被扣下的首次尝试以 `turn/end: error` 结束，Web 客户端因此显示一次 `message.turnError`（"This turn failed"），而产品要求（IG-B-05/20、IGB-AC-18）是「恢复中」。工作本身已经被救回（声明专用修复 + 同请求续步），缺的只是**呈现**。

## 2. 已验证的宿主事实（设计依据）

| 事实 | 依据 |
|---|---|
| 失败卡文案来自客户端本地化表 `message.turnError` | `packages/client/ui-chat/src/client/locale.ts` |
| 客户端插件是**公开扩展点**：包 manifest 用 `dsh.client = { inject: [...], platform: 'web' }` 声明，入口走 `exports['./client']` | `packages/client/ui-user-questions/package.json`（真实客户端插件样例，inject 里含 `dsh-client-ui-chat`、`dsh-api-session-controller`、`dsh-client-locale`） |
| 声明失配的失败码是策略自有的，可与真实故障区分 | `presets/ptc-hashline/intent-gate-watchdog.mjs`：`INTENT_DECLARATION_MISSING` / `INTENT_DECLARATION_EMPTY` / `INTENT_DECLARATION_REPAIR_EXHAUSTED` |
| 修复与续步是两条**插件来源**通知，可用固定前缀区分 | 同上 `REPAIR_NOTICE_PREFIX` / `CONTINUATION_NOTICE_PREFIX` |
| 同 turn 内「扣下 attempt 换新 step」不可行 | [ADR-0006 修订 §1](../adr/0006-declaration-only-repair-and-business-continuation.md)（`agent.ts:506-550`） |
| **节点定义注册表是公开 seam**，但**同一个 kind 不能注册两次**（重复即抛错） | `packages/client/ui-conversation/src/client/conversation/definition-registry.ts`（`if (this.definitions.has(key)) throw new Error(duplicateMessage)`）——所以**不能**"替换" `ui-chat` 的 `turn-error` 定义 |
| **事件可以被"认领"（claim）**：`match` 返回 `exclusive: true` 的定义会让同 target 的其它定义在该事件上被跳过，且与注册顺序无关 | 同包 `conversation/assembler.ts:519-550`（"Claims are resolved before any acceptance, so the outcome does not depend on registration order"；未认领者在 `:542` 被 `continue`） |
| **渲染器也是公开 slot**：按节点 kind 注册 | `packages/client/ui-chat/src/client/chat/register-node-renderers.ts`（`ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'turn-error', locale: NS }, TurnErrorNodeView))`） |

## 3. 方案（最小面）

新增一个**独立的客户端插件包**（不改宿主、不改 preset 的 agent 面）：

```
packages/client-intent-gate-presentation/
  package.json           # dsh.client = { inject: ['...ui-chat', '...session-controller', '...client-locale'], platform: 'web' }
  src/index.ts           # host 半：无（空壳，保持 bundle 形状一致）
  src/client/index.ts    # 浏览器半：注册一次「turn 失败卡」的呈现派生
  locale/zh-CN.json      # 「正在补全意图声明…」（用户可见文案，中文，与既有默认中文一致）
  locale/en-US.json
```

**结论：路线 1 不需要改宿主。** 用「认领」而不是「替换」：我方注册一个**新 kind**（`intent-recovering`，不与既有 kind 冲突）的定义，在 `match` 里对**我们那两个失败码 + 紧随其后的修复通知**返回 `exclusive: true`，`ui-chat` 的 `turn-error` 就会在该事件上被跳过（`assembler.ts:542`），我方再注册同 kind 的渲染器。其余一切事件不认领，stock 行为原样。

**呈现规则（唯一一条，且必须按结构化事实判断，不许匹配正文）**：

> 当一个 `turn/end` 的 `reason.kind === 'error'`、其 `reason.error.code` ∈ {`INTENT_DECLARATION_MISSING`, `INTENT_DECLARATION_EMPTY`}，**且同会话紧邻的下一条插件消息以 `REPAIR_NOTICE_PREFIX` 开头**时，把这一对（被扣下的 turn + 修复 turn）呈现为一次「正在补全意图声明」的进行态；其余一切失败（provider 故障、取消、截断、上限、修复耗尽）**保持原样**，绝不改写。

**必须做**：
1. 用失败码 + 生产者 kind（`source.kind === 'intent-gate-watchdog'`）识别，**不**匹配任何自然语言文本。
2. 保留可展开的原始记录（错误码、attempt、时间），即「只是换了语气，没有删证据」。
3. 修复成功后把该进行态替换为真实声明与业务回复；修复耗尽（`INTENT_DECLARATION_REPAIR_EXHAUSTED`）显示协议暂停文案，不显示「失败」也不显示「已完成」。

**明确不做**：
- 不改 `turn/end` 的 reason、不改日志、不隐藏错误码（那是伪造历史，ADR-0006 修订已禁止）。
- 不让 `INTENT_DECLARATION_LIMIT` / `..._AWAITING_ANSWER` / `INTENT_STALE_ACTION` 套用「恢复中」——它们不是「声明缺了、正在补」。
- **CLI/ACP 不在本路线范围内**：`packages/acp/acp/src/session.ts` 以 `turn failed: …` 拒绝，宿主自持；本路线生效后 Web 与 CLI 的呈现会不一致，必须在文档里写清。

## 3b. 已实现的部分（规则核心，可复核）

`presets/ptc-hashline/client/presentation.mjs`（无依赖、只读纯函数；放在 preset 资产里，因为浏览器包暂不可构建，见 §7）：

| 导出 | 作用 |
|---|---|
| `classifyTurnEnd(reason)` | 只把 `error` 且 code ∈ {`INTENT_DECLARATION_MISSING`,`INTENT_DECLARATION_EMPTY`} 判为 `recovering`；`REPAIR_EXHAUSTED`/上限/等待/陈旧/状态不可信/provider 失败一律 `failure`，非错误结局 `none`。同时接受 `reason.error` 与流式 `reason.failure` 两种字段名 |
| `isRepairNotice(event)` | 只认本产物（`source.kind === 'intent-gate-watchdog' && form === 'notice'`）且正文以修复前缀开头的通知；续步通知、用户转述、伪造 source 都不算 |
| `deriveRecoveringRow({turn, reason, following})` | 升级窗口是"turn 结束后、下一条 user/message 之前"：若第一条就是修复通知 → 给出 `{kind:'intent-recovering', seq, time, turn, code}`；若是用户输入或新 turn 开启 → 返回 null（宁可见暂停，也不做陈旧升级） |
| `RECOVERING_TEXT` / `recoveringText(locale)` | 中英文案，未知语言回落到中文；测试断言文案里**不含**"失败/错误/failed/error" |
| `REPAIR_NOTICE_PREFIX` | 与 `intent-gate-watchdog.mjs` 的同名常量**由测试断言相等**，防止两处漂移 |

证据：`tests/unit/intent-recovering-presentation.spec.ts` 7 条 PASS（分别钉住：可升级的两种码、每个不可升级的码、字段名兼容、只认本产物通知、拒绝陈旧/跨 turn 升级、文案无失败词、前缀与码表与门一致）。

## 7. 状态与阻塞（2026-10-28 决定后）

- **已做**：接缝复核（上表两处公开 seam）、规则核心实现 + 7 条测试、`check:preset` 仍通过（新增资产不影响既有不变量）。
- **未做（BLOCKED）**：浏览器半（`src/client/index.tsx` 定义 + 渲染器 + 两份 locale）。原因具体：需要把 `@deepseek-ai/dsh-client-ui-conversation`/`-ui-chat`/`-locale` 等宿主**客户端包**装进本仓库依赖并跑 `tsdown` 构建，而本环境同时拒绝 `pnpm install`（嵌套进程）与 `SetFileSecurityW`；`packages/*` 是工作区 glob，现在塞一个**无法构建**的包会让 `pnpm build`/`check`/`test:delivery` 直接失败，因此**故意不建包目录**，避免用一个空壳破坏现有门禁。
- **接线（在有能力的环境里是机械动作）**：
  1. `ctx.uiConversation.events.register({ kind: 'intent-recovering', target: 'chat', match: event => …exclusive: true 时…, start/update/buildViewNode })`；
  2. `ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'intent-recovering', locale: NS }, RecoveringNodeView))`；
  3. `dsh.client.inject` 至少含 `dsh-client-ui-conversation`、`dsh-client-ui-chat`（slot 名）、`dsh-client-locale`；
  4. 浏览器穿透用例：同一会话里既看不到 `message.turnError` 文案、也看不到「失败」，且声明与业务回复可见；反向用例：provider 失败**仍**显示失败卡。
- **不得越过**：CLI/ACP 仍显示失败（宿主自持），本路线生效后两端呈现不一致，必须在发布说明里写清。

## 4. 需要的改动清单（预估）

| 项 | 内容 |
|---|---|
| 新包 | 上面的 `packages/client-intent-gate-presentation`（含 `tsdown` 构建配置，参照 `ui-user-questions`） |
| bundle 打包 | `package.json` 的 `files` 与依赖加入新包；`scripts/delivery-acceptance.mjs` 的打包清单同步（现在是四个交付包） |
| profile 装配 | 客户端插件要装进一次性 profile 的客户端平面（`composeProfile` 增一行） |
| 契约钉住 | `scripts/check-preset.mjs` 增加该包的关键行/摘要；`preset.patch.yml` 若需客户端行则新增（**若要动 preset 行，先改规格**） |
| 新用例 | ①客户端单元级：给定会话事件序列，产出「恢复中」而不是失败卡，且原始码可取；②反向：provider 失败/取消/耗尽**不**被改写；③真实浏览器穿透：同一会话里没有 `message.turnError` 文本，声明与业务回复可见 |
| 证据 | `test:surface-gate` 保持原样（它证明的是控制器帧），新增浏览器证据单独一节；候选表 `scripts/candidate-evidence.mjs` 增加一个 `client` 轴或把浏览器证据并入 `surface` 轴的 `browser` 字段 |

## 5. 风险与代价

- **新资产 + 新平面**：从「只交付 agent 面」变成「同时交付 client 面」，打包/装配/门禁都要跟；这是本路线的主要成本。
- **两端不一致**：CLI/ACP 仍显示失败，用户可能在不同界面看到不同状态。
- **本地化**：新增文案需中英两份，且不能与既有 `message.turnError` 语义冲突。
- **不得扩散**：一旦开始「按错误码改写呈现」，必须有测试挡住把真实故障也改写掉。

## 6. 若用户改选路线 2（附录：精确改动面）

不改代码，只改契约文案与验收判据：

1. [规格](../specs/2026-10-27-intent-gate-b-requirements.md) IG-B-05：「请求层不把这次失配当成用户请求的结论」改为「**可以呈现为一次明确的策略暂停**（说明正在补全声明），不得要求用户重发、不得发布旧正文、不得执行旧调用」。
2. 同文件 IG-B-20 第一行「正在内部修复格式 → 显示恢复状态」保留，但允许该状态以「暂停 + 正在补全」的措辞出现。
3. IGB-AC-18 的判据改为：残留一次可见暂停 **可接受**；**不可接受**的是旧正文泄漏、旧调用执行、要求用户重发。
4. [ADR-0006](../adr/0006-declaration-only-repair-and-business-continuation.md) 增加一条决定：明确接受该可见暂停，并记录理由（唯一可行路线是 Client 面新资产）。
5. 验收文档把「一次可见暂停」写进已知行为，并在下一次 P5 运行里连同 FIX-08 一起复核。

</details>
