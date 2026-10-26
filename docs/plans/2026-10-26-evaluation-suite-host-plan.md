# 候选任务集的完整固定 Provider 宿主验证

承接[候选任务集验收](../acceptance/2026-10-26-evaluation-task-suite.md)，复用原 13 类任务、独立 expected、三臂、冻结/运行/check/judge。增加独立固定 Provider，只生成手写工具程序，不导入 expected 或访问宿主文件来伪造工具结果。所有用量为固定夹具，不证明模型成本或收益。

在新一次性交付安装中运行全部 39 样本。保留 strict 的限制/拒绝、长行只读取证和生成器造成的目标 unknown。连续编辑拆成两个请求并重读实际中间快照；生成器通过实际 shell 工具执行，查原始调用和退出结果。场景检查失败应保存报告和工件后退出，不改 expected、分母或策略迎合结果。

仅增加维护者脚本与夹具，不改上游源码、仓库依赖版本、工具、preset 或日常 profile。运行无费用回归、完整交付门禁和变异复核，逐项记录 PASS/FAIL/GAP/BLOCKED；尚未执行的平台、真实 Provider、代表性和语义因果效果继续保留缺口。

执行时发现新一次性安装让 tool-edit 的 `^0.2.1-alpha.4` 传递范围解析到 Hashline `0.2.1-rc.3`，与 read 的已补丁 alpha.4 分离；预检以 EVAL_ENGINE_IDENTITY 拦截，未执行样本。为继续既定基线验证，交付安装器从现有锚点 manifest 生成两个精确 upstream overrides，仍注册原 patches/，安装后核对版本与同物理引擎。保留首次错误安装和日志；不手改 node_modules、不切换或升级日常目标。此装配修正属于本轮必要范围，并重跑完整交付门禁。

2026-10-26 完成有界执行与[验收](../acceptance/2026-10-26-evaluation-suite-host.md)：39 样本、90 断言和 81/81 对账；实际保留 31 PASS / 6 GAP / 2 FAIL、judge=2。189 回归、类型检查、修正后的完整交付通过；候选任务及 expected 未改。通用语义验收、shell 目标与数值退出码、真实模型和公平性仍有缺口。
