# 评测生命周期验收：实际 fork 与取消

执行日期：2026-10-26（Asia/Shanghai）。维护基线为 fe18815 加本轮增量；范围见[计划](../plans/2026-10-26-evaluation-lifecycle-plan.md)。承接[上一阶段](2026-10-26-evaluation-next-stage.md)的单元证据，本轮新增真实安装、官方 AgentLoop、进程 PTC 与固定 Provider 的生命周期验证。真实模型请求 **0**；不证明模型遵从、Token 收益或 S1/S2 通过。

## 实现与责任层

- [lifecycle-smoke.mjs](../../scripts/evaluation/lifecycle-smoke.mjs) 复用 openHost/runEvaluation/checkRunReport，不新增正式执行器。测试入口在父首回合 whenIdle 后追加固定提示，或在子适配器等待点触发真实 AbortController；这些是测试编排，不是正式协议隐含输入。
- [固定 Provider](../../tests/fixtures/evaluation-provider/index.mjs) 仅看自身非继承事件选择脚本，支持 fork 及等待取消的流，并发布测试用请求/取消观察。无网络；其 usage 是人为夹具值。
- [session-tree.mjs](../../scripts/evaluation/session-tree.mjs) 的继承去重、整树完成等待，以及 [run.mjs](../../scripts/evaluation/run.mjs) 的取消准入、样本分母和 unknown 沿用 fe18815 实现。本轮未修改生产收集、工具、preset、依赖、补丁或官方框架。

新增 I/O 仅为 lifecycle.json 和汇总；原始轨迹、候选/最终树及 diff 沿用现有机制。日常 profile 未切换，测试只向新建的一次性安装首次放入本仓库夹具；已有夹具版本不同时拒绝覆盖。

## 最终证据

原始根 `.scratch/real-model-evaluation/20261026-lifecycle/` 被 Git 忽略，不随 clone 提供。[机器摘要](2026-10-26-evaluation-lifecycle-summary.json)包含源码、协议、报告及日志摘要。独立 tree/ 构建；Windows / Node 24.19.0 / pnpm 11.28.5。

| 验证 | 执行结果与边界 | 本地证据 |
|---|---|---|
| 实际 fork 三臂 | **3 PASS**；每组父＋子两会话，子继承 20 条父事件且截止 turn/end，含已完成模型响应；逐字核对父前缀。共 18 次实际适配器请求，去重后会话计数 18/18；独立最终文件正确 | lifecycle-final/fork/，lifecycle.json、原始图/日志、protocol.json、report.json |
| 实际取消三臂 | **测试断言通过，评测结果保留 GAP**；每臂各独立启动一组，先改 a.txt 再在子流等待取消；a.txt=y、b.txt=x，最终未满足完整 expected。子最终 turn/end=aborted，父子已空闲/释放；取消后零新适配器请求。每组 4 次适配器请求，最后一条无 usage，总 Token unknown，已知夹具 Token 6 | lifecycle-final/cancel-1～3/，lifecycle.json、部分磁盘树及原始会话 |
| 取消分母 | 三组各一个实际 CANCELLED＋两个未执行 CANCELLED，共 9 个计划槽，6 个未执行；全部保留两项目标。不能把未执行槽移出分母或说成成功任务 | 同上 report.json / targetEvaluation |
| 独立 checker | 四组 problems=[]，另用实际 driver check CLI 复核四组及普通冒烟，5 次均 exit 0；只表示证据一致。取消组的费用 accounting 仍 GAP、capturedRequests unknown | lifecycle-final/summary.json；各组报告；logs/checker-final.json |
| 原有宿主冒烟 | **12 PASS / 0 FAIL**，请求/日志对账 33/33；新夹具未破坏单点、多文件、spawn 与漂移 | smoke-final/，logs/smoke-final.log |
| 定向/类型 | **55 PASS / 0 FAIL**，4 个 evaluation 测试文件；tsc exit 0 | logs/evaluation-final.log、logs/types-final.log |
| 完整交付 | 九项门禁 exit 0；**21 PASS / 0 FAIL / 9 BLOCKED**，BLOCKED 是原交付未覆盖 ID，未改写为 PASS | [交付报告](2026-10-26-evaluation-lifecycle-delivery-report.md)、[摘要](2026-10-26-evaluation-lifecycle-delivery-summary.json)，delivery-final/、logs/delivery-final.log |
| 变异阴性对照 | 仅在隔离副本把 traceSummary 的继承前缀裁剪改为从 0 开始，fork 评测降为 GAP，生命周期断言失败 exit 1；原始字节恢复且与维护源码一致 | lifecycle-mutation/、logs/mutation.log |

实际执行样本为 fork 3＋取消 3，共 6 个；与回归的 12 个普通冒烟、55 项单元以及前轮计数分开，不相加为一次测试。四组协议合计 30 次人为适配器请求，不是 30 次真实模型请求。

## 失败对照与观察边界

早期 lifecycle-01/02 的 fork 组为 FAIL：测试在 turn/end 观察者内立即/微任务追加提示，前者处于提交重入，后者仍处于驱动清理，预期后续回合没有执行。修正测试为等官方 whenIdle 后再 followup；未改官方生命周期。lifecycle-03 完成首轮验证，最终 lifecycle-final 增加了实际适配器请求观察与会话空闲断言。各轮独立保留，不合并。

取消时，已空闲父代理可能被子完成通知再次唤醒；执行器的取消预算准入在 Provider 前拒绝该次请求，原始父末次 turn/end 可为 error/EVAL_BUDGET_STOP。报告按外部取消事实保留 CANCELLED，不把原始 error 改成 aborted；整树成本因捕获不完整仍 unknown/GAP。这里证明没有新增适配器调用，不证明取消不收费或没有宿主内部唤醒。

复核按 code-review-and-quality 五轴进行：测试编排独立于正式执行、调用归属与非空继承前缀有实际断言、取消后无请求有独立观察、版本不一致拒绝热改、输出不覆盖；变异检查确认去重回归可被捕获。

## 剩余 GAP / BLOCKED

本轮关闭“实际同进程 fork 与子流取消仅有单元证据”的有界缺口。仍未覆盖创建中取消、工具执行中取消、更多并发时序及外部进程代理；不泛化为全部生命周期验证。

同文件多目标、特殊载荷映射、语义返工、重叠候选、其它刺激控制器及自动 S2 仍待开发。macOS/Linux、真实 Provider usage/HTTP 重试/取消计费仍待验证；付费执行仍需模型、凭据、预算和明确授权。使用入口与安全前提见[评测说明](../../scripts/evaluation/README.md)。
