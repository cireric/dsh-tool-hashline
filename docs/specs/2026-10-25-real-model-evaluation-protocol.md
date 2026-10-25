# 真实模型评测协议补充

2026-10-25。承接[默认编辑策略 SRS §7](2026-10-24-hashline-default-editing.md)，仅细化维护者评测数据和离线执行契约；不改变日常工具、策略或升级授权。实现与剩余范围见[实施计划](../plans/2026-10-25-real-model-evaluation-implementation-plan.md)和[验收](../acceptance/2026-10-25-real-model-evaluation.md)。

## 冻结输入

维护者可编辑 [experiment.example.json](../../scripts/evaluation/experiment.example.json) 的副本，再用 prepare.mjs 合入实际安装身份并冻结。该便捷格式以 provider（plugin / credentialEnv / config）声明连接信息；工具摘要、依赖身份及冻结元数据由命令生成，禁止手工覆盖。它不改变下表协议，也不授权模型执行。模型、总预算与条件的 null 项必须填写；详见 [用法](../../scripts/evaluation/README.md)。

| 字段 | 契约 |
|---|---|
| id / createdAt | 本轮身份、编写时间 |
| kind | `probe` 或 `formal`；probe 的非空 limits 明示不证明的事项 |
| comparison | distinct `stock-edit` / `hashline-default` / `hashline-fallback`，至少两臂 |
| dependencies | inspect identity 采集的 packages、patches、resources、inputs、profileInputs、driverInputs、environment、readEngine / editEngine；包含解析路径、版本、运行文件摘要、补丁实际标记和源补丁摘要 |
| tools | presetHash、每臂派生配置摘要 arms、providerPlugin、无字面凭据的 providerConfig、credentialEnv（仅变量名） |
| model | 非空 provider / model；parameters 仅接受当前 AgentOptions 支持的 reasoningEffort / maxTokens。temperature 等未支持字段拒绝，不静默忽略 |
| samples | 正整数 repetitions / seed |
| order | `interleaved`：每任务按 seed + repetition + task index 旋转臂顺序，固定执行 |
| budget | 正整数 maxModelRequests / maxTotalTokens / timeoutMs；token 为观测停止阈值 |
| passConditions | 有限非负 minFirstCandidateCorrect / maxTotalTokensPerTask；先冻结，不能据结果补填 |
| tasks | 唯一 id、family、prompt、class、batchBoundary、initial / expected |

formal 仍须覆盖原 SRS 的 13 个任务族；probe 可取子集。没有自动推广判定。冻结后身份变化即拒绝，不沿用历史哈希；已有 frozen 输出不覆盖。执行前以及每样本前核对实际安装身份，缺包、补丁不全、引擎不同或身份漂移均停止。

三臂复用相同 persona、watchdog、PTC、宿主策略、非编辑工具：stock-edit 启用 stock read/edit 并移除自有 read/edit；hashline-default 将当前受管 edit 固定为 hashline；hashline-fallback 保留当前受管 auto 与三类 fallback 的事实检查。它们同时改变可用的 read/edit 能力，**不是只改变 policy 一行的消融实验**。原 auto-policy-off 对照仍可另行冻结实现，本轮不把三臂替代结果解释为纯策略因果效应。

## 任务与正确性

initial 是相对文件名到 UTF-8 内容的对象；允许空对象用于创建。expected 独立编写，值为 UTF-8 内容或 null（要求不存在）；未列出的初始文件必须保持不变。目录穿越、绝对路径和反斜线拒绝；最终树中的额外文件也判错。零字节、换行、空白及 BOM 按字节比较，不使用工具接受、自述或模式名作为正确性。

class 使用 known-applicable / declared-exception / no-change-needed / applicability-unknown。当前它是任务注释，不能自动代表一个多文件任务的全部“文件＋修改目标”采用率分母；逐目标映射未建立时该指标 unknown。

batchBoundary 支持 `task-end` 和 `first-edit-program`。后者将第一段含 edit 的 run_code 定为首候选，同程序可含一组 replace；每段结束保存文件树 checkpoint，后续含 edit 程序作为候选重试并关联 retryOf。并行重叠程序无法隔离候选时为 GAP。两臂必须使用相同边界，不能因观察到错误再把修正并入首批。额外 evaluator 快照 I/O 逐候选发生，计入墙钟时间，不伪装成模型工具调用。

最终正确与首次完整候选正确是两个维度；task-end 没有首候选 checkpoint，后者 unknown。追加内层 edit 不自动计为重试；只有真实 policy receipt 的 retry 能报告已观察到的内部重试，不能用未出现的 retry 字段证明零次重试。

## 轨迹与成本

使用真实 Session 事件及 tools/result、tool-edit/policy-receipt 的现有公开入口；PTC 按 subCallId 配对 start/settle 并检查外层 rootCallId，外层成功不掩盖内层失败。重复、缺 seq、缺 settle、缺 turn/end、缺父调用均记 GAP。请求载荷形状、策略选定模式、实际成功完成的模式分列；拒绝不能伪装成已执行替代模式。失败调用的既有磁盘副作用不由 receipt 推断。

TokenUsage 的 inputTokens 是未缓存输入。总输入优先由权威 totalTokens - outputTokens 得出，同时保留 uncachedInputTokens；不把缓存漏出成本分母。任一请求缺 usage 时保持 unknown；不以字符串长度估 Token。失败、重试和取消保留在报告里；observed edit failures、recovery 和部分任务落盘分别统计，部分落盘不等于 edit 的事务语义。

当前 trace 统计范围为根 Session；发现委派则记 GAP、相关整组成本 unknown，不能假装覆盖子会话。预算中间件观察整台隔离宿主的请求，子会话也受请求/Token 停止条件约束。完整子轨迹归并与逐目标重试分类留待后续。

原始事件只在本地被忽略目录保留；正式报告只导出必要标识、摘要、模式/错误枚举、计数及文件验证结果，不复制消息、参数、凭据值或正文。脱敏仍需发布前审阅。执行/使用命令见 [evaluation README](../../scripts/evaluation/README.md)。
