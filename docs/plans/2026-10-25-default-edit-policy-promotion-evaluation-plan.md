# 默认编辑策略：推广评测方案

2026-10-26，r4（保留原建档路径）。依据[默认策略 SRS §7](../specs/2026-10-24-hashline-default-editing.md)与[协议补充](../specs/2026-10-25-real-model-evaluation-protocol.md)。基础实现见[实施计划](2026-10-25-real-model-evaluation-implementation-plan.md)、[前轮报告](../acceptance/2026-10-25-real-model-evaluation.md)；逐目标/会话树/刺激的本轮边界见[阶段验收](../acceptance/2026-10-26-evaluation-next-stage.md)。尚无正式冻结的真实模型对照，不授权付费执行、目标切换、重启或发布。

## 1. S0 → S1 → S2

| 阶段 | 目的 | 产出与结论边界 |
|---|---|---|
| S0 probe | 测可行性、成本量级、模型停滞/绕过，形成正式预算的依据 | 独立冻结 probe，声明 limits；不能证明收益或支持推广 |
| S1 formal | 按 SRS §7.3 执行完整冻结对照 | 必须先补齐下列正式执行 GAP；失败和取消不移出分母 |
| S2 判定 | 按预先冻结条件建议推广、收窄范围或证据不足 | 正确性、返工和总成本均须有证据；高采用率本身不构成收益 |

S0 与 S1 使用不同协议，不能根据正式结果事后修改模型、预算、分母或阈值。独立 [E3 冒烟](../acceptance/2026-10-25-default-edit-policy-effectiveness-e3-01.md)不并入 S1，本轮多帧复核也不是新增实验。

## 2. 已有冻结和执行机制

| 条件 | 当前实现与限制 |
|---|---|
| kind / limits | probe 允许任务子集并须声明 limits；formal 要求全部 13 族 |
| 依赖与补丁 | identity 读取实际解析包/运行文件/资源摘要、源 patch、实际补丁标记、单物理引擎、lockfile 与宿主环境；执行前及每样本前拒绝漂移 |
| 工具配置 | 同一原始 preset 派生三臂并冻结摘要；PTC、Intent gate、persona 保持相同；工具面不同，不等于纯 policy 消融 |
| 模型与参数 | provider/model 与 AgentOptions 支持参数被冻结；真实请求逐项核对并记录实际参数，未支持参数拒绝 |
| 任务与 expected | 相对路径→内容；预期独立编写，整树字节校验、独立初始摘要、候选快照与最终 diff；额外文件判错 |
| 样本与执行顺序 | 独立 cwd/Session；按 seed 旋转臂顺序、重复数和任务清单完整留证 |
| 成本与预算 | 使用可用 usage（总输入包含缓存），缺失 unknown 并停止后续请求；请求上限在 llm/stream 边界，provider 内部 HTTP 重试 unknown；token 上限是观测停止阈值 |
| 批次 | first-edit-program：正常操作可成批，编辑程序结束或内层 edit 失败立即存 checkpoint；失败后的继续编辑是新候选，同程序 catch 修复也不并入首批。task-end 兼容模式的首次正确/重试 unknown |
| 检查 | eval:check 从冻结输入、原始事件、回执、初始/候选快照和最终文件重新计算；accepted 不等于推广通过 |

协议形状与[执行命令](../../scripts/evaluation/README.md)各维护一处。具体真实模型、次数、预算、费用上限和阈值由维护者在实验前给出；固定夹具的数值不能沿用为获批真实实验参数。

## 3. 任务覆盖与口径

formal 覆盖 single-point / repeated-fragment / multi-site / consecutive-edits / external-change / unrelated-long-line / target-long-line / restricted-degradation / large-rewrite / already-satisfied / creation / user-override / special-tool。例外和冲突场景按其独立 expected 判断，拒绝不等同于错误写入。

SRS §7.2 原计数规则继续有效：四类适用性互斥，已知适用分母不删除非 Hashline 或失败目标；首选和全程模式分开；首批正确、最终正确、工具接受、实际变更分开；正常首读不算返工；一个 PTC 程序不按内层 edit 数重复计模型往返；未测字段 unknown。run summary 现在可汇总显式 targets 的逐目标采用分母，未尝试/失败/取消/unknown 留在其中；未声明或无法归属时 unknown，不能拿任务 class 冒充逐目标分母。

## 4. 剩余正式执行 GAP

| 缺口 | 当前边界与下一步 |
|---|---|
| 真实 provider / 凭据 / 明确预算 | 本轮隔离安装可解析官方 provider 包，但未配置真实凭据和执行路由；固定适配器零真实请求。以后只在独立安装提供固定 provider 和凭据引用，另获执行批准 |
| 真实模型进程内验证 | 三臂固定适配器已验证装配；provider 实际请求、usage 及取消收费边界尚无本轮真实证据 |
| 逐目标采用与恢复分类 | 已支持每文件一个冻结目标的映射、完整分母、失败后读取与恢复事实；同文件多目标和不可靠 apply_patch/专用工具路径保持 unknown / GAP，语义返工不能仅凭读取顺序推断 |
| 漂移/专用工具等控制端注入 | 已支持冻结的成功 read 次数→字节前态条件→外部写入，并验证真实宿主三臂失败/恢复；其它时点、权限拒绝、专用工具等控制器仍需补齐 |
| 子会话归并 | 已归并同进程后代并核对目录来源；[生命周期验证](../acceptance/2026-10-26-evaluation-lifecycle.md)补齐实际非空 fork 前缀去重、子流取消及取消后无新适配器请求。外部进程代理、更多取消时点及真实 provider 取消计费仍无证明 |
| 平台与纯策略消融 | 本轮 Windows；macOS/Linux 未执行。三臂不等同原 auto vs policy 的单变量实验，若要纯策略因果结论须另冻配置 |
| 推广判定 | 无自动 S2 判定；即使 formal 能冻结，缺指标或可比性不足仍只能证据不足 |

## 5. 驱动选择结论

沿用已有完整宿主验收的官方 boot、registry/loader、生产 AgentLoop 和进程 PTC。agent-loop-testkit 能挂真实 loop，但不装配完整 preset、provider、持久化或 PTC；在已有 host 装配上再挂一次 testkit 不是必要步骤。headless CLI 不支持 preset 的历史限制没有被修改；进程内组合只禁用 headless 启动入口、LLM title 和遥测，复用官方 Web host 的禁用覆盖与子代理模型服务。

未修改官方 DSH 源码、read/edit/preset、依赖版本或日常 profile。任何工程测试、固定夹具或历史轨迹复核都不能证明真实模型收益；后续获得推广依据仍不等于获准目标切换。
