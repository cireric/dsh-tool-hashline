# 真实模型评测最小实现

> 2026-10-26 当前安排：按用户确认的[阶段决策](../acceptance/2026-10-26-evaluation-stage-decision.md)，接受完整 S0 FAIL、停止扩样并按需维护；S1/S2 延期未执行，默认推广暂停。以下设计与原 FAIL/GAP/BLOCKED 保留，不代表正式实验通过。

本轮开发授权仅覆盖离线开发、测试及隔离交付验证；不包含付费请求、日常 profile 切换或上游升级。复用默认策略 SRS §7、E1–E4 和 S0–S2，结果见同日 real-model-evaluation 验收报告。

1. 查历史证据和轨迹生产链；以现有逐帧解码器复核 E3，保留历史报告。
2. 扩展现有 freeze/check：显式 probe/formal、工具配置、依赖/补丁/环境身份、独立初始与预期文件。
3. 复用完整宿主验收的官方 boot/registry 装配方式，提供仅接受一次性安装的进程内驱动；默认只检查，执行需显式开关及预算。
4. 每个任务/重复/臂使用新 Session 和新目录，保存受限原始证据、脱敏调用摘要、可用 usage、独立最终树 diff。失败、取消和未执行样本均保留。
5. 增加协议、身份漂移、配对、成本 unknown、独立校验及无 provider/凭据/取消测试；隔离副本执行 README 门禁和 delivery。
6. 按 code-review-and-quality 做五轴复核及一次变异验证；更新推广方案、当前索引和执行说明。

不修改 read/edit/preset、Intent gate、seen/CAS、官方框架或依赖版本。新增 I/O 只在显式评测命令中：冻结时读取解析产物/补丁/配置摘要；每样本创建目录、读取最终文件、保存证据；不新增常驻遥测。

本轮离线阶段已完成：probe/formal、实际安装身份、三臂驱动、逐帧取证、policy receipt、首编辑程序候选快照与 retryOf、独立最终树与 diff、取消/预算/无 provider 验证及完整交付门禁均已落地。每候选额外保存一次文件树供离线重算，I/O 计入墙钟时间。真实 provider 请求验证、逐目标映射、子会话归并、外部刺激控制器及正式推广判定保留 GAP / BLOCKED，见验收报告；不因本计划完成离线阶段而授权付费执行。

配置入口增量：提供 experiment.example.json 和只读 prepare.mjs，使维护者可自行选择 provider / 模型 / 参数 / 预算 / 任务；仍生成同一种冻结协议，不新增执行器。建议补齐这一入口并验证后提交离线基础设施检查点，再推进逐目标统计、子轨迹和注入控制器。实际提交由用户决定，不自动包含预存的 `.npmrc` 删除等无关工作树变更。

该增量已完成[独立验证](../acceptance/2026-10-25-evaluation-config.md)：33 项定向回归、类型检查、实际 CLI 冻结/防覆盖/未填项拒绝及无凭据 preflight；未产生真实模型请求。

2026-10-26 后续：[逐目标/会话树/刺激阶段](2026-10-25-evaluation-targets-lineage-stimuli-plan.md)已完成有界离线实现与[验收](../acceptance/2026-10-26-evaluation-next-stage.md)。前文列出的初版缺口现按每文件单目标、同进程后代会话、成功读后外部写入三个范围关闭；请求边界通过官方子代理完成等待与逐 Session 对账校验。其它载荷、同文件多目标、真实 provider 等仍保留 GAP，不把初版缺口或新阶段结果扩大为 S1/S2。

同日[生命周期计划](2026-10-26-evaluation-lifecycle-plan.md)补齐实际同进程 fork 去重与子流取消的固定 Provider 端到端证据，见[验收](../acceptance/2026-10-26-evaluation-lifecycle.md)。正式执行器未变；创建中/工具中取消、外部进程及真实 provider 计费仍待验证。

随后[apply_patch 计划](2026-10-26-evaluation-apply-patch-plan.md)补齐无移动、完整受管解析回执的文件归属，见[验收](../acceptance/2026-10-26-evaluation-apply-patch.md)。73 项回归及最终 18 例宿主组通过；首轮新建和空文件换行不符仍各保留 FAIL，未据此扩大工具能力或真实模型结论。

依据后续代码分析调整优先级，[条件判定计划](2026-10-26-evaluation-verdict-plan.md)已完成 v1 绝对阈值消费者、覆盖统计和 check/judge 分离，见[验收](../acceptance/2026-10-26-evaluation-verdict.md)。94 项回归及预先冻结的实际宿主判读场景有证据；旧协议不追认条件通过。相对收益、计时/提示公平性和真实模型 probe 仍未完成。

首次指标的任务范围已按[v2 计划](2026-10-26-evaluation-cohort-plan.md)冻结，见[验收](../acceptance/2026-10-26-evaluation-cohort.md)。排除不影响全任务最终文件、Token、取证与调度检查；历史 v1 不迁移。完整 formal 任务集和真实模型执行仍是后续工作。

随后[候选任务集计划](2026-10-26-evaluation-task-suite-plan.md)补齐可复用的 13 族配置生成、独立 expected 和既有 prepare/预检链路，见[验收](../acceptance/2026-10-26-evaluation-task-suite.md)。默认 probe，不覆盖正式实验参数；完整宿主任务执行、分步/生成器行为证据及真实模型验证仍未完成。

再按[宿主任务集计划](2026-10-26-evaluation-suite-host-plan.md)完成 39 个固定 Provider 样本、连续中间快照与生成器实际调用，[验收](../acceptance/2026-10-26-evaluation-suite-host.md)保留任务 31 PASS / 6 GAP / 2 FAIL，未宣称正式实验通过。一次性安装的 upstream 范围漂移已锁回现有精确锚点并增加同物理引擎检查，未升级上游；真实模型、通用语义检查及可比性审查仍未完成。

后续[离线设计审查](2026-10-26-evaluation-design-review-plan.md)补齐实际逐臂配置差异和冻结分母核验，见[验收](../acceptance/2026-10-26-evaluation-design-review.md)。明确连续任务的合规中间状态与首程序指标混杂，保持原任务和 expected；实际请求提示/SDK、代表性、通用语义及真实模型收益仍未完成，不新增审批门。

## 本轮实施结果（2026-10-26）

[验收与机器摘要](../acceptance/2026-10-26-evaluation-request-evidence.md)记录前两包已实现及无费用验证：组装请求捕获/官方 Session 重放/SDK 比较、可编辑网关配置、固定 S0/S1 设计及指标分母。241 项定向测试通过，九项交付门禁 exit 0；完整固定 Provider 任务结果仍保留 FAIL/GAP。第三、四包的真实 Provider S0 与 S1/S2 尚未执行，需手动填写连接、容量、预算和阈值后显式执行；本轮真实模型请求 0。

### 真实 S0 首轮跟进

用户填写连接并明确批准有限 S0 后，已执行[首轮真实验证](../acceptance/2026-10-26-evaluation-real-s0-modelscope.md)：首请求收到 reasoning，120 秒超时取消；1 CANCELLED / 8 BLOCKED，usage unknown，未自动重试或执行 S1。请求捕获和重放 1/1，但完整 S0 尚未完成。前述无费用验证计数和真实请求 0 仅描述前轮，不覆盖此轮。

后续[超时诊断](../acceptance/2026-10-26-evaluation-s0-diagnosis.md)：补齐显式 low 与输出字段配置，本项目 cap 枚举误拒已修；用户批准的一次真实诊断约 46.2 秒返回工具调用和完整 usage（14,827 Token），没有执行工具或续跑整组。完整 S0 仍 GAP，正式组未执行；后续需复核预算。

### 完整 S0 第二轮结果

经用户批准新预算与阈值，[第二轮](../acceptance/2026-10-26-evaluation-real-s0-modelscope-02.md)9 项全部执行，28/28 请求对账及独立重放，总 Token 398,176；3 PASS / 3 GAP / 3 FAIL、最终 6 正确。三个 Hashline 首次输入缺方括号被拒后恢复，另三个样本只输出意图未执行工具；不是超时或预算耗尽。S0 实验执行完成但验收 FAIL；保留取证 GAP，停止于 S0，未启动 S1/S2。

### S0 后续无费用审计

[模式/提示审计](../acceptance/2026-10-26-evaluation-payload-prompt-audit.md)已交付：新增冻结 editPayloadVersion=2，坏 header 不再误标 apply_patch，旧报告继续按原版本复核；真实 SDK/可见结果核对未发现明确格式冲突，三次无工具响应均正常 stop。297 项单元、类型及固定 Provider 18 项宿主验证通过，新增真实模型请求 0。原 S0 FAIL 保留，未启动 S1；不为追求通过自动改提示或付费重跑。

当前迭代按[阶段决策](../acceptance/2026-10-26-evaluation-stage-decision.md)收尾；工程与审计交付保留，S0 FAIL 被接受为有效结果，S1/S2 延期未执行，不将延期计为完成。
