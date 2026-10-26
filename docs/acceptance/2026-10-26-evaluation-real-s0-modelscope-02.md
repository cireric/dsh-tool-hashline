# 完整真实 S0 第二轮：请求闭环通过，任务与首次条件 FAIL

日期：2026-10-26。承接[超时诊断](2026-10-26-evaluation-s0-diagnosis.md)，用户明确批准新一轮 S0：9 样本、最多 36 请求、观测总 Token 上限 600,000、每样本 300 秒；首次正确条件每臂 3/3、逐样本 Token 上限 100,000。不启动 S1，不回写首轮超时结果。

**本轮全部 9 项已执行，整体 FAIL；不是超时或预算阻断。** 28 次模型请求，完整总 usage 398,176 Token；请求/Session 对账 28/28，组装请求捕获及官方 Session 独立重放 28/28。三个 stock-edit 样本 PASS，三个 Hashline 样本最终文件正确但有取证 GAP，另三个 Hashline 样本 FAIL。

原始目录：`.scratch/real-model-evaluation/20261026-s0-modelscope-02/`。逐项结果、条件、调用与请求文件哈希见[机器摘要](2026-10-26-evaluation-real-s0-modelscope-02-summary.json)。原始提示、完整响应与请求正文只留本地，不随报告公开。

## 冻结条件与比较边界

使用同一用户配置的 ModelScope 路由、`ZhipuAI/GLM-5.3-Flash`、显式 low、maxTokens=4096；实际安装的现有 pi-ai 配置使用 maxTokensField=max_tokens，内部重试 maxRetries=0。保持原 single/repeated/multi 的 initial/expected、三臂、每臂一次与 seed=7 旋转顺序不变。每项独立 Session/工作目录，串行运行，凭据仅经环境传入一次性 acceptance profile。

本轮预算和成本阈值是诊断后、执行前经用户确认的新条件，不是事后把首轮改成通过。冻结 protocolHash 为 `cc1d01e0355ea92845df3229860f9838dac15be2137521bb5d34c5ee763b7896`。preflight PASS；设计审查生成成功但保留公平性/代表性等 GAP。

三臂仍共享 ptc-hashline persona/Intent/PTC，只比较工具配置，不等同两个原生 preset 的纯策略 A/B。每臂仅三个普通任务，不作统计推广。

## 结果

| 臂 | 最终字节正确 | 任务状态 | 首候选正确/错误/未知 | 请求数 | 总 Token |
|---|---|---|---|---|---|
| stock-edit | 3/3 | 3 PASS | 3 / 0 / 0 | 10 | 130,107 |
| Hashline 默认 | 2/3 | 2 GAP / 1 FAIL | 0 / 2 / 1 | 11 | 164,431 |
| Hashline + fallback | 1/3 | 1 GAP / 2 FAIL | 0 / 1 / 2 | 7 | 103,638 |

fallback 的总 Token 较低同时伴随两个未修改文件的样本，不能称为节省成本或编辑收益。默认臂多一次正确任务，也不能据此把两臂成本视作等工作量比较。

| 任务 | stock-edit | Hashline 默认 | Hashline + fallback |
|---|---|---|---|
| single | PASS，最终正确，首次正确 | GAP，最终正确，首次错误后恢复 | GAP，最终正确，首次错误后恢复 |
| repeated | PASS，最终正确，首次正确 | FAIL，只输出意图说明，0 工具调用，文件未改 | FAIL，只输出意图说明，0 工具调用，文件未改 |
| multi | PASS，最终正确，首次正确 | GAP，最终正确，首次错误后恢复 | FAIL，只输出意图说明，0 工具调用，文件未改 |

三个未执行工具的样本均有正常 completed 回合和完整 usage，无取消、无 Provider 异常。这是模型结束响应但没有落实编辑，不是工具执行失败，也不能按“说了准备读取”视作成功。未测首次候选保持 unknown，不填成正确或伪造一次编辑尝试。

三个恢复样本的首次错误相同：输入首行为裸 `account.txt#07A0` 或 `a.txt#32D4`，缺少必需的方括号。工具实际拒绝文案明确要求 `[PATH#HASH]`；模型随后重读，以 `[account.txt#07A0]` 或 `[a.txt#32D4]` 重试成功，并重读核验最终文件。上游校验按契约工作，本轮未放宽输入格式，也未删除失败尝试。

这些错误调用的回执 selectedMode=hashline，但失败时尚无可靠实际执行/目标归属证据。`evidence.mjs` 的 payload 启发式把不以 `[` 开头的 input 记作 requestedMode=apply_patch；`targets.mjs` 无法解析坏 header 并保留 unassigned/unknown，因此样本保留 GAP。**这不证明模型实际调用了 apply_patch 或发生 fallback。** 成功重试的 actualMode=hashline 可查；失败调用的实际模式仍 unknown。该启发式的表达限制登记为后续取证缺口，不改写本轮冻结报告。

## 独立复核与门槛

- `driver.mjs check` exit 0：文件初态、独立 expected/diff、Session/调用/回执、请求摘要和报告一致。
- `driver.mjs judge` exit 2：整体及 Hashline 两臂首次条件 FAIL；stock-edit 条件 PASS。每个样本的 totalTokens 均未超过新冻结的 100,000 阈值，三个臂的成本条件均 PASS。
- `compare-requests.mjs` exit 0：9 对计划首请求的比较完整，整体比较状态 PASS；这是取证完整性，不是文本一致、公平性或收益判定。系统文本含独立路径/时间，比较未归一化。
- 无超时、无取消、无预算耗尽；28 请求低于 36、398,176 Token 低于 600,000。初始 120,000 预算在本轮实际工作量下不足，但不能回推原超时轮未知费用。

HTTP wire 与内部 HTTP 次数仍 unknown；本轮中间件记录的是 adapter 前组装边界。单请求诊断曾记录过 wire，不能把其记录移植成整轮 HTTP 抓包。已有 input/output/total usage 可审计；未返回的缓存/货币费用分项不补造。日常 profile、preset、上游源码/版本与 Intent/seen/CAS 契约未改。

## 当前结论与下一步

真实 Provider 的完整运行、用量、调用配对及独立结果检查已有本轮证据；**S0 实验执行完成，但验收未通过**。当前模型/冻结工具配置下，stock-edit 在这三个样本表现更好，不支持 Hashline 默认推广；不外推成所有模型或所有任务上普遍优劣。

按冻结方案，S0 FAIL 后停止，不自动进入正式 117 样本 S1。下一步优先离线整理坏 header 的模式判定限制及模型只声明意图的行为证据，决定是否需要另一个有明确问题的实验；不能为取得 PASS 改 expected、删失败样本、放宽已执行阈值或直接追加付费重复。S1/S2 继续保留未执行。
