# 当前验收状态与证据索引

更新日期：2026-10-26。本文汇总已有记录，文件名保留最初建档日期。本轮补充逐目标/会话树/刺激的离线实现及独立宿主证据，见本表；没有新增付费模型请求。历史报告保留各轮结果，以下计数不得合并为同一次执行。

## 当前结论

| 主题 | 当前依据与证明范围 |
|---|---|
| 基础 read/edit、cwd、persona | 已实现并有回归，见[运行修复](2026-10-23-runtime-fix-acceptance.md) |
| MV 与快照次序 | 创建意图、不覆盖、部分成功、磁盘先于快照已修复，见[MV 验收](2026-10-23-mv-observation-acceptance.md)与 [ADR-0004](../adr/0004-mv-create-intent-and-snapshot-order.md) |
| BOM | Local provider 的 hashline 路径支持零/单 BOM，连续 BOM 拒绝，见[BOM 验收](2026-10-23-bom-and-snapshot-repair-acceptance.md)与 [ADR-0005](../adr/0005-bom-preserving-hashline-read.md) |
| 运维 skills | 两份 skill、用户入口隔离及 incident/升级工作流已交付；[10-24 真实宿主交付报告](2026-10-24-delivery-acceptance-report.md)覆盖打包安装、真实 launcher/registry/loader 与装好的 CLI，9 个未覆盖 ID 仍为 BLOCKED；一次性目标与模拟/注入部分不证明日常 profile 已升级 |
| 默认策略 F-01/F-02 | Windows 策略模块地址与 read 指引已修复，见 [fix-01](2026-10-25-default-edit-policy-fix-01.md)；非目标 read 保留原指引 |
| 默认策略 F-03 / E2 | 父用户来源误拒已修复；[fix-02](2026-10-25-default-edit-policy-fix-02.md)记录定向 27 PASS、扩展完整宿主 32 PASS / 0 FAIL，包含在线/持久化父来源、会话隔离、cwd、catch 与 BOM/MV 边界；完整 E2 仍有缺口 |
| 块定位说明与诊断 | [块定位修复](2026-10-25-hashline-block-locator-fix.md)记录定向 13 PASS、后续新打包完整宿主 33 PASS / 0 FAIL、九项交付门禁 exit 0，交付 ID 21 PASS / 9 BLOCKED；未实现块解析器 |
| 真实模型 E3 | [e3-01 冒烟](2026-10-25-default-edit-policy-effectiveness-e3-01.md)：10 个真实模型子会话、64 次请求，样本 1/2 各 3/3 PASS，样本 3 为 2 PASS / 1 FAIL（空格差异），样本 5 PASS，样本 4 BLOCKED；[多帧复核](2026-10-25-real-model-evaluation.md)恢复全部 10 个子会话事件及调用配对；历史实际模式/部分 usage 仍 unknown，dev link 环境不证明打包安装，E3 未整体通过 |
| 评测基础设施 | [本轮验收](2026-10-25-real-model-evaluation.md)：probe/formal、身份冻结、三臂真实宿主零费用驱动、候选快照和独立文件校验已验证；完整九项门禁 exit 0，交付 21 PASS / 9 BLOCKED。初版缺口由本表“逐目标/会话树/冻结刺激”分项更新；真实 provider 仍缺验证 |
| 推广收益 E4 | [推广评测方案](../plans/2026-10-25-default-edit-policy-promotion-evaluation-plan.md)已定稿；尚无已执行的正式冻结对照，独立 E3 冒烟不能替代 S1 对照 |
| 自定义模型配置 | [配置入口增量](2026-10-25-evaluation-config.md)：JSON 模板 + prepare 自动采集身份/冻结，33 项定向回归通过；实际 CLI 生成、防覆盖、未填项拒绝及无凭据 preflight 已验证，无真实模型请求 |
| 逐目标/会话树/冻结刺激 | [阶段验收](2026-10-26-evaluation-next-stage.md)：55 项定向、12 项真实宿主固定适配器案例通过；九项门禁 exit 0、交付 21 PASS / 9 BLOCKED。支持有界目标映射、父子费用归并及读后漂移，流量/会话请求对账 33/33，失败当刻独立快照区分首错与恢复；不是 S1/S2 或真实模型收益证据 |
| fork/取消生命周期 | [本轮验收](2026-10-26-evaluation-lifecycle.md)：真实同进程 fork 三臂 18/18 去重对账；子流取消三臂保留部分落盘及后续样本，取消后无新适配器请求，评测结果仍 GAP/unknown。固定 Provider 证明有界生命周期，不证明真实 Provider 取消计费；创建中/工具中等其它取消时点仍缺验证 |
| apply_patch 目标取证 | [本轮验收](2026-10-26-evaluation-apply-patch.md)：保存实际解析计划并核对同会话调用/模式/文件头集合；无移动载荷可映射，缺计划仍 unknown。73 项定向、最终宿主 18 PASS、对账 45/45；九项门禁 exit 0。早期新路径创建 FS_NOT_OBSERVED 和空文件末尾换行不符各保留 1 FAIL，未修工具契约；不证明模型收益 |
| 首次指标冻结范围 | [v2 验收](2026-10-26-evaluation-cohort.md)：任务 include/exclude 在执行前冻结，仅影响首次条件；最终文件、Token、调度和全局覆盖仍检查全任务。123 项回归、九种固定 Provider 判读及历史兼容通过；真实模型请求 0，正式任务集未执行 |
| 可复用候选任务集 | [本轮验收](2026-10-26-evaluation-task-suite.md)：13 族普通配置与独立 expected 可生成，默认 probe；136 项定向、实际 CLI 冻结及无凭据 BLOCKED 预检通过，九项交付门禁 exit 0、21 PASS / 9 BLOCKED。本阶段止于配置/预检；后续完整固定宿主结果见下行，真实模型未执行，不据标签齐全认定 S1 通过 |
| 候选任务集完整宿主验证 | [后续验收](2026-10-26-evaluation-suite-host.md)：39 样本实际固定 Provider 执行、90 断言通过、81/81 请求对账；实际任务 31 PASS / 6 GAP / 2 FAIL，最终字节 36 正确 / 3 错误，judge=2。连续中间快照与生成器调用已取证，shell 目标仍 unknown。189 回归与九项交付门禁通过、21 PASS / 9 BLOCKED；真实模型请求 0。发现并修正一次性安装的传递 Hashline 版本/物理实例漂移，历史根 marker PASS 不扩大为同引擎证明 |
| 冻结条件与覆盖统计 | [本轮验收](2026-10-26-evaluation-verdict.md)：v1 明确每臂首次正确数量与逐样本整树 Token 上限，judge 与 check 分开；保留已测/未知分母及可能范围。94 项回归、18 例宿主组、预先冻结 PASS/FAIL/GAP 场景与退出码 0/2/2 已验证；旧语义明确 GAP。完整交付 21 PASS / 9 BLOCKED；不包含真实模型收益或自动 S2 |
| 平台与安装状态 | 上述 10-25 修复验收为 Windows 隔离安装；macOS/Linux 已配置 CI，报告尚无实跑结果。没有据隔离验收切换日常 profile；早期用户确认重启不代表后续修复已装入或复验 |

## 历史失败与修复关系

| 历史记录 | 后续处置 |
|---|---|
| [local-01](2026-10-25-default-edit-policy-effectiveness-local-01.md)：Windows 加载及 read 指引 FAIL | [fix-01](2026-10-25-default-edit-policy-fix-01.md)关闭这两项；诊断用 file URL 的通过不当作原产品通过 |
| [完整宿主首轮](2026-10-25-default-edit-policy-full-host.md)：21 PASS / 1 FAIL | [fix-02](2026-10-25-default-edit-policy-fix-02.md)关闭 F-03；后续块定位轮次扩展至 33 PASS。各轮独立留证，不相加 |
| 10-23 的 1602 候选安装状态 | 1736 运行确认原 checkout 补丁解析及门禁，原始位置见下表；不代表 10-25 补丁已应用于日常宿主 |
| 10-23 的 1736 / 1807 审计 | 后续修正 scoped policy 两模式的 intent/CAS 与取证配对；v2 按 subCallId 得到 134 次完成行为调用及同轮声明，不再采用 v1 的 268 次统计，见本地 AUDIT-CLOSURE-REPORT 与[独立复核](../../.scratch/ptc-hashline/2026-10-23-1807-review-followup.md) |

1807 修正后的历史候选门禁记录：build/check exit 0、unit 44、integration 140、PTC 19、compat 21，preset/profile exit 0。后续独立复核仅运行受影响的 integration 32 与 PTC 2 项；首次 Windows 沙箱 ReplaceFileW EIO 后在获准非沙箱环境重跑通过。原始运行与后续复核不合并为一次全量结果。


## 仓库内可重跑的证明

| 行为 | 仓库内入口 |
|---|---|
| 有效工作目录 | [working-directory.spec.ts](../../packages/tool-read/tests/integration/working-directory.spec.ts) |
| MV/BOM/部分成功 | [mv-observation.spec.ts](../../packages/tool-read/tests/integration/mv-observation.spec.ts) |
| 引擎快照次序与失败 | [mv-snapshot-order.spec.ts](../../tests/compat/mv-snapshot-order.spec.ts) |
| scoped policy 两模式与 CAS | [edit-policy-composition.spec.ts](../../tests/integration/edit-policy-composition.spec.ts)、[拓扑](../../tests/integration/edit-policy-topology.spec.ts) |
| PTC 错误传播 | [edit-policy.spec.ts](../../tests/ptc/edit-policy.spec.ts)、[mv-policy.spec.ts](../../tests/ptc/mv-policy.spec.ts) |
| 日志完整性、载体与配对 | [extract-runtime-evidence.spec.ts](../../tests/integration/extract-runtime-evidence.spec.ts)、[提取器](../../scripts/extract-runtime-evidence.mjs) |
| 安装、单引擎实例、补丁与 BOM | [test-profile.mjs](../../scripts/test-profile.mjs) |
| 运维 skill 隔离与调用资格 | [operations-skills.spec.ts](../../tests/integration/operations-skills.spec.ts)（真实 preset registry/loader 装配）、[operations-context.spec.ts](../../tests/integration/operations-context.spec.ts) |
| 运维配置与运行基线 | [operations-config.spec.ts](../../tests/integration/operations-config.spec.ts)、[operations-baseline.spec.ts](../../tests/integration/operations-baseline.spec.ts)、[operations-cli.spec.ts](../../tests/integration/operations-cli.spec.ts) |
| 打包后资源可解析（PACK-01 入口切片） | [operations-pack.spec.ts](../../tests/integration/operations-pack.spec.ts) |
| 升级评估/方案/同意 | [operations-upgrade-assessment.spec.ts](../../tests/integration/operations-upgrade-assessment.spec.ts)、[operations-upgrade-proposal-consent.spec.ts](../../tests/integration/operations-upgrade-proposal-consent.spec.ts) |
| 隔离候选验证 | [operations-candidate-validation.spec.ts](../../tests/integration/operations-candidate-validation.spec.ts) |
| 目标切换与失败回退/交接 | [operations-target-switch.spec.ts](../../tests/integration/operations-target-switch.spec.ts) |
| 真实宿主交付验收（打包安装 + 真实装配 + 两条工作流） | [交付验收报告](2026-10-24-delivery-acceptance-report.md)、[入口](../../scripts/delivery-acceptance-cli.mjs)、[自检](../../tests/integration/delivery-acceptance.spec.ts) |
| 默认编辑策略的工程切片（票据 01～08） | [工程验收报告](2026-10-24-default-edit-policy-engineering.md)：各验收 ID 的证据位置、先前存在失败对照、未覆盖项 |

执行说明与环境输入见[根 README](../../README.md)及[测试说明](../../tests/integration/README.md)。用例数量是运行记录，不作为未来版本必须保持不变的常量。

## 本地原始证据的定位

以下均为 Git 忽略的本地留证路径，**不随 clone 交付**。本文只保存必要结论和可重跑入口，不复制原会话、活 profile 配置或私人绝对路径。没有这些文件时，不能宣称已经独立审阅原始日志；可依仓库测试复核对应契约，不能重造历史运行事实。

| 时间/路径（相对仓库） | 内容 |
|---|---|
| `.scratch/ptc-hashline/runtime-verification-report.md`、`runtime-fix-plan.md` | 早期目录/persona 问题与计划 |
| `.scratch/ptc-hashline/2026-10-23-relative-path-mv-rem-report.md` | MV 原始实测失败 |
| `.scratch/ptc-hashline/evidence/phase-a-red.txt` | 早期修复前红测 |
| `.scratch/ptc-hashline/evidence/20261023-1453/` | BOM 丢失与快照文案原始失败 |
| `.scratch/ptc-hashline/evidence/20261023-1602/` | 红绿测试、BOM 矩阵及候选门禁；候选安装树已清理 |
| `.scratch/ptc-hashline/evidence/20261023-1736-a4d1/` | 原 checkout 整合、实际会话与字节证据；部分解释已被后续审计纠正 |
| `.scratch/ptc-hashline/evidence/20261023-1807-4b1d/` | AUDIT-CLOSURE-REPORT、v1/v2 取证、修正前后门禁 |
| `.scratch/ptc-hashline/2026-10-23-1807-review-followup.md` | 五项修正后的独立复核 |

原始报告保持原样；有条件保存关键原始证据时，应另行脱敏并正式归档，而不是批量追踪整个 `.scratch`。本索引不能替代原始运行日志。

## 仍保留的范围限制

- 早期 scoped policy 夹具仍只证明其范围；后续完整 preset/进程 PTC/子代理路径按 fix-02 与块定位报告独立计证。
- 完整宿主使用固定适配器，真实模型请求为零；官方进程 PTC 的 sandbox enforcement 为 partial，不证明完整沙箱隔离。
- 真实 sandbox 后端、多 provider、replace/patch/apply_patch 的 BOM 保真未做系统验收。
- MV 源删除无版本条件、多节无全局事务，属于已知边界；seen 是有限守卫，不是权限边界。
- 剩余 E2 包括无 session/SDK、多窗口上限、remount 失效、真实后端 retry 竞争/取消/unknown、MV+内容混合及更多字节/载荷组合，详见 fix-02 的剩余验收。
- 已有 E3 冒烟但未整体通过，E4 正式对照未执行；`.tmp/order-config-migration/` 另有本地演练记录，本轮仅确认材料存在，未独立重验，不并入正式验收计数。
