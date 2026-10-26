# 默认编辑策略评测

复用 [SRS §7](../../docs/specs/2026-10-24-hashline-default-editing.md)、[S0–S2 方案](../../docs/plans/2026-10-25-default-edit-policy-promotion-evaluation-plan.md)。本目录是维护者主动运行的离线工具，不随 bundle 发布，也不新增常驻遥测。

**2026-10-26 收口：保留复用，暂停主动扩建与默认推广。** 下列命令继续可用，文中的后续实验仅是操作参考，没有待自动执行的真实模型安排。原始 FAIL/GAP/BLOCKED 保留；延期工作和恢复条件见[收口记录](../../docs/acceptance/2026-10-26-project-closeout.md)。

## 无凭据验证

```powershell
pnpm exec vitest run --config vitest.unit.config.ts tests/unit/evaluation-protocol.spec.ts tests/unit/evaluation-evidence.spec.ts tests/unit/evaluation-config.spec.ts tests/unit/evaluation-next-stage.spec.ts tests/unit/evaluation-apply-patch.spec.ts tests/unit/evaluation-verdict.spec.ts tests/unit/evaluation-cohort.spec.ts tests/unit/evaluation-task-suite.spec.ts tests/unit/evaluation-suite-programs.spec.ts tests/unit/delivery-engine-pins.spec.ts tests/unit/evaluation-design-review.spec.ts
# 在独立副本构建，然后获得打包安装；保留输出中的一次性 profile 路径。
pnpm test:delivery --keep --out .scratch/<runId>/delivery
node scripts/evaluation/smoke.mjs <disposable-profile> .scratch/<runId>/smoke
```

smoke 只向 `dsh-profile-acceptance` 安装本仓库的固定适配器夹具；不请求网络。它真实装配三臂宿主，执行单点、多文件、真实委派、读后外部漂移、合法 user-override 双文件更新和 apply_patch 拒绝后恢复六类任务，共 18 个案例，检查 usage、回执、候选/最终快照和报告重算。只有 fallback 臂的后两类固定程序使用 apply_patch，其它臂按各自能力执行相同文件目标；这不证明模型选择。`fixture:*` 提示仅供脚本夹具路由，不是正式模型任务。夹具已存在但版本不同会拒绝，需用新的隔离交付安装，不热改旧安装。

无移动的受管 apply_patch 可由实际解析计划映射目标。计划必须来自该 Session 的同一调用/根调用，匹配模式、版本和文件头集合；原始 parsedPlan 只留本地回执，报告不含该字段。含移动、缺计划/早期拒绝或旧证据仍 unknown。解析成功不保证落盘或正确：本轮 Add File 的 FS_NOT_OBSERVED、空文件更新的末尾换行不符均被保留为 FAIL；合法 user-override 的结果不能宣称修复了这两个限制，详见[本轮验收](../../docs/acceptance/2026-10-26-evaluation-apply-patch.md)。

生命周期验证另用同一固定适配器与现有执行器：

```powershell
node scripts/evaluation/lifecycle-smoke.mjs <disposable-profile> .scratch/<runId>/lifecycle
```

该入口在三臂分别验证非空的真实 fork 继承前缀和子会话部分落盘后取消。父回合完成后追加测试提示、等待中的适配器取消均由该测试入口显式编排，不是 formal 任务能力。`lifecycle.json` 保存后续提示边界、实际适配器请求、取消确认及空闲状态；四组协议各自保留原始证据并运行 checker。取消组包含一个实际执行样本及两个未执行 CANCELLED 样本，评测报告预期为 GAP、缺 usage 为 unknown；测试断言通过不把它改成任务 PASS，也不证明真实 Provider 的取消计费。

同一新安装先运行 smoke.mjs 放入匹配夹具后，可用 `node scripts/evaluation/verdict-smoke.mjs <disposable-profile> .scratch/<runId>/verdict` 验证判读链。它预先冻结九组协议：原三组正常/超限/未知，加上混合 no-op/write 的范围比较、范围外超限/最终错误、空 probe 范围、所选首次未知。每组独立执行并验证 check/judge 退出码；条件或任务失败不会改写为 PASS。所有 usage 来自固定夹具，不证明真实成本。

## 后续真实模型实验（本轮未执行）

### 复用 13 类候选任务

```powershell
New-Item -ItemType Directory -Force .scratch/my-suite | Out-Null
node scripts/evaluation/task-suite.mjs .scratch/my-suite/experiment.json
```

[task-suite.mjs](task-suite.mjs) 展开确定性的 initial/expected，输出普通可编辑配置，不连接 profile、Provider 或模型，也不执行任务内的生成器。输出文件必须不存在。配置约 9 MiB，主要来自快照门槛场景的两份独立文本；无需把展开文件提交到 Git。之后填写模型、预算、阈值，沿用下文 prepare、默认 run 预检和 check/judge 命令。

该候选集覆盖全部 13 个家族，但默认仍为 probe。每类仅一例，不能据家族齐全宣称代表性或 S1 通过。审阅并冻结正式实验时须另建配置、决定重复量和首次条件范围，不能根据正式结果调阈值或 expected。模型、总请求/Token 预算、两个通过阈值仍为 null；没有默认获批的付费参数。

| 任务 | 具体输入与独立目标 |
|---|---|
| single / repeated | 单点更新；仅修改第二个重复片段 |
| multi / consecutive | 同文件两点加跨文件；先插行核验，再更新后续行 |
| drift | 首次成功 read 后由既有刺激控制器写入 audit=peer，必须保留竞争者值 |
| unrelated-long / target-long | 5000 字符长行；前者可分页取得完整目标，后者目标在截断部分 |
| snapshot-limit | 4 MiB 以上文本，只有首行更新；按真实限制核验合法路径 |
| rewrite | 129 行内容全部更新，不能只改版本头 |
| satisfied / create | 核验后不写；真正新建一个文件 |
| override / generator | 真实用户提示明确 replace 范围；使用项目自带的 generate.mjs 生成产物 |

首次范围预先纳入 10 项，排除 satisfied、create、generator，并保留理由。最终文件与成本仍覆盖全部 13 项；strict Hashline 对例外任务可能失败，不能删除失败样本或把预期结果改成其实际结果。长行和快照场景按当前固定 preset 的 2000 字符列上限、4 MiB 快照门槛设计，实际冻结配置改变后应重新审阅任务。

最终字节检查不能证明 consecutive 的中间核验或 generator 的真实调用；这些要求须另审原始轨迹。专用工具变更的目标模式仍可能 unknown/GAP；生成器产物正确不补造 edit 证据。当前并未运行完整任务集的真实模型执行，验证范围见[任务集验收](../../docs/acceptance/2026-10-26-evaluation-task-suite.md)。

完整候选集的无费用宿主验证使用独立固定 Provider：

```powershell
node scripts/evaluation/suite-smoke.mjs <fresh-disposable-profile> .scratch/<runId>/suite
```

该入口只接受一次性 acceptance profile，安装匹配的测试夹具并冻结原 13 类任务与三臂，实际执行 39 样本；任务 prompt、initial 和 expected 没有被夹具标记或输出替换。连续编辑拆为两个 PTC 程序，检查实际中间快照和重读顺序；生成器通过真实平台 shell 工具执行。Provider 程序不导入 expected，也不直接替代工具改文件；用量为固定夹具数据，不代表真实 Token 成本。

`suite-summary.json` 单列测试断言和实际评测结果。脚本 exit 0 表示预先声明的失败/未知也按预期保留，**不表示 39 样本全部 PASS**。本轮实际为 31 PASS / 6 GAP / 2 FAIL，最终字节 36 正确 / 3 错误，judge=2；长行和生成器的 shell 调用仍导致目标归属 unknown。原始轨迹不包含 shell 的完整 canonical 数值退出码，固定程序现场检查该值并在非零时抛错，不能将其扩大为通用 shell 退出码审计。

新一次性交付安装器已从既有锚点固定两个 upstream overrides，并检查安装后的实际版本、补丁和同物理 Hashline；先前安装可把 tool-edit 的传递范围解析成较新副本而被评测预检阻断。不要移除 identity 检查或手改 node_modules 消除报错，详见[宿主任务集验收](../../docs/acceptance/2026-10-26-evaluation-suite-host.md)。真实模型正式实验仍需另行授权和设计审查。

### 用配置文件选择模型（推荐）

复制 [experiment.example.json](experiment.example.json) 到被忽略的 `.scratch/<runId>/experiment.json`。该文件集中维护 provider 插件/配置、模型、参数、三臂选择、重复数、预算、通过条件及独立任务输入/预期。

- `provider.plugin` 是已安装的 DSH provider 插件；`model.provider` 是它注册的路由名，两者不同。模板使用官方 DeepSeek API-key 插件和 `deepseek-official` 路由；换 provider 时两处及 config 一并调整。
- `model.model` 填真实模型 ID；只支持当前宿主契约中的 `maxTokens`、可选 `reasoningEffort`。不要添加 temperature 等尚不支持的参数。
- `provider.config` 仅保存配置和凭据环境变量名；API key 的值放在进程环境中。官方插件的 `apiKeyEnv` 应与 `provider.credentialEnv` 相同。
- 模型、总预算和通过条件刻意留为 null；必须自行填写才允许冻结。模板的 4096 单请求输出上限、120 秒超时和单次重复只是可编辑起点，不是已批准的真实实验安排。
- `tasks[].targets` 可显式冻结文件＋目标＋适用性；当前每个文件只允许一个目标，覆盖该任务全部预期文件变更。旧配置不含 targets 仍可执行，采用率保留 unknown；不会自动改写你的本地配置。

```powershell
New-Item -ItemType Directory -Force .scratch/my-probe | Out-Null
Copy-Item scripts/evaluation/experiment.example.json .scratch/my-probe/experiment.json
# 编辑 experiment.json 后，采集实际安装身份并生成新的冻结协议；无模型请求。
node scripts/evaluation/prepare.mjs .scratch/my-probe/experiment.json <disposable-profile> .scratch/my-probe/frozen.json
# 只做 preflight；配置文件本身不会触发执行。
node scripts/evaluation/run.mjs .scratch/my-probe/frozen.json <disposable-profile> .scratch/my-probe/results
```

可在执行前生成离线设计审查（无需凭据，不挂载宿主或调用模型）：

```powershell
node scripts/evaluation/review-design.mjs .scratch/my-probe/frozen.json <disposable-profile> .scratch/my-probe/design-review.json
```

审查核对当前安装身份、原始 preset 及派生臂哈希，列出实际插件变化、白名单配置、任务家族和首次/全任务分母。只导出摘要及有限 read/edit 设置，不导出整行 persona 或任意配置内容。报告固定保留 GAP：尚无完整实际请求提示/SDK、代表性、独立模型延迟或相对收益证明。退出 0 只表示成功生成审查，身份/配置漂移、防覆盖或参数错误退出 2；它不增加执行审批、不自动修改配置或提供 S2 结论。

候选 consecutive 任务尤其需要预先审查：首个编辑程序可能是任务要求的合规中间状态，不能把其相对最终 expected 的 false 直接当作模型犯错。三臂的插件/工具面不同，也不能把差异仅归因于默认策略。详见[设计审查验收](../../docs/acceptance/2026-10-26-evaluation-design-review.md)。新增脚本会进入 driverInputs，必须重新 prepare，不能沿用旧冻结身份。

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
# 证据一致后，独立判定冻结条件；只读，不请求模型。
node scripts/evaluation/driver.mjs judge .scratch/<runId>/results/protocol.json .scratch/<runId>/results/report.json
```

`results` 必须尚不存在且父目录已存在；取消用 Ctrl+C。首次执行会在一次性 profile 内生成唯一的空 root YAML，以确保派生 preset 的 bare module 解析来自该安装。日常 profile 不接受；不重启任何宿主。

请求上限按实际 `llm/stream` 边界累计（含子会话）；usage 不可得就停止后续付费请求。token 上限是收到该请求 usage 后的停止阈值，**不是服务端费用硬限额**；单个在途请求可能越界。正式付费执行必须同时设置 provider 的费用上限、`model.parameters.maxTokens` 和 timeout；取消也不保证 provider 不对已提交请求收费。

## 冻结条件判定

新模板在 passConditions 声明 `semantics: "per-arm-cohort-count-and-per-run-tokens-v2"`，并冻结 firstCandidateScope。`minFirstCandidateCorrect` 是每臂所选任务×重复中首次候选正确的最小**样本数量**，不是比例；`maxTotalTokensPerTask` 是全部任务×重复×臂各个样本的**整树总 Token 上限**，不是整臂总量或均值。两者均须是非负整数，自行按实验目标冻结；旧配置不会自动迁移。

```json
"firstCandidateScope": {
  "include": ["status-update"],
  "exclude": [
    { "taskId": "already-done", "reason": "No edit candidate is needed by this task." },
    { "taskId": "create-only", "reason": "This task measures write-only creation." }
  ]
}
```

以上是含三个任务时的例子；模板只有 status-update，故 exclude 为空。每个实际任务 ID 必须在 include 或 exclude 中恰好出现一次，排除理由非空，所有臂和重复使用同一范围。新增任务时须同步范围；冻结后不能据结果排除未知。排除只是作者的指标计划，不自动证明“不适用”，也不删除全局 coverage 中的未知。范围外的最终文件、Token、调度和证据仍全部检查。

报告将三层结果分开：run 的 `status` 是任务/取证结果，`conditions` 是逐臂冻结阈值，`coverage` 保存已测与未知。`run.mjs` 的退出码继续表示执行/取证状态；`check` 只读重算证据一致性，真实 FAIL/GAP 报告也可被接受；`judge` 先 check 再判定，只有任务/取证与条件同时 PASS 才退出 0，其余 FAIL/GAP 为 2。条件通过仅覆盖这两个绝对条件，不证明优于其它臂、统计收益或 S2 推广通过。

条件中的首次未知保留在冻结的所选范围分母，Token 未知仍检查全部样本；全局 coverage 始终保留全部计划样本：首次正确的 `correct/incorrect/measured/unknown/denominator` 与 `rateOnMeasured/rateBounds` 同时显示；单看已测率不能判通过。上下界是未知全错/全对的范围，不是置信区间。成本的 `knownSum` 必须与 measured/unknown 一起读，存在未知时不能当完整成本。已知首次正确的最高可能值仍不足要求，或某个已知样本 Token 超限时 FAIL；其余有未知则 GAP；全部测得且满足才 PASS。

旧冻结件缺 semantics 时 `judge` 返回 GAP / semantics-not-frozen，不追认历史阈值通过。可继续核对旧工件；新执行需重新 prepare/freeze，因为驱动源码也属于冻结身份。新报告 evaluationVersion=1 必须包含 coverage/conditions，checker 会重算并拒绝篡改或缺失；旧 summary 保留原口径和检查路径。

旧 v1=`per-arm-count-and-per-run-tokens-v1` 继续针对每臂全部任务，缺首次值仍 GAP；不得把 v2 范围塞进 v1。v2 解决预先声明指标范围，所选任务自身未知仍 GAP。probe 可明确 include 为空并把最小数量设 0，首次条件返回 NOT_APPLICABLE、比例为 null；其它检查照常。formal 必须选中至少一项，且完整 13 族要求仍在；配置可冻结不代表全族真实模型已验证。

checker 与执行端共用解释函数，提供工件与报告一致性检查，不是独立统计 oracle。wallMs 仍为包含身份复核、准备、快照与 diff 等开销的现场样本耗时；checker 不独立重建该值，也不重装配 promptHash/ptc，不应把这些字段当已独立核验的模型延迟或公平性证明。

## 产物和判读

- protocol.json / report.json：冻结身份、完整调度分母、逐样本状态、分臂统计及 unknown。
- `<session>.initial.json`：执行前真实初始文件摘要；每组相同 initial，seed 旋转臂顺序，独立 cwd/Session。
- `<session>.jsonl` / `.receipts.json`：本地原始事件、最小策略回执；不可直接发布，可能包含提示、正文和工具参数。
- `<session>.graph.json` 和 `<session>-child-N.jsonl` / `.receipts.json`：根/后代元数据和捕获顺序、子会话原始事件。只有 parentSession 和父 subagent/catalog 一致且全部目录子会话均被捕获，才汇总整树费用；fork 继承前缀不重复计数。标识按 sessionId＋callId 隔离。
- 请求日志带 Session 归属，并用 accounting 将实际 llm/stream 数与会话记录逐项对账；等待官方 waitForChildren 的完成通知后再检查父代理空闲。捕获外请求会在派发前拒绝，缺项/超项或归属不明为 GAP，即使文件结果正确也不认作完整计量。
- `<session>.stimuli.json` / `.stimuli/`：冻结外部写入的触发引用及前后原始字节；原始字节只留本地。未触发、条件失配或副作用不明为 GAP。
- `<session>/`：实际最终树；`.verification/expected/`：独立预期树；`actual.diff`：git no-index diff，摘要在报告中。
- `eval:check` 重新读取初始快照、事件、回执和最终文件，重算结果；`accepted` 仅表示证据一致，BLOCKED 报告也可完整，不能读成模型通过。

三臂定义见协议。`first-edit-program` 在编辑程序结束或内层 edit 失败当刻保存 checkpoint；正常的多次 edit 可以成批，但失败后即开始新候选，不能把同程序内 catch 后修复并入首次正确。重叠程序、快照失败或缺失失败边界时 unknown / GAP；`task-end` 的首批正确与重试仍 unknown。

可选外部刺激放在任务中，例如 `"stimuli": [{"id":"race","path":"account.txt","afterRead":1,"before":"status=pending\n","after":"status=external\n"}]`。它在匹配文件第 N 次成功 read 返回程序前执行，before 必须与当刻磁盘字节一致，after 是独立冻结的竞争者内容；按整棵会话树计读取次数。示例需替换为实际任务的完整文件内容，不能直接套用到含 owner 行的模板。它是受控测试写入，不是模型工具调用，也不证明自然发生的竞争或模型恢复纪律。

逐目标目前支持明确 replace/patch 路径、Hashline 公共引擎解析的各节及 MV 两端。apply_patch 等无法可靠归属的载荷、无法归属的磁盘变更、同文件多目标、外部进程代理等保持 GAP；读后成功/失败读取是观察分类，不自动等同语义返工或模型核验。真实 provider、其它刺激控制器、跨平台和 S2 尚未完成，因此现有 runner **不足以完成 S1 / S2**。

## 历史日志复核

```powershell
node scripts/evaluation/inspect.mjs trace <session.v4.jsonl.zstd> <session-id> > .scratch/<runId>/trace-summary.json
```

复用 bundle 内现有逐帧解码器；不允许用一次 `zstdDecompressSync` 的首帧返回值推断日志丢失。输出仅含标识、枚举、摘要、计数，不导出参数和正文。没有历史策略回执时，参数形状只记 requestedMode，实际执行模式为 unknown。
