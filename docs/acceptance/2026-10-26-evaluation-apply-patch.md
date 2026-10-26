# 评测 apply_patch 目标证据验收

执行日期：2026-10-26（Asia/Shanghai）；基线 80989b7 加本轮增量。[计划](../plans/2026-10-26-evaluation-apply-patch-plan.md)限定为评测取证，不修改 read/edit/preset、Intent/seen/CAS、依赖补丁或官方框架。真实模型请求 **0**；固定 Provider 的通过不证明模型选择、成本收益或正式推广。

## 差距与修复责任层

上一阶段所有 apply_patch 路径保持 unknown，原因是缺少解析成功证据，而不是宿主没有解析能力。实际安装 edit 的 describeRequest 调用 expandApplyPatchToEntries，然后策略 preflight 把 plan 写进 decision.targets；原 [host.mjs](../../scripts/evaluation/host.mjs) 只保存路由、结果、错误与原因，丢弃这部分计划。

本轮 [apply-patch-targets.mjs](../../scripts/evaluation/apply-patch-targets.mjs) 保存现有回执的版本、调用/根调用、模式和路径/操作元数据；[targets.mjs](../../scripts/evaluation/targets.mjs) 用同 Session 回执与原参数、有效 cwd 交叉核对。现有策略 requestTargets 仅用于核对显式文件头集合，不代替解析器。缺失/错配、混合载荷、模式不一致、目录越界均 unknown；任何重试缺计划也不补数。decision 未保存 rename 目的端，因此含 Move to 仍全部 unknown。

没有复制、私自导入或重写上游解析器。评测复用的本地 policy/user-source 两个模块新增到 [identity.mjs](../../scripts/evaluation/identity.mjs) inputs 冻结；解析来自已经冻结的实际安装。新协议应重新 prepare，不改旧协议或回执。

[evidence.mjs](../../scripts/evaluation/evidence.mjs) 不向报告 trace 导出 parsedPlan；原始计划仅在本地回执 sidecar，checker 从该文件独立重算目标。计划不含文件正文；不新增工具层 I/O，新增开销仅为冻结时辅助源码摘要和原有回执追加元数据。正确性继续来自独立 expected/实际字节，失败调用不能填成已成功执行的模式。

## 最终验证

本地原始根 `.scratch/real-model-evaluation/20261026-apply-patch/` 被忽略，不随 clone 交付；[机器摘要](2026-10-26-evaluation-apply-patch-summary.json)记录源码、协议、报告和日志摘要。构建及交付使用独立 tree/，临时安装只首次放入固定 Provider；未改日常 profile 或热改旧安装。Windows / Node 24.19.0 / pnpm 11.28.5。

| 范围 | 结果与边界 | 证据 |
|---|---|---|
| 定向回归 | **73 PASS / 0 FAIL**，5 个文件；其中新增 18 项，覆盖计划缺失/错配/未知版本/模式、重试、移动、多文件、cwd、部分成功、跨会话隔离、元数据提取与离线篡改。类型检查 exit 0 | tests/unit/evaluation-apply-patch.spec.ts、logs/evaluation-final.log、logs/types-final.log |
| 最终宿主组 | **18 PASS / 0 FAIL**，6 任务 × 3 臂，21 个 Session，请求/会话对账 **45/45** | smoke-authorized/、logs/smoke-authorized.log |
| 双文件合法替代 | fallback 臂真实引用冻结用户提示，逐目标 user-override 声明经原策略验证；一个 apply_patch 覆盖两文件，首选与成功模式均 non-hashline，最终字节正确；其它臂完成同一目标。这是固定程序，不是模型纪律 | apply-authorized 的原始回执、目标报告及独立最终树 |
| 拒绝后恢复 | fallback 臂因缺声明收到 EDIT_POLICY_FALLBACK_REQUIRED，计划仍可映射目标；补读后 Hashline 成功。**2 次尝试、1 次失败、恢复=true、首次候选错误、最终正确**；被拒 apply_patch 的实际模式仍 unknown | apply-recover 的回执、失败当刻 checkpoint 与目标报告 |
| 生命周期回归 | fork 三臂实际前缀去重 18/18；取消三臂断言通过、取消后无新增适配器请求，评测仍 CANCELLED/GAP、Token unknown | lifecycle-authorized/、logs/lifecycle-authorized.log |
| CLI 独立 checker | 早期两组 FAIL、最终一组 PASS 与生命周期四组共 7 次 check 全部 exit 0；仅证明证据一致，不能改写各组结论 | logs/checker.json |
| 完整交付 | 九项门禁 exit 0；**21 PASS / 0 FAIL / 9 BLOCKED**。BLOCKED 为原交付未覆盖 ID | [报告](2026-10-26-evaluation-apply-patch-delivery-report.md)、[摘要](2026-10-26-evaluation-apply-patch-delivery-summary.json)，delivery-authorized/、logs/delivery-authorized.log |
| 变异阴性对照 | 隔离副本临时移除文件头集合一致性检查，路径集合与离线篡改两项测试失败：**2 FAIL / 16 PASS**，exit 1。finally 按原字节恢复，随后完整 73 项通过 | logs/mutation.log、logs/evaluation-final.log；机器摘要的 sourceRestored |

上述普通宿主、生命周期、单元与历史轮次分别计数，不相加为一次结果。最终 smoke 的人为 usage 只证明归并链路。

## 保留的 FAIL 与产生点

两轮失败与最终成功任务使用各自冻结协议；未放宽 expected、忽略换行或改写历史结果。

1. **新路径 Add File：FAIL**。smoke-01 为 17 PASS / 1 FAIL，fallback 臂的两文件新建被 FS_NOT_OBSERVED 拒绝，均未落盘。目标计划已正确解析，成功模式仍 unknown；评测没有把“计划覆盖”判成文件正确。产生链：安装包 patch.js 的 create 分支调用其 fs.write，适配层 session.js writer.write 走 fs/edit-intent；目标尚不存在且未被观察，宿主拒绝。现有 MV createIfAbsent 补丁并不覆盖该 apply_patch create 分支，本轮未修补。
2. **空文件填充并要求末尾换行：FAIL**。smoke-final 也为 17 PASS / 1 FAIL。fallback 臂工具调用成功且实际模式为 apply_patch，但输出是 y / z，预期为 y\n / z\n。产生点是上游 patch.js applyTrailingNewlinePolicy 按原空文件 hadFinalNewline=false 去掉尾部换行。独立字节比较拒绝了“工具成功即正确”的结论。

最终 smoke-authorized 另冻已有 x\n 文本与真实用户来源引用的替代更新任务，未给这两项限制打补丁或移除守卫。前两组报告均可由 CLI checker 复核；当轮固定 Provider、协议和轨迹摘要留在原始根及机器摘要中，后续新夹具不回写旧安装。

五轴复核沿用 code-review-and-quality：目标来源必须是实际解析决策、同调用/会话和完整重试计划；移动拒绝的保守边界清楚；原始计划与公开报告分开；没有新依赖/工具文件 I/O；变异确认一致性检查有阴性覆盖。

## 剩余 GAP / BLOCKED

- 本轮仅关闭“无移动、具备完整受管解析回执”的 apply_patch 文件归属；移动目的端、缺计划的早期拒绝、stock/其它专用工具及旧日志仍 unknown。
- 同文件多目标、语义返工、并发重叠候选、更多刺激及自动 S2 仍待开发；上述新建/末尾换行失败路径未修复，不作为已完成能力。
- 外部进程代理、更多取消时点、macOS/Linux 与真实 Provider usage/HTTP 重试/取消计费仍待验证。真实模型执行仍需模型、凭据、预算和明确授权。

执行入口与安全前提见[评测说明](../../scripts/evaluation/README.md)。本轮没有自动提交或发布。
