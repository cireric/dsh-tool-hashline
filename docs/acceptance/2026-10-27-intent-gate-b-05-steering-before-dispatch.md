# 请求级意图门方案 B · 票据 05：中途纠正优先于旧的未执行调用（工程验收）

日期：2026-10-27。范围：[票据 05](../../.scratch/intent-gate/issues/05-steering-before-pending-dispatch.md)；需求正文见[正式规格](../specs/2026-10-27-intent-gate-b-requirements.md)，前序切片见[01](2026-10-27-intent-gate-b-01-declare-before-publish.md)、[02](2026-10-27-intent-gate-b-02-bounded-repair.md)、[03](2026-10-27-intent-gate-b-03-input-exceptions.md)、[04](2026-10-27-intent-gate-b-04-clarification-wait.md)。

本文只记录**本票**结果。恢复/压缩（06）、真实 CLI/浏览器呈现端与完整交付（07）未实施；日常 profile 未切换，未安装、未重启、未发布、未启动真实模型。

## 结论

在 01～04 的同一系统 seam 上新增 4 个宿主用例，**41/41 用例 PASS**（01 的 13 + 02 的 10 + 03 的 9 + 04 的 5 + 本票 4）。"新要求已到达、旧调用还没执行"由两条机械规则兑现：(1) 一次尝试若**在用户输入到达之后才被判定**、且它要调用工具，则**保留文字、扣下调用**（回复以 plain stop 结束，什么都不派发），loop 随后在新的 turn 里收取那条 steer，请求在那里重新声明；(2) 已经跑起来的程序在下一次内层派发处经官方 'tools/pre-execute' 被拒绝 —— 已执行的调用保留，未执行的调用不开始。两者都不回滚、不伪造旧调用结果、不消耗声明修复预算，也不依赖睡眠：宿主用例用"停在流中间等纠正"与"等第一条写入落盘再纠正"两个可控时序取证。

## 关键设计

| 环节 | 实现 |
|---|---|
| 判定信号 | 读宿主自己的 steering 队列 'agent.inbox.nextStep'（公开 inbox），只看"是否有人类输入还没被收取"，不按到达时间也不按文本内容判断 |
| 未开始的调用 | 判定时若队列非空且尝试含 tool-call：**保留 text/reasoning/usage，丢弃 tool-call 块与 finish**，改发 'finish: stop'。回复正常结束、零派发；下一次 turn 由 loop 收取 steer |
| 已开始但未完成的调用 | 'tools/pre-execute' 拒绝下一次内层派发（只对受管主 agent、depth 0），理由写明"已执行的部分保留" |
| 已执行的调用 | 不自动回滚、不声称回滚；用例显式对照"第一步已写、第二步未写" |
| 预算与故障 | 纠正路径不写修复提示、不消耗声明修复、不把 stale 当故障码上报成 provider 错误；与 02 的预算、04 的等待状态互不影响 |
| 语义分工 | 是否真的改变了目标由 persona 判断："若改变目标/约束/范围 → 用新的 Intent 行重申后继续；若只是进度询问 → 说明现状并继续同一计划；不得声称回滚" |

## 逐条验收判据与证据（宿主用例，均为外部断言）

| 票据判据 | 结果 | 证据 |
|---|---|---|
| 通过公开 steering/输入入口制造"旧响应仍生成中"与"工具 A 已执行、B 未执行"两类纠正时点，明确判定时序 | PASS | 固定适配器新增确定性 'hold' 握手：先发布 'attempt-held' 标记再等待用例释放，用例在持有期间调用公开 'agent.steer(...)'；第二类用"轮询到第一条写入副作用后再 steer"。IG05-02/IG05-03 分别取证 |
| 新约束已到达且未执行的旧调用不进入工具 body；不能只把输入留到下一步，也不能只靠 wrapper 声称 | PASS | IG05-02：stale 程序 **零派发**（'stale-a.txt' 不存在、'run_code' 结果恰 1 次且属于重新判断后的程序）；IG05-03：程序中途被拒（'second-step.txt' 不存在） |
| 按新要求重新判断、更新声明后才继续对应调用；重新读取必要现状，保留原授权 | PASS | IG05-02/03/04：纠正后的那条回复都带新的 'Intent:' 行，动作发生在它之后（消息次序与写入次序都可查） |
| 工具 A 的已执行事实与副作用保留并诚实报告，不声称整段程序回滚；A 已执行与 B 被阻止分别取证 | PASS | IG05-03：'first-step.txt' == 'ran'，'second-step.txt' 不存在，run_code 结果为错误；persona 明写"pausing is not a rollback，已经运行的调用保留" |
| 普通进度询问、社交输入、其他独立请求与其他主会话不被当成同任务目标纠正而误取消；判断按含义与关联 | PASS（安全侧）/ GAP（语义侧） | 机械侧只保证"陈旧的动作不派发"，不做含义判断：IG05-04 用"进度如何？"证明同一条路径也会先暂停、随后由模型继续同一计划（不取消任务）；语义上是否该暂停由 persona 表达。**登记为本票的刻意的统一处理**（宁可行前重判，也不盲发陈旧动作） |
| 在系统 seam 使用可控时序与外部 marker/结果验证纠正优先，不依赖偶发睡眠或仅检查最终文件状态 | PASS | 时序由 'attempt-held'/'attempt-released' 握手与 'write-effect' 日志定位；断言同时看发布帧、tool/call、dispatch-start、tools/result、被 instrument 的 fs.writeText |
| 与声明修复预算、真实故障和取消的组合不放大修复次数、不伪造旧调用结果；非工具观察路径不作为替代 | PASS | IG05-02：纠正路径零修复提示，随后一次未声明请求仍拿到它唯一的一次修复（总提示数 1）；IG05-03：程序被拒后不生成伪造结果，错误结果来自真实拒绝 |

## 执行命令与退出码

| 命令 | 退出码 | 结果 |
|---|---|---|
| pnpm check | 0 | build + 三包 tsc + tsc -p tsconfig.tests.json |
| pnpm check:preset | 0 | 资源 digest（persona 与 gate 随本票更新）、三项 bounds、阻塞式提问行断言 |
| pnpm test:unit | 0 | 23 文件 / 325 用例（新增 3 项 steering 契约） |
| pnpm test:integration | 1 | 568 PASS / 3 FAIL，3 项为本机 git 属主/身份既存环境失败（非本票引入；共 571 用例） |
| pnpm test:ptc | 0 | 9 文件 / 33 用例 |
| pnpm test:compat | 0 | 2 文件 / 21 用例 |
| pnpm test:profile | 0 | profile 内 gate 资产：无声明被停、有声明放行 |
| node scripts/test-intent-gate-host.mjs --pack .tmp/intent-gate-host-28 | 0 | 41/41 用例 PASS；scriptedLlmRequests = 108、realModelRequests = 0 |
| pnpm test:delivery | 1 | PASS 20 / FAIL 1（REG-01）/ BLOCKED 9；唯一失败门禁 = pnpm test:integration（同 3 个环境失败） |
| git diff --check | 0 | 无空白错误 |

### 失败与缺口

- **FAIL（既存环境，非本票引入）**：tests/integration/operations-baseline.spec.ts 2 项与 operations-cli.spec.ts 1 项（本 checkout 的 .git 属主为 BUILTIN/Administrators、本机未配 git 身份）。修复需改动用户机器配置，本票无授权，如实保留。
- **GAP（后续票据）**：恢复/压缩保真（06，必须持久化本票依赖的 steering 队列语义等价状态与其结论）；真实呈现端与完整交付（07）；真实语义效果（IGB-AC-12）。
- **GAP（本票边界）**：
  - **进度询问与真实纠正被机械地同样对待**：两者都会让"在输入到达前生成的调用"停下重判。这是刻意选择（不盲发陈旧动作），persona 要求"只是进度询问就继续同一计划"，但"是否该继续"属语义，未被机械化证明。
  - 同一程序内"先行动、后提问/后改"的**语句次序**仍不可拦截：门在派发边界与内层派发处介入，不解析程序体。
  - 若一次纠正到达前程序已经把**全部**调用跑完，门只能保证"不追加陈旧调用"，不能让时间倒流；用例不声称回滚。
  - 固定适配器不证明真实模型在收到 steer 后一定会重新声明；它只证明门的路由与拦截。

## 原始证据（本地，不随 clone 交付）

| 路径 | 内容 |
|---|---|
| .scratch/intent-gate/evidence/intent-gate-b-05-host/host-result.json | 本次 --pack 验收的 41 个用例、'attempt-held'/'attempt-released'/'write-effect' 时序、零派发证据、边界声明 |
| .scratch/intent-gate/evidence/intent-gate-b-05-host/installation.json | 一次性 profile 与打包/装配 notes |
| .scratch/intent-gate/evidence/2026-10-27-delivery-run-intent-gate-b-05.md + .json | 本轮 pnpm test:delivery 生成的报告与摘要（仓库内报告保留既有轮次，未被覆盖） |

## 未授权事项

未安装到日常 profile、未重启、未发布、未切换升级目标、未调用真实模型或付费评估。
