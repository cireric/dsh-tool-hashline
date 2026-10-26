# 冻结条件判定与覆盖统计验收

执行日期：2026-10-26（Asia/Shanghai）。维护基线 80989b7，加已有未提交 apply_patch 增量和本轮改动；执行源码摘要见[机器清单](2026-10-26-evaluation-verdict-summary.json)。承接[分析文档](../background/2026-10-26-real-model-evaluation-code-analysis.md)的 P1-2/P2-5，按[计划](../plans/2026-10-26-evaluation-verdict-plan.md)实现。未改写分析文档或历史工件。

真实模型请求 **0**。本轮证明冻结绝对条件能被执行和复核，不证明真实模型收益、三臂因果效果或 S2 推广通过。日常 profile、工具/preset、补丁/依赖及官方框架未变；不自动提交或发布。

## 实现与口径

- [verdict.mjs](../../scripts/evaluation/verdict.mjs) 提供纯离线覆盖与判定；[protocol.mjs](../../scripts/evaluation/protocol.mjs) 校验新语义，旧协议缺 semantics 时 conditions=GAP / semantics-not-frozen。
- v1 条件是明确的整数：minFirstCandidateCorrect 为每臂首次正确最小样本**数量**，maxTotalTokensPerTask 为每个任务×重复×臂样本的整树总 Token 上限。不是首次正确比例、整臂 Token 总量或均值；新模板必须重新 prepare/freeze，已有本地配置不自动改写。
- coverage 逐臂保留正确/错误/已测/未知/总分母，以及已测率和完整分母上下界。上下界把未知当全错/全对，是缺失数据范围，不是置信区间。成本 knownSum 与覆盖数量分列，未测不补零，局部和不冒充总成本。目标注释不全单列 unknownSamples，已有目标仍可查。原 summary 保留历史检查口径。
- 已知事实已违反条件即 FAIL，不被其它未知掩盖；其余有未知则 GAP；完整覆盖且满足才 PASS。各臂分别达标，不用某一臂的成功填另一臂分母。
- [run.mjs](../../scripts/evaluation/run.mjs) 最终报告增加 evaluationVersion=1、coverage 和 conditions，任务/取证 status 保留。[report.mjs](../../scripts/evaluation/report.mjs) 从工件重算后核对新增字段与整体任务状态，缺字段或伪造未执行 trace 均拒绝。
- [driver.mjs judge](../../scripts/evaluation/driver.mjs) 先 check 再判读。任务/取证与条件同时 PASS 才退出 0；FAIL/GAP 退出 2。check 仍可接受真实 FAIL/GAP 报告的证据一致性，run 的退出码仍表示执行/取证状态；条件 PASS 不能覆盖最终文件错误。

模块没有模型调用、计费或工具文件 I/O；新增开销为原报告写入几组统计和 judge 的原有只读复核。现场 wallMs、promptHash、ptc 的独立核验仍未实现，README 已写明；wallMs 未进入本轮 Token 条件。

## 执行与证据

原始根 `.scratch/real-model-evaluation/20261026-verdict/` 被 Git 忽略，不随 clone 提供。Windows / Node 24.19.0 / pnpm 11.28.5；在独立 tree/ 构建，使用本轮 delivery 生成并保留的一次性安装。固定 Provider 与上一轮字节一致，未热改已安装依赖。

| 范围 | 实际结果与边界 | 本地证据 |
|---|---|---|
| 定向回归 | **94 PASS / 0 FAIL**，6 个文件；新增判定套件 21 项。覆盖精确边界、未知与已知违反、各臂分母、缺样本/重复/外来样本、历史语义、覆盖/条件/状态/原始首次值篡改、未执行假 trace 和真实 CLI；类型检查 exit 0 | tests/unit/evaluation-verdict.spec.ts、logs/evaluation-final.log、logs/types-final.log |
| 普通宿主组 | **18 PASS / 0 FAIL**，conditions=PASS，请求/会话 **45/45**；全部 18 个首次候选均可测，首次错误不会并入最终正确 | smoke-final/、logs/smoke-final.log |
| 正常阈值 | 两臂各一任务，文件正确、整树 Token=4；conditions=PASS、check=0、judge=0 | verdict-final/pass/ |
| 冻结零 Token 上限 | **执行前冻结上限 0**，实际两臂文件均正确且 report.status=PASS，Token=4，conditions=FAIL；check=0、judge=2。没有事后换阈值冒充执行 | verdict-final/token-fail/ |
| 冻结不测首次候选 | 执行前选择 task-end，最终文件均正确、Token 可测；首次候选 unknown，conditions=GAP；check=0、judge=2 | verdict-final/first-unknown/ |
| 生命周期回归 | fork 三臂 PASS，conditions=PASS，对账 18/18；子流取消三臂断言通过、报告与条件保留 GAP，无取消后适配器请求 | lifecycle-final/、logs/lifecycle-final.log |
| CLI 对照 | 最终 8 份报告及一份上轮旧协议，共 9 组 check/judge；check 全部 0，judge 的 PASS/FAIL/GAP 对应 0/2/2，符合逐项预期。旧协议明确 GAP / semantics-not-frozen | logs/cli-final.json |
| 完整交付 | 九项门禁 exit 0；**21 PASS / 0 FAIL / 9 BLOCKED**，未覆盖 ID 未改为通过 | [报告](2026-10-26-evaluation-verdict-delivery-report.md)、[摘要](2026-10-26-evaluation-verdict-delivery-summary.json)，delivery-final/、logs/delivery-final.log |
| 变异对照 | 隔离副本把 Token 超限的 `>` 改为 `>=`，精确边界与 CLI 等 **4 项失败、17 项通过**，exit 1；finally 按原字节恢复，随后 94 项通过 | logs/mutation.log、logs/evaluation-final.log |

普通宿主、判读场景、生命周期、单元和变异分别计数，不合并为模型实验。判读场景共 6 个实际样本、12 次人为适配器请求；三份协议均在各自运行前冻结。脚本断言正确退出 0 不会把 token-fail/first-unknown 的条件改成 PASS。

[verdict-smoke.mjs](../../scripts/evaluation/verdict-smoke.mjs) 是可重复的无费用入口：先用同一隔离安装运行 smoke.mjs，再运行该脚本，得到独立的三份冻结协议、原始工件、报告和 CLI 判读。这验证了“改配置→冻结→执行→判读”的实际链路，但适配器仍是固定夹具。

## 复核与早期轮次

沿用 code-review-and-quality 五轴复核，新增计算只依赖现有统计与 Node；不读模型自述决定正确性、不把未知删除或清零、不输出正文或凭据。手算断言与边界变异提供统计口径的阴性对照；共用解释函数的一致性检查仍不是独立统计 oracle。

初轮 smoke/判读脚本通过后，复核增加了“未执行样本不得伪造 trace”的守卫并同步到隔离副本；当时生命周期 fork 已冻结旧驱动身份，后续两个槽位 BLOCKED，整体 GAP。该轮与驱动输入变化重叠，不作为最终生命周期验收。旧 logs/lifecycle.log 与 lifecycle/fork/ 工件保留；源码稳定后另冻协议，最终 lifecycle-final 全部按预期结束。最终 sourceHashes 与维护源码逐文件相符，未把前后轮混为同一次通过。

## 剩余 GAP / BLOCKED

本轮关闭 v1 绝对阈值无消费者和已测信息缺少细分统计两项；没有实现相对基线的收益/显著性、自动 S2、纯策略消融、提示分节差异或模型/评测器计时拆分。三臂原名称和能力差异仍需按协议理解。

v1 首次正确条件默认要求每个计划样本都有首次候选布尔值。因此 task-end、无需编辑或只用 write 的任务可能使完整 formal 集保持 GAP，即使最终文件正确。当前没有冻结“首次候选条件只适用于哪些任务”的子集字段；正式全族实验前须另行定义适用范围，不能运行后删除这些 unknown，也不能把本轮单点 probe 的判定能力当作完整 formal 已就绪。

上轮 apply_patch 新建路径和空文件换行的 FAIL 未修复；同文件多目标、更多载荷/刺激、并发归属和外部代理仍待开发。真实 Provider usage/HTTP 重试/取消计费及其它平台仍缺验证。真实模型 probe 仍需明确模型、凭据、预算和执行授权；本轮没有启动。

命令与字段说明见[评测 README](../../scripts/evaluation/README.md)。
