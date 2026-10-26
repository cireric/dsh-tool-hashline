# 组装请求取证、手动连接与有界设计验收

日期：2026-10-26。基线提交 `1d490a5`，按用户要求[恢复四个核心工作包](../plans/2026-10-26-evaluation-finalization-plan.md)。本轮前两包的实现和无费用验证完成；真实 Provider S0、正式 S1/S2 **未执行**。真实模型请求为 0，不形成 Hashline 收益或默认推广结论。

## 与存量的差异及根因

已有[设计审查](2026-10-26-evaluation-design-review.md)冻结了逐臂配置，但 assembly promptHash/ptc 不是实际模型请求，旧报告无法补造请求原文。本轮在 `run.mjs` 的 `llm/stream` 中间件调用 next 之前，保存完整白名单 GenerateOptions 与 Session 前缀定位；[request-evidence.mjs](../../scripts/evaluation/request-evidence.mjs)通过冻结的官方 Session 入口独立重放 messages、tools、toolHistory、参数，并核对明确 PTC SDK 块。[compare-requests.mjs](../../scripts/evaluation/compare-requests.mjs)保留所有计划样本，逐臂比较首个根请求；未执行或不可重放的项为 unknown。

这是 **adapter 投影和序列化之前** 的组装请求取证，HTTP wire 与内部 HTTP 次数仍 unknown。文本比较不归一化时间、路径或上下文；不同不自动证明不公平，相同也不证明纯策略因果。原始请求含代码、提示，留在被忽略的本地工件；正式报告只包含元数据与哈希。文件创建权限参数不构成 Windows ACL 隔离保证。

自定义连接复用现有 prepare/provider.config，不引入另一套执行器。[网关模板](../../scripts/evaluation/experiment.gateway.example.json)由用户填写 baseURL、Provider 路由、模型目录/ID、容量、预算和阈值；凭据仅引用环境变量。`prepare.mjs` 核对 URL、所选路由/模型及凭据引用；`protocol.mjs` 对正整数 maxTokens/defaultMaxTokens 作容量字段豁免，修复旧凭据键扫描误拒合法模型目录的问题，未放开其它 token/secret 字段。

实际 bootstrap 曾报 `DUPLICATE_DIRECTORY`（amazon-bedrock）：dsh-base 已挂载 pi-ai，旧 host 在 boot 后再次 ctx.plugin。修复落在自有 [host.mjs](../../scripts/evaluation/host.mjs) 的 evaluationProviderPatches：通过官方 loader overlay 关闭同名根配置行，只插入一次冻结 Provider 配置；未修改官方源码或版本。实际安装插件的自定义模型目录可解析，未执行生成或访问 endpoint。

fork 首轮只能重放 12/18 请求，原因为重建 Session 时未带 seeded header，官方 Session.create 拒绝非零继承前缀。本轮传入图中的 version/id/createdAt/cwd/isSeeded/parentSession，新增 seeded 回归；新一轮 fork 18/18 独立重放通过，旧失败报告未回写。

## 有界实验安排

[finalization-config.mjs](../../scripts/evaluation/finalization-config.mjs)复用原 13 族的独立 initial/expected、三臂及相同模型参数，保留用户预算和阈值，生成新文件且拒绝覆盖。

- S0：single/repeated/multi，各臂各一次，共 9 样本；用于验证连接和证据闭环。
- S1：13 族，每臂重复 3 次，共 117 样本；每臂全部 39 项保留在最终字节正确性与 Token 分母中。
- 首程序条件事先只选 single/repeated/multi/unrelated-long/rewrite，每臂 15 项；其余 8 项逐项冻结理由。consecutive 的合规中间阶段不再直接当作这个条件的首错；其中间行为仍须轨迹核验，最终正确性与费用继续计入。
- 每族一例、三次重复是有限描述性实验，不宣称业务代表性、统计功效或普遍收益。比较对象是共享 ptc-hashline persona/Intent/PTC 的完整工具配置，并非两个原生 preset 的单变量 A/B。

详细阈值、排除理由及 S0 停止条件见[推广方案](../plans/2026-10-25-default-edit-policy-promotion-evaluation-plan.md)。阈值由用户在执行前填写；不根据结果反推，不自动接续正式实验。

## 本轮实测

原始根目录：`.scratch/real-model-evaluation/20261026-request-evidence/`。各轮互相独立，下表不可相加为真实实验样本。逐条文件摘要和命令结果见[机器摘要](2026-10-26-evaluation-request-evidence-summary.json)。

| 检查 | 实际结果与边界 |
|---|---|
| 定向单元与类型 | 14 文件、241 PASS / 0 FAIL；类型检查 exit 0。含请求篡改、重写摘要后独立重放、配对/缺失、版本剥离、legacy、fork、容量/凭据、生成器和 Provider 组装回归 |
| 变异验证 | 将消息重放不等判断反转，21 项中 3 FAIL / 18 PASS，exit 1；恢复副本与源码字节相同。证明重放断言能识别该错误，非真实模型测试 |
| 原 smoke + 新请求证据 | 18 PASS，45/45 请求对账及独立重放；工件 `smoke-01/`，比较结果 `first-request-comparison.json` |
| S0 配置固定 Provider | `s0-fixture-02/`：9 PASS，最终 9 正确；18/18 请求对账及重放，9 对比较；check=0、judge=0 |
| formal 配置固定 Provider | `formal-fixture-02/`：117 样本，93 PASS / 18 GAP / 6 FAIL，最终 108 正确 / 9 错误；243/243 对账及重放、117 对比较；check=0、judge=2。条件 PASS 仍保留任务 FAIL；formal 标签只验证协议执行，不是实际 S1 |
| fork / 取消 | `lifecycle-capture-02/`：fork 三臂 PASS，18/18 重放；三组取消各 4/4 重放，取消后无新增适配器请求，已执行及未执行取消样本保留，评测仍 GAP、费用 unknown |
| 实际 pi-ai 组装 | `gateway-dry-02/summary.json`：custom-gateway/offline-catalog-model 可从实际插件目录解析，HTTP=0、modelStreams=0；不证明远端协议或声明容量真实 |
| 用户配置 CLI | `cli-preflight/`：probe/formal 生成、实际身份冻结、防覆盖和额外参数拒绝通过；EVAL_API_KEY 为空时两组均仅因无凭据 BLOCKED，executed=false，计划分别 9/117 项，未创建结果目录；比较 CLI 通过且拒绝覆盖 |
| 完整交付 | 独立树九项门禁 exit 0；打包、真实 launcher 装配共 56 个案例断言通过，交付 ID 21 PASS / 0 FAIL / 9 BLOCKED。详见[交付报告](2026-10-26-evaluation-request-evidence-delivery-report.md)及[摘要](2026-10-26-evaluation-request-evidence-delivery-summary.json) |

最终门禁使用 `.scratch/real-model-evaluation/20261026-cohort/tree/`，其 28 个评测 mjs/json 文件与当前源文件 SHA-256 全部一致；最后 seeded 修复后的新生命周期验证与最终单元测试通过。较早 smoke/S0/formal 的协议保留当时源码身份，不冒充重新冻结的执行；当前 checker 对其根会话证据仍可复核。

失败轮保留：`s0-fixture/`、`formal-fixture/` 的临时编排误传相对 cwd，官方 Session header 拒绝，模型流 0；这是测试编排失败，非工具或模型正确性失败。`gateway-dry/` 保存重复挂载失败，`lifecycle-capture/` 保存 seeded 元数据缺失导致的 GAP。`logs/` 保留对应执行日志；不得删去这些记录或用新结果改写旧报告。

## 剩余 GAP / BLOCKED 与操作

1. **真实 Provider S0：待执行。** 用户要求自行配置，尚无真实连接/模型/预算。手动文件已建立于 `.scratch/real-model-evaluation/manual-finalization/connection.json`，未写入密钥，不覆盖用户后续编辑。实际 route、模型参数、usage、取消计费须通过真实 S0 验证。
2. **正式 S1/S2：待执行。** 先审阅 S0 再冻结正式配置，完整保留失败、取消与 unknown；不以本轮固定用量和固定程序推断收益。
3. **明确保留的范围限制：** HTTP wire、独立模型延迟、通用 shell/多目标归属、其它取消时点及 macOS/Linux 未验证。交付原 9 个 BLOCKED ID 的原因沿用交付报告，未声称真实升级/发布。

生成、冻结、预检、显式执行和 check/judge/compare 的命令见[使用说明](../../scripts/evaluation/README.md#手动连接与有界实验)。先填写连接、容量、预算和阈值，将 EVAL_API_KEY 仅置于执行环境，使用一次性 acceptance profile 及全新输出路径；`run` 默认只预检，只有 `--execute` 发起模型执行。输出 Token 观测停止阈值不能替代服务端费用限制。

本轮未修改日常 profile、preset、Intent/seen/CAS 契约、上游源码或依赖版本，未自动升级、发布或启动付费实验。代码评审核对了职责边界、输入与证据完整性、兼容/未知语义、失败恢复及测试有效性；上述 root/tree 哈希、负向测试与实际组装证据支撑当前交付范围。
