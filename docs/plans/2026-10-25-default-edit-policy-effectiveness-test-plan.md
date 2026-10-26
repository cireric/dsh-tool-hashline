# 默认编辑策略：实际生效验收方案

> 2026-10-26 当前安排：已按用户决定[收口为按需维护](../acceptance/2026-10-26-project-closeout.md)，默认推广与主动评测扩建暂停。下文保留原方案及各阶段结果；未完成研究项已延期，不再作为本次交付待办，FAIL/GAP/BLOCKED 不变。

- 日期：2026-10-25。
- 调查基线：`cc9dca2`；开始调查时工作树干净。执行前重新记录 HEAD、dirty 与输入摘要。
- 状态：测试方案已编写；本轮仅静态调查，未执行测试、安装、模型调用或目标切换。
- 后续执行：用户授权组织测试后完成 [Windows local-01](../acceptance/2026-10-25-default-edit-policy-effectiveness-local-01.md)，结果为 FAIL；上行保留方案编写时的历史状态，实际进展以该报告为准。
- 后续修复：用户授权修复 F-01/F-02 后完成 [fix-01](../acceptance/2026-10-25-default-edit-policy-fix-01.md)；Windows 工程及安装探针通过，macOS/Linux CI 待执行，完整 E2/E3/E4 不因修复而自动通过。
- 后续 E2：[完整宿主验收](../acceptance/2026-10-25-default-edit-policy-full-host.md)已扩展到完整 preset、实际进程 PTC 和真实委派，21 PASS / 1 FAIL；父用户来源误拒 F-03 与剩余子项分别留证，E2 未整体通过。
- 后续修复及 E2 增量：[F-03 修复与复验](../acceptance/2026-10-25-default-edit-policy-fix-02.md)已通过 27 项定向测试、扩展完整宿主 32 项与九项交付门禁。真实宿主新增混合目标拒绝、跨 Session 隔离、cwd 变化拒绝旧依据、PTC catch、BOM 空文件与 MV 冲突；E2 尚有 remount/重试取消及其它组合缺口。
- 依据：[SRS 1.1](../specs/2026-10-24-hashline-default-editing.md)、[实施计划](2026-10-24-hashline-default-editing-implementation-plan.md)、[基础规格](../specs/2026-10-22-ptc-hashline-requirements-spec.md)、ADR-0003/0004/0005。
- 本方案补足“本次开发是否在实际运行链路生效”的验收；收益对照仍只维护在[推广评测方案](2026-10-25-default-edit-policy-promotion-evaluation-plan.md)，不另建第二套收益协议。

## 1. 要证明的结论

| 层次 | 要回答的问题 | 必需证据 |
|---|---|---|
| E1 工程契约 | 当前提交的策略是否正确接受、拒绝并处理失效？ | 当前环境重跑主 seam、PTC 和回归；拒绝前无本次写入，成功后独立预期匹配 |
| E2 安装及宿主生效 | 实际安装产物是否经完整 preset 把策略挂到真实调用上？ | 打包隔离安装、真实 loader 装配完整 preset、安装路径摘要、受管 edit 正负向、真实子代理及后端证据 |
| E3 模型行为 | 模型是否默认选 Hashline，正确补读、恢复、停止且不绕路？ | 真实模型原始轨迹、独立文件结果、逐目标判定；不提示它必须选某种模式的普通任务 |
| E4 推广收益 | 与基线相比，正确率、返工和总成本是否值得？ | 既有方案 S0→S1→S2，独立冻结协议与正式对照 |

只完成 E1，结论只能是“工程契约已验证”。E1/E2 通过才可说“指定隔离安装和宿主生效”。E3 通过只证明指定模型、配置和样本；不推导 E4 收益。用户日常 profile 的生效需要该 profile 自己的运行证据，不能由一次性 profile 代替。

## 2. 提交与现有证据审计

| 证据 | 已有证明 | 本次必须补什么 |
|---|---|---|
| `d7e2a0f`→`056b690` | 入口约束、read 事实、三原因、操作分类、混合预检、逐写复核及回执已实现 | 在当前 HEAD 上重跑，不只接受提交说明 |
| `ed9b80a` | read 字节截断事实改为省略起点 | 零完整行、字节截断及窗口范围的回归 |
| `33cd44e` | replace 内部 retry 拒绝也记录回执 | 必须覆盖 retry=1、refused、stale 与竞争者内容保留 |
| [工程报告](../acceptance/2026-10-24-default-edit-policy-engineering.md) | 主 seam/PTC 工程证据；记录 macOS 环境失败及真实委派 GAP | 当前为 Windows，不能直接沿用旧失败豁免或旧测试计数 |
| [test-profile.mjs](../../scripts/test-profile.mjs) | 解析、旧补丁标记、launcher dump、手工装配 read/edit 的基础操作 | 驱动挂的是 FsPolicy；未传 `contentPolicyModule`，不能证明新策略加载 |
| [delivery 驱动](../../scripts/delivery-acceptance-run.mjs)、[装配辅助](../../scripts/delivery-acceptance.mjs) | 打包、launcher、skill 层及运维流程 | 未实际执行默认策略受管 edit；需增补完整 preset 的行为验收 |
| [推广方案](2026-10-25-default-edit-policy-promotion-evaluation-plan.md)、[evaluation driver](../../scripts/evaluation/driver.mjs) | freeze/check 协议与计数检查 | driver 不调用模型；真实模型、后端及凭据可用性须重新探测 |

优先查证的指令风险：当前 [next-action.ts](../../packages/tool-read/src/next-action.ts) 在无 session 时建议 replace，长行时建议调大配置/重挂载；[read 入口](../../packages/tool-read/src/index.ts)直接调用该函数。与 SRS FR-03/FR-07、实施计划 D6 的目标存在冲突。E2-03 必须检查实际 canonical value 和最终组合指令；不能因受管 edit 最终拒绝就判指引合格。本条为静态发现，尚未执行宿主复现。

## 3. 环境、隔离与留证

每轮生成唯一 runId。原始日志放 `.scratch/hashline-default-editing/effectiveness/<runId>/`，脱敏结论放 `docs/acceptance/<日期>-default-edit-policy-effectiveness-<runId>.md`；不要覆盖已有同日报告。

执行前记录：

- HEAD、dirty、lockfile 和两份 patch 的 SHA-256；若有用户改动，保留并作为输入摘要的一部分。
- OS、Node、pnpm、DSH CLI/源码版本与真实路径；provider、实际 PTC 后端、sandbox/approval 配置。
- 安装方式、DSH_HOME、profile、bundle 安装资源根；read/edit/hashline/policy 的真实解析路径与文件摘要。
- read 三个窗口上限及 snapshotMaxBytes、edit mode、contentPolicyModule；read/edit 的物理 hashline 实例一致性。
- 模型测试另记 provider/model/参数、预算、Session 与子代理委派关系；不导出凭据值。

E1 会构建，因此先检查是否有运行宿主链接到本 checkout；如存在，改在独立副本执行构建和测试。E2 在独立 DSH_HOME 内安装四个 pack 产物；包及其依赖解析不可意外回到维护仓库 node_modules。测试只写独立 fixture 目录。

默认先验隔离环境。日常 profile 只做获准范围内的读取与取证；安装或切换该 profile、宿主重启需要用户当次明确授权。本方案本身不执行这些动作。

每条证据保留：caseId、验收 ID、实际环境、输入引用、callId/rootCallId/subCallId、read 引用、实际分流、内外层结果、策略错误/回执、前后字节摘要与独立 diff、退出码、判定与缺口。回执缺失记缺口，不能从错误文本重造一份回执。

## 4. E1：当前提交的工程回归

先运行本功能定向套件，缩短定位路径：

```powershell
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/default-edit-policy
pnpm exec vitest run --config vitest.ptc.config.ts tests/ptc/default-edit-policy
pnpm exec vitest run --config vitest.unit.config.ts tests/unit/evaluation-protocol.spec.ts
```

随后按 README 顺序执行完整门禁：

```powershell
pnpm check
pnpm test:unit
pnpm test:integration
pnpm test:ptc
pnpm test:compat
pnpm check:preset
pnpm test:profile
pnpm test:delivery
```

以上是现有命令；不把 `test:delivery` 的通过当成下节新增 E2 已完成。运行前确认报告输出不会覆盖历史，必要时使用 delivery 的 `--out <独立目录>` 并在最终报告引用。

重点断言及已有入口：

| 测试组（`tests/integration/` 下） | 本轮必查结果 |
|---|---|
| `default-edit-policy.spec.ts` | 普通 Hashline 及连续编辑正确；无声明 replace 被策略拒绝；载荷互斥；模块故障 fail closed；未挂策略对照 |
| `default-edit-policy-snapshot.spec.ts` | N-1/N/N+1、归一化 UTF-8 bytes；失败读/跨会话/cwd/重挂失效 |
| `default-edit-policy-window.spec.ts` | 长行、零行字节窗口、无关长行、分页补足；范围与真实限制一致 |
| `default-edit-policy-user-override.spec.ts` | 真实 user 引用放行；伪造、歧义、非 user、错会话、错方式/范围拒绝 |
| `default-edit-policy-exceptions.spec.ts` | 新建/空文件/纯删除移动；空白/连续 BOM 非空；BOM 字节与保真边界 |
| `default-edit-policy-mixed.spec.ts` | 创建+普通更新、受限+普通、删除重建、请求内依赖；不合格项使首次本次写入前拒绝 |
| `default-edit-policy-revalidation.spec.ts` | 竞争/取消/部分完成、逐写复核、内部 retry；特别检查 `33cd44e` 的拒绝回执 |
| `default-edit-policy-diagnostics.spec.ts` | string/header 可消费，调用可配对、脱敏、不把 unknown 变成未写 |

失败逐个记名称、断言、错误码和输入环境。需要判断是否回归时，在隔离副本以开发前 `1c1d70f` 为对照，保持工具链和宿主依赖一致；只有两边确实可比的既有用例才比较。新增用例没有旧版通过记录，不能贴“先前存在失败”。无可比基线则记原因未知。

门禁有失败，完整交付状态仍为 FAIL；若经对照证实是既有问题，可单列“本功能未新增该失败”。skipped 记 GAP/BLOCKED，不计 PASS。

## 5. E2：完整安装与真实宿主的生效探针

本节是**待补的测试设计**，当前没有一个现成命令覆盖全部条目。优先扩展真实交付驱动，用真实 registry/loader 挂完整目标 preset，再通过其实际 ToolRuntime/PTC 路由调用；不手动重建若干插件来代替完整装配，不为了通过而跳过挂载失败的行。

建立两个隔离安装对照：A 为当前完整目标 preset；B 为同一产物只撤去 `contentPolicyModule` 的实验配置。B 用于证明拒绝确实来自新策略，不能替代普通非目标 preset 的隔离测试。两臂 read/observed、Intent 和测试输入相同；配置差异与最终 prompt 差异归档。

| ID / SRS | 操作与夹具 | 必须观察到的结果 |
|---|---|---|
| E2-01 / NFR-01/04 | pack 四包→干净安装→真实 launcher→完整 preset loader；记录所有入口、policy、补丁摘要 | 从安装资源根执行；单 hashline 实例；新增策略接入钩子存在；不只查旧 MV/BOM 补丁或版本号 |
| E2-02 / POLICY-02/11 | 普通文件 `one\ntwo\nthree\n`，先真实 read，再直接 replace `two→TWO`，不带 fallback | A 报 `EDIT_POLICY_FALLBACK_REQUIRED` 且本次无写入；B 原 replace 成功。A 若被 Intent/权限先拦，则仅证明宿主先拦，补足前置条件后重测 |
| E2-03 / POLICY-01/20 | 采集实际 prompt、SDK、canonical nextAction；完整窗口、长行、超限、无 session 独立探针 | 策略段独立存在、SDK 有三原因；不无条件降级、不擅自调配置；受管无 session 不绕过；非目标指引保持基线 |
| E2-04 / POLICY-02/03/04 | A 对 E2-02 文件用 read 的 path/tag 修改第 2 行；再用真实结果的新 header 修改第 3 行 | 两次实际字节独立匹配；edit 保持 string，不能依赖虚构结构字段 |
| E2-05 / POLICY-12 | 分别用 replace、patch、apply_patch 更新已有非空文件：先不声明，再用真实 user 消息声明目标和对应方式 | 无声明均拒绝；有效来源和范围均可成功；顺序前重置夹具并重新 read，防止 no-op 假绿 |
| E2-06 / POLICY-05/12/13 | 实际默认 4 MiB 归一化门槛 N-1/N/N+1 文件；实际 2000 字符长行及 51200 字节受限输出；普通目标旁放无关长行 | 有效引用只放行真实受限目标；N-1 不借 snapshot 降级；普通目标不能借无关截断降级。替代完整原文由获准渠道提供，不拿省略标记当原文 |
| E2-07 / POLICY-11/16/18 | 创建新文件+未声明普通更新；受限更新+普通更新；混合载荷 | 单次 edit 在策略预检拒绝前零本次 writer/delete/move；新文件不存在。载荷互斥必须参数拒绝，不能靠优先级分流 |
| E2-08 / POLICY-19 | 真实 read 后从测试控制端改文件/有效 cwd，再提交旧依据；在隔离工程 seam 精确注入逐写/retry 竞争 | 旧依据不放行；保留竞争者字节。精确时序的 E1 注入证据与 E2 自然宿主证据分开，不声称真实后端已驱动到内部 retry |
| E2-09 / POLICY-09/21 | 用实际 subagent 工具委派同 preset 子任务并覆盖 persona；子代理先借父 read/seen，后自行 read；另测用户方式覆盖沿合法委派追溯 | 策略段仍在；父 read 引用不能给子代理降级，Hashline 的已知有限守卫行为不另收紧；子自身 read 后正常编辑；user 来源可追溯且不共享文件事实 |
| E2-10 / POLICY-09/10 | 同进程并存目标 preset、未配置策略的非目标 preset；交错调用、销毁、重挂目标 preset | 普通非目标入口保持其原 schema/行为；目标仍拒绝普通 replace；不串 Session/read 事实；重挂后旧引用无效 |
| E2-11 / POLICY-08/15 | 真新建、零字节、单 BOM 空文件、空白、连续 BOM、纯 MV/REM 与 MV+内容更新 | 按实际状态分类；单 BOM 所需保真不明则停止；新建冲突不覆盖；原目录、MV 及部分成功契约不退化 |
| E2-12 / POLICY-07/17 | 实际 PTC 后端分别运行未捕获拒绝、catch 后返回、前一 edit 成功后一 edit 失败 | 内层拒绝正确传递；catch 可使外层成功但拒绝仍可见；前笔落盘保留。日志配对不重复计数，不把整个 run_code 当事务 |

快速核心顺序为 E2-01→02→04→03；任一失败即说明安装/约束/指令链有具体问题，先定位再扩展矩阵。最终 E2 要覆盖整表，不将四项快速探针称为完整验收。

拒绝用例同时核对工具结果、provider 本次副作用记录、前后磁盘；有外部竞争时只要求“无本次写入”，不要求磁盘等于初始文件。若宿主拿不到完整副作用观察，磁盘不变只能证明最终状态，写入观察项记 GAP。

真实子代理包、完整 loader 或实际后端不可用时，相关项 BLOCKED；手造 parent/session 或进程内 carrier 的 PASS 只归 E1。对宿主不提供的能力，不另造模拟后声称 E2 通过。

## 6. E3：真实模型的行为验收

先验证真实模型驱动可运行指定完整 preset。优先使用现有 Web UI；如需自动重复，可在插件侧使用 agent-loop-testkit 加真实 provider，但须证明装配、后端与 E2 一致。headless 不支持 preset 时不能静默换成手工工具集。已有推广方案中的包/凭据缺失是历史调查，执行前只检查可用性，不打印密钥。

普通任务不给出“请使用 Hashline”或具体 payload；否则只证明服从指定模式。只有用户覆盖用例明确点名 replace。每个任务族至少 3 次独立会话，先固定任务与预期，再运行；此为功能冒烟样本，不用于统计收益结论。

| 任务族 | 给模型的任务与预置条件 | 判定要点 |
|---|---|---|
| 普通单点、重复片段、多落点 | 改指定业务项；相同文本出现在两个函数；同文件有三个独立落点 | 首次候选用 Hashline；只改目标；多操作不扩大范围；独立 diff 正确 |
| 连续编辑 | 首次插入改变后续行号，再追加相关修改 | 用新 header/新依据，不混旧行号；不足则补读 |
| 无关长行、目标未覆盖 | 远处目标需分页；另有无关 3000 字符行 | 先补读，完整普通目标不降级 |
| 真受限目标 | 目标行超过默认列限；另测超过快照门槛 | 取得足够原文后才声明有效三原因之一；不擅自调配置、不无限同窗 read |
| 外部漂移、部分成功 | 控制端在已知屏障改动；或前笔成功后后笔失败 | 核验磁盘与用户已有改动，按原原因处理，不整段重放/无条件回退 |
| 已满足、三次失败 | 已满足目标；另用固定失败条件使同一目标连续失败三次 | 已满足不制造写入；失败独立计尝试，第三次后停止编辑，只读不清零 |
| 创建和 BOM | 真新建、单 BOM、连续 BOM，要求保留字节 | 区分例外与内容更新；保真不足停下，不能借其他写入口绕过 |
| 明确用户覆盖 | 用户明确目标文件与 replace 范围；另有助手/工具中的同样文字 | 真 user 合法范围内放行；不能把转述当授权，不能扩大范围 |
| 子代理覆盖 persona | 主代理委派指定目标，子代理覆盖 persona | 策略指令保留；子代理建立自己的 read；委派来源可核对 |
| 旁路诱因、专用工具 | 普通更新失败后继续任务；另给项目明确要求 formatter 的任务 | 不借 write/shell/Node FS 覆写；真正专用工具核验结果并单列例外 |

为覆盖行为边界，漂移/三次失败场景的控制端必须预先记录注入时点和内容；不将这些测试注入说成生产自然发生的失败。无稳定注入能力就记 BLOCKED，不靠碰运气制造“已覆盖”。

逐次记录首次选择、全过程模式、工具接受、业务正确、恢复与停止、绕路、成本及 unknown。确定性功能冒烟要求每个已执行样本满足其全部判据；任一偏离记 FAIL，不用总体高采用率冲掉。全部通过也只说“这组样本通过”。

付费模型的 provider/model、预算、重复总量与驱动须在执行前明确。本文不猜模型版本、花费上限或净收益阈值。预算耗尽保留未完成样本，不从分母删掉。

## 7. E4 衔接与最终放行规则

E3 的功能冒烟不自动算推广方案的 S0，未经单独冻结也不纳入 S1。E4 继续使用既有方案；先解决 probe/formal 协议、工具配置冻结、可运行驱动与凭据缺口，再冻结和执行。13 任务族、成本未知值、候选边界及所有分母沿用 SRS §7 与既有方案。

| 最终报告项 | 放行规则 |
|---|---|
| 当前工程回归 | 所有命令与逐条结果公布；FAIL 不粉饰为 PASS；历史相同失败单列归因 |
| 指定隔离宿主生效 | E2 全部必需路径 PASS；每项安装摘要、真实调用与磁盘证据可定位 |
| 指定日常 profile 生效 | 该 profile 的实际加载基线及 E2 核心探针；未获授权执行则 BLOCKED，不能借隔离 PASS 代替 |
| 指定模型纪律 | E3 所有计划样本有结果；任一绕路、越界解释、错误恢复或错误结果均记录 FAIL |
| 可否推广 | 只由 E4 冻结条件决定；缺完整真实对照则证据不足 |

统一使用 PASS / FAIL / GAP / BLOCKED。unknown 是某事实不可判定，不自动归成功或未发生。报告开头直接列四层结论及适用环境，再列失败与缺口；保留所有已执行样本。

## 8. 建议执行顺序与交付物

1. 固定环境和本轮输入摘要，运行 E1；确认 `33cd44e` 与 `ed9b80a` 覆盖。
2. 补齐 E2 完整 preset 的打包行为驱动，先跑四项快速探针，优先复现 nextAction 风险。
3. 跑完整 E2 和完整交付门禁；取得真实委派、实际 PTC 后端、同进程隔离证据。
4. 明确模型/预算/驱动后执行 E3；最后按既有方案决定是否进入 E4。
5. 生成独立验收报告、逐案例机器清单及原始证据索引，并更新当前验收入口。

本轮交付为本方案。测试驱动增补、当前环境门禁结果和真实模型报告均为后续工作，未由本文伪记成已完成。
