# 验收与维护基线

先读[当前状态](2026-10-23-current-status-and-evidence-index.md)。日常只维护当前状态与下列主题结论；不再为同一轮测试的重复成功新增独立报告。

| 要查什么 | 保留入口 |
|---|---|
| read/edit、cwd、MV、BOM | [运行修复](2026-10-23-runtime-fix-acceptance.md)、[MV](2026-10-23-mv-observation-acceptance.md)、[BOM](2026-10-23-bom-and-snapshot-repair-acceptance.md) |
| 默认编辑策略与块定位限制 | [父来源修复](2026-10-25-default-edit-policy-fix-02.md)、[块定位诊断](2026-10-25-hashline-block-locator-fix.md) |
| 运维安装与上游同步 | [交付基线](2026-10-24-delivery-acceptance-report.md)、[真实来源检查](2026-10-27-upstream-sync-check-06.md)、[后续审查修复](2026-10-27-upstream-sync-review-fixes.md) |
| 评测基础设施与推广结论 | [评测摘要](evaluation-history.md)、[真实 S0 失败](2026-10-26-evaluation-real-s0-modelscope-02.md)、[停止扩样决定](2026-10-26-evaluation-stage-decision.md) |
| Intent 演进与未决问题 | [演进摘要](intent-history.md)、[独立反例核验](2026-10-28-joint-goals-independent-verification.md) |

## 历史原件

旧逐票报告、重复交付报告、机器摘要及外部 A/B 快照已归入[历史归档](../evidence/history-2026-10-29.zip)。ZIP 内保留原仓库相对路径与 MANIFEST.json，每个原件都有 SHA-256。旧报告各自的 PASS/FAIL/GAP/BLOCKED、环境和计数保持原样；摘要不把不同轮次合成一次通过。

旧文件链接上的“归档原件”标题标出 ZIP 中的原路径。将归档解压到单独目录即可按原路径找回；不要覆盖当前源码。只有代码仍需读取的 JSON 和关键报告继续保持原路径。

## 本地原始证据

历史报告中的 `.scratch/...` 是原始执行时路径。2026-10-29 清理后，具有取证价值的日志、会话、报告、输入与身份摘要保存在本地 `.scratch/archives/history-2026-10-29.zip`，不随 clone 交付。探针和一次性脚本、临时源码/安装副本已按用户要求删除，不宣称完整旧环境仍可原地重跑。当前可重跑入口以 README、tests 和 scripts 为准。
