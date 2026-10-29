# 可复用候选任务集

> 文档状态（2026-10-28）：历史实施参考；已执行范围与原 FAIL/GAP/BLOCKED 见[对应验收](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-26-evaluation-task-suite.md")。未覆盖项不自动变成当前任务；后续是否重开统一见[当前状态](../acceptance/2026-10-23-current-status-and-evidence-index.md)。以下正文按制订时点阅读。


承接[v2 范围验收](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-26-evaluation-cohort.md")的完整任务集缺口。复用既有协议、prepare、运行器和独立文件校验，不改工具、上游、preset 或日常 profile。

1. 提供无模型/无 profile I/O 的候选任务配置生成器，覆盖 SRS §7.3 的 13 家族；输出普通可编辑 JSON，再走已有 prepare/freeze/preflight，不新增执行协议。
2. initial 和 expected 分别编写，稳定展开长行与快照门槛输入；不从模型或执行结果推导 expected。覆盖重复片段、跨文件、改行数、读后竞争、无关/目标长行、快照门槛、大范围重建、no-op、创建、覆盖和项目生成器。
3. 默认 probe，保留模型、总预算、阈值 null；执行前明确首次范围。固定配置可能使 strict 臂无法完成例外任务，失败必须保留。任务家族标签不证明场景触发或模型纪律。
4. 验证确定性、三臂同输入、路径/范围、正式形状、长行/门槛、独立 expected、生成器实际产物、CLI 防覆盖及无凭据预检；复核一次变异。按本轮实际执行保存验收与源码摘要。

不宣称本轮实现所有控制器、语义行为审查、代表性任务库、真实 Provider 验证或正式 S1/S2。连续步骤和生成器调用必须从实际轨迹另行审查；未测为 GAP。

2026-10-26 完成上述候选配置与有界验证，见[验收](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-26-evaluation-task-suite.md")：136 项回归、类型检查、实际 prepare/预检与完整交付门禁有证据。完整 13 族固定 Provider 宿主执行及关键行为审查仍是下一项，不把 formal 形状校验算作实验完成。
