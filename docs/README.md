# 文档导航

日常从三个入口开始：[使用与验证](../README.md) → 本页选择主题 → [当前状态与下一步](acceptance/2026-10-23-current-status-and-evidence-index.md)。本页只导航，不维护实施进度。

| 主题 | 需求与决策 | 按需深入 |
|---|---|---|
| read/edit 基础契约 | [基础规格](specs/2026-10-22-ptc-hashline-requirements-spec.md)、[ADR](adr/) | [兼容矩阵](../tests/compat/README.md) |
| 默认编辑策略 | [策略规格](specs/2026-10-24-hashline-default-editing.md) | [测试范围](../tests/integration/README.md) |
| 意图门与工具路径 | [意图门规格（先读最新决定）](specs/2026-10-27-intent-gate-b-requirements.md)、[ADR-0006](adr/0006-declaration-only-repair-and-business-continuation.md) | [联合工作入口](plans/2026-10-28-intent-gate-repair-implementation-plan.md)、[工具路径判据](plans/2026-10-28-ptc-hashline-tool-routing-repair-plan.md) |
| 运维与上游同步 | [运维规格](specs/2026-10-23-ptc-hashline-operations-skills.md)、[同步规格](specs/2026-10-27-upstream-sync-requirements.md) | [配置模板](../presets/ptc-hashline/operations/config.template.json)、[审阅决定模板](../presets/ptc-hashline/operations/decisions.template.json) |
| 评测工具 | [评测协议](specs/2026-10-25-real-model-evaluation-protocol.md) | [运行命令](../scripts/evaluation/README.md) |
| 历史证据与旧计划 | [按主题查历史](acceptance/README.md) | [研究](background/)、[外部报告](acceptance/README.md#历史原件 "归档原件：docs/evidence/tetris-ab/README.md") |

开发前读 [AGENTS](../AGENTS.md)；用语见[术语表](../GLOSSARY.md)。文档整理按[维护约定](agents/documentation.md)，调查按[证据可追溯](agents/evidence-traceability.md)；本地票据按 [issue tracker](agents/issue-tracker.md)，领域说明见[领域约定](agents/domain.md)。

规格定义行为，计划安排工作，验收记录每轮结果。历史报告中的“当前”仅指执行当时；本地 `.scratch/` 原始证据不随 clone 交付。
