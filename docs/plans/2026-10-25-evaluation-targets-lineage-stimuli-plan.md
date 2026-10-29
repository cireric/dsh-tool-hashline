# 评测下一阶段：逐目标、会话树与冻结刺激

> 文档状态（2026-10-28）：历史实施参考；已执行范围与原 FAIL/GAP/BLOCKED 见[对应验收](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-26-evaluation-next-stage.md")。未覆盖项不自动变成当前任务；后续是否重开统一见[当前状态](../acceptance/2026-10-23-current-status-and-evidence-index.md)。以下正文按制订时点阅读。


承接已提交的离线评测基础设施与配置入口。开发范围仅为仓库评测辅助程序，不改 read/edit/preset、DSH 框架或依赖，不自动执行真实 API 请求或提交代码。

1. 协议增加可选 targets：id / path / goal / class；初期每文件一个独立目标，避免凭文件名推断同文件多目标。未声明或载荷无法解析时保持 unknown。Hashline 目标解析复用实际安装引擎的 Patch.parse。
2. 通过现有 session/created、session/event 和 agent 生命周期采集根/后代会话；验证 parentSession 与父 subagent/catalog，调用按 sessionId 隔离，fork 继承事件不重复统计。保存跨会话捕获顺序和独立子事件，离线重算整树费用及目标事实。
3. 增加冻结 stimuli：在指定文件第 N 次成功 read 后、结果交还程序前，按冻结 before 条件写入冻结 after。仅允许任务目录内普通文件；保留触发调用、前后字节摘要和独立证据；未触发/条件失配/取消/记录缺失不能算覆盖。
4. 将目标、会话树、刺激结果接入原 report checker，保留旧报告重算路径。增加缺失子记录、跨会话 ID 碰撞、错误分母、未知模式、外部漂移和取消的阴性测试。
5. 使用固定适配器做真实安装/AgentLoop/PTC 的多文件、委派和读后漂移冒烟；按 README 在独立副本跑门禁与交付。不得用夹具统计或脚本修复行为作为真实模型收益。

新增 I/O：每后代会话保存原始事件/回执；每候选文件树快照沿用既有机制；每刺激读取前态、写入后态并保存证据。评测墙钟包含这些开销，模型核验次数仍不从 evaluator I/O 推断。

正式需求补充写回原协议说明；本计划不代表 S1 已就绪，也不处理真实 provider、跨平台和自动 S2 的既有 GAP。

2026-10-26 收尾：上述有界离线增量已实现；最终 55 项定向测试、12 项真实宿主固定适配器案例、九项交付门禁和独立报告重算均有证据。见[阶段验收](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-26-evaluation-next-stage.md")。同程序内失败后修复有失败当刻快照；未捕获目录子会话不能被其它子会话掩盖；使用官方 waitForChildren 排空通知后，33 次流量请求与 33 条会话请求一致，计数缺口只能 GAP。10-25 开发轮次独立保留，不与最终结果相加；未产生真实模型请求。
