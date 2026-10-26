# ModelScope 真实 S0：首请求推理中超时，保留 GAP

日期：2026-10-26。用户填写连接后明确要求开始验证，并确认本轮仅执行 S0：最多 36 次模型请求、观测总 Token 达 120,000 后停止、每样本 120 秒、每请求输出 cap 4,096；首次条件每臂 3/3、逐样本总 Token 上限 20,000。**本轮结果为 GAP，S0 未通过，未启动 S1。**

与[前轮固定 Provider 验收](2026-10-26-evaluation-request-evidence.md)不同，本轮实际挂载 pi-ai 并向用户配置的 ModelScope 端点发起模型生成。原始材料位于 `.scratch/real-model-evaluation/20261026-s0-modelscope-01/`，冻结协议和原始事件保留；[机器摘要](2026-10-26-evaluation-real-s0-modelscope-summary.json)保存计数、判定和工件哈希，不导出提示、reasoning 或凭据正文。

## 配置与执行

用户连接文件保留原样，没有覆盖。所填模型目录为 `ZhipuAI/GLM-5.3-Flash`，但 model.model 为空，本轮从唯一目录项补齐；声明容量 `256k` 规范化为整数 262,144，不冒充服务端容量核验。provider/model、参数、预算、任务与工具/依赖身份在请求前冻结，protocolHash 见机器摘要。

用户将密钥值填到了 credentialEnv/apiKeyEnv 中，本轮生成配置改为环境变量引用 EVAL_API_KEY，实际值仅传入执行进程环境。首次字段检查曾误回显 credentialEnv，已向用户说明并建议更换；正式报告不保存该值。原始连接文件仍属于用户本地敏感配置，不能随交付入库。

使用既有一次性 `dsh-profile-acceptance`，未改日常 profile、preset、上游源码或版本。preflight 为 PASS。三任务 single/repeated/multi、三臂各一次，共 9 样本，seed=7 串行旋转顺序；第一项为 single/hashline-default。每项独立 initial/expected、工作目录及 Session。

## 实际结果

| 项目 | 本轮证据 |
|---|---|
| 组装请求 | 1 次 llm/stream 请求，原文捕获及官方 Session 独立重放 1/1 PASS，SDK 可提取；HTTP wire/内部 HTTP 次数仍 unknown |
| 服务响应 | Session 保存 reasoning 流，首事件距 turn/start 8,291 ms；取消时 reasoning 文本 13,676 字符。说明该请求收到服务响应，不能归因为网络完全不通；不证明实际后端模型身份或能力 |
| 超时取消 | 首 turn 约 119,992 ms 后结束，样本槽记录 120,726 ms；本地定时器触发，执行状态 CANCELLED。官方事件中的 user 分类是执行器 abort 传递结果，不是用户手动取消 |
| 文件与工具 | 未观察到工具调用，account.txt 保持初态；独立 expected/diff 判定 finalCorrect=false。此为超时未完成，不能据此断定 Hashline 编辑失败或比较工具优劣 |
| usage / 对账 | 无完整 usage，input/output/totalTokens 与完整模型请求计数保持 unknown；streamRequests=1，Session 完成捕获对账为 GAP，不将已知 Token 0 当作实际花费 0 |
| 后续样本 | 剩余 8 项 BLOCKED。budget.unknown=true 后没有继续请求；未自动重试或执行 S1 |
| 独立判读 | check exit 0（证据一致）；judge exit 2，任务证据及冻结条件均 GAP；compare exit 0，输出 9 对计划比较均保留，整体 GAP，不能缺样本缩分母 |

复核命令（不发起请求）：

```powershell
node scripts/evaluation/driver.mjs check .scratch/real-model-evaluation/20261026-s0-modelscope-01/results/protocol.json .scratch/real-model-evaluation/20261026-s0-modelscope-01/results/report.json
node scripts/evaluation/driver.mjs judge .scratch/real-model-evaluation/20261026-s0-modelscope-01/results/protocol.json .scratch/real-model-evaluation/20261026-s0-modelscope-01/results/report.json
```

## 根因边界与后续

已定位的直接停止原因是 `run.mjs` 的样本超时 abort，触发时 Provider 仍处于 reasoning 流中，尚未产生工具调用和完整 usage。不是凭据预检失败或本地目录错误；已有流事件使免费连接探测失去必要性，因此本轮没有追加网络或生成探测。

长 reasoning 的具体原因仍为待查：模型默认行为、服务端思考模式与大提示/SDK 的交互不能靠本轮事件区分。固定安装 pi-ai 的 `resolveModelReasoning` 对 `reasoningEfforts:false` 仅返回 `reasoning:false`；`reasoningInfo` 注释明确指出，省略 reasoning 选项不会关闭默认思考的服务端。入口 SHA-256 与源码位置保存在机器摘要，支持“目录元数据不是服务端关闭指令”这一解释；具体端点应使用何种 wire 控制仍待验证。本轮不修改官方适配器、不升级上游、不擅自加入未支持的请求参数，也不凭猜测重试收费请求。

下一轮需先确认服务端思考控制是否可经当前插件契约表达；否则明确选用模型默认推理行为，并重新决定超时与输出预算。因本轮取消请求没有完整 usage，须核对服务端用量后，再明确新一轮预算；生成新配置/协议/结果目录，保留本次 GAP。不能简单延长超时后覆盖结果，也不能直接进入正式 117 样本。

剩余核心工作：完成真实 S0 的编辑闭环、完整 usage、逐调用配对及三臂核验，然后才考虑 S1/S2。请求取证和超时取消路径获得本轮真实证据，但完整真实 Provider 验证、正式对照和收益结论均未完成。

后续：[诊断与单次真实复验](2026-10-26-evaluation-s0-diagnosis.md)获得显式 low/max_tokens 的工具调用响应和 usage；本报告保留首轮原结果，未回写为 S0 PASS。
