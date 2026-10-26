# 真实模型评测协议补充

2026-10-25 建档，2026-10-26 补充逐目标、会话树、请求对账与冻结刺激。承接[默认编辑策略 SRS §7](2026-10-24-hashline-default-editing.md)，仅细化维护者评测数据和离线执行契约；不改变日常工具、策略或升级授权。基础实现见[实施计划](../plans/2026-10-25-real-model-evaluation-implementation-plan.md)和[前轮验收](../acceptance/2026-10-25-real-model-evaluation.md)，后续边界见[阶段验收](../acceptance/2026-10-26-evaluation-next-stage.md)。

## 冻结输入

维护者可编辑 [experiment.example.json](../../scripts/evaluation/experiment.example.json) 的副本，再用 prepare.mjs 合入实际安装身份并冻结。该便捷格式以 provider（plugin / credentialEnv / config）声明连接信息；工具摘要、依赖身份及冻结元数据由命令生成，禁止手工覆盖。它不改变下表协议，也不授权模型执行。模型、总预算与条件的 null 项必须填写；详见 [用法](../../scripts/evaluation/README.md)。

| 字段 | 契约 |
|---|---|
| id / createdAt | 本轮身份、编写时间 |
| kind | `probe` 或 `formal`；probe 的非空 limits 明示不证明的事项 |
| comparison | distinct `stock-edit` / `hashline-default` / `hashline-fallback`，至少两臂 |
| dependencies | inspect identity 采集的 packages、patches、resources、inputs、profileInputs、driverInputs、environment、readEngine / editEngine；包含解析路径、版本、运行文件摘要、补丁实际标记和源补丁摘要。inputs 同时冻结评测复用的本地 default-edit-policy/user-source 辅助模块 |
| tools | presetHash、每臂派生配置摘要 arms、providerPlugin、无字面凭据的 providerConfig、credentialEnv（仅变量名） |
| model | 非空 provider / model；parameters 仅接受当前 AgentOptions 支持的 reasoningEffort / maxTokens。temperature 等未支持字段拒绝，不静默忽略 |
| samples | 正整数 repetitions / seed |
| order | `interleaved`：每任务按 seed + repetition + task index 旋转臂顺序，固定执行 |
| budget | 正整数 maxModelRequests / maxTotalTokens / timeoutMs；token 为观测停止阈值 |
| passConditions | 有限非负 minFirstCandidateCorrect / maxTotalTokensPerTask；先冻结，不能据结果补填。v1/v2 两者均为整数，分别是每臂首次正确最小样本数、每个任务×重复×臂样本的整树 totalTokens 上限。v1 对全部任务计首次，v2 必须冻结 firstCandidateScope |
| tasks | 唯一 id、family、prompt、class、batchBoundary、initial / expected |

formal 仍须覆盖原 SRS 的 13 个任务族；probe 可取子集。没有自动推广判定。冻结后身份变化即拒绝，不沿用历史哈希；已有 frozen 输出不覆盖。执行前以及每样本前核对实际安装身份，缺包、补丁不全、引擎不同或身份漂移均停止。

## 条件判定与未知覆盖

冻结 v1/v2 语义后，逐臂判定上述两个绝对条件，结果写入 report.conditions；它与任务/取证的 report.status 分开。v1=per-arm-count-and-per-run-tokens-v1，其每臂首次分母为全部任务数×重复数；v2=per-arm-cohort-count-and-per-run-tokens-v2，其每臂首次分母为冻结 include 数×重复数。选中样本的失败、取消、BLOCKED 和未测均保留。首次正确只接受可复核的布尔值；Token 上限始终覆盖全部任务的含后代 totalTokens，不用均值掩盖单个超限。

v2 的 passConditions.firstCandidateScope 必须为 `{include: [taskId], exclude: [{taskId, reason}]}`。全部任务恰好出现一次，ID 不得重复/交叉/未知，排除理由非空；最小数量不得超过所选任务数×重复数。范围对所有臂、所有重复一致，不能按执行结果自动改变；v1/无语义协议不得携带该字段。排除是作者声明的指标范围，不是模型/工具推断的“不适用”事实，也不证明被排除任务天然不适用。

v2 条件结果 version=2，首次条件含 cohort 的 include/exclude/excludedSamples。全局 coverage 仍保留全部任务的未知，不因排除改写；最终文件、调度、取证与 Token 检查也覆盖全部任务。probe 可明确把首次范围设为空，但最小数量必须为 0，首次条件标 NOT_APPLICABLE，比例与上下界为 null；token 和任务/取证仍可能 FAIL/GAP。formal 必须有非空首次范围，13 个任务族要求不因排除而降低。旧 v1 输出形状及全任务口径不变，旧冻结件不迁移。

所选范围内已知首次正确数＋未知数仍小于最小要求，或全部任务中任一已知 Token 超限，即 FAIL；其余存在所选首次未知或任一任务 Token 未知时 GAP；覆盖完整且条件满足才 PASS。显式空 probe 首次范围为 NOT_APPLICABLE，仅由其它条件与全部任务结果决定是否通过。PASS 只表示满足冻结的绝对条件，不包含因果收益、统计推广或 S2 授权。旧协议缺 semantics 时 conditions=GAP，reason=semantics-not-frozen；不把历史 PASS 解释成阈值通过。

report.coverage 独立保留每臂首次/最终正确的 correct、incorrect、measured、unknown、denominator；rateOnMeasured 仅为描述，同时给出完整计划分母的 rateBounds。上下界分别把未知当错误/正确，是缺失数据的可能范围，不是统计置信区间。成本提供 knownSum/measured/unknown/denominator，unknown>0 时 knownSum 不是总成本。目标注释缺失单列 unknownSamples，不抹掉已有的目标统计。原 summary 的全量 unknown 口径不变，历史报告继续按原字段检查。

新 report.evaluationVersion=1 必须带可重算的 coverage/conditions 和请求对账；有版本语义条件的新协议必须使用该报告版本。check 校验证据和计算一致性，允许真实 FAIL/GAP 报告；judge 在证据一致后单独判条件，且要求任务/取证也为 PASS 才退出 0。条件 PASS 不能覆盖最终文件错误。未执行样本不得伪造 trace，整体任务/取证状态也必须可重算。wallMs 仍是包含评测器开销、由运行端现场记录且未独立重建的样本耗时，不用于本轮 Token 条件，也不充当模型延迟。

三臂复用相同 persona、watchdog、PTC、宿主策略、非编辑工具：stock-edit 启用 stock read/edit 并移除自有 read/edit；hashline-default 将当前受管 edit 固定为 hashline；hashline-fallback 保留当前受管 auto 与三类 fallback 的事实检查。它们同时改变可用的 read/edit 能力，**不是只改变 policy 一行的消融实验**。原 auto-policy-off 对照仍可另行冻结实现，本轮不把三臂替代结果解释为纯策略因果效应。

## 任务与正确性

initial 是相对文件名到 UTF-8 内容的对象；允许空对象用于创建。expected 独立编写，值为 UTF-8 内容或 null（要求不存在）；未列出的初始文件必须保持不变。目录穿越、绝对路径和反斜线拒绝；最终树中的额外文件也判错。零字节、换行、空白及 BOM 按字节比较，不使用工具接受、自述或模式名作为正确性。

class 使用 known-applicable / declared-exception / no-change-needed / applicability-unknown，任务 class 仍只是整组注释。可选 targets 数组以 id / path / goal / class 冻结每个“文件＋修改目标”；当前每文件只允许一个目标，且覆盖全部 expected 中的文件变更。不按模型自述补目标、不删除未尝试/失败/取消目标；未声明时采用率 unknown。路径还须排除跨平台非法字符、Windows 设备名和尾随点/空格。

工具目标从原始参数和会话有效目录解析：Hashline 复用实际安装引擎的公开 Patch.parse，包含 MV 源/目标；replace / patch 使用明确路径。无移动的受管 apply_patch 复用上游解析后进入策略 decision.targets 的计划：本地回执保存 parsedPlan，交叉核对版本、同 Session 调用/根调用、请求/选定模式及现有 requestTargets 文件头集合，并约束在任务目录内。文件头单独出现不证明解析成功；早期拒绝无计划、集合不一致或任一重试计划缺失均 unknown。现有计划不含 rename 目的端，含 Move to 一律 unknown；shell、其它专用工具及未归属变更仍 unknown / GAP。

parsedPlan 仅保存调用、模式和路径/操作元数据，不复制正文，保留在本地原始回执 sidecar；报告 trace 不导出该字段。checker 重读原始回执重算目标，不能靠报告自己补计划。解析计划既不证明调用执行成功，也不证明所有文件落盘；已失败/拒绝的模式保持 unknown，独立最终字节仍是正确性依据。旧回执没有此字段时不补造。

首选载荷与选定路由冲突时也不虚构精确选择。逐目标最终正确用独立 expected 字节判断；正常首读、编辑前额外读取、失败后读取、成功后读取及并发/未知读取分列，这些是观察事实，不自动证明读取意图或语义返工。

batchBoundary 支持 `task-end` 和 `first-edit-program`。后者以首段含 edit 的 run_code 开始首候选，同程序可包含一组正常操作；程序结束或任何内层 edit 失败时立即保存文件树 checkpoint，失败后的继续编辑是新候选，即使模型在同一程序中 catch 并修复。每批有唯一 id、sessionId、边界调用、attempt 和 retryOf；并行重叠程序无法隔离候选时为 GAP。旧证据缺少同程序失败/恢复间快照时不得沿用“首次正确”。额外 evaluator 快照 I/O 计入墙钟，不伪装成模型工具调用。

最终正确与首次完整候选正确是两个维度；task-end 没有首候选 checkpoint，后者 unknown。追加内层 edit 不自动计为重试；只有真实 policy receipt 的 retry 能报告已观察到的内部重试，不能用未出现的 retry 字段证明零次重试。

## 轨迹与成本

使用真实 Session 事件及 tools/result、tool-edit/policy-receipt 的现有公开入口；PTC 按 subCallId 配对 start/settle 并检查外层 rootCallId，外层成功不掩盖内层失败。重复、缺 seq、缺 settle、缺 turn/end、缺父调用均记 GAP。请求载荷形状、策略选定模式、实际成功完成的模式分列；拒绝不能伪装成已执行替代模式。失败调用的既有磁盘副作用不由 receipt 推断。

TokenUsage 的 inputTokens 是未缓存输入。总输入优先由权威 totalTokens - outputTokens 得出，同时保留 uncachedInputTokens；不把缓存漏出成本分母。任一请求缺 usage 时保持 unknown；不以字符串长度估 Token。失败、重试和取消保留在报告里；observed edit failures、recovery 和部分任务落盘分别统计，部分落盘不等于 edit 的事务语义。

新执行使用 session-tree 证据：记录 Session 事件、捕获顺序、各自回执及后代元数据；核对 parentSession 与父 subagent/catalog 的 childId / childCreatedAt，要求全部目录子会话都被捕获。调用按 sessionId＋callId 隔离，fork 的 inheritedEventCount 前缀不重复收费；捕获缺失、目录孤儿、重复/倒序位置、子会话未结束均记 GAP。整树任一费用字段不可得则该总量 unknown；保留各 Session 子项。预算中间件仍观察隔离宿主所有 llm/stream 请求。实际同进程 fork 与子流取消已有[固定 Provider 集成证据](../acceptance/2026-10-26-evaluation-lifecycle.md)；外部进程代理、其它取消时点及真实 provider 取消计费边界仍待验证；旧根日志继续按原范围检查。

Agent 空闲不等于子代理激活清理和完成通知已经结束；完成边界必须使用宿主公开 waitForChildren 后重新等待父代理空闲。每次流量准入记录真实 Session 身份，捕获外请求在调用 provider 前拒绝并留标记。accounting 逐 Session 核对流量与日志模型记录计数；任一缺项/超项/归属不明时整体计量为 GAP，PASS 不能只看局部轨迹或最终文件。checker 独立重算 accounting，不将补数或漏记当作零成本。

## 冻结刺激

可选 stimuli 数组声明 id / path / afterRead / before / after；目前仅支持对 initial 中普通文件的读后外部写入。id 唯一且可作安全证据文件名，afterRead 为正整数，before/after 为完整 UTF-8 内容。触发点是整树同文件第 N 次成功 tools/result(read) 后、程序取得返回值前；运行时校验原字节并拒绝链接路径，保留触发 Session/调用、前后摘要和独立原始字节。条件失配不覆盖文件，写入失败/部分状态、未触发、缺日志/字节均 GAP；checker 重新核对冻结内容、成功读取引用及前后证据，不能只相信 applied 字段。刺激写入只代表受控竞争者，不属于模型采用或模型工具成本。

原始事件只在本地被忽略目录保留；正式报告只导出必要标识、摘要、模式/错误枚举、计数及文件验证结果，不复制消息、参数、凭据值或正文。脱敏仍需发布前审阅。执行/使用命令见 [evaluation README](../../scripts/evaluation/README.md)。
