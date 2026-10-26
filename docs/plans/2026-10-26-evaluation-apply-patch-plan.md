# 评测 apply_patch 目标证据补齐

承接 80989b7 与[剩余缺口](../acceptance/2026-10-26-evaluation-lifecycle.md)。本轮仅补齐已有受管 edit 的解析计划取证，不复制解析器、不改 policy/preset/依赖、不启动真实模型或自动提交。

责任层：上游 edit 的 describeRequest 已调用 expandApplyPatchToEntries；策略 preflight 将该计划写入现有 decision.targets。评测 host 当前只保留路由/结果/原因，丢弃该计划；targets.mjs 只调用 Hashline Patch.parse，故 apply_patch 目标不可得。

1. 保存现有 apply_patch decision 的调用/根调用、模式、版本及路径/操作枚举到本地回执，不导出原始计划到正式报告。
2. 与同 Session 的实际 callId/rootCallId、模式及现有 policy.requestTargets 的显式文件头集合交叉核对。无移动的受管载荷可映射；含 Move to、缺计划、早期拒绝、模式/集合不一致或越界仍 unknown。文件头检查只是交叉核对，不能代替上游解析成功事实。
3. 独立 expected 字节仍决定正确性，已解析/获准不等于已落盘；拒绝与恢复保留两次调用，不将未完成模式记为成功。
4. 增加回执缺失/伪造/调用错配/移动/多文件/目录变化/部分成功阴性回归；用新隔离安装的固定 Provider 验证带用户来源引用的双文件更新与拒绝后恢复，重跑受影响测试、宿主与交付门禁，按 code-review-and-quality 复核及变异验证。首轮新路径创建触发既有 FS_NOT_OBSERVED 限制，空文件更新还保留无末尾换行而不满足独立预期，两轮均保留 FAIL。成功路径另冻合法 user-override 任务，不改写前两轮结果、不在评测改动中修补工具契约或放宽策略门。

新增取证不增加工具层文件 I/O；仅在原回执 sidecar 增加脱敏计划元数据。正式报告继续仅含相对目标和既有模式/结果，不输出原始计划路径。其它专用工具、同文件多目标、并发归属、刺激与自动 S2 仍属后续工作。

有界实现已完成，见[验收](../acceptance/2026-10-26-evaluation-apply-patch.md)：73 项定向通过，最终合法替代/拒绝恢复等 18 例宿主组通过且对账 45/45；移除集合核对的变异被两项测试拒绝。创建与空文件换行两轮各 1 FAIL 独立保留，不作为已修复能力。
