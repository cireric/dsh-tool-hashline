# 文档导航

使用和开发命令见[项目 README](../README.md)，开发规则见 [AGENTS.md](../AGENTS.md)，术语见 [GLOSSARY.md](../GLOSSARY.md)。

**当前实现、验收范围和剩余缺口统一见[当前状态与证据索引](acceptance/2026-10-23-current-status-and-evidence-index.md)。** 文件名保留最初建档日期，正文注明更新日期。历史报告中的“当前”指执行当时。

2026-10-26 经有界恢复、真实 S0 与离线审计，用户确认[本轮阶段决策](acceptance/2026-10-26-evaluation-stage-decision.md)：接受 S0 FAIL、停止扩样并转为按需维护，S1/S2 延期未执行，默认推广暂停。原始报告与 FAIL/GAP/BLOCKED 保留，评测工具仍可复用；[两轮外部 A/B 快照](evidence/tetris-ab/README.md)仅作决策参考。

## 按主题阅读

上游同步交付后的审查问题及修复验证见[审查修复验收](acceptance/2026-10-27-upstream-sync-review-fixes.md)，各轮原始验收继续保留。

| 主题 | 需求与决策 | 实施与证据 |
|---|---|---|
| PTC 与上游同步 | [需求规格](specs/2026-10-27-upstream-sync-requirements.md)、[早期技术提案](plans/2026-10-27-upstream-sync-plan.md) | [票据 01 本机来源检查](acceptance/2026-10-27-upstream-sync-check-01.md)：公开手动入口、来源优先级、来源身份与本项目基线；[票据 02 PTC 变化检查](acceptance/2026-10-27-upstream-sync-check-02.md)：75 个逐对象检查点、公共差异记录与保留依据；[票据 03 stock read 对照](acceptance/2026-10-27-upstream-sync-check-03.md)：14 个检查点、上限按值比较、已有关联差异带负向探针；[票据 04 引擎发布评估](acceptance/2026-10-27-upstream-sync-check-04.md)：已发布版本全量枚举按语义版本分渠道、补丁与组合只到待验证、部分来源与超时如实记录；[票据 05 重复检查与审阅决定](acceptance/2026-10-27-upstream-sync-check-05.md)：跨轮分类、决定格式与校验、维护者录入与复查操作；[票据 06 真实来源验收与交接](acceptance/2026-10-27-upstream-sync-check-06.md)：真实本机 DSH 与真实发布源四轮运行、SYNC-01～10 PASS、SYNC-11 Windows PASS 且 macOS/Linux 保留 GAP、跟进项交接路径。四个区域在 Windows 实跑；候选包内容、macOS/Linux 实跑与目标切换仍为 GAP |
| 收口与按需维护 | [收口计划](plans/2026-10-26-project-closeout-plan.md) | [收口记录](acceptance/2026-10-26-project-closeout.md)、[报告归档](evidence/tetris-ab/README.md)；日常推荐 PTC，Hashline 可选，未自动切换配置 |
| PTC、read/tag/edit、窗口与 seen | [基础规格 v3](specs/2026-10-22-ptc-hashline-requirements-spec.md)、[ADR-0001](adr/0001-inherit-bounded-seen-guard.md)、[ADR-0002](adr/0002-own-ptc-gate-assets.md) | [初期追溯](acceptance/2026-10-23-acceptance-traceability.md)、[运行修复](acceptance/2026-10-23-runtime-fix-acceptance.md) |
| cwd、MV、BOM、快照次序 | [ADR-0003](adr/0003-effective-working-directory.md)、[0004](adr/0004-mv-create-intent-and-snapshot-order.md)、[0005](adr/0005-bom-preserving-hashline-read.md) | [MV 验收](acceptance/2026-10-23-mv-observation-acceptance.md)、[BOM 验收](acceptance/2026-10-23-bom-and-snapshot-repair-acceptance.md)、[兼容矩阵](../tests/compat/README.md) |
| 运维 skills | [需求](specs/2026-10-23-ptc-hashline-operations-skills.md)、[实施计划](plans/2026-10-23-ptc-hashline-operations-skills-implementation-plan.md) | [真实宿主交付报告](acceptance/2026-10-24-delivery-acceptance-report.md)及同名 summary.json |
| 默认编辑策略 | [SRS](specs/2026-10-24-hashline-default-editing.md)、[实施计划](plans/2026-10-24-hashline-default-editing-implementation-plan.md) | [工程切片](acceptance/2026-10-24-default-edit-policy-engineering.md)；[local-01](acceptance/2026-10-25-default-edit-policy-effectiveness-local-01.md) → [fix-01](acceptance/2026-10-25-default-edit-policy-fix-01.md)；[完整宿主红测](acceptance/2026-10-25-default-edit-policy-full-host.md) → [fix-02](acceptance/2026-10-25-default-edit-policy-fix-02.md) |
| 实际生效与推广评测 | [E1～E4 验收方案](plans/2026-10-25-default-edit-policy-effectiveness-test-plan.md)、[S0～S2 推广评测方案](plans/2026-10-25-default-edit-policy-promotion-evaluation-plan.md) | [E3 冒烟](acceptance/2026-10-25-default-edit-policy-effectiveness-e3-01.md)；[早期宿主调查](acceptance/2026-10-23-host-run-deferred.md)仅作历史参考 |
| 可复现评测基础设施 | [协议补充](specs/2026-10-25-real-model-evaluation-protocol.md)、[实施计划](plans/2026-10-25-real-model-evaluation-implementation-plan.md)、[命令](../scripts/evaluation/README.md) | [差距与根因、离线验收](acceptance/2026-10-25-real-model-evaluation.md)；未执行新的真实模型请求 |
| 逐目标、子会话与外部刺激 | [阶段计划](plans/2026-10-25-evaluation-targets-lineage-stimuli-plan.md)、[协议补充](specs/2026-10-25-real-model-evaluation-protocol.md) | [阶段验收](acceptance/2026-10-26-evaluation-next-stage.md)：固定适配器证明基础设施，不证明真实模型收益 |
| fork 与取消生命周期 | [验证计划](plans/2026-10-26-evaluation-lifecycle-plan.md)、[命令](../scripts/evaluation/README.md) | [实际宿主证据](acceptance/2026-10-26-evaluation-lifecycle.md)：非空 fork 去重与子流取消；真实 Provider 计费仍待验证 |
| apply_patch 文件归属 | [补齐计划](plans/2026-10-26-evaluation-apply-patch-plan.md)、[协议](specs/2026-10-25-real-model-evaluation-protocol.md) | [解析计划取证与失败对照](acceptance/2026-10-26-evaluation-apply-patch.md)：有界映射；创建和换行 FAIL 保留 |
| 首次指标的冻结范围 | [v2 计划](plans/2026-10-26-evaluation-cohort-plan.md)、[协议](specs/2026-10-25-real-model-evaluation-protocol.md) | [v2 验收](acceptance/2026-10-26-evaluation-cohort.md)：显式纳入/排除任务，保留全任务文件及成本门禁；真实模型仍待验证 |
| 可复用候选任务集 | [计划](plans/2026-10-26-evaluation-task-suite-plan.md)、[配置生成命令](../scripts/evaluation/README.md) | [验收](acceptance/2026-10-26-evaluation-task-suite.md)：13 族配置、独立 expected、冻结/预检可复用；默认 probe，尚未完整真实模型执行 |
| 候选任务集宿主执行 | [计划](plans/2026-10-26-evaluation-suite-host-plan.md)、[运行命令](../scripts/evaluation/README.md) | [验收](acceptance/2026-10-26-evaluation-suite-host.md)：39 个固定 Provider 样本、81/81 对账；保留 31 PASS / 6 GAP / 2 FAIL，未执行真实模型；一次性安装已固定传递引擎与同物理实例 |
| 冻结设计可比性审查 | [计划](plans/2026-10-26-evaluation-design-review-plan.md)、[审查命令](../scripts/evaluation/README.md) | [验收](acceptance/2026-10-26-evaluation-design-review.md)：逐臂配置差异和指标分母可复核；报告保持 GAP，不增加执行审批或推广结论 |
| 冻结条件判读与复用 | [判定计划](plans/2026-10-26-evaluation-verdict-plan.md)、[命令](../scripts/evaluation/README.md) | [判定验收](acceptance/2026-10-26-evaluation-verdict.md)：绝对阈值与未知覆盖可查，check/judge 职责分开；真实收益仍待验证 |
| 块定位能力限制 | [问题调查](background/2026-10-25-hashline-block-locator-assessment.md)、[修复计划](plans/2026-10-25-hashline-block-locator-guidance-fix.md) | [说明与诊断修复验收](acceptance/2026-10-25-hashline-block-locator-fix.md)；不代表实现了块解析器 |

## 背景与维护规则

- 背景研究：[10-22 选型](background/2026-10-22-dsh-hashline-selection-analysis.md)、[10-23 功能盘点](background/2026-10-23-dsh-hashline-feature-analysis.md)、[10-24 实现路线](background/2026-10-24-hashline-implementation-landscape.md)、[10-26 评测代码分析](background/2026-10-26-real-model-evaluation-code-analysis.md)。它们保留研究时点的版本、观察和建议，不覆盖现行规格。
- 迁入证据：[PTC gate 资源清单](evidence/2026-10-22-ptc-gate-inventory.txt)。
- 开发细则：[证据可追溯](agents/evidence-traceability.md)、[本地 issue](agents/issue-tracker.md)、[票据状态](agents/triage-labels.md)、[领域用语](agents/domain.md)、[文档维护与清理](agents/documentation.md)。

日期报告及其 JSON 是不同执行轮次的证据，保留各自边界；本地 `.scratch/`、`.tmp/` 原始材料不随 clone 交付。查看测试入口不等于重新执行验收。
