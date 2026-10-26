# 可复用候选任务集验收

日期：2026-10-26（Asia/Shanghai），基线 4cfc3e2 加本轮未提交增量。按[计划](../plans/2026-10-26-evaluation-task-suite-plan.md)承接[v2 范围](2026-10-26-evaluation-cohort.md)之后的任务数据缺口；没有重做轨迹恢复、调用归属或条件判定。源码和工件摘要见[机器清单](2026-10-26-evaluation-task-suite-summary.json)。

本轮真实模型请求 **0**。新增的是可复用的候选配置和无费用检查，不是已完成的 13 类模型实验，不证明收益或 S1/S2 通过。未修改 read/edit/preset、官方框架、依赖版本、补丁或日常 profile；未提交或发布。

## 实现范围

[task-suite.mjs](../../scripts/evaluation/task-suite.mjs) 用稳定数据构造 13 类任务，输出普通可编辑 JSON；再由原 prepare 合入实际安装身份并冻结。生成入口不加载 profile、Provider、运行器或任务生成器，不新增执行协议。`wx` 防覆盖，参数不接受 --execute。模型、总预算和通过阈值保持 null，不默认授权真实执行。

initial 与 expected 分别编写，未引用模型产物或实际文件来生成预期。重复的未改字节用常量压缩源码，输出时完整展开；约 9 MiB 的 JSON 主要来自两份 4 MiB 以上的快照场景文本，原始展开文件留在 `.scratch/`，不提交大文件。冻结哈希涵盖展开后的全部内容；新增模块也被既有 identity 的 driverInputs 扫描，因此旧冻结身份不能直接沿用。

| 家族 | 具体设计及证据边界 |
|---|---|
| single-point / repeated-fragment | 单点；仅改第二段，保留第一段相同值 |
| multi-site | 同文件两个位置及另一个文件；遗漏任一更新判错 |
| consecutive-edits | 插行后核验，再改后续行；最终字节独立可查，但分步行为仍须轨迹审查 |
| external-change | 既有成功 read 刺激控制器写入 audit=peer；预期要求保留竞争者值 |
| unrelated-long-line | 首行 5000 字符截断，末行目标可独立分页取得完整依据 |
| target-long-line | 单行目标超出当前 2000 字符窗口；允许只读 Node 取必要完整内容，不放宽编辑策略 |
| restricted-degradation | 4500015 字节文本，超过当前 4 MiB 门槛；只更新首行，不变更门槛或策略 |
| large-rewrite | 版本和 128 个路由均更新，129 行，防止只改版本头冒充重建 |
| already-satisfied / creation | 已满足则不写；真正新建一个文件 |
| user-override | 实际用户提示明确 replace 模式、文件与范围；strict 臂可能无法完成，保留失败 |
| special-tool | 项目提供 generate.mjs/source.json；独立 expected 同时要求源、生成器不变和产物正确 |

默认 kind=probe，limits 明示代表性和行为审查缺口。首次范围纳入 10 项，排除 satisfied/create/generator，理由在配置中冻结；全任务 Token、最终文件和调度仍不缩小。每类一例与 formal schema 校验通过，不构成正式任务集设计充分或实际场景已触发的证明。

## 本轮验证

原始根 `.scratch/real-model-evaluation/20261026-task-suite/` 被 Git 忽略，不随 clone 提供。Windows、Node 24.19.0；复用上轮独立验证树，加入本轮新增模块与测试，恢复后源码字节一致。构建/交付在隔离树进行，未在日常宿主链接的源码树构建。

| 检查 | 实际结果 | 证据 |
|---|---|---|
| 定向回归 | 8 文件 **136 PASS / 0 FAIL**，其中新任务集 13 项；TypeScript exit 0 | logs/evaluation-final.log、types-final.log；tests/unit/evaluation-task-suite.spec.ts |
| 确定性/协议 | 13 族恰好一次；输出对象独立；正式形状能冻结并拒绝篡改；两次重复保留 78 个计划位置 | 同一测试中的冻结、调度用例；不是 78 个已执行样本 |
| 窗口与门槛 | 使用实际 buildReadWindow/resolveConfig，目标长行不完整、无关长行后的目标可分页；快照输入超过真实默认门槛 | 同一测试中的窗口/门槛用例；不是完整宿主长行实验 |
| 外部写入与生成器 | 实际本地磁盘触发 peer 写入；实际 node generate.mjs 产物匹配独立 expected，修改源文件仍被判错 | 同一测试中的控制器、生成器用例；不是模型自主工具调用证据 |
| 生成/prepare CLI | 生成 exit 0，未填配置 prepare exit 2 且无冻结文件；填写仅用于预检的参数后 prepare exit 0 | expanded.json、configured.json、frozen.json、logs/cli.json |
| 无凭据预检 | 对一次性 profile 默认 run 返回 BLOCKED / exit 2，唯一 gap 为 credential environment variable unavailable；executed=false、39 个计划位置，未创建执行目录 | logs/cli.json；未传 --execute |
| 无可用 profile/Provider | 缺安装环境时 BLOCKED，hostFactory 不得启动 | 新套件最后一项测试；不是实际 Provider 请求失败测试 |
| 防覆盖变异 | 隔离副本 wx 改成 w，覆盖用例失败：**1 FAIL / 12 PASS**，exit 1；按原字节恢复后 **13 PASS** | logs/mutation.log、restored-suite.log |
| 完整交付 | 九项门禁 exit 0，验收 ID **21 PASS / 0 FAIL / 9 BLOCKED**；细项 55 PASS 单列，不与 ID 相加 | [报告](2026-10-26-evaluation-task-suite-delivery-report.md)、[摘要](2026-10-26-evaluation-task-suite-delivery-summary.json)、logs/delivery.log |

最初定向测试为 12 PASS / 1 FAIL：测试误从 protocol 导入 schedule；类型检查另发现重复 limit 被覆盖。均已修正，首次失败保留于 logs/task-suite-initial.log、types-initial.log。首次变异运行过滤路径错误，未发现测试，不计为有效变异；随后从隔离树正确运行并得到上表失败，未将退出码本身冒充测试抓错。

代码按 code-review-and-quality 五轴复核：数据生成与现有执行器分开，保持普通协议；无新依赖和任意脚本执行入口；写入仅限用户指定的新输出文件；生成器只作为任务输入。输出开销约 9 MiB、无模型费用。未发现本轮有界实现的阻断问题。

## 剩余 GAP

- **已实现且已验证**：可复用候选数据、独立 expected、展开/防覆盖、原 prepare/freeze/无凭据预检，以及本地控制器和生成器的有界验证。
- **已实现但缺真实验证**：13 类任务尚未通过模型完整执行；长行/快照的实际回执、例外路径、最终文件和 usage 仍须逐样本取证，不能用本地函数测试替代。
- **部分实现**：formal 形状与首次范围已有校验；每族只有一例，缺代表性审查、充分重复和完整固定 Provider 宿主任务集验收。生成器的目标采用归属仍可能 unknown/GAP。
- **未实现**：consecutive 的中间状态和 generator 的必经调用尚无自动语义验收；没有相对收益、提示公平性及独立模型计时判定。
- **外部依赖**：本轮主动不给真实模型凭据，不启动付费请求；实际实验仍需用户明确模型、Provider、重复量和费用边界。

下一项优先补齐候选任务的完整无费用宿主执行验证及关键行为证据，再决定正式实验配置。后续命令与安全前提维护在[使用说明](../../scripts/evaluation/README.md)：先生成并编辑 JSON，prepare 后默认 run 只做预检；真实执行另获授权才传 --execute，使用独立 profile 与服务端费用上限，不改 expected 追随实际结果。
