# 当前验收状态与证据索引

更新日期：2026-10-27。本文汇总已有记录，文件名保留最初建档日期。真实 S0 第二轮已完整执行 9 项，整体 FAIL，未启动 S1；原超时轮保留 GAP。PTC 与上游同步的六张票据全部交付并在 Windows 实跑：真实来源与真实发布源完成完整检查、重复检查与部分失败边界，四区域共 118 个检查点、43 条差异逐项处置，macOS/Linux 与候选包内容保留 GAP（见[票据 06](2026-10-27-upstream-sync-check-06.md)）。历史报告保留各轮结果，以下计数不得合并为同一次执行。

**当前安排：本轮评测按用户确认的[阶段决策](2026-10-26-evaluation-stage-decision.md)收尾，停止扩样并转为按需维护。** 完整 S0 已执行但 FAIL，后续离线审计完成；S1/S2 延期未执行，不计作完成或通过。日常推荐 PTC、Hashline 手动可选及暂停默认推广不变；原 FAIL/GAP/BLOCKED 与历史证据保留。

## 当前结论

| 主题 | 当前依据与证明范围 |
|---|---|
| 请求级意图门方案 B（需求） | [正式规格](../specs/2026-10-27-intent-gate-b-requirements.md)已完成用户需求与系统级测试 seam 确认，状态 ready-for-agent；本轮只发布规格和本地票据，未实现或运行验收。既有[六场景证据](../evidence/2026-10-27-intent-gate-b-feasibility.json)仅证明早期核心接口组合；新格式、澄清等待、恢复、并发、UI 与真实效果仍待验证，当前运行门未切换 |
| 请求级意图门方案 B · 票据 01（实施） | [本票验收](2026-10-27-intent-gate-b-01-declare-before-publish.md)：判据从「按内层工具名拒绝」迁移为「`llm/stream` 暂存整段生成 → 检查首行 `Intent:` 与非空正文 → 原样放行或策略停止」，persona、资源摘要基线与契约检查同口径迁移。隔离打包安装的完整 preset 上 13/13 用例 PASS（含拒绝路径发布/记录/派发/副作用四项为零），`check`、`check:preset`、unit 309、PTC 33、compat 21、profile 均 exit 0；`test:integration` 3 项失败为本机 git 属主/身份既存环境问题。自动修复、输入例外、澄清等待、纠正、恢复、真实呈现端与效果评估仍未实施，日常 profile 未切换 |
| 请求级意图门方案 B · 票据 02（实施） | [本票验收](2026-10-27-intent-gate-b-02-bounded-repair.md)：在 01 的同一系统 seam 上交付**一次自动修复**——插件经官方 `agent/request-error` 把插件来源的纠正提示写入正式会话记录后认领重试，重生成请求从该记录重建；预算在判定时扣除且被压回规格固定值 1，耗尽后以 `INTENT_DECLARATION_REPAIR_EXHAUSTED` 停止。23/23 宿主用例 PASS（含纯答修复、工具修复、耗尽、取消/网络/截断不吃预算、上限与策略拒绝区分、未知成本仍 unknown、通用 retry 不放大预算）。`test:integration` 仍有 3 项本机 git 环境既存失败；03～07 与真实效果评估未实施，日常 profile 未切换 |
| 请求级意图门方案 B · 票据 03（实施） | [本票验收](2026-10-27-intent-gate-b-03-input-exceptions.md)：输入例外只做**整句精确比对**（封闭短表），裸致谢永远免声明、裸「继续」仅在「本会话已有被接受的理解且上一请求以接受结束」时免声明；同词带新目标即还原为需声明，豁免永不覆盖要调用工具的回复，停止后的「继续」按新请求重新声明并获得一次新修复。语义短检查仍由 persona 在同一次生成内完成（豁免路径 requests = 1，无第二个模型）。32/32 宿主用例 PASS；test:integration 仍有 3 项本机 git 环境既存失败；04～07 与真实语义效果未实施，日常 profile 未切换 |
| 请求级意图门方案 B · 票据 04（实施） | [本票验收](2026-10-27-intent-gate-b-04-clarification-wait.md)：澄清等待不靠私有开关，而由宿主的 `ask_user_question` 持久调用开启、由其结算或真实用户输入关闭；等待期间 03 的输入豁免关闭（A/B 待答中裸「继续」不等同选择）、要调用工具的回复被停（沉默不是同意）、宿主以 `user-question-reply` 送达的回答一律要求声明。preset 钉住阻塞式（legacy）提问——暂停由宿主实现，`check:preset` 在改成 timed 时失败。37/37 宿主用例 PASS；test:integration 仍有 3 项本机 git 环境既存失败；05～07 与真实语义效果未实施，日常 profile 未切换 |
| 请求级意图门方案 B · 票据 05（实施） | [本票验收](2026-10-27-intent-gate-b-05-steering-before-dispatch.md)：读宿主自己的 steering 队列（`agent.inbox.nextStep`）判断"有人类输入还没被收取"——此时**保留文字、扣下调用**（回复以 plain stop 结束、零派发），已跑起来的程序在下一次内层派发处经 `tools/pre-execute` 被拒；已执行的调用保留、不回滚、不伪造结果、不消耗修复预算。可控时序由 `attempt-held`/`write-effect` 标记定位，不靠睡眠。41/41 宿主用例 PASS；`test:integration` 仍有 3 项本机 git 环境既存失败；06～07 与真实语义效果未实施，日常 profile 未切换 |
| 请求级意图门方案 B · 票据 06（实施） | [本票验收](2026-10-27-intent-gate-b-06-log-derived-state.md)：取消私有状态——门所需的一切（已确认理解、已用修复、待答问题、上一请求结论）每次从**会话事件日志**推导，故恢复/重载/压缩重放同一批事件即保留；不可信记录一次一报并停下（`INTENT_STATE_UNTRUSTED`）后从保守默认值继续。宿主 `flush → 销毁 → agents.resume` 真实恢复 3 例，44/44 用例 PASS；`test:integration` 仍有 3 项本机 git 环境既存失败；压缩实跑、真实 CLI resume 组装与 07 未覆盖，日常 profile 未切换 |
| 请求级意图门方案 B · 票据 07（实施，收尾） | [本票验收](2026-10-27-intent-gate-b-07-full-contract-evidence.md)：完整交付门禁 + IG-B-01～16 与 IGB-AC-01～12 逐条映射 + 04×05×06 交叉（IG07-01/02）+ **客户端呈现边界**穿透（`agent/assistant-stream` 帧即控制器原样转发给浏览器的载荷）：校验前客户端零可见文本、被拒尝试以 attempt 而非 message 结束。宿主 46/46、呈现端 3/3 用例 PASS；`test:integration` 575/575、`test:delivery` PASS 21/FAIL 0（需子进程带 `HOME`，见 07 验收"更正"）；**IGB-AC-12 真实模型效果、压缩实跑与浏览器截图保持 GAP**；日常 profile 未切换 |
| 上游同步审查修复 | [后续修复验收](2026-10-27-upstream-sync-review-fixes.md)：5 项意见均 ACCEPT；单侧插件绑定完整配置、read token 差异绑定实际内容，配置先校验后统一写入，报告区分发布来源，PTC 测试不再意外联网。新增 7 项红转绿，定向 107 PASS；隔离副本九项门禁 exit 0，打包宿主 21 PASS / 9 BLOCKED；修复后真实只读冒烟 complete。旧决定内容身份变化需复查，不回写历史结果 |
| PTC 与上游同步 · 引擎发布评估 | [正式规格](../specs/2026-10-27-upstream-sync-requirements.md)的 SYNC-05/SYNC-07 要求枚举已发布版本、区分稳定与预发布、给出更新依据并如实记录外部查询失败。[票据 04](2026-10-27-upstream-sync-check-04.md)在 Windows 实跑：两个引擎包全量枚举后按语义版本分渠道（真实来源显示两包均未发布正式版，dist-tag 的 latest 指向预发布，故不能取 latest 充当答案），补丁 7 项与组合影响只到 pending-verification，单个引擎查询失败或超时记 BLOCKED 且不复用上一轮结果；一次真实只读查询得整体 complete、exit 0 |
| PTC 与上游同步 · 重复检查与审阅决定 | [正式规格](../specs/2026-10-27-upstream-sync-requirements.md)的 SYNC-06 要求区分首次 / 无新增 / 已知 / 新增 / 旧决定需复查，并让决定只绑定已审阅的内容身份。[票据 05](2026-10-27-upstream-sync-check-05.md)在 Windows 实跑两轮：首轮 43 条新增；写入 1 条 keep 决定后次轮 no-new-changes（已知 1、未变化未决定 42），决定记录整份生效或整份无效，历史缺失 / 读不出 / 格式不支持分别报告。 |
| PTC 与上游同步 · 真实来源验收与交接 | [正式规格](../specs/2026-10-27-upstream-sync-requirements.md)的 SYNC-09/SYNC-10/SYNC-11 要求 Windows 真实来源完整检查、可核验重复运行、可交接跟进项与三平台自动化。[票据 06](2026-10-27-upstream-sync-check-06.md)在真实本机 DSH（0.2.1-rc.2 @ 687f282，工作树 clean）与真实 npm 发布源上跑了四轮：首轮 complete（18/75/14/11 检查点、43 条差异：保留 24 / 待分析 18 / 不适用 1、缺口 0）、重复轮 no-new-changes、带 1 条决定轮 known 1、部分失败轮 engines BLOCKED 而本地三区域照常；检查前后来源树、依赖、补丁、profile 与链接均未改变。SYNC-01～10 PASS，SYNC-11 Windows PASS 且 macOS/Linux 保留 GAP |
| PTC 与上游同步需求 | [正式规格](../specs/2026-10-27-upstream-sync-requirements.md)记录手动检查、来源身份、差异复查和 11 项验收场景。[票据 01](2026-10-27-upstream-sync-check-01.md)交付公开入口 pnpm sync:check、三层来源优先级与来源/基线身份；[票据 02](2026-10-27-upstream-sync-check-02.md)交付 ptc 区域逐对象比较（75 检查点 / 28 差异，其中 3 条指向本项目声明的 backgroundMode 在所选来源未满足）；[票据 03](2026-10-27-upstream-sync-check-03.md)交付 stock read 对照（14 检查点 / 5 记录：三处上限按值比较均相同、4 条已有关联差异带依据、图片工具记不适用）；[票据 04](2026-10-27-upstream-sync-check-04.md)交付引擎发布评估（版本全量枚举、渠道分离、补丁与组合待验证）；[票据 05](2026-10-27-upstream-sync-check-05.md)交付跨轮比较与决定记录；[票据 06](2026-10-27-upstream-sync-check-06.md)完成真实来源验收与交接（四轮、SYNC-01～10 PASS、SYNC-11 Windows PASS + macOS/Linux GAP），整体检查现可在真实来源上跑成 complete，报告不再标不完整 |
| 本轮阶段决策 | [决策记录](2026-10-26-evaluation-stage-decision.md)：接受 S0 失败并停止扩样；已交付实现与审计保留复用，S1/S2 延期未执行。两个候选问题按需立项，不以未获 PASS 作为继续花费理由 |
| S0 后续模式/提示审计 | [本轮验收](2026-10-26-evaluation-payload-prompt-audit.md)：version=2 消除坏 header→apply_patch 误标，actualMode 仍 unknown；旧真实报告继续复核且未改写。6 个 Hashline 首请求均有方括号指引，三个无工具响应正常 stop，未发现明确提示冲突。297 项单元、类型与固定宿主 18 项/45 请求通过；新增真实请求 0，S0 FAIL 不变 |
| 完整真实 S0 第二轮 | [本轮验收](2026-10-26-evaluation-real-s0-modelscope-02.md)：9 项全部执行，28/28 请求对账与独立重放、总 Token 398,176；3 PASS / 3 GAP / 3 FAIL，最终 6/9 正确。stock-edit 3/3 正确，两 Hashline 臂分别 2/3 与 1/3；Hashline 首次条件失败，S0 FAIL 后停止，未启动 S1，不外推普遍收益 |
| S0 诊断与单请求复验 | [本轮诊断](2026-10-26-evaluation-s0-diagnosis.md)：确认原推理控制未发送，修复 cap 枚举误拒；追加一次 low/max_tokens 请求约 46.2 秒返回工具调用，usage 14,827 Token。未执行工具，完整 S0 仍 GAP。291 项单元及类型通过，未启动 S1 |
| 真实 S0 首轮 | [真实 S0 首轮](2026-10-26-evaluation-real-s0-modelscope.md)：ModelScope/GLM-5.3-Flash 首请求在 reasoning 阶段 120 秒超时；1 CANCELLED / 8 BLOCKED，usage/费用 unknown；捕获与重放 1/1，check=0、judge=2。S0 未通过，S1/S2 未执行 |
| 请求取证与有界恢复 | [本轮验收](2026-10-26-evaluation-request-evidence.md)：完整组装请求捕获、官方 Session 独立重放、SDK 比较及手动网关配置已验证。241 项定向、九项交付门禁通过；固定 Provider 117 样本仍为 93 PASS / 18 GAP / 6 FAIL。前两包无费用部分完成，真实 S0/S1/S2 待配置及显式执行，无收益结论 |
| 项目收口（历史） | [收口验收与延期清单](2026-10-26-project-closeout.md)：最后实现已提交为 116ece1；[两轮用户报告](../evidence/tetris-ab/README.md)按原文与摘要归档。当前证据不支持默认推广；不宣称机制普遍优劣、正式 S0/S1/S2 通过或所有 GAP 已解决 |
| 基础 read/edit、cwd、persona | 已实现并有回归，见[运行修复](2026-10-23-runtime-fix-acceptance.md) |
| MV 与快照次序 | 创建意图、不覆盖、部分成功、磁盘先于快照已修复，见[MV 验收](2026-10-23-mv-observation-acceptance.md)与 [ADR-0004](../adr/0004-mv-create-intent-and-snapshot-order.md) |
| BOM | Local provider 的 hashline 路径支持零/单 BOM，连续 BOM 拒绝，见[BOM 验收](2026-10-23-bom-and-snapshot-repair-acceptance.md)与 [ADR-0005](../adr/0005-bom-preserving-hashline-read.md) |
| 运维 skills | 两份 skill、用户入口隔离及 incident/升级工作流已交付；[10-24 真实宿主交付报告](2026-10-24-delivery-acceptance-report.md)覆盖打包安装、真实 launcher/registry/loader 与装好的 CLI，9 个未覆盖 ID 仍为 BLOCKED；一次性目标与模拟/注入部分不证明日常 profile 已升级 |
| 默认策略 F-01/F-02 | Windows 策略模块地址与 read 指引已修复，见 [fix-01](2026-10-25-default-edit-policy-fix-01.md)；非目标 read 保留原指引 |
| 默认策略 F-03 / E2 | 父用户来源误拒已修复；[fix-02](2026-10-25-default-edit-policy-fix-02.md)记录定向 27 PASS、扩展完整宿主 32 PASS / 0 FAIL，包含在线/持久化父来源、会话隔离、cwd、catch 与 BOM/MV 边界；完整 E2 仍有缺口 |
| 块定位说明与诊断 | [块定位修复](2026-10-25-hashline-block-locator-fix.md)记录定向 13 PASS、后续新打包完整宿主 33 PASS / 0 FAIL、九项交付门禁 exit 0，交付 ID 21 PASS / 9 BLOCKED；未实现块解析器 |
| 真实模型 E3 | [e3-01 冒烟](2026-10-25-default-edit-policy-effectiveness-e3-01.md)：10 个真实模型子会话、64 次请求，样本 1/2 各 3/3 PASS，样本 3 为 2 PASS / 1 FAIL（空格差异），样本 5 PASS，样本 4 BLOCKED；[多帧复核](2026-10-25-real-model-evaluation.md)恢复全部 10 个子会话事件及调用配对；历史实际模式/部分 usage 仍 unknown，dev link 环境不证明打包安装，E3 未整体通过 |
| 评测基础设施 | [本轮验收](2026-10-25-real-model-evaluation.md)：probe/formal、身份冻结、三臂真实宿主零费用驱动、候选快照和独立文件校验已验证；完整九项门禁 exit 0，交付 21 PASS / 9 BLOCKED。初版缺口由本表“逐目标/会话树/冻结刺激”分项更新；真实 provider 仍缺验证 |
| 推广收益 E4 | [推广评测方案](../plans/2026-10-25-default-edit-policy-promotion-evaluation-plan.md)已定稿；尚无已执行的正式冻结对照，独立 E3 冒烟不能替代 S1 对照 |
| 自定义模型配置 | [配置入口增量](2026-10-25-evaluation-config.md)：JSON 模板 + prepare 自动采集身份/冻结，33 项定向回归通过；实际 CLI 生成、防覆盖、未填项拒绝及无凭据 preflight 已验证，无真实模型请求 |
| 逐目标/会话树/冻结刺激 | [阶段验收](2026-10-26-evaluation-next-stage.md)：55 项定向、12 项真实宿主固定适配器案例通过；九项门禁 exit 0、交付 21 PASS / 9 BLOCKED。支持有界目标映射、父子费用归并及读后漂移，流量/会话请求对账 33/33，失败当刻独立快照区分首错与恢复；不是 S1/S2 或真实模型收益证据 |
| fork/取消生命周期 | [本轮验收](2026-10-26-evaluation-lifecycle.md)：真实同进程 fork 三臂 18/18 去重对账；子流取消三臂保留部分落盘及后续样本，取消后无新适配器请求，评测结果仍 GAP/unknown。固定 Provider 证明有界生命周期，不证明真实 Provider 取消计费；创建中/工具中等其它取消时点仍缺验证 |
| apply_patch 目标取证 | [本轮验收](2026-10-26-evaluation-apply-patch.md)：保存实际解析计划并核对同会话调用/模式/文件头集合；无移动载荷可映射，缺计划仍 unknown。73 项定向、最终宿主 18 PASS、对账 45/45；九项门禁 exit 0。早期新路径创建 FS_NOT_OBSERVED 和空文件末尾换行不符各保留 1 FAIL，未修工具契约；不证明模型收益 |
| 首次指标冻结范围 | [v2 验收](2026-10-26-evaluation-cohort.md)：任务 include/exclude 在执行前冻结，仅影响首次条件；最终文件、Token、调度和全局覆盖仍检查全任务。123 项回归、九种固定 Provider 判读及历史兼容通过；真实模型请求 0，正式任务集未执行 |
| 可复用候选任务集 | [本轮验收](2026-10-26-evaluation-task-suite.md)：13 族普通配置与独立 expected 可生成，默认 probe；136 项定向、实际 CLI 冻结及无凭据 BLOCKED 预检通过，九项交付门禁 exit 0、21 PASS / 9 BLOCKED。本阶段止于配置/预检；后续完整固定宿主结果见下行，真实模型未执行，不据标签齐全认定 S1 通过 |
| 候选任务集完整宿主验证 | [后续验收](2026-10-26-evaluation-suite-host.md)：39 样本实际固定 Provider 执行、90 断言通过、81/81 请求对账；实际任务 31 PASS / 6 GAP / 2 FAIL，最终字节 36 正确 / 3 错误，judge=2。连续中间快照与生成器调用已取证，shell 目标仍 unknown。189 回归与九项交付门禁通过、21 PASS / 9 BLOCKED；真实模型请求 0。发现并修正一次性安装的传递 Hashline 版本/物理实例漂移，历史根 marker PASS 不扩大为同引擎证明 |
| 冻结设计审查 | [本轮验收](2026-10-26-evaluation-design-review.md)：实际插件差异、共享声明、任务分布及首次分母可重复审查；197 回归、实际 CLI 拒绝场景、18 例宿主及九项交付门禁通过。报告仍 GAP：工具面不等同纯策略消融，consecutive 的合规中间状态不能直接解释为模型犯错；尚无真实提示/SDK、代表性或收益证明；无付费请求 |
| 冻结条件与覆盖统计 | [本轮验收](2026-10-26-evaluation-verdict.md)：v1 明确每臂首次正确数量与逐样本整树 Token 上限，judge 与 check 分开；保留已测/未知分母及可能范围。94 项回归、18 例宿主组、预先冻结 PASS/FAIL/GAP 场景与退出码 0/2/2 已验证；旧语义明确 GAP。完整交付 21 PASS / 9 BLOCKED；不包含真实模型收益或自动 S2 |
| 平台与安装状态 | 上述 10-25 修复验收为 Windows 隔离安装；macOS/Linux 已配置 CI，报告尚无实跑结果。没有据隔离验收切换日常 profile；早期用户确认重启不代表后续修复已装入或复验 |

## 历史失败与修复关系

| 历史记录 | 后续处置 |
|---|---|
| [local-01](2026-10-25-default-edit-policy-effectiveness-local-01.md)：Windows 加载及 read 指引 FAIL | [fix-01](2026-10-25-default-edit-policy-fix-01.md)关闭这两项；诊断用 file URL 的通过不当作原产品通过 |
| [完整宿主首轮](2026-10-25-default-edit-policy-full-host.md)：21 PASS / 1 FAIL | [fix-02](2026-10-25-default-edit-policy-fix-02.md)关闭 F-03；后续块定位轮次扩展至 33 PASS。各轮独立留证，不相加 |
| 10-23 的 1602 候选安装状态 | 1736 运行确认原 checkout 补丁解析及门禁，原始位置见下表；不代表 10-25 补丁已应用于日常宿主 |
| 10-23 的 1736 / 1807 审计 | 后续修正 scoped policy 两模式的 intent/CAS 与取证配对；v2 按 subCallId 得到 134 次完成行为调用及同轮声明，不再采用 v1 的 268 次统计，见本地 AUDIT-CLOSURE-REPORT 与[独立复核](../../.scratch/ptc-hashline/2026-10-23-1807-review-followup.md) |

1807 修正后的历史候选门禁记录：build/check exit 0、unit 44、integration 140、PTC 19、compat 21，preset/profile exit 0。后续独立复核仅运行受影响的 integration 32 与 PTC 2 项；首次 Windows 沙箱 ReplaceFileW EIO 后在获准非沙箱环境重跑通过。原始运行与后续复核不合并为一次全量结果。


## 仓库内可重跑的证明

| 行为 | 仓库内入口 |
|---|---|
| 有效工作目录 | [working-directory.spec.ts](../../packages/tool-read/tests/integration/working-directory.spec.ts) |
| MV/BOM/部分成功 | [mv-observation.spec.ts](../../packages/tool-read/tests/integration/mv-observation.spec.ts) |
| 引擎快照次序与失败 | [mv-snapshot-order.spec.ts](../../tests/compat/mv-snapshot-order.spec.ts) |
| scoped policy 两模式与 CAS | [edit-policy-composition.spec.ts](../../tests/integration/edit-policy-composition.spec.ts)、[拓扑](../../tests/integration/edit-policy-topology.spec.ts) |
| PTC 错误传播 | [edit-policy.spec.ts](../../tests/ptc/edit-policy.spec.ts)、[mv-policy.spec.ts](../../tests/ptc/mv-policy.spec.ts) |
| 日志完整性、载体与配对 | [extract-runtime-evidence.spec.ts](../../tests/integration/extract-runtime-evidence.spec.ts)、[提取器](../../scripts/extract-runtime-evidence.mjs) |
| 安装、单引擎实例、补丁与 BOM | [test-profile.mjs](../../scripts/test-profile.mjs) |
| 运维 skill 隔离与调用资格 | [operations-skills.spec.ts](../../tests/integration/operations-skills.spec.ts)（真实 preset registry/loader 装配）、[operations-context.spec.ts](../../tests/integration/operations-context.spec.ts) |
| 运维配置与运行基线 | [operations-config.spec.ts](../../tests/integration/operations-config.spec.ts)、[operations-baseline.spec.ts](../../tests/integration/operations-baseline.spec.ts)、[operations-cli.spec.ts](../../tests/integration/operations-cli.spec.ts) |
| 打包后资源可解析（PACK-01 入口切片） | [operations-pack.spec.ts](../../tests/integration/operations-pack.spec.ts) |
| 升级评估/方案/同意 | [operations-upgrade-assessment.spec.ts](../../tests/integration/operations-upgrade-assessment.spec.ts)、[operations-upgrade-proposal-consent.spec.ts](../../tests/integration/operations-upgrade-proposal-consent.spec.ts) |
| 隔离候选验证 | [operations-candidate-validation.spec.ts](../../tests/integration/operations-candidate-validation.spec.ts) |
| 目标切换与失败回退/交接 | [operations-target-switch.spec.ts](../../tests/integration/operations-target-switch.spec.ts) |
| 真实宿主交付验收（打包安装 + 真实装配 + 两条工作流） | [交付验收报告](2026-10-24-delivery-acceptance-report.md)、[入口](../../scripts/delivery-acceptance-cli.mjs)、[自检](../../tests/integration/delivery-acceptance.spec.ts) |
| 默认编辑策略的工程切片（票据 01～08） | [工程验收报告](2026-10-24-default-edit-policy-engineering.md)：各验收 ID 的证据位置、先前存在失败对照、未覆盖项 |

执行说明与环境输入见[根 README](../../README.md)及[测试说明](../../tests/integration/README.md)。用例数量是运行记录，不作为未来版本必须保持不变的常量。

## 本地原始证据的定位

以下均为 Git 忽略的本地留证路径，**不随 clone 交付**。本文只保存必要结论和可重跑入口，不复制原会话、活 profile 配置或私人绝对路径。没有这些文件时，不能宣称已经独立审阅原始日志；可依仓库测试复核对应契约，不能重造历史运行事实。

| 时间/路径（相对仓库） | 内容 |
|---|---|
| `.scratch/ptc-hashline/runtime-verification-report.md`、`runtime-fix-plan.md` | 早期目录/persona 问题与计划 |
| `.scratch/ptc-hashline/2026-10-23-relative-path-mv-rem-report.md` | MV 原始实测失败 |
| `.scratch/ptc-hashline/evidence/phase-a-red.txt` | 早期修复前红测 |
| `.scratch/ptc-hashline/evidence/20261023-1453/` | BOM 丢失与快照文案原始失败 |
| `.scratch/ptc-hashline/evidence/20261023-1602/` | 红绿测试、BOM 矩阵及候选门禁；候选安装树已清理 |
| `.scratch/ptc-hashline/evidence/20261023-1736-a4d1/` | 原 checkout 整合、实际会话与字节证据；部分解释已被后续审计纠正 |
| `.scratch/ptc-hashline/evidence/20261023-1807-4b1d/` | AUDIT-CLOSURE-REPORT、v1/v2 取证、修正前后门禁 |
| `.scratch/ptc-hashline/2026-10-23-1807-review-followup.md` | 五项修正后的独立复核 |

原始报告保持原样；有条件保存关键原始证据时，应另行脱敏并正式归档，而不是批量追踪整个 `.scratch`。本索引不能替代原始运行日志。

## 仍保留的范围限制

- 早期 scoped policy 夹具仍只证明其范围；后续完整 preset/进程 PTC/子代理路径按 fix-02 与块定位报告独立计证。
- 完整宿主使用固定适配器，真实模型请求为零；官方进程 PTC 的 sandbox enforcement 为 partial，不证明完整沙箱隔离。
- 真实 sandbox 后端、多 provider、replace/patch/apply_patch 的 BOM 保真未做系统验收。
- MV 源删除无版本条件、多节无全局事务，属于已知边界；seen 是有限守卫，不是权限边界。
- 剩余 E2 包括无 session/SDK、多窗口上限、remount 失效、真实后端 retry 竞争/取消/unknown、MV+内容混合及更多字节/载荷组合，详见 fix-02 的剩余验收。
- 已有 E3 冒烟但未整体通过，E4 正式对照未执行；`.tmp/order-config-migration/` 另有本地演练记录，本轮仅确认材料存在，未独立重验，不并入正式验收计数。
