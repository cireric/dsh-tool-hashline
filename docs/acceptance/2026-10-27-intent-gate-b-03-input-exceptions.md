# 请求级意图门方案 B · 票据 03：输入例外与耗尽后的显式重试（工程验收）

日期：2026-10-27。范围：[票据 03](../../.scratch/intent-gate/issues/03-request-exceptions-and-explicit-retry.md)；需求正文见[正式规格](../specs/2026-10-27-intent-gate-b-requirements.md)，前序切片见[票据 01](2026-10-27-intent-gate-b-01-declare-before-publish.md)与[票据 02](2026-10-27-intent-gate-b-02-bounded-repair.md)。

本文只记录**本票**结果。不宣称 IGB-AC 全组或整套规格通过：澄清等待（04）、中途纠正（05）、恢复（06）、真实 CLI/浏览器呈现端与完整交付（07）未实施；日常 profile 未切换，未安装、未重启、未发布、未启动真实模型。

## 结论

在 01/02 的同一系统 seam 上新增 9 个宿主用例，**32/32 用例 PASS**（01 的 13 + 02 的 10 + 本票 9）。语义判断仍由主 agent 在同一次生成内完成（本票不加第二个模型：豁免路径的模型请求数恰为 1）；门的机械面只做**精确整句**比对：裸致谢永远免声明，裸「继续」仅在「本会话已有被接受的意图声明且上一请求以接受结束」时免声明；同一句话带上新目标/约束即还原为需声明；豁免永远不覆盖要调用工具的回复；请求以停止（修复耗尽/失败/截断）收尾后，裸「继续」按新请求重新声明并获得属于它自己的一次修复。

## 关键设计

| 环节 | 实现 |
|---|---|
| 语义检查（IG-B-03） | 留在 persona：目标/交付物/对象/范围/完成标准五项在一次生成内自检；只考虑「有依据且会改变工作」的解读；不产出分类标签，不增加第二个模型（证据：豁免路径 requests = 1） |
| 机械面（IG-B-01 例外） | 两个**封闭短表**：致谢（谢谢/多谢/收到/好的/ok/thanks/👍…）与继续（继续/接着/go on/continue…）；归一化只做「折叠空白 + 去尾标点 + 转小写」，然后**整句**相等比对。不是子串、不是关键词命中 |
| 继续的前提 | classifyInput 读会话状态：accepted > 0（本会话至少有一次被接受的声明）**且** lastOutcome === 'accepted'；否则「继续」仍需声明（新会话、耗尽后、失败/截断后都属此类） |
| 豁免的边界 | 只豁免 NO_TEXT / MISSING / EMPTY_BODY 三种声明缺失；不豁免 LIMIT_* 与 GATE_ERROR；且回复**不得含 tool-call**（否则按未声明拒绝并进入修复）——豁免永不覆盖行动（IG-B-09） |
| 用户续步 vs 机器续步 | 机器续步在 agent/pre-step 就没有真实用户消息，门根本不参与（不收取、不扣预算）；用户续步是一条真实的 user/message（source.kind = 'user'），门会判定它。持久记录里两者天然可区分（证据：IG03-07 断言机器步骤未新增 user/message） |
| 耗尽后的「继续」 | 02 已保证「每条真实用户输入各有一次预算」；本票把「停止后不享受继续豁免」实现为 lastOutcome 条件，因此耗尽后的裸「继续」会重新声明并消耗新的修复（IG03-08） |
| 主会话隔离 | 会话状态按 sessionId 分开存储，另一主会话不能借用「已有理解」或预算（IG03-09） |

## 逐条验收判据与证据（宿主用例，均为外部断言）

| 票据判据 | 结果 | 证据 |
|---|---|---|
| 主 agent 在原有生成中做五项短检查；不增加第二个模型、不硬凑两种意图、不把分类词当授权 | PASS（机械侧可证的部分）/ GAP（语义质量需真实模型） | IG03-01：豁免路径 requests = 1，证明没有额外的分类调用；persona 新增「短检查在你这次生成里」与「只考虑有依据且会改变工作的解读」；「不硬凑意图、分类词不是授权」由 persona 与 01/04 的绑定共同承载，其语义效果仍属 IGB-AC-12 的独立评估 |
| 同请求的工具结果、机器通知、进度与收尾不重新收取声明；新的真实用户输入按其含义决定是否欠声明 | PASS | IG03-07：机器续步回复无标记仍发布、0 提示、未新增 user/message；IG01-02/IG01-09 已覆盖续步与逐输入收取 |
| 纯回应与目标清楚的普通继续可免完整声明；含相同词语但附带新目标/约束的必须更新理解，不能只用关键词白名单 | PASS | IG03-01（谢谢 → 无标记回复照发、0 修复）；IG03-03（已有理解后「继续」→ 无标记照发）；IG03-02（收到，但把 a.txt 第二行改成 B → 拒绝并修复）；IG03-04（继续，同时把 b.txt 删掉 → 拒绝并修复）；IG03-05（新会话裸「继续」→ 拒绝，因为没有可承接的理解）。整句比对由单测 6 项钉住（含 7 个「同词带内容」的反例） |
| 耗尽后的用户继续重新生成声明/响应并获得一次新修复机会；旧程序不重放；该特例优先于普通继续的免声明规则 | PASS | IG03-08：耗尽后裸「继续」的第一次回复被判为缺声明（不享受豁免）→ 第 2 条提示 → 修复后合格回复发布；IG01-07/IG02-03 已证旧程序零启动、零重放 |
| 用户主动继续与机器续步有可追溯区别；其他主会话不能重置或借用预算 | PASS | IG03-07（持久记录里机器步骤不产生 user/message，用户「继续」产生 source.kind = 'user' 的消息）；IG03-09（另一主会话无「已有理解」，裸「继续」仍欠声明）；IG02-04 已证预算按用户输入各自计算 |
| 固定响应系统测试覆盖正常继续、社交、新要求、机器续步和耗尽恢复的可见回复与执行结果；persona 指引与运行规则一致 | PASS | 上述 9 个用例覆盖五类输入；persona 的「两个输入不欠这一行」「豁免永不覆盖行动」「停止后的继续是新请求」与插件规则逐条对应（资源 digest 在 check-preset 中钉住） |
| 显式说明固定响应测试只证明路由/状态与提示契约，不证明真实模型总能正确理解输入 | PASS（本文与 findings.boundaries 均声明） | host-result.json 的 boundaries 含「Deterministic adapter … No model-behaviour, semantic-quality or value evidence」；本文结论栏亦如此 |

## 执行命令与退出码

| 命令 | 退出码 | 结果 |
|---|---|---|
| pnpm check | 0 | build + 三包 tsc + tsc -p tsconfig.tests.json |
| pnpm check:preset | 0 | 资源 digest（persona 与 gate 随本票更新）与三项 bounds 断言 |
| pnpm test:unit | 0 | 23 文件 / 319 用例（新增 6 项输入例外） |
| pnpm test:integration | 1 | 558 PASS / 3 FAIL，3 项为本机 git 属主/身份既存环境失败（非本票引入） |
| pnpm test:ptc | 0 | 9 文件 / 33 用例 |
| pnpm test:compat | 0 | 2 文件 / 21 用例 |
| pnpm test:profile | 0 | profile 内 gate 资产：无声明被停、有声明放行 |
| node scripts/test-intent-gate-host.mjs --pack .tmp/intent-gate-host-21 | 0 | 32/32 用例 PASS；realModelRequests = 0 |
| pnpm test:delivery | 1 | PASS 20 / FAIL 1（REG-01）/ BLOCKED 9；唯一失败门禁 = pnpm test:integration（同 3 个环境失败） |
| git diff --check | 0 | 无空白错误 |

### 失败与缺口

- **FAIL（既存环境，非本票引入）**：tests/integration/operations-baseline.spec.ts 2 项与 operations-cli.spec.ts 1 项——本 checkout 的 .git 属主为 BUILTIN/Administrators（git 报 dubious ownership）与本机未配 git 身份。修复需改动用户机器配置，本票无此授权，如实保留。
- **GAP（后续票据）**：澄清等待（04，届时「A/B 待答中的继续」必须在等待状态下关闭本票的继续豁免）；中途纠正（05）；恢复/压缩保真（06，必须把本票的 accepted/lastOutcome 会话状态持久化，否则重载后会重新给出豁免或预算）；真实呈现端与完整交付（07）；真实语义效果（IGB-AC-12）。
- **GAP（本票边界）**：
  - 免声明表是**封闭短表**：其它语言的致谢/继续（如「ありがとう」「sigue」）不在表内，会要求声明。这是刻意的方向：宁可多要一行声明，也不把带内容的输入误判为社交；扩展需改代码并更新单测与 digest。
  - 归一化只折叠空白、去尾标点、转小写；表内词内部夹空白/换行（如「继 续」）不匹配 → 需声明（安全方向）。
  - 「已有理解」目前只统计本进程内被接受的声明次数与上一请求结局（内存态），重载/压缩后的行为属 06；本票的宿主用例都在同一会话内验证。
  - 固定适配器只证明路由与状态机；模型是否真能分辨「谢谢」与「收到，但…」属语义效果，未被本票证明。

## 原始证据（本地，不随 clone 交付）

| 路径 | 内容 |
|---|---|
| .scratch/intent-gate/evidence/intent-gate-b-03-host/host-result.json | 本次 --pack 验收的 32 个用例、逐用例结论、请求数（证明无第二个模型）、持久 user/message 来源、提示计数、边界声明 |
| .scratch/intent-gate/evidence/intent-gate-b-03-host/installation.json | 一次性 profile 与打包/装配 notes |
| .scratch/intent-gate/evidence/2026-10-27-delivery-run-intent-gate-b-03.md + .json | 本轮 pnpm test:delivery 生成的报告与摘要（仓库内报告保留既有轮次，未被覆盖） |

## 未授权事项

未安装到日常 profile、未重启、未发布、未切换升级目标、未调用真实模型或付费评估。
