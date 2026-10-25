# 默认编辑策略评测

复用 [SRS §7](../../docs/specs/2026-10-24-hashline-default-editing.md)、[S0–S2 方案](../../docs/plans/2026-10-25-default-edit-policy-promotion-evaluation-plan.md)。本目录是维护者主动运行的离线工具，不随 bundle 发布，也不新增常驻遥测。

## 无凭据验证

```powershell
pnpm exec vitest run --config vitest.unit.config.ts tests/unit/evaluation-protocol.spec.ts tests/unit/evaluation-evidence.spec.ts
# 在独立副本构建，然后获得打包安装；保留输出中的一次性 profile 路径。
pnpm test:delivery --keep --out .scratch/<runId>/delivery
node scripts/evaluation/smoke.mjs <disposable-profile> .scratch/<runId>/smoke
```

smoke 只向 `dsh-profile-acceptance` 安装本仓库的固定适配器夹具；不请求网络。它真实装配三臂宿主，检查最终字节、PTC 配对、usage、回执和报告重算，结果只证明执行驱动。

## 后续真实模型实验（本轮未执行）

### 用配置文件选择模型（推荐）

复制 [experiment.example.json](experiment.example.json) 到被忽略的 `.scratch/<runId>/experiment.json`。该文件集中维护 provider 插件/配置、模型、参数、三臂选择、重复数、预算、通过条件及独立任务输入/预期。

- `provider.plugin` 是已安装的 DSH provider 插件；`model.provider` 是它注册的路由名，两者不同。模板使用官方 DeepSeek API-key 插件和 `deepseek-official` 路由；换 provider 时两处及 config 一并调整。
- `model.model` 填真实模型 ID；只支持当前宿主契约中的 `maxTokens`、可选 `reasoningEffort`。不要添加 temperature 等尚不支持的参数。
- `provider.config` 仅保存配置和凭据环境变量名；API key 的值放在进程环境中。官方插件的 `apiKeyEnv` 应与 `provider.credentialEnv` 相同。
- 模型、总预算和通过条件刻意留为 null；必须自行填写才允许冻结。模板的 4096 单请求输出上限、120 秒超时和单次重复只是可编辑起点，不是已批准的真实实验安排。

```powershell
New-Item -ItemType Directory -Force .scratch/my-probe | Out-Null
Copy-Item scripts/evaluation/experiment.example.json .scratch/my-probe/experiment.json
# 编辑 experiment.json 后，采集实际安装身份并生成新的冻结协议；无模型请求。
node scripts/evaluation/prepare.mjs .scratch/my-probe/experiment.json <disposable-profile> .scratch/my-probe/frozen.json
# 只做 preflight；配置文件本身不会触发执行。
node scripts/evaluation/run.mjs .scratch/my-probe/frozen.json <disposable-profile> .scratch/my-probe/results
```

prepare 不写配置原文件，不覆盖已有 frozen 输出，也不修改 profile。更换模型或参数后生成另一份 frozen 文件；不要修改已经运行过的冻结协议。下面的手动 identity → protocol → freeze 路线仍可用。

前提：用户另行明确批准模型、provider、重复量和费用边界；使用新打包的独立 `dsh-profile-acceptance`，不得传日常 profile。provider 包必须已经在这个安装中以与宿主相同的固定版本可解析；不要为评测修改官方源码。须核对实际解析；本轮隔离安装已有官方 provider 包，但没有配置并执行真实评测路由。凭据仅通过选定 provider 的环境变量引用，不放进 JSON，也不复制日常 profile。

先准备 provider-config.json（例如官方 API-key 插件使用 `apiKeyEnv`；按实际已安装插件契约填写），再执行只读采集：

```powershell
node scripts/evaluation/inspect.mjs identity <disposable-profile> <provider-package> <credential-env-name> provider-config.json > .scratch/<runId>/identity.json
```

按[协议字段](../../docs/specs/2026-10-25-real-model-evaluation-protocol.md)编写 protocol.json，把 identity.json 的 `dependencies`、`tools` 原样合入；独立编写 initial/expected、参数、样本、预算及条件。不要把 smoke 的模型/阈值当作真实实验参数。

```powershell
pnpm eval:freeze .scratch/<runId>/protocol.json --out .scratch/<runId>/frozen.json
# 默认只检查安装身份、provider 和凭据存在性；不启动宿主或请求模型。
node scripts/evaluation/run.mjs .scratch/<runId>/frozen.json <disposable-profile> .scratch/<runId>/results
# 仅在另获执行批准后添加 --execute（可能产生 API 费用）。
node scripts/evaluation/run.mjs .scratch/<runId>/frozen.json <disposable-profile> .scratch/<runId>/results --execute
pnpm eval:check .scratch/<runId>/results/protocol.json .scratch/<runId>/results/report.json
```

`results` 必须尚不存在且父目录已存在；取消用 Ctrl+C。首次执行会在一次性 profile 内生成唯一的空 root YAML，以确保派生 preset 的 bare module 解析来自该安装。日常 profile 不接受；不重启任何宿主。

请求上限按实际 `llm/stream` 边界累计（含子会话）；usage 不可得就停止后续付费请求。token 上限是收到该请求 usage 后的停止阈值，**不是服务端费用硬限额**；单个在途请求可能越界。正式付费执行必须同时设置 provider 的费用上限、`model.parameters.maxTokens` 和 timeout；取消也不保证 provider 不对已提交请求收费。

## 产物和判读

- protocol.json / report.json：冻结身份、完整调度分母、逐样本状态、分臂统计及 unknown。
- `<session>.initial.json`：执行前真实初始文件摘要；每组相同 initial，seed 旋转臂顺序，独立 cwd/Session。
- `<session>.jsonl` / `.receipts.json`：本地原始事件、最小策略回执；不可直接发布，可能包含提示、正文和工具参数。
- `<session>/`：实际最终树；`.verification/expected/`：独立预期树；`actual.diff`：git no-index diff，摘要在报告中。
- `eval:check` 重新读取初始快照、事件、回执和最终文件，重算结果；`accepted` 仅表示证据一致，BLOCKED 报告也可完整，不能读成模型通过。

三臂定义见协议。`first-edit-program` 按首段含 edit 的 run_code 冻结候选边界，保存完整 checkpoint；同程序的多次 edit 属于同一候选，后续含 edit 的程序才计候选重试。`task-end` 的首批正确与重试仍为 unknown。逐文件目标映射、外部漂移的冻结注入及子会话完整导出仍有 GAP。因此 `formal` 可以做完整性冻结，现有 runner **不足以完成 S1 / S2**。

## 历史日志复核

```powershell
node scripts/evaluation/inspect.mjs trace <session.v4.jsonl.zstd> <session-id> > .scratch/<runId>/trace-summary.json
```

复用 bundle 内现有逐帧解码器；不允许用一次 `zstdDecompressSync` 的首帧返回值推断日志丢失。输出仅含标识、枚举、摘要、计数，不导出参数和正文。没有历史策略回执时，参数形状只记 requestedMode，实际执行模式为 unknown。
