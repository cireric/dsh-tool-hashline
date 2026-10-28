# 请求级意图门方案 B · 票据 06：状态来自正式日志（恢复与压缩保留等待、预算与最新约束）（工程验收）

日期：2026-10-27。范围：[票据 06](../../.scratch/intent-gate/issues/06-persist-wait-budget-and-latest-intent.md)；需求正文见[正式规格](../specs/2026-10-27-intent-gate-b-requirements.md)，前序切片见[01](2026-10-27-intent-gate-b-01-declare-before-publish.md)、[02](2026-10-27-intent-gate-b-02-bounded-repair.md)、[03](2026-10-27-intent-gate-b-03-input-exceptions.md)、[04](2026-10-27-intent-gate-b-04-clarification-wait.md)、[05](2026-10-27-intent-gate-b-05-steering-before-dispatch.md)。

本文只记录**本票**结果。真实 CLI/浏览器呈现端与完整交付（07）未实施；日常 profile 未切换，未安装、未重启、未发布、未启动真实模型。

## 结论

本票不是"把内存字段存起来"，而是**取消私有状态**：门所需的一切改为在每次读取时**从会话事件日志推导**（'sessionId -> 已确认理解计数 / 上一请求结论 / 待答问题 / 本次请求已用修复'），因此恢复、重载与压缩重放同一批事件时自然保留等待、已用预算与最新约束，而不是重新播种。宿主用例新增 3 个真实恢复用例，**44/44 用例 PASS**（01 的 13 + 02 的 10 + 03 的 9 + 04 的 5 + 05 的 4 + 本票 3）；恢复路径 flush → 销毁 agent → 'agents.resume' → 在同一份持久日志上继续。不可信记录（缺失/损坏/无法关联）**一次一报并停下**（'INTENT_STATE_UNTRUSTED'），随后从保守默认值继续，不静默放行、不猜授权。

## 关键设计

| 环节 | 实现 |
|---|---|
| 推导来源 | 'session.snapshotEvents(from)' —— 公开日志读取入口；按 'seq' 增量折叠，不写任何私有 side-car 文件或插件记录 |
| 已确认理解 | 日志里**首行重新判定合格**的 'assistant/message' 计数（同一机械规则，不信任历史判定） |
| 已用修复 | 本插件自己的修正提示（source 'intent-gate-watchdog'）出现在当前真实输入之后 ⇒ 已用 1 次；跨重载不重置 |
| 待答问题 | 'tool/call' / 'tool/ptc-dispatch-start' 的 'ask_user_question' 与其结算事件（pending 结果保持开启） |
| 上一请求结论 | 'turn/end' 的 reason：completed ⇒ accepted；error 且本请求已用修复且未产出合格回复 ⇒ exhausted；其它 ⇒ failed（真实 provider 故障可能被记为 exhausted，方向更保守） |
| 不可信 | 任何无法折叠的事件（内容非数组、缺 callId、未知 turn/end、日志读取抛错）⇒ 'trusted = false' ⇒ 该请求以 'INTENT_STATE_UNTRUSTED' **停下并说明**，然后丢弃已推导状态、从保守默认值继续（每会话每进程只报一次，用户后续输入走正常入口） |
| 压缩 | 压缩只改**表面**（surface 替换），不动事件日志；推导只读日志，因此压缩不改变门的结论。记录本身不进入模型可见表面，不占上下文 |
| 不重放 | 恢复不重发旧请求、不重跑旧程序：用例对写入副作用计数取证（恢复后计数不变） |

## 逐条验收判据与证据

| 票据判据 | 结果 | 证据 |
|---|---|---|
| 以正式日志/持久化和公开生命周期入口，分别恢复"待答、已用一次修复、已耗尽、已收到新约束"的会话 | PASS | 宿主：'agents.resume'（公开注册表入口）+ 'sessions.flush'，见 IG06-01（待答）、IG06-02（已用/耗尽）；waterfall 层另有"已收到新约束后恢复"（日志内通知 + turn/end，见集成用例）；不经任何内存字段注入 |
| 重载/恢复/压缩本身不清除等待、不重置已用预算、不丢失最新约束；旧程序与旧调用不重放 | PASS | IG06-01：恢复后裸「继续」仍欠声明（提示 1 次），同名文件写入次数不变；IG06-02：恢复后仍按"上一请求已停止"判定；推导只读日志，压缩不改日志（集成用例以"新对象读同一事件数组"证明重载语义） |
| 恢复后 A/B 中的继续仍不代选；耗尽后的用户继续仍需重新声明并显式获得一次新机会，区别于恢复动作自身 | PASS | IG06-01（A/B 待答中「继续」被判缺声明）；IG06-02（耗尽后继续仍欠声明，且各自恰得一次修复；恢复动作本身不消耗、不发放修复） |
| 状态记录缺失、损坏、无法关联或不能可信重建时，当前请求暂停并说明，不静默放行、不猜测授权；用户后续补充能经正常入口处理 | PASS | 集成用例"reports an untrusted record…"：合法声明也被 'INTENT_STATE_UNTRUSTED' 停下、不消耗修复；随后同一会话的新输入正常通过。**边界**：通过公开 append 无法造出损坏事件（会话拒绝畸形事件），因此该项在 waterfall 层用构造日志取证，宿主层未复现 |
| 多个主会话独立恢复，其他 preset、子代理与标题/压缩辅助模型调用不被意图门要求首句；不能把压缩调用与压缩后主请求混为一谈 | PASS | IG06-03（两个会话分别恢复，一个保留等待、另一个照常行动）；辅助调用不带声明仍放行（01/04 的 out-of-scope 用例，'purpose'/'system' 识别） |
| 等待、独立请求、纠正、取消和恢复交叉时，既有执行事实与预算可追溯，原始错误/成本不被改写 | PASS | IG06-01/02 的写入计数与错误码；02/05 的既有用例继续覆盖取消与纠正；门的停止只追加策略失败，不改写 provider 原始 finish/usage |
| 在隔离完整宿主下复核上述外部行为，并记录可信性判据与未覆盖生命周期 | PASS | 宿主 44/44；本文"关键设计"给出可信性判据；"失败与缺口"列出未覆盖生命周期 |

## 执行命令与退出码

| 命令 | 退出码 | 结果 |
|---|---|---|
| pnpm check | 0 | build + 三包 tsc + tsc -p tsconfig.tests.json |
| pnpm check:preset | 0 | 资源 digest（gate 随本票重写更新）、三项 bounds、阻塞式提问行断言 |
| pnpm test:unit | 0 | 23 文件 / 325 用例 |
| pnpm test:integration | 1 | 572 PASS / 3 FAIL，3 项为本机 git 属主/身份既存环境失败（非本票引入；共 575，本票新增 4 项） |
| pnpm test:ptc | 0 | 9 文件 / 33 用例 |
| pnpm test:compat | 0 | 2 文件 / 21 用例 |
| pnpm test:profile | 0 | profile 内 gate 资产：无声明被停、有声明放行（探针会话补上日志，因为门现在只读日志） |
| node scripts/test-intent-gate-host.mjs --pack .tmp/intent-gate-host-32 | 0 | 44/44 用例 PASS；scriptedLlmRequests = 123、realModelRequests = 0 |
| pnpm test:delivery | 1 | PASS 20 / FAIL 1（REG-01）/ BLOCKED 9；唯一失败门禁 = pnpm test:integration（同 3 个环境失败） |
| git diff --check | 0 | 无空白错误 |

### 失败与缺口

- **FAIL（既存环境，非本票引入）**：tests/integration/operations-baseline.spec.ts 2 项与 operations-cli.spec.ts 1 项（本 checkout 的 .git 属主为 BUILTIN/Administrators、本机未配 git 身份）。
- **GAP（恢复路径依赖宿主组装）**：恢复出来的 agent 是**全新的 scoped world**，preset 必须在 resume 的 'setup' 里重新组装（本票宿主用例走 'agentPresets.recompose'）；'select' 对已开始的会话会拒绝。若某条恢复路径不做这一步，被恢复的 agent 就没有门，而**另一个 agent 中存活的门的实例仍会按 sessionId 判定它的流**（本票调试中实际观察到）。真实 CLI 的 resume 路径是否组装 preset 属 07 的穿透范围。
- **GAP（不可信记录的构造）**：公开 append 会拒绝畸形事件，因此损坏日志只能在磁盘被外部破坏时出现；该项在 waterfall 层用构造日志取证，宿主层未复现。
- **GAP（压缩实跑）**：本仓宿主没有可用上下文容量（compaction 报"no context capacity"），因此未跑真实压缩；"压缩不清除等待"由"推导只读事件日志、压缩只改表面"的机制保证，并被集成层的同构重载用例覆盖，未在完整宿主实跑。
- **GAP（分类近似）**：'turn/end' 为 error 且本请求已用修复、未产出合格回复 ⇒ 记为 exhausted；真实 provider 故障在同一请求里也可能落到这里，方向更保守（继续仍欠声明），但不是精确区分。
- **GAP（后续）**：07 的真实呈现端与完整契约证据；IGB-AC-12 真实语义效果。

## 原始证据（本地，不随 clone 交付）

| 路径 | 内容 |
|---|---|
| .scratch/intent-gate/evidence/intent-gate-b-06-host/host-result.json | 44 个用例、恢复时序（flush/销毁/恢复）、恢复后提示与写入计数、'INTENT_STATE_UNTRUSTED' 边界声明 |
| .scratch/intent-gate/evidence/intent-gate-b-06-host/installation.json | 一次性 profile 与打包/装配 notes |
| .scratch/intent-gate/evidence/2026-10-27-delivery-run-intent-gate-b-06.md + .json | 本轮 pnpm test:delivery 生成的报告与摘要 |

## 未授权事项

未安装到日常 profile、未重启、未发布、未切换升级目标、未调用真实模型或付费评估。
