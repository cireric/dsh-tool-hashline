# 首次候选指标的冻结任务范围

承接[条件判定验收](../acceptance/2026-10-26-evaluation-verdict.md)中 formal 可能因 no-op/write/task-end 无首次候选而长期 GAP 的缺口。保留旧协议、历史报告及工作树；仅开发维护者评测工具，不改日常 profile、工具策略或上游依赖，不请求真实模型，不自动提交。

1. 新增 v2 语义 per-arm-cohort-count-and-per-run-tokens-v2，必须在 passConditions.firstCandidateScope 明确 include 任务 ID 与 exclude 的 taskId/reason。全部任务恰好出现一次，重复、交叉、未知/遗漏 ID、空理由、超出范围的最小数量均在冻结前拒绝。v1 仍沿用全任务分母，不默默改变历史含义。
2. 只在首次正确条件使用预先冻结范围，报告选中分母、排除任务和理由；全局 coverage 仍包含全部任务。选中任务未测仍 GAP，不根据模型本轮实际选择 write/no-op 自动排除。排除是作者声明的指标范围，不证明任务天然不适用。
3. Token、最终文件、样本调度和证据完整性始终覆盖全部任务。范围外的 Token 超限、缺 usage、最终错误和缺少样本仍阻止 judge PASS。probe 可明确排除全部首次候选任务，但要求最小数为 0，首次条件标 NOT_APPLICABLE、比例为 null；formal 至少纳入一项。
4. 新模板展示 v2；缺少 v2 范围不推断。新增配置、历史兼容、选中未知、范围外失败/超限、空范围及报告篡改测试；固定 Provider 增加 no-op/write 场景，在独立安装验证实际配置→冻结→执行→check/judge 链路，跑交付门禁和变异复核。

不新增工具层文件 I/O。范围解析为纯离线计算，沿用报告与工件；不实施完整正式任务集、真实模型实验、公平性/计时拆分、收益判定或自动 S2。

2026-10-26 完成上述有界实现；123 项回归、九种实际宿主判读、生命周期回归与完整交付门禁见[验收](../acceptance/2026-10-26-evaluation-cohort.md)。正式任务集与真实模型验证仍未完成。
