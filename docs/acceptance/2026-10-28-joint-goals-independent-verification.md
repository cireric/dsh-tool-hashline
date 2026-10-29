# 意图门与工具路径：未提交修复的独立目标核验

> 归档说明（2026-10-29）：本文保留原轮次结果；文中历史 `.scratch/...` 路径现位于[本地原始证据归档](../evidence/README.md#本地原始证据)。一次性探针和候选环境已清理，当前重跑入口见项目 README。

日期：2026-10-28。对象：当前工作树相对 HEAD 的改动，**包含未跟踪实现与测试**。本轮使用 verification-before-completion，并按 code-review 的 Standards / Spec 两轴独立审查；结论以下列新执行证据为准，不沿用历史报告的 PASS。

## 1. 目标是否达成

**两项目标均未完全达成，当前不能宣布联合修复完成。**

| 目标 | 本轮结论 | 已获得的证据 | 阻止完整通过的事项 |
|---|---|---|---|
| 意图门 | 部分达成；有 FAIL 和 GAP | 声明、问题身份/等待、同程序后续行动拦截等已有定向测试与完整宿主证据 | 请求层“恢复中”只有纯规则函数，没有客户端接线；字符上限未在越界时停止读取；整宿主旧用例与新协议冲突；真实模型歧义识别未执行 |
| 工具路径 | 未通过完整验收 | 隔离打包安装、read/edit/PTC/策略等现有回归通过，已有按任务目标的判读工具 | 判读器存在可复现的错误通过/错误旁路判定与日志完整性缺口；模型实际采用效果未执行 |

这里的“未达成”不等于所有实现无效，也不等于已证明真实模型仍必然漏问或绕行。机械流程、判读可信度、实际呈现与模型效果是不同层。

## 2. 冻结范围与新执行记录

本轮复制当前 tracked + untracked 的 407 个源码/文档文件到独立候选，保存 HEAD、工作树 Diff、每文件 SHA-256。测试前后主工作树原 407 文件无变化；最终新增本报告及索引行另行核对，不改产品代码、不修测试来制造通过。

原始证据目录：`.scratch/verification/2026-10-28-joint-goals/`，被忽略、不随 clone 交付。主要产物：`source-manifest.json`、`working-tree.patch`、`results.json`、`adversarial-results.json`、`host/{host-result.json,installation.json}`、`surface/surface-result.json`、`delivery/2026-10-28-delivery-acceptance-summary.json`。

本轮安装资产原始字节身份与冻结源码相同：

- watchdog SHA-256：`0b000e17267412e4cbfd76c12b46696686fdce31d47d990a17872aabac95f37e`。
- persona SHA-256：`0c5abc4781b59b671e1ad15327d04d5948d101fcac4bc4e150cf176d3d3d6613`。这是原始字节摘要；`check:preset` 的归一化 LF 摘要口径不同，不混用。
- 完整宿主记录 DSH `0.2.1-rc.2`、hashline/tool-edit `0.2.1-alpha.4`；工具补丁/引擎共享实例按本轮 profile/compat 门禁验证，不能只看版本号。

| 实际命令/检查 | 退出码与结果 | 覆盖与局限 |
|---|---|---|
| 候选 `pnpm install --offline --frozen-lockfile` | 0 | pnpm 11.28.5、隔离锁定依赖 |
| 候选 `pnpm build` | 0 | 打包前构建，避免未生成 dist 的夹具准备错误 |
| 三个定向 unit spec | 0；66 PASS | declaration 43、recovering-presentation 7、tool-usage-judgement 16 |
| 五个定向 integration spec | 0；70 PASS | request-scope 52、persona 5、artifact judge 4、工具提取器接线 5、呈现提取器 4 |
| 候选 `pnpm test:delivery --out ..\delivery` | 0；21 PASS / 0 FAIL / 9 BLOCKED | 九道门禁全部 exit 0：build、包类型、测试类型、unit、integration、PTC、compat、preset、profile。交付未执行的 9 个 ID 不是 PASS |
| 候选 `pnpm test:host-gate --pack ..\host` | **1；49 PASS / 1 FAIL** | 50 个固定响应整宿主用例，166 次固定请求，真实模型请求 0；失败为旧 IG04-01 期望，见下文 |
| 候选 `pnpm test:surface-gate <本轮一次性 profile> ..\surface` | 0；3 PASS | 正式正文在校验前不发布、接受后呈现与耗尽路径；只到客户端载荷边界，未验证浏览器 renderer |
| `node .scratch/verification/2026-10-28-joint-goals/adversarial-probes.mjs` | **2；1 PASS / 7 FAIL** | 新反例；纯函数、日志 artifact、插件 seam，无真实模型、无任务文件或 shell 命令执行 |
| 隔离候选的问题 ID 条件变异检查 | 变异测试 exit 1；2 FAIL / 50 PASS；随后字节恢复 | 临时将匹配条件 `===` 改为 `!==`，现有等待测试能识别；只改候选临时副本，不改主树或安装实例 |
| `node scripts/evaluation/joint-plan.mjs --cases docs/plans/2026-10-28-joint-real-model-cases.json --out <本轮预检>` | **2；unauthorized** | 案例结构合法（12 意图门＋8 工具场景、40 对话），缺 11 项模型/参数/价格/预算字段；不发模型请求 |
| `git diff --check` 与最终源码摘要对照 | 0；源码稳定 | 测试对象未被修改；仅新增核验产物、报告与索引行 |

所有命令的完整输出分别保存在本轮 `*.log`、`model-preflight.json`、`waiting-mutation.json` 和 `results.json`。交付 gate 全绿与新增反例失败同时成立：现有测试缺少下面这些负向场景。

## 3. Standards：实现与证据可信度

### S1 · 必修/P1：工具路径可错误通过

产生点：[tool-usage-judgement.mjs](../../scripts/tool-usage-judgement.mjs) 的 265～278、336～340 行，以及路径匹配 207～218 行。

`settled` 同时纳入 completed 和 failed；`readFirst` / `editAfter` 实际只是总数组非空，没有检查次序、成功结果或全部目标。`endsWith` 也没有路径分隔边界。

本轮独立复现，下面四种输入全部返回 `applied-tool-path`、无 unknown：

1. read 与 edit 的结算均 `isError:true`；失败尝试未与已完成路径分开，不能凭此推定 canonical 读取与更新链已成立。
2. edit 先结算，之后才 read；并不存在该任务的 read → edit 顺序。
3. 声明目标 a.ts、b.ts，但只 read/edit a.ts；b.ts 未覆盖。
4. 声明 `src/a.ts`，实际只操作 `other-src/a.ts`；字符串后缀碰巧相同，被当成同一目标。

修复应逐目标记录身份、成功/失败及事件次序，缺依据时保持 unknown。采用过工具、工具完成、更新正确应分别表达，不能靠聚合调用数推成路径已应用。该模块本来不负责业务正确性，不能由它的 PASS 替代独立文件结果检查。

### S2 · 必修/P2：把 metadata 观察写成“已证实旁路”

产生点：同模块 284～286 行，将所有 `shellTarget` 加入 provenBypass；目标关联只要命令文本包含路径。

复现：正常 read/edit 后执行一个 `Get-Item src/a.ts` 记录，返回 `bypass` / `shell-touches-target`。这只是文件 metadata 查询，不是文本读取/更新旁路证据。副作用与证据来源不清时，应保留候选或 unknown，不能称 proven。

### S3 · 必修/P1：日志缺事件仍被标完整

产生点：同模块 `judgeSessionArtifact` 第 409 行的 complete，只检查残帧和 JSON 解析。

本轮 artifact 的 seq 为 0、1、3、4，明确缺 seq 2，但 JSON 与已有 start/settle 均可解析；得到 `complete:true` 且 `applied-tool-path`。丢失的整条事件可能正是旁路，缺证据不能当零旁路。需要检查 seq 缺口、重复和顺序，并将受影响判读降为 unknown。

### S4 · 必修/P2：字符上限未在越界时停止来源

产生点：[watchdog](../../presets/ptc-hashline/intent-gate-watchdog.mjs) 1350～1370 行。

超过 maxBufferedChars 只标记 overChars，循环仍持续 source.next 并追加 buffered。测试将上限设为 64，每块 30 字符，来源仍被读取 13 次（12 个文本块，共 360 字符，再加 finish）；之后才调用 return、返回 LIMIT。

本轮确认未接受正文没有发布，这是已有保护；但它不是声明的实际缓存保护。应在跨过阈值时停止读取并释放来源，并补充“越界后来源继续产出”的负例。现有停滞超时测试通过不能替代字符上限验收。

没有将一般代码气味当作阻断，也未为追求重构扩大范围。上述结论均有源码和本轮命令支撑。

## 4. Spec：需求缺失与验收不一致

### R1 · 未实现完整目标：首次 Failed 体验

规格 IG-B-05/20、IGB-AC-18 和计划 FIX-08 要求请求层恢复期间不先宣布失败。

产生点：[client/presentation.mjs](../../presets/ptc-hashline/client/presentation.mjs) 第 4～10 行明确写浏览器接线尚未实现；当前目录仅此纯函数模块，没有客户端插件入口、renderer 或注册装配，package/preset 也未接入该呈现行为。watchdog 首次失配仍走 error → idle followup。

因此这是**缺实现**，不只是本轮少拍了一张浏览器截图。规则函数 7 条单测、提取器能解释 recovering，都不能使现有界面采用它。本轮不启动日常宿主；实际 Web/CLI 的最终呈现效果继续 GAP，相关完整目标不能 PASS。

### R2 · 验收未对齐：整宿主 IG04-01 仍要求旧行为

产生点：[test-intent-gate-host.mjs](../../scripts/test-intent-gate-host.mjs) 第 1193～1209 行，要求 ASK_PROGRAM 在答案返回后于同一程序写文件。

新 IG-B-19/IGB-AC-17 则要求同一提问程序不得继续业务操作。本轮实际轨迹为：ask → answer → 后续 write 被新守卫拒绝，零 write-effect；旧断言因此 FAIL。

这个失败不能记为通过，也不能直接认定为新守卫退化。应将正例改为“问题专用程序结束 → 处理答案后的新模型生成 → 新业务程序写入”，并保留“同一程序尝试后续业务动作必须被拒”的负例。不能为让旧用例变绿而移除新守卫。

### R3 · 效果仍 GAP，不能据未执行判模型必然失败

人格已表达语义三选一及 SDK 路径；当前机械问题等待用例能够识别错误 ID 条件的变异。但没有本轮真实模型证据证明支付示例会主动提问、明确场景不误问，或文件任务实际停止使用原生 FS/child_process。

模型预检明确返回 unauthorized，缺 provider、model、reasoningEffort、temperature、maxTokens、输入/输出价格、currency、总生成/货币/时间上限。未获准前本轮没有真实调用，也没有把已冻结的 40 对话当作已执行结果。

## 5. 对两份计划的逐项归纳

| 验收范围 | 本轮状态 | 依据与边界 |
|---|---|---|
| FIX-01/02/03/15：歧义识别、明确则推进与漏问判读 | GAP（提示契约 PASS） | 实际 assembly 测试通过；真实模型未执行 |
| FIX-04/05/06/07：问题专用程序、待答、身份和隔离 | 部分 PASS；整宿主验收需修正 | 52 项 scope 集成、host 的等待/恢复用例及同程序拦截轨迹；IG04-01 仍旧期望，不能扩大成所有交叉已验收 |
| FIX-08：无首次 Failed | 未达成 | 缺客户端接线；3 个 surface 用例不等同浏览器效果 |
| FIX-09：声明修复后仍需正确澄清 | GAP | 提示/流程不能证明模型识别未解歧义 |
| FIX-10：一次修复与耗尽 | PASS（固定宿主覆盖） | 相应用例在本轮 host 50 项中通过；不外推真实生成效果 |
| FIX-11：真实终态、取消与资源上限 | 部分 PASS / FAIL | 故障/取消既有用例通过；字符上限反例 FAIL |
| FIX-12：所有断点恢复/压缩 | 部分 PASS / GAP | 本轮 host 重载用例通过；未新执行全部真实进程/压缩矩阵 |
| FIX-13/14：元数据/成本、作用域 | PASS（已测范围） | unit、integration、固定宿主与 profile；未知成本仍 unknown |
| TOOL-01/07：SDK 执行与原契约回归 | PASS（隔离工程范围） | 本轮完整 delivery/profile/PTC/compat；不代表模型主动采用 |
| TOOL-02/04/05：路径/旁路/unknown 的可信判读 | FAIL | 反例证明错误通过、误报及完整性缺口 |
| TOOL-03/06：适用工具选择及与意图门交叉 | 部分 PASS / GAP | 固定流程可执行；真实选择与覆盖仍有限 |
| TOOL-08：真实模型采用与正确性 | GAP | 未获模型与预算授权，未执行 |

## 6. 下一步顺序与本轮边界

建议先修判读器的逐目标身份/成功/顺序、日志完整性和 proven/candidate 分类，同时修字符超限即时停止；这些不依赖真实模型预算。然后对齐 IG04-01 的新协议用例，完成客户端实际接线与真实呈现验证，最后按获准模型/预算执行冻结语义和工具采用集合。

旧联合工程记录称剩余缺口均属外部条件，不应再作为当前完整结论：本轮已找到代码与验收层缺陷。保留旧报告历史状态，以本轮新证据追加纠正，不回写旧 PASS。

本轮未修改产品、依赖或测试，只有本地验证脚本、原始证据、本报告与状态索引更新。没有启动或重启日常宿主，没有安装到日常 profile，没有真实模型调用。临时变异仅发生在隔离候选，已按原始字节恢复。
