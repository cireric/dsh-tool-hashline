# 请求级意图门方案 B · 票据 02：声明缺失可修复一次，失败与成本可追溯（工程验收）

日期：2026-10-27。范围：[票据 02](../../.scratch/intent-gate/issues/02-bounded-repair-and-failure-accounting.md) 的纵向切片；需求正文见[正式规格](../specs/2026-10-27-intent-gate-b-requirements.md)，前序切片见[票据 01 验收](2026-10-27-intent-gate-b-01-declare-before-publish.md)。

本文只记录**本票**结果。不宣称 IGB-AC 全组或整套规格通过：输入例外（03）、澄清等待（04）、中途纠正（05）、恢复（06）、真实 CLI/浏览器呈现端与完整交付（07）均未在本票实施；日常 profile 未切换，未安装、未重启、未发布、未启动真实模型。

## 结论

在 01 的同一系统 seam（隔离打包安装 + 官方 launcher/registry/loader + 完整 preset + 真实 AgentLoop/Session/进程 PTC + 固定响应适配器）上新增 10 个用例，**23/23 用例 PASS**（01 的 13 + 本票 10）。一次自动修复在真实宿主上端到端成立：纠正提示以插件来源写入正式会话记录，重生成请求从该记录重建（请求尾部即那条提示），旧响应与旧程序零发布零启动；第二次仍不合格时以 INTENT_DECLARATION_REPAIR_EXHAUSTED 明确停止。取消、网络失败与截断保持宿主原意且不吃修复预算；字符上限是独立停止而不是声明缺陷。

## 关键设计与接口组合

| 环节 | 实现 |
|---|---|
| 判据 | 与 01 相同的机械检查（首行 Intent: + 非空正文，大小写/空格豁免；只认最终块文本） |
| 修复预算 | maxRepairs: 1，在 preset 行列明并由 check-preset 断言；插件内部把任何更大配置压回 1（规格固定值，不是旋钮）。预算在**判定时**扣除，provider 失败不会换来第二次 |
| 修复通道 | 官方 agent/request-error waterfall：插件把纠正提示 session.append('user/message', notice, { surfaceOp: 'append' }) 写入正式记录，然后返回 { kind: 'retry' }；loop 的 continue → buildRequest → session.deriveMessages()，因此重生成请求天然包含该提示（不改冻结请求） |
| 提示归属 | 提示是 user 角色、source.kind = 'intent-gate-watchdog'、form: 'notice'、summary 截到 120 字符；正文明确写"不是用户在说话、不授予新授权、目标与范围不变"（IG-B-07） |
| 只修自己那一次 | 仅当 failure.code 等于「已记录原因对应的策略码」时才认领重试；耗尽码、真实故障、其他插件对同一次尝试的重试一律 next() 交回，避免预算被放大 |
| 故障语义 | 只有 provider 成功（stop / tool-calls）才判定；aborted/error/max-tokens 原样回放（且先于上限判定），不额外消耗修复 |
| 成本 | 被拒尝试把 usage 放回 assistant/attempt 流（已知成本不对账为零），未上报 usage 时记录就是 unknown；被拒的 text/tool-call/replayState 一律不外泄，接受答案只带自己的 replay 元数据 |
| 资源上限 | 命中 maxBufferedChars/maxBufferMs → INTENT_DECLARATION_LIMIT，不修复、不放行、不占预算（本票明确"上限不等于声明缺陷"） |
| 语言分工 | 用户读到的停止原因用中文；只给模型读的纠正提示用英文（与 persona 一致） |

## 逐条验收判据与证据（宿主用例，均为外部断言）

| 票据判据 | 结果 | 证据 |
|---|---|---|
| 首次不合格、第二次合格时仅新程序执行；旧程序零启动、无伪造结果、授权不扩大 | PASS | IG02-01（纯答案：2 次请求、1 条提示、只有合格回复落库、发布流首字为该回复）；IG02-02（程序：被拒程序写的 forbidden.txt 不存在、effects=1、只执行一次 run_code）；提示正文含"不授予新授权"（单测与 IG02-01 双证） |
| 每次需声明的用户输入最多修复一次；正常续步不计；连续不合格明确停止 | PASS | IG02-03：恰好 2 次请求、1 条提示、2 条 assistant/attempt、0 条 assistant/message、0 发布、0 派发，终态码 INTENT_DECLARATION_REPAIR_EXHAUSTED；IG02-04：新用户输入拿到属于它自己的第 2 条提示；01 的 IG01-02 / IG01-09 已覆盖"续步不重复收取"与"每条用户输入各自收取" |
| 纠正提示正式入记录并带插件来源；重生成请求可从正式记录重建；不改冻结请求、不伪装用户授权 | PASS | IG02-01：user/message 事件 source.kind = intent-gate-watchdog；重生成请求的 messageCount 增 1 且尾部 sourceKind 为插件、文本即提示；surfaceOp: 'append' 由集成层断言 |
| 在完整宿主的通用 retry 组合下预算不被转交/嵌套/重复放大 | PASS（协作式策略）/ GAP（抢占式策略） | IG02-09：注册一份"先问后领"的通用重试插件（loop 文档的默认形状），始终只有 1 条提示、0 发布、0 派发，请求总数 4（1 原始 + 1 修复 + 该策略自己的 2 次），其自身预算归零。GAP：若某插件不调用 next() 就抢占我方故障码，我方提示不会落库（我方 listener 未被执行）；本插件保证的是"绝不发放第二次声明修复"，不保证提示一定送达，已在用例边界与本文登记 |
| 取消、网络失败、超时、截断沿用宿主处理、不吃修复次数；系统错误提示免标记；取消后不派发 | PASS | IG02-05（aborted：0 提示、code=ABORTED、0 派发、0 副作用，随后请求仍拿到修复）；IG02-06（error/NETWORK 原样上报、0 提示、随后仍拿修复）；IG02-07（max-tokens：原文照发、0 提示、被截断的 tool-call 不派发、文件未创建）。超时由宿主映射为 error/aborted，属同一路径 |
| 命中资源上限时暂停说明、不绕过校验；provider 完成/策略拒绝/真实故障/超限可区分 | PASS | IG02-08：INTENT_DECLARATION_LIMIT、0 提示、0 发布，且同一请求随后仍保有一次修复；四类终态分别由成功接受的 assistant/message、INTENT_DECLARATION_*、ABORTED/NETWORK、INTENT_DECLARATION_LIMIT 区分 |
| 已知成本可对账（含被拒）、未知成本仍 unknown、原始终态与策略判定可追溯、被拒 replay 不挂到新答案 | PASS | IG02-03：两条被拒尝试的 assistant/attempt 流都带 usage（11/7/18）；IG02-10：无 usage 的两次尝试记录为 unknown（不是 0）；IG02-01：接受消息的 replayState 是修复尝试自己的，被拒尝试的 rejected-answer 从未出现在任何 assistant/message |
| 用固定分块/终态/故障演示纯答修复、工具修复、耗尽、取消与成本保真，断言外部结果 | PASS | 上述用例全部断言外部观察点（发布帧、tool/call、tool/ptc-dispatch-start、tools/result、被 instrument 的 fs.writeText、会话记录、请求尾部），未读插件私有计数 |

## 执行命令与退出码

| 命令 | 退出码 | 结果 |
|---|---|---|
| pnpm check | 0 | build + 三包 tsc + tsc -p tsconfig.tests.json |
| pnpm check:preset | 0 | 资源 digest（persona 与 gate 已随本票更新）、maxBufferedChars / maxBufferMs / maxRepairs 三项断言、禁止旧 gate 开关 |
| pnpm test:unit | 0 | 23 文件 / 313 用例（新增 4 项修复文案契约） |
| pnpm test:integration | 1 | 551 PASS / 3 FAIL，3 项仍为本机 git 属主与 git 身份的既存环境失败（与 01 相同，非本票引入） |
| pnpm test:ptc | 0 | 9 文件 / 33 用例 |
| pnpm test:compat | 0 | 2 文件 / 21 用例 |
| pnpm test:profile | 0 | profile 内 gate 资产：无声明被停、有声明放行 |
| node scripts/test-intent-gate-host.mjs --pack .tmp/intent-gate-host-17 | 0 | 23/23 用例 PASS；scriptedLlmRequests = 55、realModelRequests = 0 |
| pnpm test:delivery | 1 | PASS 20 / FAIL 1（REG-01）/ BLOCKED 9；唯一失败门禁 = pnpm test:integration（同 3 个环境失败），test:profile 与本票相关门禁均 0；原始报告见"原始证据" |
| git diff --check | 0 | 无空白错误 |

pnpm test:delivery 的具体读数见下文"原始证据"；其门禁表与上表同源。

### 失败与缺口

- **FAIL（既存环境，非本票引入）**：tests/integration/operations-baseline.spec.ts 2 项、operations-cli.spec.ts 1 项——本 checkout 的 .git 属主为 BUILTIN/Administrators（git 报 dubious ownership，baseline 记 unknown）与本机未配 git 身份（夹具 git commit 失败）。修复需改动用户机器的 git 配置或属主，本票无此授权，如实保留。
- **GAP（后续票据）**：用户"继续"语义入口（03）、澄清等待（04）、中途纠正（05）、恢复/压缩保真（06）、真实呈现端与完整交付（07）、真实模型语义效果（IGB-AC-12）。
- **GAP（本票边界）**：
  - 抢占式通用 retry（不调用 next() 直接认领故障）会让纠正提示无法落库；本插件只保证不放大声明修复预算，见上文与 IG02-09 的边界说明。
  - 修复尝试若遇到真实 provider 失败，该失败按宿主语义终止（不重试、不二次修复）；"失败后用户说继续"重新获得一次机会属于 03。
  - 真实 compaction / session-title 调用在本宿主仍未实际发出（固定适配器无 context capacity），辅助调用豁免仍以同形直连调用证明。
  - 宿主日志仍见两条既存噪声（compaction-basic 的 no context capacity，以及宿主某 agent/disposed listener 抛错）；均与本机制无关，未影响用例判定。

## 原始证据（本地，不随 clone 交付）

| 路径 | 内容 |
|---|---|
| .scratch/intent-gate/evidence/intent-gate-b-02-host/host-result.json | 本次 --pack 验收的 23 个用例、逐用例结论、四个观察点计数、请求尾部（提示是否进入重生成请求）、被拒尝试的 usage、边界声明 |
| .scratch/intent-gate/evidence/intent-gate-b-02-host/installation.json | 一次性 profile 与打包/装配 notes |
| .scratch/intent-gate/evidence/2026-10-27-delivery-run-intent-gate-b-02.md + .json | 本轮 pnpm test:delivery 生成的报告与摘要（仓库内同名报告保留既有轮次，未被覆盖） |

## 未授权事项

未安装到日常 profile、未重启、未发布、未切换升级目标、未调用真实模型或付费评估。
