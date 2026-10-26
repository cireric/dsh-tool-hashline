# 剩余四个工作包的有界恢复

2026-10-26，用户在[收口](../acceptance/2026-10-26-project-closeout.md)后明确要求继续完成四项核心工作，并要求通过文件自行配置 BASE_URL、Provider 和模型 ID。恢复范围仅为下表，原三类扩展缺口继续保留；日常推荐 PTC、Hashline 可选与暂停默认推广的决定不变。完成标准是可审计的结果和有边界的结论，不要求证明 Hashline 胜出。

| 工作包 | 有限产出和验收 | 执行边界 |
|---|---|---|
| 1 实际请求取证 | 在正式 AgentLoop 的 llm/stream 请求边界保存完整 messages、tools/toolHistory、参数及 Session 前缀定位；用冻结的官方 Session 重放独立核对。比较请求中的完整系统文本和工具声明，不再只依赖 assembly 摘要 | 原始内容仅保存在本地工件，报告输出摘要与差异；明确该边界在 adapter 的传输/模态投影之前，不冒充 HTTP wire 抓包 |
| 2 正式设计定稿 | 提供有界 S0/formal 配置、独立 expected、相同初态/参数、预先声明重复和指标；consecutive 的合规中间阶段单列，仍保留全部最终正确性与 Token 分母。主结论按完整工具配置比较，不作纯策略因果推断 | 用户自行填写连接、模型、预算和阈值后再冻结，不用执行结果反推条件 |
| 3 真实 S0 | 按用户冻结配置验证真实请求、usage、调用配对、独立结果与取消边界；保留缺失为 unknown | 用户已明确批准完整 S0 第二轮并执行；请求闭环与总 usage 可查，任务/首次条件 FAIL，仍有模式归属 GAP。详见本计划末尾验收链接 |
| 4 S1/S2 | 按冻结安排执行对照并形成 PASS/FAIL/GAP 分层及有限结论，完整保留失败/取消；比较可审计总成本与正确性 | S0 达到预先约定条件后，才由明确授权的命令执行正式组；证据不足也是允许的最终结论 |

优先复用现有协议和官方 Session/AgentLoop/Provider，不改 DSH 官方源码、版本或日常 profile。连接配置复用现有 provider.config；优先提供已安装 pi-ai 插件的自定义兼容端点例子，API key 仍为环境变量引用。BASE_URL 不等于 Provider 路由名，配置校验应指明不一致项。

本轮先实现并验证无需真实凭据的部分。真实配置、费用和执行未确认时保留 S0/S1 待执行，不用夹具或两轮外部报告填补。不存在自动续跑、自动升级或默认推广安排。

## 本轮实施结果（2026-10-26）

[验收与机器摘要](../acceptance/2026-10-26-evaluation-request-evidence.md)记录前两包已实现及无费用验证：组装请求捕获/官方 Session 重放/SDK 比较、可编辑网关配置、固定 S0/S1 设计及指标分母。241 项定向测试通过，九项交付门禁 exit 0；完整固定 Provider 任务结果仍保留 FAIL/GAP。第三、四包的真实 Provider S0 与 S1/S2 尚未执行，需手动填写连接、容量、预算和阈值后显式执行；本轮真实模型请求 0。

### 真实 S0 首轮跟进

用户填写连接并明确批准有限 S0 后，已执行[首轮真实验证](../acceptance/2026-10-26-evaluation-real-s0-modelscope.md)：首请求收到 reasoning，120 秒超时取消；1 CANCELLED / 8 BLOCKED，usage unknown，未自动重试或执行 S1。请求捕获和重放 1/1，但完整 S0 尚未完成。前述无费用验证计数和真实请求 0 仅描述前轮，不覆盖此轮。

后续[超时诊断](../acceptance/2026-10-26-evaluation-s0-diagnosis.md)：补齐显式 low 与输出字段配置，本项目 cap 枚举误拒已修；用户批准的一次真实诊断约 46.2 秒返回工具调用和完整 usage（14,827 Token），没有执行工具或续跑整组。完整 S0 仍 GAP，正式组未执行；后续需复核预算。

### 完整 S0 第二轮结果

经用户批准新预算与阈值，[第二轮](../acceptance/2026-10-26-evaluation-real-s0-modelscope-02.md)9 项全部执行，28/28 请求对账及独立重放，总 Token 398,176；3 PASS / 3 GAP / 3 FAIL、最终 6 正确。三个 Hashline 首次输入缺方括号被拒后恢复，另三个样本只输出意图未执行工具；不是超时或预算耗尽。S0 实验执行完成但验收 FAIL；保留取证 GAP，停止于 S0，未启动 S1/S2。

### S0 后续无费用审计

[模式/提示审计](../acceptance/2026-10-26-evaluation-payload-prompt-audit.md)已交付：新增冻结 editPayloadVersion=2，坏 header 不再误标 apply_patch，旧报告继续按原版本复核；真实 SDK/可见结果核对未发现明确格式冲突，三次无工具响应均正常 stop。297 项单元、类型及固定 Provider 18 项宿主验证通过，新增真实模型请求 0。原 S0 FAIL 保留，未启动 S1；不为追求通过自动改提示或付费重跑。
