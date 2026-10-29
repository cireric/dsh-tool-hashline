# 真实模型评测代码分析：实现、口径与证据边界

2026-10-26 建档。分析对象：`scripts/evaluation/*`（18 个 mjs 与一个配置模板）、`tests/unit/evaluation-*.spec.ts`、`tests/fixtures/evaluation-provider/`，对照 [SRS §7](<../specs/2026-10-24-hashline-default-editing.md>)、[协议补充](<../specs/2026-10-25-real-model-evaluation-protocol.md>) 与三轮验收（[10-25 基础](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-25-real-model-evaluation.md")、[10-26 阶段](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-26-evaluation-next-stage.md")、[10-26 生命周期](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-26-evaluation-lifecycle.md")）。

方法：逐行读源码 + 需求条款逐条对照 + 链接核对。**本轮没有执行任何测试、评测或宿主命令**（原因见 §8），因此下文所有"通过/失败"都指文档记录的结论，不指本轮复核。

维护基线 `80989b7`。工作树在同一时刻还有一份**未提交的 apply_patch 取证增量**：[计划](../plans/2026-10-26-evaluation-apply-patch-plan.md)、新文件 `apply-patch-targets.mjs` 与 `tests/unit/evaluation-apply-patch.spec.ts`，以及 `targets.mjs`/`host.mjs`/`evidence.mjs`/`identity.mjs`/`smoke.mjs`/`tests/fixtures/evaluation-provider/index.mjs` 的修改。分析过程中该增量仍在被继续编辑，因此本文凡提它处一并标注 **(未提交)**，判断以读到的快照为准。

## 1. 结论

1. **生产与校验的分离比文档承诺的更彻底。** 执行期只写工件，检查器重读工件重算；`accepted` 只表示证据自洽，`driver.mjs` 的通过信息还带一句"不意味模型收益或推广"。
2. **但"独立"只到输入层。** 检查器与生产共用 `analyzeEvidence`（[run.mjs:99](../../scripts/evaluation/run.mjs)、[report.mjs:57](../../scripts/evaluation/report.mjs)），解释层相同：口径错误只要在两侧同构，检查器就抓不到。见 P2-1。
3. **三臂命名与实际语义反向。** `hashline-default` 是"只许 Hashline"的严格臂；出厂默认 `auto` 才是 `hashline-fallback`（[identity.mjs:24](../../scripts/evaluation/identity.mjs) 对 [preset.patch.yml:119](../../presets/ptc-hashline/preset.patch.yml)）。见 P1-1。
4. **`passConditions` 冻结后无人判定。** 除冻结期形状校验外没有消费者，也没有 S2 判定函数；报告里也没有字段说明它"仅记录、未执行"。见 P1-2。
5. **`wallMs` 是唯一免检的成本字段，同时计时区间混入评测器自身 I/O**，其中包括每样本一次的安装身份全量重算。见 P1-3。
6. **部分的汇总是"全有或全无"。** `firstCandidateCorrect`、`candidateRetries` 与成本在任一未测样本存在时整臂变 `unknown`；`perTargetAdoption` 是例外——它保留已声明目标、继续算分母，但把未尝试当成"未用 Hashline"，于是给出一个**没有标注的下界**。见 P2-5。
7. **(未提交)** apply_patch 增量方向正确（复用上游 decision、不重写解析器、双实现交叉核对）。真正的隐患不是"重试永久未知"，而是一个形状级拒绝会经 `unassigned` **连坐同任务的其它目标**。见 P2-6。

## 2. 一次执行的数据流与责任层

| 阶段 | 入口 | 产物 | 检查器能否重算 |
|---|---|---|---|
| 冻结 | `prepare.mjs` / `driver.mjs freeze` | `frozen.json`（`protocolHash` 规范化 JSON） | 能（重算哈希与字段完整性） |
| 预检 | `run.mjs preflight` | `BLOCKED` 或 `PASS` | 能（同一 `captureIdentity`） |
| 装配 | `host.mjs openHost` | 三臂 preset 注册 + provider 挂载 | 部分（preset/arm 摘要可重算，provider 实挂不可） |
| 执行 | `host.execute` | `*.jsonl`、`*.receipts.json`、`*.graph.json`、`*.checkpoint-N/`、`*.stimuli.json`、最终树、`actual.diff` | 能（全部重读） |
| 采样 | `run.mjs` 循环 | `report.json` 逐样本记录 | 大部分能 |
| 校验 | `driver.mjs check` → `checkRunReport` | `problems[]` | —— |

四个"不能重算"的地方全部集中在 `report.json` 的自述字段上：`wallMs`（P1-3）、`promptHash` 与 `ptc`（P1-4）、`analysis.targetEvaluation` 里来自 `installedPatch` 的解析结果（由工件重算，实际可查）。这不是疏忽——检查器需要活宿主才能重算提示装配——但报告与文档都没把这四个字段标成"仅自述"。

## 3. SRS §7 条款符合性

| 条款 | 实现点 | 判定 |
|---|---|---|
| §7.1 先发布并冻结方案 | `protocol.mjs` 的 `protocolGaps`/`freezeProtocol`/`assertFrozenProtocol`；缺失字段按名拒绝 | 符合 |
| §7.1 依赖与补丁身份 | `identity.mjs captureIdentity`：解析路径、入口摘要、关键包运行文件树摘要、补丁实际标记、源码补丁摘要 | 符合，且比要求更严（版本相同不成证据） |
| §7.1 模型与参数 | `model.parameters` 白名单 `reasoningEffort`/`maxTokens`；执行期 `EVAL_MODEL_DRIFT` 逐参核对 | 符合 |
| §7.1 工具配置 | `tools.presetHash` + `tools.arms` 三臂摘要，启动时比对并在漂移时拒绝 | 符合 |
| §7.1 任务初始内容与独立预期 | `initial`/`expected` 相对路径→UTF-8；`verifyTree` 逐字节、额外文件判错、`expected null` 表示不存在 | 符合 |
| §7.1 样本、顺序、预算 | `schedule`（seed+repeat+task 旋转）、`budget` 三条上限 | 符合 |
| §7.1 正确性与成本通过条件 | `passConditions` 被冻结 | **仅冻结，未判定**（P1-2） |
| §7.2 四类互斥分母 | `TARGET_CLASSES` + `adoption`，非 Hashline/未尝试/unknown 留在分母 | 符合 |
| §7.2 首次与全程分列 | `firstAttempt` 与 `mode`（hashline/non-hashline/mixed/not-attempted/unknown）两套字段 | 符合 |
| §7.2 首次正确/最终正确/工具接受/实际变更 | `candidateSummary` + `OUTCOMES` + `summarizeRuns` 四个独立计数 | 符合 |
| §7.2 正常首读不算返工 | `reads{initial,beforeEdit,afterFailure,afterSuccess,failed,concurrentOrUnknown}` 六分列 | 符合 |
| §7.2 一个程序不按内层 edit 计往返 | 候选以含 edit 的 `run_code` 为单位（`evidence.mjs candidateSummary`） | 符合 |
| §7.2 未测记 unknown | 成本字段要求字符串 `unknown`，`validateCost` 拒绝虚构 0 | 符合（粒度问题见 P2-5） |
| §7.2 耗时与核验成本 | `wallMs` 有值但被污染；`verifications` 恒为 `unknown` | **部分**（P1-3、P2-4） |
| §7.3 13 个任务族 | `REQUIRED_TASK_FAMILIES`，仅 `formal` 强制 | 符合 |
| §7.3 比较当前 auto 与新增策略 | 三臂为 stock-edit / 严格 Hashline / auto+fallback | **不等价于 auto vs policy**，协议已声明 |
| §7.3 可比环境 | 三臂复用 persona/watchdog/PTC/非编辑工具 | 有声明，无量化（P1-4） |
| NFR-06 PASS/FAIL/GAP/BLOCKED 分列 | 运行状态、引用证据、`claims` 字段 | 符合 |

## 4. 确实成立的设计

1. **身份取自字节而非版本。** `installedPatch` 读解析后的入口文件并核对 `entryHash`（[targets.mjs:9-13](../../scripts/evaluation/targets.mjs)）；`captureIdentity` 对关键包做运行文件树摘要（[identity.mjs:46-58](../../scripts/evaluation/identity.mjs)）。补丁是否生效不靠版本号推断。
2. **apply_patch 用两个实现交叉核对 (未提交)。** `parsedPlanFiles` 把策略自有的文件头集合（`requestTargets`）与上游 `expandApplyPatchToEntries` 产出的 `decision.targets` 逐项比对，不一致就 unknown（[apply-patch-targets.mjs:15-32](../../scripts/evaluation/apply-patch-targets.mjs)）。这比"相信自己解析"强得多；按计划第 2 条，文件头检查被明确降级为交叉核对，不充当"解析成功"的事实。
3. **失败当刻的 checkpoint。** `tools/result` 里内层 edit 失败立即落盘快照并重置该 root 计数（[host.mjs:79-86](../../scripts/evaluation/host.mjs)），使"同一程序内 catch 后修复"不能并入首次正确。这是 §7.2 "不得事后把修复并入首批"唯一可执行的落地方式。
4. **完成边界用宿主公开 join。** `collector.idle()` 在子代理 `whenIdle` 之后调 `subagents.waitForChildren`，再等父代理重新空闲（[session-tree.mjs:40-52](../../scripts/evaluation/session-tree.mjs)）。这一条正是 33/33 对账修复的落点，也是"尾请求漏计"类错误的通用防线。
5. **捕获外请求在派发前拒绝。** `llm/stream` 中间件按 Session 归属准入（[run.mjs:56-58](../../scripts/evaluation/run.mjs)），并独立用 `requestAccounting` 逐 Session 对账。
6. **未知有区分。** 结构性缺口（缺 settle、缺 turn/end、seq 不稠密）与数据缺口（某请求缺 usage）分开，前者污染整条 trace，后者只污染对应字段。这使"`modelRequests` 有数而 `inputTokens` unknown"成为合法状态（[10-25 summary](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-25-real-model-evaluation-summary.json") 第 58-69 行即此形态）。

## 5. 问题清单

### P1-1 三臂命名与语义反向

- 现象：`armRows` 里 `hashline-default` 被设成 `mode: 'hashline'`（无任何非 Hashline 分派），`hashline-fallback` 才是出厂默认 `auto`。
- 产生点：[identity.mjs:24](../../scripts/evaluation/identity.mjs)、[preset.patch.yml:119](../../presets/ptc-hashline/preset.patch.yml)、[协议补充](../specs/2026-10-25-real-model-evaluation-protocol.md) 第 25 行（文档描述正确）。
- 后果：验收表与报告里"hashline-default"这一臂最容易被读成"当前默认策略"。若 S2 把 `default` 臂的高正确率当作默认策略的收益，结论会系统性偏乐观——那一臂不允许任何降级，模型遇到快照/窗口受限时只能失败。
- 建议：**先定比较对象，再定名字。**S1 要回答的是"完整工具组合的对比"还是"只拨默认策略这一个开关"？现有三臂同时改变 read 能力面和提示文本（P3-7、P1-4），只能回答前者。定了"只比开关"，臂集要重设计并补一条 policy-off 对照；定了"比工具组合"，把名字改成 `hashline-strict` / `hashline-auto`，让"哪一臂是出厂默认"不再靠猜。改名会改变 `tools.arms` 摘要，必须在冻结前做。

### P1-2 `passConditions` 无消费者，且能冻结一个不可能满足的条件

- 现象：`minFirstCandidateCorrect` / `maxTotalTokensPerTask` 只在 `protocolGaps` 里做形状校验（只要"有限非负"），全仓除测试与夹具外没有任何代码读取它们。
- 更硬的一条：因为只查"非负"，`maxTotalTokensPerTask: 0`（比任何实测用量都低）也能通过冻结，运行照旧给出结论。零请求判读实验取的就是这个反例：把某任务的 Token 上限设成 0，该任务实测用量为 4，checker 仍然接受。
- 产生点：[protocol.mjs:141-145](../../scripts/evaluation/protocol.mjs)；仓库内 grep 无第二处消费者。
- 后果：一份 `status: PASS` 的报告只表示"每个样本都通过、证据自洽"，与预先冻结的阈值毫无关系。读者（包括下一个 agent）很可能把它当成"达到通过条件"。把一个没人执行的承诺写进冻结件，比不写更危险。
- 建议：二选一，不要留着模糊。(a) 在 `report` 里加 `verdict`：以 `measured` 为分母计算两类通过条件，未测显式 `unknown` 并使判定停在"证据不足"；(b) 把字段改名 `recordedConditions` 并在报告里写 `enforcement: 'not-implemented'`。无论选哪条，冻结期都应先拒绝 0 上限这类自相矛盾的取值——能冻结一个不可能满足的条件本身就是缺陷。

### P1-3 `wallMs` 既不可核验，又被评测器 I/O 污染

- 现象：`started` 在样本循环内、身份复核之前打点（[run.mjs:76](../../scripts/evaluation/run.mjs)），`wallMs` 在 `analyzeEvidence` 之后取（[run.mjs:101](../../scripts/evaluation/run.mjs)）。因此它包含：`captureIdentity` 全量重算（每样本一次，遍历关键包运行文件树）、初始文件创建与 `treeState`、`verifyTree`、`writeExpectedDiff`（内部 spawn 一次 `git diff`）。而 `report.mjs:70` 直接取报告自述值参与哈希比对，等于免除核验。
- 产生点：run.mjs:76/81/83-87/98/101；report.mjs:69-72。
- 后果：§7.2 把耗时列为成本维度，而这里测到的是"样本槽壁钟"，不是模型侧延迟；同一模型在不同 I/O 状态下会得到不同的"成本"。更麻烦的是它是唯一免检字段——想改进报告的人不需要改任何工件。
- 建议：在已持有的 `llm/stream` 边界累加"请求发出→usage 到达"的区间作为模型耗时，把评测器 I/O 单列（`evaluatorMs`）；并在报告 schema 里把 `wallMs` 标注为 `live-measured`，让"不可重算"成为显式属性而不是隐性信任。

### P1-4 `promptHash` 与 `ptc` 未经独立重算，且三臂提示必然不同

- 现象：`promptHash` 由活宿主算出并写进 run 记录（[host.mjs:110](../../scripts/evaluation/host.mjs)），检查器不重算（全仓仅两处引用）；`ptc.isolation`/`language` 同理。
- 更关键：三臂的 edit 工具描述本来就不一样——`auto` 描述"从参数形状选择模式"，固定模式描述"按固定模式调用"（[tool-edit 补丁:213-225](../../patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch)）。所以"复用相同 persona/watchdog/PTC"成立，但**系统提示整体并不相同**，而报告没有任何量记录这一差异。
- 产生点：host.mjs:104-110；evidence.mjs / report.mjs 无消费。
- 后果：§7.3 要求的"可比环境"目前只是一句声明加一个不可核验的摘要。若某一臂的提示恰好更长或更强调 Hashline，收益归因就说不清——而这恰恰是 S1 要回答的问题。
- 建议：装配后按节记录 `{id, digest}` 而不是整体哈希；跑完自动给出一张"三臂分节差异表"。这样"提示差异"从不可见变成可审阅，也能顺带证明 persona/watchdog/PTC 三臂逐节一致。

### P2-1 检查器的独立性只到输入层

- 现象：`analyzeEvidence` 被生产与校验同时调用（run.mjs:99、report.mjs:57），`treeTraceSummary`、`targetSummary`、`stimulusSummary` 全在同一模块里。
- 后果：篡改工件、伪造报告、删除会话都会被抓到；但"把某个不该计入的分母算进去"这类**解释型**错误会在两侧同构复现，检查器永远说 `problems=[]`。真正的独立 oracle 只有 `tests/unit/evaluation-*.spec.ts` 里手写的期望值。
- 建议：把这句边界写进协议与 README（现在是隐含的）；对四类分母、首次/最终正确、请求对账各保留至少一处"手算期望值"的用例（现有测试基本做到了），并保留变异验证记录。

### P2-2 `uncachedInputTokens` 不受结构性缺口约束

- 现象：`traceSummary` 的成本对象里，除 `uncachedInputTokens` 外每个字段都以 `gaps.length ? 'unknown' : ...` 保护；`uncachedInputTokens: total('inputTokens')` 独独漏了（[evidence.mjs:77](../../scripts/evaluation/evidence.mjs)）。
- 后果：trace 被判 GAP 时，报告里仍会出现一个真实数字，且它是"未含缓存"的输入量——恰好是最容易被用来把成本说得更低的那一列。现有验收摘要中未出现该组合（两处同时 unknown），因此是潜在不一致而非既发缺陷。
- 建议：同样加缺口守卫，或额外输出 `uncachedInputTokensStatus`。

### P2-3 降级原因被采集后丢弃

- 现象：回执监听把 `decision.fallbacks` 记为 `declaredFallbacks`（[host.mjs:92-94](../../scripts/evaluation/host.mjs)），它随 `call.receipts` 进入报告；但没有任何聚合，也没有任何判定读取它。
- 后果：§7.2 要求"记录入口拒绝及例外负担"、§7.3 要求"受限降级单列"。现状只能看到"这一臂有 N 次非 Hashline"，看不到其中多少次是授权降级、原因是什么（snapshot/window/user-override 各几次）。而这三类原因对"该不该推广 Hashline"的含义完全不同：snapshot-limit 是能力边界，user-override 是用户偏好。
- 建议：在 `summarizeRuns` 里加一张 `degradation` 直方图（按 reason 与结果），分母沿用目标数。数据已经在报告里，只是没算。

### P2-4 `verifications` 恒为 `unknown`

- 现象：`COST_FIELDS` 包含它，生产者硬写 `'unknown'`（[evidence.mjs:77](../../scripts/evaluation/evidence.mjs)）。
- 后果：§7.2 的"读取及核验"只有读取一半可测。永久 unknown 字段会稀释 unknown 的信号价值——读者很快学会忽略它。
- 建议：要么定义可测口径（例如"编辑后对同一目标的再读次数"），要么从 `COST_FIELDS` 移除并在协议里写明"本轮不测核验成本"。

### P2-5 汇总：一半作废，一半变成没标注的下界

- 现象：`summarizeRuns` 对成本、`firstCandidateCorrect`、`candidateRetries` 用 `group.every(...) ? 汇总 : 'unknown'`；`perTargetAdoption` 走另一条路——只要每个 run 都带已声明的目标数组就照常 `adoption()`（[counting.mjs:148-162](../../scripts/evaluation/counting.mjs)）。
- 后果（两半，方向相反）：
  - 前半：13 族 × 3 臂 × R 次里只要一个样本结构性 GAP，首次正确率与成本就整臂作废，结论只剩"证据不足"。
  - 后半：逐目标采用率不会作废，但 BLOCKED/未尝试目标只进分母不进分子，得到的是一个**下界**，报告没有任何字段声明它是下界。把下界当点估计会系统性低估 Hashline 采用率——与把上界当点估计同样危险，只是方向相反。零请求判读实验的第三例（一条已测 + 一条 BLOCKED）正是这个形态。
- 建议：改成分量与区间：`{ total, measured, correct|hashline, unknown, bounds: { lower, upper } }`，把 unknown 同时计入区间两个端点。既保住已测信息，也不让任何一端冒充事实；与"未测不进分子、不删分母"并不冲突。

### P2-6 (未提交) apply_patch：一个无法解析的调用会连坐同任务的其它目标

- 先纠正一种过头的读法："apply_patch 被拒 → 改走 Hashline 成功"**通常可以归因**。策略在验证回退原因之前就把 decision 记下来了（[default-edit-policy.mjs:596-609](../../presets/ptc-hashline/policy/default-edit-policy.mjs)），所以"未声明降级"、"回退证据不符"这类拒绝仍带 `decision.targets`，`parsedPlanFiles` 能解析，两次尝试、`observedFailures` 与 `observedRecovery` 都留得住。
- 真正的隐患在另一分支：拒绝发生在 decision 之前（参数形状错误、多形状混合、非对象参数）时没有 plan → `requestFiles` 返回 unknown → 进 `unassigned`；而 `targetSummary` 用**任务级** `unassigned` 计算 `ambiguous`（[targets.mjs:101](../../scripts/evaluation/targets.mjs)），于是同任务**所有**目标一起变 unknown。一个只可能触及 A 文件的坏调用，会把 B 文件的正确统计一并抹掉。
- 边界：`retry-plan` 用例把"任一回执缺 plan 即 unknown"钉成期望值，所以这是设计选择；但设计选择只该决定**那一次尝试**的模式未知，不该决定其它目标的分母。
- 建议：不要用后一次成功的计划去补造早期失败的目标归属（那会把"首次目标未知"洗成"首次目标已知"）。正确做法是分两条序列：`firstAttemptAttribution`（解析不了就未知）与 `completedAttribution`（完成调用可解析就记已知），并把 `ambiguous` 的作用域从任务收到**该调用可能触及的目标**。

### P3 级（记录，不阻断）

- **P3-1 冻结刺激的两侧索引来源不同。** 运行期按"每个成功 read 结果"计数，离线重算只统计**可归属**的 read（[analysis.mjs:20-27](../../scripts/evaluation/analysis.mjs) 走 `targetObservations`）。两者在"同文件存在不可归属读取"时会取到不同的第 N 次，结果是假 GAP（不会假 PASS）。建议把运行期触发点也记成 `callId`，离线只比对引用而不重排索引。
- **P3-2 诊断信息被吞。** `run.mjs:94` 的 `catch` 只留一句"host execution failed"，`report.mjs:74` 的统一 catch 把越界路径、`validateCost` 失败等一律压成 `missing/unreadable independent evidence`。fail-closed 正确，但排障成本高。建议至少把错误 `code` 写进 `problems`。
- **P3-3 每次工具结果都全文序列化。** `errorCode` 对 `d.content`/`d.message.content` 做 `JSON.stringify` 再正则（[evidence.mjs:49](../../scripts/evaluation/evidence.mjs)），大文件读结果会整段进字符串。改前先取 `d.error?.code`，没有再走短路径判断。
- **P3-4 身份覆盖过宽与"冻结即绑定驱动字节"。** `packages` 覆盖 profile 内所有顶层包，任何无关包装卸都会 `EVAL_IDENTITY_DRIFT`；`driverInputs` 哈希 `scripts/evaluation` 下全部 `.mjs`，因此改动驱动（如本轮未提交增量）会使所有既有 `frozen.json` 失效。后者是有意的完整性设计，但 README 未说明"冻结同时绑定驱动源码"，容易让人以为旧冻结件还能跑。
- **P3-5 会话图对乱序到达的子会话直接丢弃。** `collectSessions.watch` 在父会话尚未捕获时返回 `undefined`，该子会话不再重试（[session-tree.mjs:15](../../scripts/evaluation/session-tree.mjs)）。结果是 `catalog child not captured` GAP——仍是 fail-closed，但会产生与真实缺陷无法区分的假 GAP。
- **P3-6 每次运行在一次性 profile 里留一个 `evaluation-<uuid>.yml`。** 对一次性安装无害，但不再是一次"干净"安装；`profileInputs` 只哈希三个固定文件，所以不影响身份。
- **P3-7 stock-edit 臂同时换掉 read 工具。** `stock-edit` 移除自有 read/edit 并打开 `tool-fs` 的 read/edit（[identity.mjs:18-22](../../scripts/evaluation/identity.mjs)），所以三臂差异包含 read 能力面而非仅 edit 策略。协议第 25 行已声明，但验收表的"三臂"读起来像单变量。

## 6. 文档与代码的偏差

| 文档说法 | 代码事实 | 判定 |
|---|---|---|
| 回执记录"声明了哪些原因、验证了哪些"（policy JSDoc） | 只记 `fallbacks: [{path, reason}]`，无 verified 标记；验证通过与否只能从 `result` 反推 | 文档超前一句 |
| 三臂复用"相同 persona、watchdog、PTC、非编辑工具" | 成立；但 edit 工具描述文本随 mode 改变，系统提示整体不同 | 成立但易被读成"提示相同" |
| 协议：受限降级、读后漂移等族"按其独立 expected 判断" | 成立；降级原因无统计（P2-3） | 成立但指标缺一半 |
| 计划：apply_patch 仅增加脱敏计划元数据，正式报告不含原始计划路径 | 成立：`parsedPlan` 在进报告前被剔除（evidence.mjs:59），计划只留 `path`/`op`；单测断言报告文本不含 `parsedPlan` | 与代码一致 (未提交) |
| 验收："55 项定向回归" | 树内新增第 5 个套件（含一个 12 例参数化），名义用例数上升；本轮未重跑 | 计数需按新套件更新 |
| 验收："取消组 accounting 仍 GAP、缺 usage 为 unknown" | 代码一致：usage 缺失置 `budget.unknown`，后续样本 BLOCKED，`requestAccounting` 因 `modelRequests` unknown 报缺口 | 一致 |
| 验收与协议对 unknown 传播的描述（任一缺项整体 GAP） | 成本、`firstCandidateCorrect`、`candidateRetries` 确实下沉；`perTargetAdoption` 不下沉，给出未标注的下界 | 描述过宽，须按字段分别说明 |

## 7. 如果明天真要跑 S1，按顺序会先炸在哪

1. **首次正确率与成本会先变 unknown。** P2-5 前半：一个结构性缺口就足以让 `firstCandidateCorrect` 与成本整臂作废；逐目标采用率不作废，但会变成一个没标注的下界。
2. **`special-tool` 族的统计容易连坐。** P2-6：一次形状级拒绝就能把同任务全部目标打成 unknown；`restricted-degradation` 则只知"非 Hashline"不知原因（P2-3）。
3. **成本不可比。** `wallMs` 混入评测器 I/O（P1-3），三臂的 `git diff`/快照/身份重算开销并不完全相同（stock-edit 臂的文件面不同），耗时差会被读成模型差。
4. **`passConditions` 没被执行。** 跑完只会得到"逐样本 PASS"，没有人能说"是否达到冻结阈值"（P1-2）。
5. **真 provider 的边界仍未验证。** 中间件按 `llm/stream` 计一次请求，但 provider 内部 HTTP 重试、取消后是否计费均记 `unknown`（`providerHttpRequests: 'unknown'`）——这一点文档已如实写出，不是缺陷，但意味着"费用上限"只是本地阀门。

## 8. 本轮未覆盖

- **未执行任何测试或评测命令。** 本会话沙箱下 `vitest` 启动即失败：`esbuild` 的 `child_process.spawn` 报 `EPERM`（沙箱禁止程序通过管道捕获子进程输出）。这是环境限制，不构成对被测代码的 FAIL；按仓库规则，本轮所有 PASS/FAIL 一律引用文档记录，不冒充新证据。
- **无 `dsh-profile-acceptance` 一次性安装可复现**，因此宿主侧行为（三臂装配、`waitForChildren` 实际时序、刺激触发）未在本轮重新观察。
- **macOS/Linux 未涉及**；真实 provider 计费、内部 HTTP 重试、跨进程代理均不在本轮范围。
- **本文不构成推广结论**，也不改变任何授权：真实执行仍需模型、凭据、预算与当次明确批准。

## 9. 建议的最小改动集（按"先修再跑"排序）

1. **先定比较对象**（完整工具组合 vs 只拨策略开关），并据此确定臂集与命名（P1-1、P3-7）。这是唯一一个"不写代码也要先定"的决定，后面所有指标都随它变。
2. **阈值判定**：`passConditions` 要么判定、要么显式标 `not-implemented`；冻结期先拒绝 0 上限（P1-2）。
3. **计时边界**：模型侧耗时与 `evaluatorMs` 分列，`wallMs` 标 `live-measured`（P1-3，牵动 P3-4 的每样本身份重算）。
4. **提示差异**：按节记录 `{id, digest}`，出三臂差异表（P1-4）。
5. **汇总改分量 + 区间**（P2-5）——保住已测信息，且不让下界冒充点估计。
6. **降级原因聚合**（P2-3），直接支撑 §7.2 的"例外负担"与 §7.3 的"受限降级单列"。
7. **(未提交)** apply_patch 分清 `firstAttemptAttribution` 与 `completedAttribution`，并把 `ambiguous` 收窄到该调用可能触及的目标（P2-6）。
8. P3-1、P3-2 顺手修；其余 P3 记录在案即可。

以上 1-4 项都会改变 `protocolHash` 或报告 schema，因此**必须在正式冻结之前完成**；一旦冻结，任何一项修订都要重新冻结并重跑，不能只改代码。

## 10. 外部核对：零请求判读实验的四处反例

用户提供的《评测体系的实际价值与缺口》判读页（2026-10-26 09:06，未入库、不随 clone 交付）按"只读内存判读"提出四处反例。它不是新的执行证据——它和本文一样是读码结论——但每一处都能回到代码核对，结果如下。

| 判读页的断言 | 代码核对 | 本文处置 |
|---|---|---|
| 把某任务 Token 上限设成 0，checker 仍接受 | 成立：`protocolGaps` 只要求有限非负，且无人消费；实测用量 4 不影响结论 | P1-2 强化为"能冻结一个不可能满足的条件" |
| 耗时 +100 万毫秒并重算汇总，checker 仍接受 | 成立：`report.mjs:70` 取报告自述值参与哈希比对，`summarizeRuns` 用同一批自述值重算，所以自洽 | P1-3 原判成立 |
| 一条已测 + 一条 BLOCKED：首次正确与成本 unknown，目标采用率仍保留 | 成立：`counting.mjs:160` 要求全臂布尔，`:162` 只要求目标数组存在 | P2-5 **已改写**（原"全有或全无"过宽），并补上"下界"这一半 |
| apply_patch 拒绝后改走 Hashline：两次尝试、一次失败、目标可归属 | 成立：decision 在验证回退原因前已记录，`parsedPlan` 存在 | P2-6 **已改写**（原"重试永久未知"过头），改为连坐问题 |

三条取舍与本文一致，已并入对应条目：共用解释函数只保证工件与报告一致，口径正确靠手算期望与阴性对照（P2-1 因此降级为"需要控制"，不是"需要重构"）；不能用后一次成功的计划补造早期失败的目标（P2-6 建议）；未知样本不能从分母删掉，应报总数/已测/成功/未知/可能范围（P2-5 的区间方案）。

判读页把整体结论归纳成三问，本文的条款矩阵与之同向：

| 问题 | 状态 | 证据边界 |
|---|---|---|
| 工具能否运行、结果能否复查 | 有实际价值 | 安装身份、调用配对、最终字节与失败快照 |
| 真实模型能否完成任务 | 验证不足 | 新驱动没有任何真实模型执行证据 |
| 默认策略是否更正确且更省 | 尚无结论 | 阈值未执行、成本与实验控制未完 |

旧 E3 有真实模型记录，但不能替代新驱动的冻结对照；那四处反例也说明：这套设施目前的价值落在**能否把话说准**，而不是**已经说出了什么**。
