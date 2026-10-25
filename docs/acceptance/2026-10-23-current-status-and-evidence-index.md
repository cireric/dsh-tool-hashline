# 当前验收状态与证据索引

> 2026-10-25 块定位说明修复：[验收报告](2026-10-25-hashline-block-locator-fix.md)。tool-edit 正式补丁明确块替换/剪切不可用并准确诊断，保持显式范围和块后插入/粘贴行为；13 项定向、33 项新打包完整宿主通过，九项交付门禁 exit 0。日常 profile 未切换，macOS/Linux 与真实模型未在本轮执行。

> 2026-10-25 修复增量：[F-03 修复与复验](2026-10-25-default-edit-policy-fix-02.md)：父用户来源改用宿主 observation 与真实委派记录核验；扩展后的新打包完整宿主 32 PASS / 0 FAIL（含在线/持久化父会话、混合整笔拒绝、会话隔离、cwd 变化、catch 语义与 BOM/MV 边界），定向 27 PASS，九项交付门禁 exit 0；交付 ID 21 PASS / 9 BLOCKED。此前完整宿主 21 PASS / 1 FAIL 保留为历史红测。剩余 E2 子项、macOS/Linux 实跑与真实模型仍未完成，日常 profile 未切换。

> 2026-10-25 后续修复：[fix-01 验收](2026-10-25-default-edit-policy-fix-01.md)已修复下面 local-01 的 Windows 模块地址与目标 read 指引问题；pnpm 11.28.5 下正式补丁冻结安装、新增 13 项回归及完整交付门禁均通过。三平台 CI 已配置，macOS/Linux 尚未实际执行；完整 preset、实际后端、真实委派与模型验收继续保留缺口。下方 FAIL 描述保留为修复前历史。

> 2026-10-25 默认编辑策略增量：[实际生效验收 local-01](2026-10-25-default-edit-policy-effectiveness-local-01.md)已在 Windows 隔离副本及 pack 安装执行。当前 FAIL：原生路径使策略模块不可加载；read nextAction 指引与规格不一致。诊断用 file URL 的通过不是产品修复；完整 preset、真实委派/后端及真实模型仍待验，不覆盖下方历史基础能力结果。

> 2026-10-25 真实模型 E3 增量：[冒烟 run 20261025-e3-01](2026-10-25-default-edit-policy-effectiveness-e3-01.md)：10 个真实模型子会话（全部 wb/deepseek-v4.1-flash，64 次请求）。样本 1/2 各 3/3 PASS；样本 3 为 2 PASS / 1 FAIL（"90 天"写成"90天"）；样本 5 PASS（子会话 prompt 可见性记 GAP）；样本 4（明确用户覆盖）BLOCKED，需真实用户会话。逐调用轨迹不可得、read/edit 经 dev link 解析，结论只覆盖本组样本；E3 未整体通过，E4 未触及。

更新日期：2026-10-23。本文是当前维护入口；各历史验收文件保留执行当时的结果，不能把旧 GAP 或旧计数直接当作当前状态。

本次仅整理文档，没有重新运行构建或业务测试。下面区分历史候选全量门禁、后续独立定向复核和用户确认，不将它们合并成同一轮执行。

## 当前结论

| 项目 | 当前依据与边界 |
|---|---|
| read/edit、有效 cwd 与 persona | 已实现并有回归；见[运行修复记录](2026-10-23-runtime-fix-acceptance.md) |
| MV 创建意图、不覆盖、部分成功与快照次序 | 已修复；见[MV 记录](2026-10-23-mv-observation-acceptance.md)、[ADR-0004](../adr/0004-mv-create-intent-and-snapshot-order.md) |
| hashline BOM 保真与快照错误文案 | Local provider、零/单 BOM 支持；连续 BOM 明确拒绝；见[BOM 记录](2026-10-23-bom-and-snapshot-repair-acceptance.md)、[ADR-0005](../adr/0005-bom-preserving-hashline-read.md) |
| 原 checkout 安装整合 | 后续 1736 运行确认补丁已解析并完成门禁；1602 记录的“安装树尚未更新”是当时状态 |
| editor policy 链 | 1807 修正后，hashline 与真实 replace 两模式在 scoped 定向夹具中验证版本 intent/CAS；未据旧探针实施 realm 修复 |
| Intent/PTC 取证 | v2 按 subCallId 配对；原会话 seq 0..973 得到 134 次完成行为调用、134 次同轮声明有效、无门拒绝；不使用 v1 的 268 次统计 |
| 1807 审查修正 | 五项发现已在后续复核关闭；单独重跑受影响的 integration 32 项与 PTC 2 项通过 |
| DSH 重启 | 用户已确认手动重启；不再要求进程启动取证，不据此声称重新跑过重启后的完整业务矩阵 |
| 运维 skills | 两份 skill 仅在本 preset 的用户入口出现（真实 registry/loader 装配证据）、模型加载被拒、调用资格核验、CONFIG-01 配置与运行基线（ticket 01）；incident 取证与登记（ticket 02/03）；升级评估、方案、同意、隔离候选验证与获第二阶段同意后的目标切换/本轮回退或交接（ticket 04/05/06/07）均已实现；真实宿主交付验收（PACK-01、SCOPE-01～07、UPG-13、REG-01）已按[交付验收报告](2026-10-24-delivery-acceptance-report.md)执行一次：打包安装、真实 launcher 装配出 ptc-hashline preset、装上的 preset registry/loader 装配出两份 skill、两条工作流走装好的 CLI。报告逐条记 PASS/GAP/FAIL/BLOCKED 与退出码，9 个不由本轮覆盖的规格 ID 显式列 BLOCKED 并注明归属；模拟候选、注入 runner、一次性 profile、以及「没有人工冒烟」的边界都写在报告里 |

## 最近已记录的门禁

1807 修正后的隔离候选报告记录：

| 命令 | 记录结果 |
|---|---|
| build / check | exit 0 |
| test:unit | 44 passed |
| test:integration | 140 passed（含新增拓扑 3、策略 10、取证 19） |
| test:ptc | 19 passed（含两模式策略用例） |
| test:compat | 21 passed |
| check:preset / test:profile | exit 0 |

后续独立复核只运行新增相关套件，共 34 项通过；首次 Windows 沙箱执行有 ReplaceFileW EIO，保持代码不变在获准的非沙箱环境重跑通过。该次环境失败与候选全量门禁不是同一次运行。

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

- 定向 policy 夹具复现 scope/realm，未通过真实 preset loader 装配全部行，不扩大其证明范围。
- PTC 回归包含进程内 carrier；完整真实执行后端的生命周期、进程隔离/沙箱仍需按使用目标验证。
- 真实 sandbox 后端、多 provider、replace/patch/apply_patch 的 BOM 保真未做系统验收。
- MV 源删除无版本条件、多节无全局事务，属于已知边界；seen 是有限守卫，不是权限边界。
- 已有实际会话冒烟，不等于具备持续自动运行的完整宿主/model 回归；[历史自动化调查](2026-10-23-host-run-deferred.md)仍可作实现参考。
