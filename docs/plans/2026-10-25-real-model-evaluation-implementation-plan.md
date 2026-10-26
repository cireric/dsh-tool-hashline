# 真实模型评测最小实现

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
