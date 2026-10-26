# 评测下一阶段验收：逐目标、会话树与冻结刺激

收尾日期：2026-10-26（Asia/Shanghai）。主要开发与早期证据在 10-25；**最终完整复验在 10-26**，变异对照仍来自 10-25，不相加。承接 [23c5dcf 的基础设施验收](2026-10-25-real-model-evaluation.md)及[配置入口](2026-10-25-evaluation-config.md)，本轮新增[阶段计划](../plans/2026-10-25-evaluation-targets-lineage-stimuli-plan.md)范围内的离线能力，**没有执行新的真实模型请求，也没有正式 S1/S2 结论**。

## 交付范围与产生点

| 能力 | 状态与证据边界 | 源码/协议 |
|---|---|---|
| 逐文件＋目标统计 | 已实现且离线验证：显式 targets、四类分母、未尝试/失败/取消不移出分母；首次选择、实际成功模式、失败与恢复、读取顺序和独立最终字节分列。每文件一个目标；未声明、载荷不明、未归属变更时 unknown / GAP | [targets.mjs](../../scripts/evaluation/targets.mjs)、[counting.mjs](../../scripts/evaluation/counting.mjs)、[协议](../specs/2026-10-25-real-model-evaluation-protocol.md) |
| Hashline 目标解释 | 复用实际安装引擎的公开 Patch.parse，核对入口摘要；支持多节与 MV 两端。没有复制编辑器语法或读取模型自述来填精确路径；不能解释的 apply_patch 保留缺口 | targets.mjs installedPatch / requestFiles |
| 父子轨迹与费用 | 已实现且真实宿主固定适配器验证：parentSession 与父 subagent/catalog 的 childId/childCreatedAt 一致；全部目录子会话、稠密序号和捕获顺序均需齐全；按 sessionId＋callId 隔离同名调用。任一成本项缺失不补零 | [session-tree.mjs](../../scripts/evaluation/session-tree.mjs)、[analysis.mjs](../../scripts/evaluation/analysis.mjs) |
| 完成边界与请求对账 | 复用官方 SubagentRuntime.waitForChildren，等待清理后的完成通知，再等父代理空闲；实际 llm/stream 带 Session 归属，捕获外请求拒绝且标记，流量/会话计数不一致只能 GAP | session-tree.mjs idle、[accounting.mjs](../../scripts/evaluation/accounting.mjs)、run.mjs 的准入检查 |
| fork 去重 | 有单元证据：inheritedEventCount 前缀不计入该后代自己的模型与调用统计。实际 fork 端到端本轮未跑，不扩大为完整 fork 验收 | evaluation-next-stage.spec.ts 的继承前缀对照 |
| 冻结的读后竞争者写入 | 已实现且真实宿主固定适配器验证：成功 read 次数触发、真实 before 条件、冻结 after、原始前后字节、成功读取引用重算。条件不符不覆盖；未触发、部分写入、证据缺失均 GAP | [stimuli.mjs](../../scripts/evaluation/stimuli.mjs)、[host.mjs](../../scripts/evaluation/host.mjs) tools/result 监听 |
| 首次候选与恢复 | 新增失败当刻 checkpoint，防止同一 run_code 中 catch 后修复混入首次正确；每批有唯一 ID 与 retryOf。正常多操作仍可同批；重叠程序/缺失边界时 unknown | [evidence.mjs](../../scripts/evaluation/evidence.mjs) candidateSummary、host.mjs checkpoint |
| 离线审计 | 同一 analyzeEvidence 服务执行端与 checker；重新读取图、各 Session 事件/回执、冻结目标、初始/候选/最终树及刺激前后字节。伪造分母、缺少任一目录子会话均拒绝 | [report.mjs](../../scripts/evaluation/report.mjs) |

沿用 read/edit/preset 和现有 PTC/Intent/seen/CAS 契约；未修改官方框架、补丁、依赖版本或日常 profile。评测监听只在显式启动的独立宿主中存在。额外导出、快照和刺激 I/O 计入评测墙钟，不当作模型调用或模型核验。

## 执行与可追溯结果

原始证据根：`.scratch/real-model-evaluation/20261025-next/`，Git 忽略，不随 clone 提供。正式脱敏清单见[机器摘要](2026-10-26-evaluation-next-stage-summary.json)。Windows / Node 24.19.0 / pnpm 11.28.5；构建和完整交付均在 `tree/` 独立副本执行。验收时维护 HEAD 为 `411ea54`，包含本轮未提交增量，机器摘要记录执行源码 SHA-256；不声称干净提交已被同样执行。

| 执行轮次 | 结果 | 产物 |
|---|---|---|
| 10-26 最终定向回归 | **55 PASS / 0 FAIL**，4 个 evaluation 测试文件；类型检查 exit 0 | logs/evaluation-accounting-20261026.log、tests/unit/evaluation-next-stage.spec.ts 及原三套回归 |
| 10-26 隔离构建/完整交付 | 九项门禁全部 exit 0；交付 ID **21 PASS / 0 FAIL / 9 BLOCKED** | [本轮交付报告](2026-10-26-evaluation-next-stage-delivery-report.md)、[summary](2026-10-26-evaluation-next-stage-delivery-summary.json)，原始 delivery-accounting-20261026/、logs/delivery-accounting-20261026.log |
| 10-26 最终宿主冒烟 | **12 PASS / 0 FAIL**，4 任务 × 3 臂，15 个本地 Session；独立 checker problems=[]；33 次流量请求与 33 条会话请求一致 | smoke-accounting-20261026/、logs/smoke-accounting-20261026.log |
| 10-25 变异验证 | 故意漏检未捕获的目录子会话后，**1 项阴性测试失败**，19 项保持通过；源文件已恢复 | logs/mutation.log |

交付生成器按 UTC 截日命名，较早的 10-26 本地轮次可能仍使用含 2026-10-25 的文件名；最终 accounting 轮生成名已是 10-26。以机器 startedAt 换算 Asia/Shanghai 记执行日期，不改写原始时间。早期 53 项定向、13 项模板及其它宿主轮次均保留原日志，不加进最终 55 / 12 的计数。

三臂仍是 stock-edit / hashline-default / hashline-fallback，复用相同 persona、watchdog 和 PTC。以下结果均由**固定适配器**产生，不是模型选择或收益实验：

| 冻结任务 | 组数 | 已证明的行为 |
|---|---:|---|
| 单点更新 | 3 | 各臂独立目标映射、文件字节正确、首候选正确 |
| 两文件更新 | 3 | 每文件一个目标，两个目标均保留；同程序正常多操作作为同一候选 |
| 真实 subagent 委派 | 3 | 每组捕获父＋子两个 Session、目录来源、独立内外层调用与整树 usage |
| 成功 read 后外部变更 | 3 | 每组刺激恰好应用一次；首次编辑失败快照为竞争者内容，随后读取并修复到 expected；**首次候选错误、最终正确、候选重试 1 次** |

本轮有 33 次固定适配器请求，usage 是夹具人为值；**真实模型请求 0**。它们只能证明计量归并路径，不证明真实 Token 成本、模型遵从、净收益或统计显著性。三臂也不等于仅切换一行 policy 的纯策略消融。

## 调查与复核修正

与前轮相比，没有重做已修复的默认策略或 Zstd 问题，本轮新增的是目标/会话树/受控竞争者的产生与审计路径。复用了现有宿主 subagent/catalog、Session 事件和 Hashline 公开解析器。

首次 smoke-01 虽最终文件均正确，但计数仍把同程序中失败后的恢复并入首候选。后续增加失败当刻快照，smoke-02 等轮次证明了首错/最终正确分离。

最终交叉对账又发现，早期捕获只有 30 条会话请求，而流量计为 33；差额恰为三个委派案例的父代理末次请求。产生点是官方子代理管理器在 child.whenIdle 之后仍要清理激活并 notifySettlement 唤醒父代理；仅等待所有 Agent.whenIdle 加一次 setImmediate 不构成完成边界。修复为调用现有公开 waitForChildren，按其契约重新检查父代理空闲；同时新增请求 Session 归属准入与 requestAccounting 独立重算。计数不一致或捕获外请求即 GAP，不能靠最终字节正确掩盖成本轨迹缺失。最新 accounting 轮为 33/33、无捕获外请求。早期“12 PASS”只证明当轮文件/局部结构检查，不能当作完整费用归并证据；各轮独立保留，最终采用 smoke-accounting-20261026。

五轴代码复核沿用 code-review-and-quality：额外关闭了“有一个已捕获子代理就漏掉另一个缺失子代理”、跨会话同名 ID 混合、fork 前缀重复收费、读取并发时过度分类、没有归属调用却把磁盘变更当未尝试，以及 `__proto__` / `constructor` 文件名干扰整树验证的问题。缺少读取引用的 applied 声明不能单凭摘要通过；报告的固定说明也已改为逐字段判读，不再错误声称可测的首次候选仍 unknown。

一个早期阴性测试用重命名模拟子源缺失时，在 Windows 沙箱遇到 EPERM；改为让图引用不存在的源工件，仍验证同一个“缺失证据必须拒绝”行为，没有豁免生产检查。该失败不计为产品功能 FAIL，也不把其环境原因扩大为已证明的框架问题。

## 剩余 GAP / BLOCKED

- **GAP**：同文件多个独立修改目标；不能可靠归属的 apply_patch / 专用工具载荷；读取意图与语义返工分类；并行重叠候选的精确归属。现有保守 unknown 不代表这些指标已完整测量。
- **GAP**：外部进程代理；实际 fork 和取消时的端到端验证；真实 provider usage、内部 HTTP 重试和取消计费边界；macOS/Linux。本轮实际委派仅覆盖同进程本地 subagent。
- **GAP**：当前刺激只覆盖成功 read 计数触发的外部普通文件写入。其它时点、权限拒绝、专用工具、删除/移动竞争者等完整正式任务控制器及自动 S2 未实现。
- **BLOCKED（本轮范围）**：未启动真实模型，仍须先确认可用凭据、实际模型与费用预算，并获得真实执行授权。代码可以冻结 formal，但不意味着 S1 所有刺激/指标已齐备。

使用新版[配置模板](../../scripts/evaluation/experiment.example.json)或在自己的配置中添加 targets / stimuli；不会改写已有本地实验配置。[执行说明](../../scripts/evaluation/README.md)中的 prepare 和默认 preflight 不产生模型请求，显式 `--execute` 才可能付费。旧报告按原范围保留；缺失败边界快照时不能继续宣称同程序修复之前“首次正确”。
