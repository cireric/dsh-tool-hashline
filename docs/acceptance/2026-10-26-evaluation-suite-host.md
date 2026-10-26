# 13 类候选任务的固定 Provider 宿主验收

2026-10-26（Asia/Shanghai），基线 85c62e5 加本轮增量，按[计划](../plans/2026-10-26-evaluation-suite-host-plan.md)承接[任务集](2026-10-26-evaluation-task-suite.md)。本轮首次完整执行该候选集，区别于此前只生成配置、冻结和预检。源码、环境与逐样本摘要见[机器清单](2026-10-26-evaluation-suite-host-summary.json)。

真实模型请求 **0**。固定 Provider 驱动真实 AgentLoop、进程 PTC、安装后的工具和本地 shell；不是模型自主决策、真实 Token 成本或收益证明。未改日常 profile、上游源码、仓库依赖版本、补丁、read/edit/preset；没有发布或目标切换。

## 实现与取证

[suite-smoke.mjs](../../scripts/evaluation/suite-smoke.mjs) 沿用候选配置、prepare、身份冻结、串行运行和独立 checker/judge。冻结的 13 个 tasks 与 [defaultTasks](../../scripts/evaluation/task-suite.mjs) 内容哈希相等；三臂全部保留，未改 prompt、initial、expected、首次范围或任务数量迎合结果。仅连接信息、固定模型名、预算与条件按零费用夹具重新冻结，kind 仍为 probe。

独立 [Provider](../../tests/fixtures/evaluation-suite-provider/index.mjs) 根据原任务提示路由至[手写程序](../../tests/fixtures/evaluation-suite-provider/programs.mjs)，不导入 expected，不在 Provider 进程直接写任务文件。程序通过真实 tools.read/edit/write/pwsh（其它平台为 bash）执行；TokenUsage 每次固定 1 输入＋1 输出，仅用于对账测试。连续任务分两次工具请求，程序完成后下一次请求才继续；生成器通过实际 shell 工具调用。

本轮行为断言限于这组固定程序：连续任务检查实际 checkpoint-0 为 `start=yes\nmiddle=ready\ntail=pending\n`、两次 edit 分属不同程序、第二次 edit 前存在实际重读；生成器核对同一会话的原始 shell 参数 `node generate.mjs`、调用/结果配对和外层程序成功，最终产物另按 expected 校验。固定程序现场核对 canonical exitCode 为 0，非零/超时/取消会抛错；投影后的原始事件只留下 `(no output)` 等渲染结果，没有独立数值 exitCode，不能宣称已实现通用 shell 数值退出码审计。目标归属仍 unknown/GAP，未伪造 edit。

## 安装阻断与必要修正

首轮使用新打包的一次性安装，评测预检报 EVAL_ENGINE_IDENTITY，**0 样本执行**。`.scratch/real-model-evaluation/20261026-suite-host/blocked-install.json` 保存实际路径和版本：read 解析根目录的已补丁 Hashline `0.2.1-alpha.4`，tool-edit 的 `^0.2.1-alpha.4` 传递依赖解析为嵌套 `0.2.1-rc.3`。产生点是该安装的 tool-edit/package.json 及其 node_modules 解析，不是模型生成错误。原交付门禁对运维装配的 PASS 不包含同物理引擎证明；本轮预检正确阻断，不沿用它宣称评测已执行。

[delivery-acceptance.mjs](../../scripts/delivery-acceptance.mjs) 原先只 override 自有 tarball 包并检查根引擎补丁，未固定上游传递范围。现从现有两份锚点 manifest 获取精确 upstream overrides，保持原 patches/＋patchedDependencies；安装后额外核验实际版本和 read/edit 的同一物理引擎。非精确锚点拒绝，不从 registry 选新目标；没有手改 node_modules 或引入升级。新安装两个 upstream 都为 `0.2.1-alpha.4`，同物理路径和补丁证据写入 PACK-01/engine-identity。

首次错误安装、原交付结果和 host-01.log 留在原始目录，未回写历史结果。历史 delivery 中根包 marker 的 PASS 继续只按原范围解释；新物理实例检查从本轮起生效。

## 执行结果

原始根 `.scratch/real-model-evaluation/20261026-suite-host/` 被忽略，不随 clone 提供。Windows、Node 24.19.0、pnpm 11.28.5；复用独立验证树加入本轮源码，再用新一次性安装执行，8 个变更源码/测试文件与工作树 SHA-256 一致。没有在日常链接的源码树构建。

| 范围 | 实际结果 | 证据 |
|---|---|---|
| 定向回归 | **189 PASS / 0 FAIL**，10 文件；新增程序测试 45、精确锚点测试 8；类型 exit 0 | logs/evaluation-final.log、types-final.log；evaluation-suite-programs.spec.ts、delivery-engine-pins.spec.ts |
| 完整候选宿主 | **39/39 实际执行**；90 个夹具断言 PASS，模型评测状态仍 FAIL、conditions=GAP；请求对账 **81/81**，162 个合成 Token | host-02/protocol.json、report.json、suite-summary.json、logs/host-02.log |
| 独立最终文件 | **36 正确 / 3 错误**；三项错误全部保留在 strict 臂 | 同组实际任务目录、verification/actual.diff、report.runs[].final |
| 普通宿主回归 | **18 PASS**，请求/会话 **45/45** | smoke/、logs/smoke.log |
| fork/取消回归 | fork 三臂 PASS、18/18；三组取消各 1 个实际和 2 个未执行 CANCELLED，报告仍 GAP/unknown | lifecycle/summary.json、logs/lifecycle.log |
| CLI | 6 组 check 全 0；完整候选 judge=2/FAIL，普通与 fork=0/PASS，取消=2/GAP | logs/cli-final.json |
| 修正后完整交付 | 九项门禁 exit 0；验收 ID **21 PASS / 0 FAIL / 9 BLOCKED**；细项 **56 PASS** 单列，新增物理引擎证据 | [报告](2026-10-26-evaluation-suite-host-delivery-report.md)、[摘要](2026-10-26-evaluation-suite-host-delivery-summary.json)、delivery-pinned/ |
| 变异 | 独立 mutation-tree 将 shell 非零判断反转，**2 FAIL / 43 PASS**；原始文件未动，按原字节恢复副本。最终 189 回归通过 | logs/mutation.log、evaluation-final.log、机器清单源码摘要 |

| 实际任务状态 | 数量 | 解释 |
|---|---|---|
| PASS | 31 | 文件和现有取证均满足任务检查；不等同模型收益 |
| GAP | 6 | 三臂 target-long 和 generator：shell 调用的目标归属未建立；strict target-long 的最终文件也错误，未被 GAP 改为正确 |
| FAIL | 2 | strict snapshot-limit 无 tag 路径而停止、strict override 不支持明确要求的 replace，文件仍未达预期 |

最终字节按臂分别为 stock 13/13、fallback 13/13、strict 10/13；这是固定程序和既定工具能力的观察，不能当作真实模型正确率比较。strict target-long 实际触发一次工具失败；snapshot-limit/override 的固定程序明确停止，没有伪造 tag 或绕到 write/shell 更新。三臂 consecutive 首候选都只是中间状态，首次正确为 false、最终正确为 true，未合并为首批正确。失败/限制、目标未知和全部 Token 均保留，未缩小首次分母。脚本 exit 0 仅表示预期断言成立；judge 仍退出 2。

首次程序测试通过但 TypeScript 的动态 each 参数类型报错，改为显式用例类型后检查通过；原日志保留。首次变异命令配置路径错误、未执行测试，不计有效变异；后续使用绝对配置路径完成上表变异。按 code-review-and-quality 五轴复核：数据/夹具/执行器职责分开，安装修正仅精确约束已有锚点，原始调用及独立文件检查保留；无新运行时依赖或官方框架补丁。没有发现本轮有界实现的阻断问题。

## 剩余 GAP / BLOCKED

- **已实现且已验证**：13 类固定程序的完整宿主执行、分步中间快照、生成器实际调用、完整样本分母及既有回归；一次性安装传递引擎漂移已定位并修正。
- **已实现但缺真实验证**：真实 Provider 路由、模型自主工具选择、实际 usage/取消收费，仍未运行；不能把 81 次合成请求计作真实模型样本。
- **部分实现**：关键行为断言仅用于本组夹具，不是通用的模型语义合规 checker；shell 目标归属和独立数值退出码仍缺证据。每族只有一例，代表性与重复量未审定。
- **未实现**：提示/工具面公平性的定量审查、独立模型延迟、相对收益及统计推广判定。formal S1/S2 未执行或通过。
- **外部/人工边界**：Windows 以外未实跑；9 个交付 BLOCKED 依旧保留。真实模型实验需要明确模型、Provider、费用上限及单独执行授权。

下一项应先审阅候选任务的正式实验适用范围、工具面/提示可比性和未知指标口径，再选择有界真实 probe；不要求先把所有 GAP 包装为 PASS。执行入口及费用前提统一见[README](../../scripts/evaluation/README.md)，默认 run 仅预检；本轮只显式执行了固定夹具，没有对真实 Provider 使用 --execute。
