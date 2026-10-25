# 自定义模型配置入口增量验收

2026-10-25。承接[离线评测基础设施](2026-10-25-real-model-evaluation.md)，新增 [experiment.example.json](../../scripts/evaluation/experiment.example.json) 和 [prepare.mjs](../../scripts/evaluation/prepare.mjs)，复用原协议/执行器，不修改 read/edit/preset、宿主或依赖。配置文件本身不触发模型请求。

模型、总预算与通过条件留为 null，维护者自行选择；provider 配置只含环境变量引用。prepare 只读采集一次性安装身份，合入自定义配置并验证/冻结，拒绝凭据字面值、生成字段覆盖、provider 漂移、不完整配置与已有输出覆盖。命令见 [evaluation README](../../scripts/evaluation/README.md)。

本轮证据 `.scratch/real-model-evaluation/config-20261025-01/`，与前轮的区别是验证可编辑配置→实际安装采集→冻结入口；没有重跑或改写前轮交付结果。

| 项目 | 结果与证据 |
|---|---|
| 定向回归 | 三套 evaluation 单元测试合计 33 PASS / 0 FAIL；tests.log |
| 类型检查 | `node node_modules/typescript/bin/tsc -p tsconfig.tests.json` exit 0 |
| 实际 CLI | 合成的本地验证配置冻结 exit 0；重复输出拒绝 exit 2 且原 SHA 不变；未填写模板拒绝 exit 2 且无输出；cli-summary.json |
| 无凭据 preflight | BLOCKED，executed=false、realModelRequests=0，无执行产物目录；只验证命令链，不验证真实 provider |
| 代码复核 | 复用 code-review-and-quality 五轴检查；隔离副本反转 provider 身份比较后三项配置测试均失败，源文件已恢复；mutation.log |
| 范围 | 本增量仅是仓库离线辅助入口；未重跑完整交付门禁。前轮九项门禁、固定适配器宿主结果仍保留其原范围，不能视为本轮新执行 |

建议完成此配置入口后，将离线评测基础设施提交为本地检查点，再推进逐目标统计、子轨迹归并和冻结注入。此建议不自动执行 git commit，不将预存用户改动混入评测提交；真实实验仍需配置与明确费用授权。
