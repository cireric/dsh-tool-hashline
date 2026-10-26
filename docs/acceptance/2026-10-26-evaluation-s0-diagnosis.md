# S0 超时诊断：推理配置、输出字段与预算边界

日期：2026-10-26。承接[首轮真实 S0 GAP](2026-10-26-evaluation-real-s0-modelscope.md)。本轮先离线重放和本地 HTTP 检查，再按用户明确授权追加 **1 次真实诊断请求**；未执行返回的工具操作，未续跑 S0 或启动 S1。原失败报告保持不变。

## 结论与证据强度

| 问题 | 已确认事实 | 仍不能推断 |
|---|---|---|
| 为什么首轮停止 | 样本本地 120 秒定时器触发时，响应仍处于 reasoning，无工具调用、无完整 usage；其后 unknown 费用守卫阻止剩余 8 项 | 不能把取消后的文件未改判成 Hashline 编辑工具失效；此前尚未进入该工具 |
| 为什么没有关闭/降低推理 | 首轮未指定 reasoningEffort；当前适配器对 reasoningEfforts=false 仅声明不提供推理控制，本地 wire 未发送 reasoning_effort/thinking。模型官方说明未指定档位默认 max | ModelScope 首轮内部实际档位没有服务端回执，默认 max 是有来源支持的推断，不是观测值 |
| 输出 cap 是否可靠 | 实际适配器默认序列化为 max_completion_tokens=4096；可用现有 compat.maxTokensField 改为 max_tokens。此前本项目凭据扫描会误拒该合法枚举，现已修复 | 首轮没有 HTTP 抓包，不能把本地重放当首轮远端 wire；也没有证明 ModelScope 忽略 max_completion_tokens |
| 候选是否可用 | 同一提示显式 low + max_tokens=4096 的单次真实请求约 46.2 秒完成，返回工具调用和完整 input/output/total usage；本次 HTTP 字段实测记录可查 | 同时修改两个配置、只测一次，不能分离各自因果贡献，不能保证后续每次都不超时或已完成编辑 |
| 原预算/成本条件是否合适 | 本次一次请求已消耗 14,827 Token；原 S0 共 9 项且通常需要多轮模型交互，120,000 总观测阈值有提前停止风险。逐任务 20,000 条件在第二次请求输入成本相近时也会超限，可能让正确任务仍条件 FAIL | 不把一次样本成本乘法当作三臂实测总费用，不事后改阈值；首次流失败的收费仍 unknown |

模型作者的[官方模型卡](https://huggingface.co/zai-org/GLM-5.3-Flash/raw/main/README.md)说明支持 low/high/max，缺省为 max。[官方思考说明](https://docs.z.ai/guides/capabilities/thinking)指出该系列不支持关闭思考。因此下一轮采用明确 low 候选，不把 false 或 off 当作可关闭 GLM-5.3-Flash 的保证；ModelScope 的实际调度行为仍以本轮响应及后续实验为边界。

## 可复核的诊断过程

原始目录：`.scratch/real-model-evaluation/20261026-s0-diagnosis-01/`；文件摘要和来源位置见[机器摘要](2026-10-26-evaluation-s0-diagnosis-summary.json)。

1. `node .scratch/real-model-evaluation/20261026-s0-diagnosis-01/replay-symptom.mjs` 离线重放既有事件，exit 1：CANCELLED、reasoning 13,676 字符、0 工具调用、completeUsage=false。该命令能复核已发生症状，不冒充确定性复现远端性能。
2. `wire-probe.mjs` 将实际固定版本 pi-ai 适配器接到本地模拟 SSE 服务，用假凭据发送原 GenerateOptions，仅改变端点。原配置没有推理控制，cap 为 max_completion_tokens；zai/off 负向变体会序列化 thinking.disabled，但不用于实际 GLM 请求。模型和工具正文留本地，不导出。
3. `wire-candidates.mjs` 分别只变推理声明、只变 cap 字段，再检验组合配置：显式 low 可发送 reasoning_effort=low；cap 枚举可发送 max_tokens=4096；均可解析夹具 usage/finish。六个本地请求不代表真实模型完成，也不回填首轮 providerWire=unknown。上游 detectCompat 将 custom-gateway/ModelScope 与回环地址都视作通用兼容端点，函数位置及哈希见摘要。
4. 在纯冻结入口加 5 项回归。合法 maxTokensField 两个枚举先被凭据扫描误拒（2 FAIL / 22 PASS）；自有 protocol.mjs 仅豁免精确键及 max_tokens/max_completion_tokens 值，其它 token 字段、任意字符串/null/对象仍拒绝。没有修改、复制或升级官方适配器。
5. 相关 14 文件 **246 PASS**，完整单元 22 文件 **291 PASS**，类型检查 exit 0。把豁免故意放宽为任意 maxTokensField 值的隔离变异导致 **2 FAIL / 22 PASS**；副本已恢复，与源文件 SHA-256 相同。原 S0 报告 checker 在修复后仍 exit 0。

`pnpm exec` 一次尝试因 package-manager shim 请求 npmmirror 失败，未执行测试；随后使用仓库已安装的 Vitest/TypeScript 入口完成上表测试，没有下载、升级或改 lockfile。最初通配符命令只选中 8 项，不记作全量；246/291 来自之后显式文件清单/完整配置的独立日志。未将前轮九项交付门禁改写为本轮重新执行。

## 追加的一次真实请求

用户明确批准：复用原提示，low、max_tokens=4096、300 秒超时，只接收响应与 usage，不执行工具、不启动 S1。`real-once.mjs` 为本地单次诊断编排，不是正式评测驱动替代品；通过现有 openHost/llm 实际调用，拦截传输字段核对，拒绝第二次 HTTP/stream 请求，使用冻结候选的实际安装身份预检。

| 项目 | 实际值 |
|---|---|
| 实际模型请求 / HTTP 观测 | 1 / 1；端点路径 /v1/chat/completions |
| HTTP 字段 | reasoning_effort=low，max_tokens=4096，无 max_completion_tokens；stream_options.include_usage=true |
| 响应 | 有 reasoning、正文及 tool-call 流；finish=tool-calls，未执行模型提出的工具操作 |
| 首 chunk / 整槽耗时 | 10,813 ms / 46,249 ms；含宿主装配，不是独立模型延迟 |
| usage | inputTokens=14,186，outputTokens=641，totalTokens=14,827；其它缓存分项及货币费用不补造 |
| 结果边界 | 单次响应/usage 诊断 PASS；完整 S0 编辑闭环仍 GAP，S1/S2 未执行 |

首轮记录的 messages 含 57,648 个文本字符、外层工具定义 2,496 字符；本次输入用量说明请求上下文成本不可忽略。但字符数不是 tokenizer 计数，也不能证明大提示本身导致长 reasoning。不得通过删改共享 persona/Intent/SDK，事后把另一个实验当作原三臂对照。

## 后续工作

已提供新候选 `s0.low.candidate.experiment.json` 与其冻结件：相同三臂任务、明确 low、max_tokens 字段，原 120 秒/36 请求/120,000 Token 条件保持，**没有执行该整组**。它用于审阅，不是完整 S0 可通过的预算承诺。下一轮应先按实际服务用量重新决定请求/Token 预算、逐样本成本阈值和超时，并冻结新协议；即使原参数都保留，也需显式执行新一轮，不能覆写首轮证据。

如果全部样本沿用本次约 1.48 万 Token/请求，18 次请求的情景约为 26.7 万 Token；这只是“两次请求/任务且各请求成本相近”的预算示例，非已批准费用或实测总量。原 12 万上限很可能只够部分样本，不能把预算提前停止解释为某编辑方案失败。原取消请求的供应商收费仍需服务端记录，无法从本地补造。

本轮已确定停止机制和配置缺口，并获得一次有完整 usage 的真实响应，尚未证明完整 S0 通过或 Hashline 有收益。没有日常 profile、preset、Intent/seen/CAS 契约或上游依赖的变更。

后续：[完整 S0 第二轮](2026-10-26-evaluation-real-s0-modelscope-02.md)经用户另行授权执行 9 项，请求闭环 28/28、总 Token 398,176；任务与首次条件 FAIL，未启动 S1。本报告保留诊断轮范围和计数。
