# 真实模型评测体系：差距、根因与最小实现验收

2026-10-25。本轮完成无凭据最小实现与离线验证；**没有执行新的真实模型请求，没有正式 S1 / S2 结论**。保留开始时用户的 README 修改和 `.npmrc` 删除；未修改日常 profile、上游源码、依赖版本、read/edit/preset 或 Intent/seen/CAS 契约。

实施依据：[SRS §7](../specs/2026-10-24-hashline-default-editing.md)、[E1–E4](../plans/2026-10-25-default-edit-policy-effectiveness-test-plan.md)、[S0–S2](../plans/2026-10-25-default-edit-policy-promotion-evaluation-plan.md)。新增[数据契约](../specs/2026-10-25-real-model-evaluation-protocol.md)、[实施计划](../plans/2026-10-25-real-model-evaluation-implementation-plan.md)和[执行说明](../../scripts/evaluation/README.md)。机器摘要见[本轮 summary](2026-10-25-real-model-evaluation-summary.json)。

## 1. 差距清单与责任层

| 状态 | 发现及本轮处置 | 可核验产生点 |
|---|---|---|
| 已实现且已验证（存量） | freeze/check、四类分母、unknown 成本规则已有实现；本轮扩展而非重建。原 check 仅信任报告形状，不读取实际文件，不能证明业务正确 | evaluation/protocol.mjs、counting.mjs、原 evaluation-protocol.spec.ts；当前 driver/report 将校验连到原始证据 |
| 已实现且已验证（存量） | 逐帧 Zstd 解码早已存在，E3 使用首帧解码的观察不能归因为宿主丢日志 | [session-log.mjs](../../presets/ptc-hashline/operations/session-log.mjs) 的 scanZstdFrames / decodeArtifact；`.scratch/ptc-hashline/runtime-fix-plan.md` 早已记录此限制 |
| 已实现且已验证（新增） | probe/formal、配置/版本/补丁/环境身份、冻结漂移拒绝、三臂派生、真实初始快照、最终树字节与 diff、候选 checkpoint、调用配对、已观测失败/拒绝/恢复/部分落盘、取消及 unknown | [evaluation 目录](../../scripts/evaluation/README.md)；[新增测试](../../tests/unit/evaluation-evidence.spec.ts)、[协议回归](../../tests/unit/evaluation-protocol.spec.ts)；固定适配器宿主结果 |
| 已实现但缺真实验证 | 真实 provider 的进程内接入、usage、请求参数核对、预算停止和取消路径；本轮只用固定适配器验证，不把模拟 Token 作为收益 | host.mjs / run.mjs；tests/fixtures/evaluation-provider；smoke.mjs。官方 API-key 插件源码在宿主 packages/llm/llm-deepseek-api-key/src/index.ts，凭据通过 apiKeyEnv 解析 |
| 部分实现 | 实际成功模式来自 policy receipt 或已知 stock 工具契约；历史无回执、失败实际执行状态、核验次数、内部 HTTP 重试保持 unknown。跨文件逐目标采用分母/补读返工分类仍未自动建立 | evidence.mjs 的 selectedMode / actualMode / execution；counting.mjs 的 perTargetAdoption unknown；receipt 生产者是 preset policy 的 settle |
| 部分实现 | 根 Session 的 PTC 配对/成本已自动提取；发现委派标 GAP，子 Session 尚未自动归并到任务。预算观察整个隔离宿主 | evidence.mjs traceSummary 的 root-session 范围；run.mjs llm/stream 中间件 |
| 未实现 | 外部漂移、专用工具、特殊拒绝任务的统一冻结注入控制器；纯 auto-policy-off 消融臂；自动 S2 判定 | schedule 只创建初始文件并发送冻结 prompt；armRows 仅定义三个指定能力臂。正式执行需另补，不以 family 字符串冒充刺激已实施 |
| 环境限制 / 外部依赖 | 当前隔离安装可解析 DeepSeek API-key / DeepSeek / pi-ai 包；本进程三种常见 API key 环境变量均不存在。没有本轮真实预算/费用授权。macOS/Linux 未执行 | 本轮 environment-readiness.json 只记录存在性；没有读取日常 profile 密钥，也没有调用 provider |

本轮复核了既有 local-01 → fix-01、完整宿主红测 → fix-02、块定位说明修复和 E3 报告；没有重做已修复的 Windows 模块地址、nextAction、父来源或块解析器工作。与存量的差异是：实际用已有解码器读出 E3 全部帧，并把评测配置/执行/文件证据接入可重跑工具。

## 2. E3 “逐调用不可得”的根因证据

历史样本 1-a 的文件仍为 **50,517 字节**。单次 Node zstdDecompressSync 返回 **320 字节**首帧；现有 decodeArtifact 逐帧读出 **16 帧、50 条记录**，包括 3 对外层工具调用及 5 对内层调用。责任层为解码取证环节，而不是已证明的宿主持久化丢失；没有修改官方持久化代码。

对历史记录列出的 10 个 Session 逐个复核后，均能取得完整序号、turn/end 及外内层配对；合计 **96 个已配对调用（44 外层、52 内层），11 个 edit 调用，64 个模型记录**。样本 1-c 的一次内层失败和后续成功可独立观察。这里的 PASS 只表示结构配对完整，不是 E3 业务全部通过。

历史日志不保存此次需要的最小 policy receipt，所以请求形状可直读、实际分流仍按 unknown 处理，不从成功字节反推执行模式。部分 Session 存在无 usage 的 assistant/attempt，完整成本仍 unknown；不以 cost ledger 或自述填补缺失项。缓存输入必须纳入总输入，例如 1-a：uncached 4,484 + cacheRead 73,728 = 总输入 78,212，输出 1,621。

未重写历史 E3 的 FAIL/BLOCKED，也未把本轮复核当作新增模型实验。原始文件 SHA-256、每 Session 帧数、调用数及 unknown 见 summary，完整脱敏轨迹在 `.scratch/real-model-evaluation/20261025-01/historical-traces.json`。

## 3. 驱动选型与装配修复

agent-loop-testkit 0.2.1-rc.2 的 mountAgentLoopTestDependencies / mountAgentLoopTestHarness 确实挂生产 AgentLoop；它不提供真实 provider、不自动组合完整 preset/PTC。已有 [test-default-edit-host.mjs](../../scripts/test-default-edit-host.mjs) 已证明官方 boot + registry/loader + AgentLoop + Node process PTC 的装配路线，因此本轮复用这条路线，避免重复挂服务或改 headless CLI。

新增宿主冒烟中曾出现派生 preset 的多行 “never started”：根配置最初放在 evidence 目录，loader 因而从该目录解析手动注册的 arm rows。修复为只在一次性 profile 内创建唯一空 root YAML，使解析从该安装目录发生。失败日志 host-smoke-1～4 保留，不把它们改写成通过；最终 smoke-accepted 结果来自已入库的 smoke.mjs。

三臂复用相同 PTC/persona/watchdog 和非编辑工具；stock-edit 的 read/edit 能力面与两种 Hashline 臂不同。因此本轮交付可比较配置，不声称只改变策略一行或已经隔离纯策略因果效应。

## 4. 本轮测试与边界

原始证据根：`.scratch/real-model-evaluation/20261025-01/`。Windows / Node 24.19.0 / pnpm 11.28.5；构建和交付在 `tree/` 独立副本运行，依赖按既有 lockfile 离线安装。pnpm 的跨盘 store 回退警告不作为失败，也未据此修改用户的仓库配置。

| 验证 | 本轮结果 | 证据 |
|---|---|---|
| 评测定向测试 | 30 PASS / 0 FAIL | 两份 tests/unit/evaluation-*.spec.ts；最终交付门禁也包含这些测试 |
| 类型/构建与九项门禁 | 全部 exit 0；交付验收 21 PASS / 0 FAIL / 9 BLOCKED，未覆盖 ID 沿用原交付边界 | [本轮独立交付报告](2026-10-25-real-model-evaluation-delivery-report.md)、[机器摘要](2026-10-25-real-model-evaluation-delivery-summary.json)；原始 delivery-final/ 与 logs/delivery-final.log |
| 三臂完整宿主 | 3 PASS，真实请求 0；每臂 2 次固定适配器请求；首候选 checkpoint/最终文件均正确，报告重算无问题 | logs/smoke-accepted.log、smoke-accepted/protocol.json、report.json、逐 Session 原始事件/回执/候选树；PTC isolation=process |
| 变异验证 | 按预期 FAIL：4 项测试失败；原条件已恢复 | logs/mutation.log；反转 verifyTree 字节相等条件，证明阴性对照能捕获错误 |
| 真实模型实验 | 未执行（BLOCKED） | 缺执行授权及凭据；历史复核不产生新请求 |

代码复核按 code-review-and-quality 的正确性、可读性、架构、安全、性能五轴进行。修复了报告序列化往返的 undefined 哈希差异、拒绝误称实际执行、失败 turn 误计 PASS、程序级候选与内层调用混计等问题。实际包清单记录全部顶层解析版本/入口/manifest；关键宿主/编辑/provider 包另记录运行资源树摘要。第三方的所有嵌套文件不做完整 hermetic attestation，远端 provider 版本/内部 HTTP 重试也不在本地证明范围。

## 5. 剩余 GAP / BLOCKED 与下一步

- **GAP**：真实 provider 请求与取消的集成验证；完整子轨迹归并、逐“文件＋修改目标”的采用分母和返工分类；外部漂移等刺激控制器；macOS/Linux；正式 S2 评判。
- **GAP**：task-end 边界没有首次候选 checkpoint；first-edit-program 有独立快照，但重叠程序、快照失败或证据缺失时结果 unknown。不能用最终正确覆盖首次错误。
- **BLOCKED**：本轮不具备真实凭据和另获批准的模型/费用预算，未启动任何付费实验。
- **后续命令与安全前提**：见 [evaluation README](../../scripts/evaluation/README.md)。先采集 identity，编写独立 probe，冻结，运行默认无执行的 preflight；获单独执行批准后才使用 `--execute`。token 阈值是使用量返回后的停止条件，费用硬限额须在 provider 配置；不能保证在途请求不收费。

本轮只证明离线评测基础设施和指定隔离宿主链路。正式冻结协议、真实模型收益与推广条件尚未满足。
