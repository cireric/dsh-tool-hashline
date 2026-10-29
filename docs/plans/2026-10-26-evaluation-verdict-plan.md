# 冻结条件判定与覆盖统计

> 文档状态（2026-10-28）：历史实施参考；已执行范围与原 FAIL/GAP/BLOCKED 见[对应验收](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-26-evaluation-verdict.md")。未覆盖项不自动变成当前任务；后续是否重开统一见[当前状态](../acceptance/2026-10-23-current-status-and-evidence-index.md)。以下正文按制订时点阅读。


承接[代码分析](../background/2026-10-26-real-model-evaluation-code-analysis.md)及[apply_patch 增量](2026-10-26-evaluation-apply-patch-plan.md)。保留已有未提交代码和分析文档；不启动付费模型、不切换 profile、不升级或修改官方框架、不自动提交。

本轮优先解决冻结条件无消费者和汇总丢失已测信息。收益因果、计时拆分、提示差异、完整 S2 及其它边缘功能不在本轮实现范围。

1. passConditions 可显式冻结 semantics=per-arm-count-and-per-run-tokens-v1。minFirstCandidateCorrect 是每臂计划样本中首次正确的最小整数数量；maxTotalTokensPerTask 是每个任务×重复×臂样本的整树 totalTokens 最大整数。旧协议缺 semantics 时只报告判定 GAP，不倒推含义。
2. 新增覆盖统计：总样本、已测、正确/错误/未知、已测率与全分母上下界；成本保留 knownSum 与 measured/unknown/denominator。未知不从分母删除，已测局部之和不冒充完整成本。原 summary 保留以兼容历史。
3. 判定逐臂报告：已知事实足以违反条件则 FAIL；缺证据而不能完成判定则 GAP；完整覆盖且全部满足才 PASS。不按已测子集宣布通过，也不因未知屏蔽已知违反。
4. report.status 沿用任务/证据状态；report.conditions 另列条件结果。check 重读证据后核对覆盖与判定；新增只读 judge 命令，证据不一致拒绝，条件 FAIL/GAP 非零退出。条件通过不等于模型收益或 S2 推广通过。
5. 增加边界/未知/缺样本/阈值/篡改/历史协议与真实 CLI 回归。在独立副本执行门禁和固定 Provider 宿主验证，按 code-review-and-quality 复核及变异验证；原始日志留 .scratch，正式结果与摘要进 acceptance。

新增模块为纯离线计算，不增加模型请求或工具文件 I/O；judge 沿用 checker 的只读工件读取。新语义必须重新 prepare/freeze，不修改旧工件。

本轮有界实现与[验收](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-26-evaluation-verdict.md")已完成：94 项回归、最终普通宿主 18 PASS、预先冻结的判读三场景实际给出 PASS/FAIL/GAP 与 0/2/2；生命周期与完整交付按原边界通过。judge 额外要求任务/取证 PASS，条件 PASS 不能覆盖最终文件错误；未执行假 trace 被拒绝。真实模型、计时、公平性与相对收益仍未关闭。
