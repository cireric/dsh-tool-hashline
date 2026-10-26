# 首次候选指标冻结范围验收

执行日期：2026-10-26（Asia/Shanghai）。基线 4e88222 加本轮未提交增量，按[计划](../plans/2026-10-26-evaluation-cohort-plan.md)实施。[机器摘要](2026-10-26-evaluation-cohort-summary.json)保存源码 SHA-256、场景和退出码。真实模型请求 **0**；不证明模型收益或正式推广通过。

## 缺口与实现

此前[v1 验收](2026-10-26-evaluation-verdict.md)将全部任务纳入首次候选分母。no-op、write-only 或 task-end 没有 edit checkpoint，因此首次正确 unknown，混合任务可能持续 GAP。产生点是 [verdict.mjs](../../scripts/evaluation/verdict.mjs) 的首次统计分母及 [analysis.mjs](../../scripts/evaluation/analysis.mjs) 的 checkpoint 判读；这不是 usage 丢失或模型编辑失败的证明。本轮新增预先声明范围，与历史轨迹恢复和目标归属工作不同。

- [protocol.mjs](../../scripts/evaluation/protocol.mjs) 与 verdict 的 firstCandidateScopeGaps 接受 v2 语义，要求全部任务恰好属于 include 或带理由的 exclude。遗漏、重复、交叉、未知 ID、空理由和超出所选样本数的最低要求在冻结前拒绝；v1 不接受该范围，保留原输出。
- 首次条件只使用冻结的所选任务×重复，各臂相同；不根据执行后实际选用工具排除。报告 conditions.version=2 保存范围和排除数量，evaluationVersion 仍为 1。全局 coverage 不缩小。
- 最终文件、全部样本 Token、完整调度和原始证据仍检查所有任务。选中首次未知仍 GAP，范围外超限或文件错误仍使 judge FAIL；排除不能掩盖未执行样本。
- probe 可显式空范围且最低数为 0，首次条件为 NOT_APPLICABLE、比例为 null；不报告 100% 首次正确。formal 必须有非空范围且继续满足原 13 家族校验。作者填写的排除理由不证明任务天然不适用。
- [模板](../../scripts/evaluation/experiment.example.json)及[使用说明](../../scripts/evaluation/README.md)提供自定义模型与范围入口，旧本地配置不会自动迁移。

## 验证

原始证据根为被忽略的 `.scratch/real-model-evaluation/20261026-cohort/`，不随 clone 提供。Windows、Node 24.19.0、pnpm 11.28.5；在独立 tree/ 构建，使用本轮 delivery 生成的一次性安装；未修改日常 profile、工具/preset、上游源码、依赖或补丁。源码与隔离树逐文件 SHA-256 一致。

| 验证 | 实际结果 | 原始证据 |
|---|---|---|
| 定向回归 | 7 文件 **123 PASS / 0 FAIL**；新增 cohort 27 项、verdict 23 项；类型与 build/check exit 0 | logs/evaluation-restored.log、types-restored.log、check.log；tests/unit/evaluation-cohort.spec.ts、evaluation-verdict.spec.ts |
| 普通宿主 | 18 样本 PASS，请求/捕获 45/45，judge 0 | smoke/、logs/smoke.log |
| 九种判读 | 全部脚本断言 PASS，40 个实际样本、68 次固定适配器请求；条件结果如下 | verdict/summary.json、各场景 protocol.json/report.json |
| fork/取消 | fork 三臂 PASS，对账 18/18；三组取消各保留 1 个实际和 2 个未执行 CANCELLED，报告仍 GAP/unknown，无取消后新适配器请求 | lifecycle/summary.json、各组 lifecycle.json、logs/lifecycle.log |
| CLI 兼容 | 16 组 check 均 0；judge 依 PASS/FAIL/GAP 返回 0/2/2。历史 v1 仍 PASS；无语义旧协议仍 GAP / semantics-not-frozen | logs/cli-final.json |
| 完整交付 | 九项门禁 exit 0；按验收 ID **21 PASS / 0 FAIL / 9 BLOCKED**，另有细项 55 PASS，不与 ID 数量相加 | [报告](2026-10-26-evaluation-cohort-delivery-report.md)、[摘要](2026-10-26-evaluation-cohort-delivery-summary.json)、logs/delivery.log |
| 变异复核 | 将 Token 检查错误缩小到所选范围，范围外超限测试失败：1 FAIL / 26 PASS，exit 1；恢复原字节后 123 PASS | logs/mutation.log、evaluation-restored.log |

| 场景 | 任务/取证 | 条件 | judge |
|---|---|---|---|
| pass | PASS | PASS | 0 |
| token-fail | PASS | FAIL | 2 |
| first-unknown | PASS | GAP | 2 |
| cohort-pass（edit/no-op/write 混合） | PASS | PASS | 0 |
| cohort-unscoped（同类任务，v1） | PASS | GAP | 2 |
| excluded-token-fail | PASS | FAIL | 2 |
| excluded-final-fail | FAIL | PASS | 2 |
| empty-cohort（probe） | PASS | PASS，首次 NOT_APPLICABLE | 0 |
| selected-unknown | PASS | GAP | 2 |

混合组每臂的首次条件分母为 1、排除样本 2；全局首次 coverage 仍为已测 1、未知 2、总分母 3。范围外昂贵 write 为每样本 20 Token，超过冻结上限 4，仍 FAIL。范围外写错文件时条件可以 PASS，但独立字节校验为 FAIL，judge 仍拒绝。测试计数、宿主样本和固定请求分开记录，不合并成真实模型实验。

沿用 code-review-and-quality 五轴复核：范围校验和计算留在现有判定层，不新增依赖、工具 I/O 或模型权限；checker 从工件重算范围结果，篡改报告及冻结理由均被测试拒绝。未发现阻断本轮有界实现的问题。首次尝试通过 pnpm 包装器执行变异测试未产生输出并被取消；随后直接使用隔离安装的 Vitest/TypeScript 入口完成上述测试，未把中止尝试计为通过。

## 剩余 GAP / BLOCKED

- 已实现且已验证：v2 冻结、分母、未知、全任务成本/文件门禁、历史兼容与固定 Provider 链路。
- 已实现但缺真实验证：可配置模型、Provider、凭据预检和执行器已有；本轮未运行真实模型，不能推导收益、取消计费或真实 usage 完整性。
- 部分实现：formal 的 13 家族与非空范围仅有协议校验，完整正式任务集尚未实际执行；所选范围代表性仍需实验设计审查。
- 未实现：相对收益判定、提示公平性及独立模型延迟分解；其它取消时点、外部进程后代尚缺验证。
- 环境/人工边界：交付中的 9 个 BLOCKED 继续保留，具体 ID 及原因见交付报告。早期 Add File 的 FS_NOT_OBSERVED、空文件换行失败仍按[原验收](2026-10-26-evaluation-apply-patch.md)保留，未修工具契约。

下一项应构建并审阅可复用的完整正式任务配置与独立 expected；先做无费用预检和夹具验收。后续真实执行命令见[使用说明](../../scripts/evaluation/README.md)：先 prepare/inspect、freeze、默认 run 预检；只有用户明确批准模型、样本量、Provider 费用上限后才添加 --execute。使用独立 profile，凭据以环境变量引用；请求后 Token 停止阈值不等于服务端硬费用上限。
