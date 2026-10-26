# S0 后续：请求模式校准与真实提示离线核对

日期：2026-10-26。承接[完整真实 S0 第二轮](2026-10-26-evaluation-real-s0-modelscope-02.md)。本轮新增真实模型请求 **0**；完成模式识别修复与提示/工具返回值核对，原 S0 仍为 FAIL，未启动 S1/S2。

原始工件：`.scratch/real-model-evaluation/20261026-payload-audit/`；源码位置、文件哈希、逐项核对与验证计数见[机器摘要](2026-10-26-evaluation-payload-prompt-audit-summary.json)。与前轮记录相比，本轮修正的是评测解释层，不改变工具输入规则、执行器行为或既有实验结果。

## 1. 模式误标根因与兼容修复

`evidence.mjs` 原 payload 规则将任意不以 `[` 开头的 input 归为 apply_patch。因此模型提交的裸 `account.txt#07A0`、`a.txt#32D4` 被记为 requestedMode=apply_patch，尽管真实回执 selectedMode=hashline，实际执行仍 unknown。这是请求形状识别过宽，不能据此声称模型使用了 fallback。

新增冻结字段 editPayloadVersion：未声明/1 保留原语义；2 仅在独立首行明确出现 `*** Begin Patch` 时识别 apply_patch，`[` 前缀为 Hashline 形状，其余 input 或互斥路由字段混用为 unknown。未知版本拒绝。它是请求形状分类，不代替上游完整语法校验，也不将 selectedMode 提升成实际执行。

新模板、finalization-config 和固定宿主 smoke 默认声明 2；分析器及 checker 的根/子会话均使用协议冻结版本。旧协议不自动迁移，旧报告继续按原语义核对。未来采用新版需另建配置并冻结，不允许给已执行协议补字段后改写历史。

离线校准前轮真实证据，恰有 3 个调用由 requestedMode=apply_patch 改为 unknown，均为被拒绝的坏 header；selectedMode=hashline、actualMode=unknown 保持。原始 protocol.json/report.json 在校准前后 SHA-256 相同；旧真实报告 checker exit 0。校准只另写 audit.json，**没有另造实验报告或将三个 GAP 改为 PASS**。

## 2. SDK、canonical value 与模型可见结果

逐一核对 9 个首请求及原 Session：

- 6 个 Hashline 样本的真实首请求均含 `[path#tag]` 指引；3 个 stock-edit 样本不含该 Hashline 指引，符合工具面差异。共同 persona/Intent/PTC 并不使 SDK 或全部系统文本相同，仍不能作纯策略因果归因。
- 自有 read 的 canonical value 按既有 schema 返回 path、tag、lines 等字段，正常完整窗口 nextAction=null。`packages/tool-read/src/index.ts` 的渲染器另用 formatHashlineHeader 生成带方括号的卡片；**PTC 消费 value，卡片并不自动作为模型上下文**，不能用卡片证明模型看过完整 header。
- single 两个 Hashline 样本的 run_code 输出打印了分开的 path/tag JSON；multi/default 打印行内容与 aTag/bTag。模型必须按 SDK 规则组装带方括号的 input。三次实际提交缺方括号，工具拒绝信息提供完整例子，后续修改成功。
- 未发现已核对的编辑格式指引要求省略方括号。SDK 中“读取以获得 header”的表达与 canonical path/tag 分离存在可理解性上的距离，但本轮没有证明它导致错误；不新增 schema 字段或改提示来换取 PASS。

产出点为每项 firstRequestArtifact、Session 的 tool/result 和 tool/ptc-dispatch-start。audit.json 的打印字段检查仅识别特定 JSON 键，multi 自定义打印的 aTag/bTag 不匹配该规则，不能将 false 解释成模型没有得到 tag。该例已另行核对真实 tool/result。

## 3. 三个“只说意图”的样本

repeated 的两个 Hashline 臂及 multi/fallback 均为：首请求收到正常响应、finish.kind=stop、turn/end=completed，outer/inner 工具调用 0，文件未改，完整 usage 存在。其可见正文只有将要读取/编辑的意图说明；没有执行器中途截断、取消、工具拒绝或等待审批事件支撑另一种解释。

这些样本在接收 read 值之前已经结束，因此不能用 read 格式解释其不执行。此次核对没有定位到明确提示冲突；模型内部为何选择结束仍未知，保留为该模型/工具配置下的真实任务失败。不追加“请继续执行”回合，不把第二次提示后的结果混入首次样本，不修改 Intent gate 或自动重试以消除失败。

## 4. 本轮验证

| 检查 | 实际结果 |
|---|---|
| 修复前回归 | 新请求形状及版本验证暴露 3 FAIL / 22 PASS，exit 1 |
| 修复后定向 | evaluation-evidence 25 PASS；新测试覆盖未知、明确 marker、混用、旧语义以及 actualMode 不提升 |
| 完整单元/类型 | 22 文件、297 PASS / 0 FAIL；TypeScript 测试类型检查 exit 0，含子会话版本传递 |
| 隔离变异 | 强制所有 input 为 apply_patch 后 3 FAIL / 22 PASS，exit 1；副本恢复后与源字节相同，原源码未被变异 |
| 实际宿主固定 Provider | 新协议 version=2，18 PASS；45/45 请求对账及独立重放，smoke exit 0，不是模型收益证据 |
| 历史真实证据 | 原 S0 报告 checker exit 0，protocol/report 哈希未改变；任务/条件 FAIL 保持 |

本轮只修改离线评测脚本、模板、测试与文档，没有 read/edit/preset、依赖版本或宿主契约改动；未在日常宿主链接树构建，未重新执行前轮九项交付门禁，也不将其历史计数当作本轮结果。新版本的完整宿主链由固定 Provider smoke 覆盖。

## 5. 当前决策

无费用修复与核对已完成，尚无新的证据支持开展正式 S1。当前 S0 的拒绝后恢复、只声明意图、失败成本及 unknown 都应保留。若进一步研究，可围绕“明确格式提示是否降低构造错误”另设有边界的实验，预先冻结条件并取得费用授权；它是新提示条件，不能替代现有 S0 或用于声称原默认策略已通过。

日常仍推荐 PTC，Hashline 可选。完整 S0 已执行但失败，S1/S2 未执行；本轮不证明 Hashline 普遍优劣，也不以修改解释层宣称收益提高。
