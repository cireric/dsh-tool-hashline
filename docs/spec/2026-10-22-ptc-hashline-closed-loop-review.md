# ptc-hashline 需求闭环审查与决议记录

- 日期：2026-10-22
- 性质：保留 v2 审查过程与两轮用户决议；当前权威文档为[需求规格 v3](./2026-10-22-ptc-hashline-requirements-spec.md)，下方最初发现与推荐按当时状态阅读。
- 范围：本地规格、HANDOFF、GLOSSARY、已安装 alpha.4 引擎与编辑包、stock DSH 源码、ptc-gate 基线副本。
- 当前结论：两轮共七项决议已确认并落实到规格 v3，需求具备实施基线。实现与交付验收未闭环：tool-read 仍是 stub，compat 仅有 README，根 manifest 尚无 bundle 声明。
- 验证边界：做了静态交叉核对；事实核查子代理对 recovery、哨兵、淘汰和 REM 做了引擎级复现。未运行完整 ToolRuntime、PTC、Web 或干净 profile 验收。

## 1. 必须先定的产品保证

规格第 19 行承诺“没看过的行改不动”，实际约束弱于这句话：

| 情形 | 已确认行为 | 证据 |
|---|---|---|
| PTC 未打印全部 read 返回值 | seen 仍按工具返回窗口记录 | 规格 R-3 |
| replace / patch / stock write | 不受 hashline seen 守卫约束 | 规格 Q-01、FR-6 |
| 跨 session | 缺少 seen 记录时放行 | 规格 FR-7、R-7 |
| 同 session 快照淘汰 | 同样可能放行；不只跨 session | `node_modules/@hy-sde-org/dsh-hashline/dist/snapshots.js:59`、`patcher.js:756`、`:682` |
| 旧 tag + 文件漂移 + recovery 成功 | 可以修改原快照未 seen 的锚点 | `patcher.js:803`、`:819`；子代理复现：seen=[1]，外部追加后旧 tag 编辑第 2 行成功 |
| 只看一行后 REM 整文件 | 可删除含未见行的文件 | `input.js:282`、`patcher.js:474`；子代理已复现 |
| block 操作 | seen 检查原始 anchor，不等于整个解析块均已 seen | `input.js:285`、`patcher.js:685` |
| 零行哨兵 [0] | 首次拒绝；错误完整回显后可增加 seen，原样重试成功 | `patcher.js:724`；子代理已复现 |
| mismatch 后抄当前 tag 重试 | mismatch 记录当前全文快照但不附 seen，后续可能失去守卫约束 | `patcher.js:742`、`:645`；静态核对 |

推荐：保留复用上游路线，把承诺明确为“上游 seen 守卫的限定保护”，列出操作和生命周期边界。若要严格保证全部未见内容不可修改，当前 read 适配层范围不足，必须重新讨论编辑端约束。

当时术语问题：v2 的 seen 行写“实际呈现给模型”，与 R-3 的“工具返回窗口”不同；错误回显和 edit 结果也能成为 seen 来源。tag 是内容摘要，不能据此证明当前 session 保留着有效的 seen 记录。两轮审查后已同步 GLOSSARY。

## 2. 截断与零行窗口尚无完整决议

FR-5 规定列截断，FR-7 只说传窗口行号；HANDOFF §11.2 却仍要求截断行不计 seen。实施者可能作出相反实现。

推荐：只把完整返回的行计入 seen；截断行不计入；本次没有完整行时传 [0]。重复读取的并集仍由引擎负责。补用例：长行前缀可见但未 seen，首次编辑被拒；此前已完整见过的行不因后续截断读而撤销许可。

需要同时接受其边界：stock 参数没有列窗口，默认 maxLineLength 下无法通过连续 offset 读取一条长行的剩余部分。不能只写“重新 read”而不提供可执行的处理路径。

FR-5 第 142 行的验收本身有误：默认 maxLineLength=2000 时，200 KB 单行先截为约 2000 字符，再计算输出字节，通常不会触发 51200 字节上限。证据：stock `packages/fs/tool-fs/src/read-render.ts:69`、`:83`。

应拆成两个用例：长行测试列截断；多条未超列限的行累计测试字节上限。另用 maxBytes 小于首条展示行大小，测试零行窗口和 [0]。

## 3. PTC 返回契约还缺一块

FR-3 的 canonical value 未包含 nextAction，但 §3、FR-7、FR-9、Q-01 均要求它。只在 content 加指引对 PTC 无效。

建议补齐 output schema、SDK 类型与字段组合约束：

- tagged=true 时 tag 为有效 tag。
- tagged=false 时 tag=null，nextAction 为非空、可执行的指引。
- 区分空文件、无 session、超过快照上限的行动建议。
- 明确 snapshotMaxBytes 比较的是原始文件大小还是归一化 UTF-8 字节数，以及 size 未知时如何处理。

FR-13 应区分“当前磁盘内容的 tag”与“store.head 的 tag”，二者不是恒等关系。上游 mismatch 已有当前 hash 和英文 re-read 指引，见 `dist/mismatch.js:77`、`:82`。要求抓到中文“重新 read”会误判上游的有效指引，宜改成语义断言或英文稳定片段。

## 4. bundle 的安装到挂载没有闭环

逐字复制三处 delta 之外仍存在未解决的资源来源：

- persona 使用 createRequire(baseUrl).resolve('@cireric/dsh-ptc-roles/package.json')。
- watchdog 引用 @cireric/dsh-ptc-roles 的子路径。
- 该上游包 private=true；本地 clone 不等于 profile 已安装依赖。
- 规格只写 link + install + remount，未写 dsh.profile.bundles 登记。
- 本仓库子包暴露 src/index.ts；HANDOFF §10.1 已记录裸 Node 加载失败。必须明确构建产物或实际宿主加载 TS 的路径。
- 插件从 profile 解析，不能仅凭根目录 workspace 存在就认定包名可加载。

证据：`.scratch/dsh-ptc-roles/preset/ptc-gate/preset.patch.yml:66`、`:362`；上游 `package.json:4`；`scripts/deploy-preset.cjs:241`、`:279`；本仓库三个包 manifest。

推荐：显式规定 profile 安装锁定基线的本地上游包，保留 persona/watchdog 原引用；并把插件解析和构建路径写成可执行安装步骤。如果要求本 bundle 独立搬运部署，则需要另选资源打包方案并修订“三处 delta”的口径。

验收须从干净临时 profile 开始：安装依赖和 bundle 登记 → 发现 ptc-hashline → 真正加载 read/edit/watchdog/persona → 执行一次 PTC read→edit。

## 5. 大文件的资源边界未定义

NFR-2 要求一次 readText、不流式读取；FR-9 只取消大文件 mint，仍需读全文并返回窗口。4 MiB 只是快照门槛，不是读取内存上限。超大文件和未知 size 的文件没有资源策略。

推荐：本期明确接受全量读取的成本，并记录为限制，不宣称保持 stock 大文件读取能力。若需要有界内存，应重新讨论大文件流式路径与 NFR-2；不能由实现者自行选一条而仍宣称完全符合规格。

## 6. 交付验收需形成可执行矩阵

已有 FR 验收足以指导很多测试，但 M1–M4 与 FR/NFR 尚无逐条覆盖表。建议补一张“需求 → 用例 → 运行命令 → 判定”的矩阵，尤其包括：

- 真正 run_code 内读取 tag/nextAction 并编辑，核对 SDK 类型；仅直接调用 ToolRuntime 不足以证明 PTC 链路。
- 干净 profile 安装、资源解析、bundle 登记和真正重新挂载。
- 同 session 快照淘汰、recovery 绕过、REM/block 边界、错误回显后重试。
- 编辑后继续用新 tag 编辑、外部漂移 recovery 成功、recovery 失败、head/tail 告警。
- store key / show path 在相对路径、绝对路径及符号链接下的口径；不支持的别名明确声明。
- 无权限和非法 UTF-8 的错误断言；FR-14 目前只枚举三类错误，不能单凭该列表覆盖 FR-9 全表。
- NFR-4 限定为自建 tool-read 的运行时 import；上游 tool-edit 本身有宿主运行时依赖，不应对整个 preset 作相同断言。

## 7. 文档维护项

规格头部的 GLOSSARY、背景报告相对链接当前路径不正确，应分别指向 ../../GLOSSARY.md 与 ../background/…。

HANDOFF 有意保留历史，但部分未划除内容和 stub 注释仍指向装饰器实现。权威规格优先级已足够明确；实施前应清理活跃入口，避免新实现者沿旧 TODO 工作。

## 8. 第一轮决策前沿

以下互相独立；建议回答“是”即接受推荐。

1. 是否保留上游有限守卫，把总目标收窄并明确 recovery、REM/block、淘汰及降级路径边界？推荐是。
2. 是否规定截断行不新增 seen，零完整行用 [0]，并承认默认 read 无列分页能力？推荐是。
3. 是否允许本 preset 依赖 profile 中另行安装的锁定版本 ptc-roles 包，以保留原资源引用？推荐是。
4. 是否本期保留一次全文 readText，明确接受大文件内存成本？推荐是；若大文件保障是核心需求，则选否并重开 NFR-2。

## 9. 第一轮答复（2026-10-22）

- Q1 接受：收窄总目标，继承上游有限守卫。见 ADR-0001。
- Q2 接受：只把完整返回的行新增到 seen，零完整行时用 [0]；承认没有列分页。
- Q3 调整：独立整合 ptc-gate，原项目可弃置，不额外安装 ptc-roles。见 ADR-0002。
- Q4 接受：本期全文 readText，明确接受大文件内存成本。

本轮已同步 GLOSSARY 的 tag、seen 行和零行窗口口径；当时暂未改写权威 v2，后续第二轮已统一修订为 v3。

## 10. 第二轮决策前沿

1. 是否只交付 ptc-hashline 一个 preset，把 ptc-gate 作为内置能力，而不再额外提供 ptc-gate picker 项？推荐是；原 D-2 的并存不再作为安装前提。
2. 是否以锁定基线逐字迁入 persona/watchdog，首版只改资源地址，后续独立演进？推荐是；本仓库存基线摘要与契约测试，检查不依赖原项目目录可用。原“三处 delta”需拆为功能 delta 与资源定位 delta。
3. 是否将长行补救明确为调高 maxLineLength 后重挂载再读，或显式 replace/patch 降级？推荐是；nextAction 应在截断窗口也给出提示，避免重复 read 同一前缀。

事实补充：watchdog 仅有 node:crypto 的静态 import，无其他本地运行时代码依赖；persona 与 watchdog 的迁入即可消除 patch 内两处对 @cireric/dsh-ptc-roles 的资源引用。上游 verifier 是测试资产，不能据此宣称无需本仓库验收。

## 11. 第二轮答复与落地（2026-10-22）

- Q5 接受：只交付 ptc-hashline 一个 preset。
- Q6 接受：首版保持 gate 基线正文/行为，仅迁移资源地址；本仓库保存基线与契约测试，以后独立演进。
- Q7 接受：截断长行采用配置重挂载或显式 replace/patch 降级，nextAction 给出指引。

七项取舍落入规格 §7.3；FR-3 补 canonical nextAction，FR-5 修正长行与字节上限验收，FR-7 写明有限守卫和完整行来源，§4.2 补独立资源/构建/安装契约，§8.1 补验收组与计划脚本接口，NFR-2/3/4 澄清适用范围。

补查 local provider 发现 processPath 返回 targetKey，可能不同于输入解析键；规格 FR-7 据此要求记录输入与返回路径各自的编辑键（相同时仅一次），通过集成测试验证，不改变上游 edit 键算法。

本轮仅修改需求与交接文档，尚未迁入资源、实现 read、创建验收脚本或挂载 profile。不能用“需求取舍已收敛”推断“插件功能已实现”。
