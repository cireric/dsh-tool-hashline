# 请求级意图门方案 B · 票据 07：完整交付与真实呈现端验证（工程验收）

日期：2026-10-27。范围：[票据 07](../../.scratch/intent-gate/issues/07-delivery-ui-and-full-contract-evidence.md)；需求正文见[正式规格](../specs/2026-10-27-intent-gate-b-requirements.md)。各切片验收：[01](2026-10-27-intent-gate-b-01-declare-before-publish.md)、[02](2026-10-27-intent-gate-b-02-bounded-repair.md)、[03](2026-10-27-intent-gate-b-03-input-exceptions.md)、[04](2026-10-27-intent-gate-b-04-clarification-wait.md)、[05](2026-10-27-intent-gate-b-05-steering-before-dispatch.md)、[06](2026-10-27-intent-gate-b-06-log-derived-state.md)。

本文只记录**本票**结果：把 01～06 放在一起跑完整仓库交付门禁、补两个 04×05×06 的交叉用例、在**客户端呈现边界**做最小穿透检查，并把 IG-B-01～16 与 IGB-AC-01～12 逐条映射到证据。日常 profile 未切换，未安装、未重启、未发布、未启动真实模型。

## 结论

| 项 | 结果 | 证据 |
|---|---|---|
| 隔离打包安装 + 官方 launcher/registry/loader + 完整目标 preset + 真实 AgentLoop/Session + 官方进程 PTC | PASS | pnpm test:delivery（真实 launcher 装配，**PASS 21 / FAIL 0 / BLOCKED 9，退出码 0**，见下方"更正"）；宿主 46 用例与呈现端 3 用例均在 **--pack** 出来的一次性 dsh-profile-acceptance 上运行 |
| IG-B-01～16 / IGB-AC-01～12 覆盖映射 | PASS（16+12 逐条见表） | 见下文两张表；每行指向具体用例号与分层证据 |
| 04×05×06 交叉行为 | PASS | IG07-01（steering 不是回答：等待不被 steer 结束，且等待期间零派发）、IG07-02（预算已耗尽 + 等待仍开着，经真实 reload 后继续仍欠声明）、IG05-03（A 已执行 / B 被阻止） |
| 客户端呈现端最小穿透 | PASS（边界=客户端线） / GAP（浏览器截图） | scripts/test-intent-gate-surface.mjs：IG07-S1/S2/S3；映射证据见下节 |
| 暂存等待、资源上限、被拒成本、usage/replay 保真、错误责任可对账 | PASS | findings.timingRule 的四段时间字段；IG01-05/IG02-10（被拒仍计已知成本、未知保持 unknown）；集成层"replays an accepted attempt verbatim" |
| 实际解析路径/摘要/新旧门迁移/既有 read+edit 契约 | PASS | installation.json（解析路径、版本、gate+persona sha256）；check:preset（digest+bounds+阻塞式提问行）；test:compat 21、test:ptc 33 |
| 真实模型效果（误读/漏问/误问/任务结果/等待成本） | GAP | 未执行，见"剩余限制"；本票只证明路由、拒绝与呈现契约 |
| 安装/重启/发布/profile 切换 | 未执行（无授权） | 见"未授权事项" |

## IG-B 覆盖映射

| 要求 | 结论 | 证据（用例号；分层） |
|---|---|---|
| IG-B-01 每次真实用户输入后的首次正式回复表达理解；续步不重复；新目标/纠正仍须更新 | PASS | IG01-01、IG01-02、IG01-09、IG03-03、IG03-07（宿主）；集成"does not ask a tool continuation to declare again" |
| IG-B-02 首行 Intent: + 自然语言；硬校验只查标记与非空正文，兼容大小写/空格 | PASS | IG01-03、IG01-04、IG01-05、IG01-06、IG01-08（宿主）；单元 28 项 checkDeclaration |
| IG-B-03 主 agent 自查目标/交付物/对象/范围/完成标准；只用有依据且改变工作的解读；不加第二个模型 | PASS（机械侧）/ GAP（语义侧） | 机械：单元"no second model"计数断言、IG03-01（一次尝试一次请求）；语义：persona「Phase 0」契约。固定适配器不证明模型识别歧义的能力 |
| IG-B-04 正文展示与提交前校验，工具执行同样等待；独立思考/加载态不纳入首句 | PASS | IG01-05、IG01-06、IG01-07、IG02-02（宿主）；IG07-S1、IG07-S3（呈现端：校验前客户端零可见文本） |
| IG-B-05 首次不合格不放行旧响应与旧调用；重新生成；不伪造理解、不重放旧调用 | PASS | IG02-01、IG02-02、IG02-03（宿主）；IG07-S1（客户端只见修正后的正文） |
| IG-B-06 每次需声明的输入最多一次修复；再不合格说明并停止；正常续步不计修复 | PASS | IG02-01～04、IG02-09、IG03-08（宿主）；集成"spends one repair…"、"gives each new user input its own repair" |
| IG-B-07 修复提示记为插件来源、保留原请求与约束、不伪装用户授权、上下文可重建 | PASS | IG02-01（提示 source.kind=插件）、IG03-08、IG07-S1（客户端日志里恰一条提示）；集成 request-error 用例 |
| IG-B-08 新目标/约束到达时旧未执行调用先停、重判并更新声明；已执行动作不回滚 | PASS | IG05-01～04、IG05-03（A 已执行/B 被阻止）、IG07-01（宿主） |
| IG-B-09 声明、分类与未打断都不扩大授权；方法可被新证据修正 | PASS | IG03-02、IG03-04、IG03-06、IG01-09（宿主）；persona 授权段 |
| IG-B-10 取消/网络/超时/截断沿用宿主处理；不额外消耗修复；系统提示免标记；取消后不执行缓存调用 | PASS | IG02-05、IG02-06、IG02-07、IG02-08（宿主）；集成"never repairs a mechanism stop"、"does not repair when the turn was already cancelled" |
| IG-B-11 原 provider 完成、插件拒绝与真实故障分别记录；已知成本计入、未知保持 unknown | PASS | IG01-05（拒绝仍带 usage）、IG02-06、IG02-10（unknown 保持 unknown）；findings 成本字段 |
| IG-B-12 合格响应保留正文/参数/usage/replay；被拒元数据不挂到新答案；不制造未执行工具的结果 | PASS | IG01-01、IG01-02、IG02-02（宿主）；集成"replays an accepted attempt verbatim, including usage and replay metadata" |
| IG-B-13 只对本 preset 受管主 agent；不扩其他 preset/子代理/辅助调用；多会话状态与预算独立 | PASS | IG01-10、IG01-11、IG01-13、IG03-09、IG06-03（宿主）；集成 out-of-scope 用例 |
| IG-B-14 恢复/重载/压缩保留等待、已用预算与最新约束；不重放；不可信则暂停说明 | PASS（重载/恢复）/ GAP（压缩实跑） | IG06-01～03、IG07-02（宿主真实 resume）；集成四个 resume 用例；压缩见"剩余限制" |
| IG-B-15 列明缓存/时间/生成上限与测时方式；触顶暂停说明 | PASS | IG01-12（字符上限）、IG02-08（上限与缺声明区分）；DEFAULT_LIMITS + check:preset 断言配置与默认一致；findings.timingRule |
| IG-B-16 歧义或必需信息缺失时澄清；先做获授权只读核实；需要取舍就直接问；发问后暂停当前请求；独立请求不受影响 | PASS（机械侧）/ GAP（语义侧） | IG04-01～05、IG07-01（宿主）；persona「Asking instead of guessing」；"该不该问"属语义 |

## IGB-AC 覆盖映射

| 验收组 | 结论 | 证据 |
|---|---|---|
| IGB-AC-01 首行/大小写空格可通过；无标记或空正文不通过；多块与最终文本不能绕过最终检查 | PASS | IG01-03、IG01-04、IG01-08、IG01-05、IG01-06；单元 checkDeclaration |
| IGB-AC-02 纯答案与多工具程序都先查后展示/派发；不合格程序零启动；接受后保真 | PASS | IG01-01、IG01-02、IG01-07、IG02-02；集成 replay 保真 |
| IGB-AC-03 初次不合格只重生成一次；再不合格明确停止；续步不重复声明、不放大 retry | PASS | IG02-01、IG02-03、IG02-09、IG03-07；IG07-S3（客户端只见一次失败） |
| IGB-AC-04 社交回应/正常继续/新目标/待答中的继续/耗尽后的继续各按优先级，不误选不重放 | PASS | IG03-01、IG03-02、IG03-03、IG03-08、IG04-04、IG07-01 |
| IGB-AC-05 发出澄清后当前请求暂停；回答前无相关后续执行；独立请求不被误伤 | PASS | IG04-01、IG04-02、IG04-05、IG07-01 |
| IGB-AC-06 纠正到达后旧未执行调用先停并重判；已执行事实保留；不以最终字节不变代替零执行 | PASS | IG05-02（零派发）、IG05-03（A 已执行/B 被阻止，分别取证）、IG05-04 |
| IGB-AC-07 取消/网络/超时/截断保留原终态，不额外耗预算；取消后零缓存派发，故障提示可见 | PASS | IG02-05、IG02-06、IG02-07；集成取消用例 |
| IGB-AC-08 命中缓存/时间/生成上限时暂停说明，不无校验放行 | PASS | IG01-12、IG02-08；check:preset 的 caps 断言 |
| IGB-AC-09 其他 preset/子代理/辅助调用不受影响；多主会话不串状态与预算 | PASS | IG01-10、IG01-11、IG01-13、IG03-09、IG06-03 |
| IGB-AC-10 重载/恢复/压缩保留等待、已用预算与最新约束；不可信暂停说明；旧调用不重放 | PASS（重载/恢复、不可信）/ GAP（压缩实跑） | IG06-01～03、IG07-02；集成"reports an untrusted record…" |
| IGB-AC-11 纠正上下文可重建且来源明确；provider 完成与插件拒绝分开；被拒成本不丢；合格元数据保真；未知仍 unknown | PASS | IG02-01（提示来源）、IG01-05（拒绝带 usage）、IG02-10、集成 replay 保真 |
| IGB-AC-12 独立效果评估（理解/误读/漏问/误问/纠正后恢复/任务结果/等待成本），不用声明出现率代替效果 | **GAP（未执行）** | 需要另行授权的样本、预算与门槛；见"剩余限制" |
## 客户端呈现端最小穿透

**边界与理由**：Web 客户端的助手正文来自稠密 \`agent/assistant-stream\` 帧；\`@deepseek-ai/dsh-api-session-controller\`（\`lib/types/assistant-stream.js\`）把这些帧折叠进重连基线，\`follow()\` 再逐帧以 \`{ type: 'assistant-stream', frame }\` 原样发给浏览器 —— 是一比一透传，没有二次加工。因此 \`scripts/test-intent-gate-surface.mjs\` 在这一交界处断言，等于断言浏览器收到的载荷；聊天消息则取自客户端日志渲染的会话表面事件（\`assistant/message\`、\`user/message\`、\`turn/end\`）。

| 用例 | 断言（外部可观察） | 结果 |
|---|---|---|
| IG07-S1 | 被拒程序的正文**从未**出现在客户端可见文本里；客户端收到的唯一文本属于过检后的重生成；程序零执行；客户端日志里恰一条修正提示；被拒尝试以 \`assistant/attempt\` 结束而非 \`assistant/message\` | PASS |
| IG07-S2 | 合格回复逐字到达客户端；呈现流 open→committed 成对；客户端出现对应消息 | PASS |
| IG07-S3 | 两次都不合格：零可见文本、零 assistant 消息、恰一个失败回合且错误码为 \`INTENT_DECLARATION_REPAIR_EXHAUSTED\` | PASS |

**GAP（浏览器截图）**：\`session-controller\` 行需要浏览器连接栈（\`fileUploads\` ← \`connection\` ← \`credentials\`/\`webStartup\`），而启动日常 Web 宿主不在本任务授权内；本票改为在**它的上游交界**（控制器原样转发的帧）取证，并在 surface-result.json 的 \`controllerCompositionAttempt\` 里记录这次组装的失败点。

## 时序与成本对账

| 关注点 | 观测点（门之外） | 说明 |
|---|---|---|
| provider 时间 | \`requestToFirstProviderChunkMs\`、\`providerSpanMs\` | 固定适配器自打时间戳；后者只描述 provider 自身首末块跨度 |
| 暂存等待（用户可见时间的一部分） | \`providerFinishToFirstPublishedMs\` | provider 已完成后，门压住回复多久才放行；被拒尝试该值为"零发布" |
| 用户可见时间 | \`requestToFirstPublishedMs\` | 第一次真正发布正文的时间 |
| 被拒生成成本 | \`assistant/attempt\` 上的 usage | 拒绝只放行 usage，已知成本照计（IG01-05） |
| 未知成本 | IG02-10 | provider 不给成本时保持 unknown，不写 0 |
| 错误责任 | 策略失败码 vs provider 原始 finish | 拒绝是门的策略失败（\`INTENT_*\`），原 provider finish/success 保留在 attempt 记录里（IG-B-11） |

## 资产身份与迁移

| 项 | 值/结论 |
|---|---|
| 解析路径 | installation.json 记录 profile、bundleRoot、解析出的 \`@deepseek-ai/dsh\` 版本 0.2.1-rc.2、hashline/tool-edit 0.2.1-alpha.4 |
| 资源摘要 | check:preset 固定 persona 与 gate 的 sha256；宿主与呈现端运行的正是同一份 --pack 产物 |
| 新旧门迁移 | 旧 watchdog 的工具名档位与 \`gate: enforce\` 开关已移除，同一文件承载请求级门；\`check:preset\` 断言不再出现 \`gate\` 键，并要求三项 caps 与模块默认一致 |
| read/edit 契约 | test:compat 21 PASS、test:ptc 33 PASS；read/edit 名称、canonical value、共享 hashline 实例未变 |

## 执行命令与退出码（本轮同一最终 diff）

| 命令 | 退出码 | 结果 |
|---|---|---|
| pnpm check | 0 | build + 三包 tsc + tsc -p tsconfig.tests.json |
| pnpm check:preset | 0 | digest + caps + bounds + 阻塞式提问行断言 |
| pnpm test:unit | 0 | 23 文件 / 325 |
| pnpm test:integration | **0** | **575 PASS / 0 FAIL（44 文件）**；需在子进程环境里带 `HOME`/`USERPROFILE`（见下方"更正"） |
| pnpm test:ptc | 0 | 9 文件 / 33 |
| pnpm test:compat | 0 | 2 文件 / 21 |
| pnpm test:profile | 0 | profile 内 gate 资产：无声明被停、有声明放行 |
| node scripts/test-intent-gate-host.mjs --pack .tmp/intent-gate-host-34 | 0 | 46/46 用例 PASS；scriptedLlmRequests=135、realModelRequests=0 |
| node scripts/test-intent-gate-surface.mjs --pack .tmp/intent-gate-surface-01 | 0 | 3/3 用例 PASS；scripted=5、realModelRequests=0 |
| pnpm test:delivery | **0** | **PASS 21 / FAIL 0 / GAP 0 / BLOCKED 9**（同样是带 `HOME` 运行；BLOCKED 的 9 项是本仓交付 harness 自身的"未运行"集合，历次一致） |
| git diff --check | 0 | 无空白错误 |

## 更正（2026-10-27，同日复核）

早先本轮记录把 `test:integration` 的 3 项失败归因为"本机 git 属主/身份既存环境失败"。该归因**错误**，现更正：

- 本机 `~/.gitconfig` **本来就有** `user.name=cireric`、`user.email=eric.f.tyc@gmail.com`，并且有 `[safe] directory = *`，因此 `git` 在该 checkout 上正常工作；
- 失败的真实原因是**本会话工具进程的 `process.env` 为空**（无 `HOME`/`USERPROFILE`），子进程 `git` 因此读不到 `~/.gitconfig`：既看不到身份（`Author identity unknown`），也看不到 `safe.directory`（`dubious ownership`）；
- 给子进程补回 `HOME`/`USERPROFILE` 后实测：`pnpm test:integration` **575/575 PASS、退出码 0**；`pnpm test:delivery` **PASS 21 / FAIL 0 / BLOCKED 9、退出码 0**。
- 结论：仓库门禁**全绿**，不需要改动机器配置；先前那句"修复需改动用户机器配置"作废。本条更正只调整归因与数字，不改动任何代码或测试。

## 剩余限制（GAP / 未授权）

- **GAP（IGB-AC-12 真实效果）**：未执行任何真实模型试验；误读、漏问、误问、纠正后恢复、任务结果与等待成本都还没有数据。需要另行授权并先定样本量、模型、预算与判定门槛；不得用"声明出现率"代替效果，也不得沿用旧的 S0/S1/S2 六探针结论。
- **GAP（压缩实跑）**：隔离宿主无上下文容量（compaction 报 \`no context capacity\`），压缩未实跑；"压缩不清除等待"由"门只读事件日志、压缩只改表面"的机制与集成层同构重载用例支撑。
- **GAP（浏览器截图）**：见上节；呈现端证据止于控制器原样转发的帧边界。
- **GAP（恢复路径组装）**：恢复出的 agent 需在 resume 的 setup 中重新组装 preset；真实 CLI 的 resume 路径未穿透（属 07 后续事项，已在票据 06 记录）。
- **GAP（语义侧）**：IG-B-03/09/16 的"是否该问、是否真的改变工作"由 persona 承担，机械层只保证路由与拒绝。
- **未授权**：未安装到日常 profile、未重启、未发布、未切换升级目标、未启动真实模型或付费评估。

## 原始证据（本地，不随 clone 交付）

| 路径 | 内容 |
|---|---|
| .scratch/intent-gate/evidence/intent-gate-b-07-host/host-result.json + installation.json | 46 个宿主用例、交叉用例、时序字段、21 条边界声明、一次性 profile 与解析路径 |
| .scratch/intent-gate/evidence/intent-gate-b-07-surface/surface-result.json | 3 个呈现端用例、客户端线证据、控制器组装失败点记录 |
| .scratch/intent-gate/evidence/2026-10-27-delivery-run-intent-gate-b-07.md + .json | 本轮 pnpm test:delivery 报告与摘要 |
