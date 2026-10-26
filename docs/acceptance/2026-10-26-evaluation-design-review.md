# 冻结实验可比性审查验收

2026-10-26（Asia/Shanghai），基线 ceaa004 加本轮未提交增量。此前宿主验证与安装修正已先提交为 ceaa004，本轮按[计划](../plans/2026-10-26-evaluation-design-review-plan.md)补离线审查工具；不改写[上轮 31 PASS / 6 GAP / 2 FAIL](2026-10-26-evaluation-suite-host.md)。源码、实际审查和 CLI 结果见[机器清单](2026-10-26-evaluation-design-review-summary.json)。

真实模型请求 **0**。本轮没有启动真实 Provider、修改日常 profile、依赖、补丁或工具/preset，不新增执行审批、推广授权或自动配置迁移。设计报告保持 GAP；命令 exit 0 只表示报告生成，不表示可比性或收益成立。

## 实现

[review-design.mjs](../../scripts/evaluation/review-design.mjs) 读取冻结协议并核对实际一次性安装身份，通过官方 loader 读取 preset，再按原 armRows 派生配置并核验 tools.presetHash/arms。比较插件存在性、名称与行摘要，两两列出变化；仅导出 read/edit 白名单的开关、模式和数值上限，不输出完整 persona 或任意配置正文。重复插件 ID、配置/安装漂移、非法参数或覆盖输出拒绝。

[host.mjs](../../scripts/evaluation/host.mjs) 只提取既有读取步骤为 capturePresetRows，原 captureTools 输出形状与派生算法不变；无需挂载宿主或解析实际模型。新增模块进入原 driverInputs，须重新 prepare，旧冻结身份不追认。本轮未改 run/check/judge 的执行、成本、文件或条件契约。

报告给出冻结模型配置摘要、13 族分布、重复量、完整计划数及首次纳入/排除范围。v1 保持全任务首次分母；历史无 semantics 时标 semantics-not-frozen、首次条件分母 null，不推断 v2。字段 frozenSharedAcrossSchedule/frozenInputsSharedByTask 只描述协议共享声明，不冒充实际请求参数或初始磁盘核验。

## 实际设计发现与用途

原始目录 `.scratch/real-model-evaluation/20261026-design-review/` 被 Git 忽略，不随 clone 提供。实际重新生成并冻结 13 类候选配置，模型名仅为 offline-design-only，没有请求它。review.json 关联本次 protocolHash，而非使用旧安装身份。

| 事实或缺口 | 可核验证据与解释 |
|---|---|
| 三臂工具配置确实不同 | stock 与两 Hashline 臂分别变化 tool-edit/tool-fs/tool-read；两个 Hashline 臂只变化 tool-edit 行，配置 mode 分别为 hashline/auto。产生点为实际 review.comparison.pairs/plugins 与 identity.armRows；不能称为纯策略消融 |
| 20 行配置摘要相同 | 包括 persona、intent-gate-watchdog、shell 等，证明加载后的行声明相同；没有独立证明最终模型请求中的完整提示和生成 SDK 一致 |
| 每族一个候选 | 13 族、1 次重复、3 臂共 39 个计划位置。这里没有执行这 39 个样本；家族标签齐全不证明代表性或统计效力 |
| 首次与全任务分母不同 | 每臂首次 10、最终/Token 13；satisfied/create/generator 的三个排除理由原样保留。理由是作者声明，不独立证明天然不适用 |
| consecutive 指标解释有混杂 | 本次声明 family=consecutive-edits、边界 first-edit-program、且纳入首次范围，工具据此标待审。[上轮实际 checkpoint](2026-10-26-evaluation-suite-host.md)证明固定程序三臂的合规中间状态被记为首错；不能直接将 false 解释为模型犯错 |
| wallMs 不等于模型延迟 | 现场计时仍含 evaluator 快照/校验；新报告不补造拆分时间或填零 |

审查器不根据这些发现自动排除 consecutive、换阈值或改 expected。正式实验应在执行前选择适当的批次/指标含义，或将合规中间阶段与完整候选的正确性分别设计、审查；当前候选仍按原协议解释。比较可以回答“这些完整工具配置下的端到端表现”，若要归因于单独策略，需要新的可比性依据；本轮未新增实验臂或更改日常策略。

## 验证结果

Windows、Node 24.19.0、pnpm 11.28.5。构建和交付在独立 tree/ 进行，三个变更源码/测试文件与工作树字节一致；实际审查使用已验证同物理 alpha.4 的一次性安装，只读身份与配置。普通宿主回归使用本轮新交付安装。

| 范围 | 实际结果 | 证据 |
|---|---|---|
| 定向回归 | **197 PASS / 0 FAIL**，11 文件；新增设计审查 8 项，类型 exit 0 | logs/evaluation-final.log、types-final.log；tests/unit/evaluation-design-review.spec.ts |
| 实际 CLI | prepare=0、review=0，报告 status=GAP；无凭据要求、无宿主启动 | configured.json、frozen.json、review.json、logs/cli.json |
| CLI 拒绝 | 既有输出、额外 --execute、臂配置漂移、安装身份漂移、非 acceptance profile 均 exit 2；未产生拒绝项输出，原报告字节不变 | logs/cli.json；wrong-arm.json、wrong-identity.json 为自洽冻结的负向输入 |
| 普通宿主回归 | **18 PASS**、45/45 请求对账，原 captureTools 的装配/执行闭环仍通过 | smoke/、logs/smoke.log |
| 完整交付 | 九项门禁 exit 0，验收 ID **21 PASS / 0 FAIL / 9 BLOCKED**，细项 56 PASS 单列 | [报告](2026-10-26-evaluation-design-review-delivery-report.md)、[摘要](2026-10-26-evaluation-design-review-delivery-summary.json)、delivery/ |
| 变异复核 | 独立 mutation-tree 将行摘要相等判断反转，**1 FAIL / 7 PASS**，exit 1；原始文件未动，副本按原字节恢复 | logs/mutation.log、机器清单摘要 |

按 code-review-and-quality 五轴复核：工具仅生成离线报告、数据以摘要和有限配置输出、复用同一 loader 和 armRows，避免另一套装配逻辑；条件语义和未知边界明确。没有新依赖、模型调用或自动执行入口。未发现阻断本轮有界实现的问题。

## 剩余 GAP / BLOCKED

- **已实现且已验证**：逐臂实际配置差异审查、冻结分母/范围、历史语义保留、身份漂移与输出防覆盖；可随不同模型/任务配置重复运行。
- **已实现但缺真实验证**：执行器和身份检查仍未通过本轮真实 Provider/模型实验；本报告也未独立核对真实请求全文提示和工具 SDK。
- **部分实现**：本组固定程序的关键行为已有证据；设计审查只标可能混杂，不是通用语义验收或正式方法学审定。
- **未实现**：实际请求工具面/提示差异的独立取证、代表性及正式样本设计、分解延迟、相对收益和统计推广。
- **外部边界**：真实模型费用未授权，9 个交付 BLOCKED 及未实跑平台继续保留。

后续可先补实际请求提示/SDK 的有界独立取证，并在执行前固定合适的指标解释；真实 probe 另按[命令及费用前提](../../scripts/evaluation/README.md)执行，不因 review 生成成功获得付费授权或 S2 结论。
