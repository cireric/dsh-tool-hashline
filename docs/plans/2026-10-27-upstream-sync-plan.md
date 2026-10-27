# PTC 与上游能力同步方案（待实施）

> 状态更新（2026-10-27）：本文保留需求对齐前的技术提案与调查，需求权威已转为[同步需求规格](../specs/2026-10-27-upstream-sync-requirements.md)。下文每周 CI、月度复核、全量范围及工作包仅为历史建议，不是获准实施的安排；冲突处以规格为准。

日期：2026-10-27。目标是持续发现 PTC preset、DSH read 契约及 hashline/tool-edit 引擎变化，在明确本项目差异的前提下维护兼容性。此文是设计提案：没有自动检查、定时任务、新版本安装或目标切换；任何升级目标切换仍需用户当次明确同意。现行默认推广和真实模型实验的[阶段决策](../acceptance/2026-10-26-evaluation-stage-decision.md)不因本方案改变。

## 现状与证据

| 对象 | 当前实现 | 已有能力与缺口 |
|---|---|---|
| PTC Mode | [本项目 preset](../../presets/ptc-hashline/preset.patch.yml)维护独立的插件行、persona、Intent watchdog 和资源 | [check-preset](../../scripts/check-preset.mjs)检查本项目固定结构、资源摘要及 read 窗口一致性；尚无对候选上游 PTC 的完整结构/行为漂移检查 |
| hashline/tool-edit | 两个 workspace 适配包分别精确锚定 `0.2.1-alpha.4`；[pnpm 配置](../../pnpm-workspace.yaml)对二者应用补丁 | [兼容矩阵](../../tests/compat/README.md)覆盖 seen、cwd、MV、BOM 等；`baseline.mjs` 检查实际解析路径、补丁标记和实例身份，版本相同不足以证明补丁生效 |
| tool-read | [自有实现](../../packages/tool-read/src/index.ts)，而非第三个可直接升级的上游包；PTC 消费 canonical value | 需对照 DSH `@deepseek-ai/dsh-tool-fs` 的 read 输入/输出、窗口、FS observation、错误及大文件行为，按本项目 read/tag/seen 契约独立跟进 |
| 升级运维 | [upgrade skill](../../presets/ptc-hashline/skills/ptc-hashline-upgrade/SKILL.md)已有三方 assess/propose/consent/validate/switch、基线和证据 | 只允许用户在该模式显式调用；[upgrades.mjs](../../presets/ptc-hashline/operations/upgrades.mjs)的组件集合为 dsh/hashline/tool-edit。它并非 PTC 差异或 tool-read 全量同步器，真实只读 assess 缺候选包文本时通常只能 defer；候选阶段的 `semanticRegression` 当前为 `not-measured` |

本机只读抽样：`D:/Project/source/__TEST__/deepseek-harness/packages/bundle/web-app/presets/ptc.patch.yml` 与本仓库 preset 的顶层 id 各 23 项；前者独有 `time-context`、`tool-schedule`、`tool-plugin-manager`、`tool-plugin-market`，本项目独有 `tool-read`、`tool-edit`、`ptc-hashline-operations-skills`、`intent-gate-watchdog`。源文件 SHA-256 分别为 `9e355c947bf61c3d2fe9bf3214b386f83c0d99d37579ce22576d4b82cb6e1a2c` 和 `be099e048d23cb26c3ba812846222a453ea6693121d0b1f3b8bf1a8c4e62a295`。该抽样仅比较顶层 id；本地 DSH manifest 声明 `0.2.1-rc.2`，HEAD/ref 文件指向 `687f282e8625c6b8d11ff58211a90524be2e4317`；但本轮 `git -C` 被环境拒绝，commit 对象及 dirty 状态未核实，checkout 身份 **unknown**。不能认定这些差异是已发布版本的新变化或都应同步。

同一 DSH 本地快照的 `packages/fs/tool-fs/src/read.ts` 包含大文件流读取路径，自有 read 的 `index.ts` 使用 `ctx.fs.readText` 读取全文。这是值得核实的行为/资源差异，不能据此宣称回归或无条件搬运实现。stock `read_image` 是 `tool-fs` 的独立注册项，不能把它与文本 read 混为同一工具；实际挂载情况也须以候选宿主结果为准。

## 同步目标与差异边界

同步是“**上游变化均被发现、分类、验证和记录**”，不是将本项目 preset 字节复制成上游。以候选上游 PTC 为参考，至少检查：顶层及嵌套插件的增删/顺序/配置、平台表达式和隔离域；persona 和系统提示；工具名称/schema/SDK；PTC runtime；计划、委派、compaction、技能和资源；安全/权限及 Intent gate。

每条差异均有稳定标识、上游来源版本和路径、本项目对应路径、影响、判定、依据、负责人和关联测试：

- **跟进**：与 Hashline 差异无冲突，候选变更和回归通过后合入。
- **保留差异**：例如独立 persona/watchdog、自有 read/edit 组合；须记录理由、影响、现行规格/ADR 和复查触发条件，不能整段无条件忽略。
- **待分析**：新增工具、权限变化、冲突或语义未知；保持 GAP，不能自动视作安全或无变化。
- **不适用**：注明平台/版本/构建条件和证据；不得把不可访问的源视为不适用。

上述四个抽样中的上游独有 id 先登记待分析，包括权限、宿主依赖、产品用途和 PTC SDK 影响；不自动添加工具。默认编辑策略和 S0 结论不随同步检查自动改变。

## 工作流：发现 → 比较 → 候选 → 切换

1. **发现（只读）**：每次计划升级 DSH 或两个引擎时检查；建议自动检查每周一次、人工复核至少每月一次，安全/兼容问题可提前触发。查询 registry 的稳定版/预发布和官方仓库 tag/commit，记录来源 URL、查询时间、引用、哈希及成功/失败。网络不可达、源不可验证或 checkout dirty 记 unknown/GAP；同版本不等于无漂移。本方案不创建自动任务。
2. **固定基线**：分别记录现行本仓库 commit/dirty 输入、lockfile、patch hash、已安装解析路径/版本/构建文件标记及共用 hashline 实例；记录指定上游 release/commit、PTC 与 stock read 相关文件摘要。基线与候选必须分别命名，不能将工作区快照或仓库最新分支当成已发布安装。
3. **对比并分诊**：输出结构化差异与简短人可读报告。按插件 id 和嵌套路径比较增删、顺序、配置、资源；按功能清单比对 read 的参数、结果、错误、资源开销和权限。声明的保留差异只能匹配精确范围和依据，新字段/新行/源失效仍须显式暴露。只读解析不能执行上游 YAML 的 `!!js`；平台表达式保留原文，实际装配另在隔离宿主核验。差异为零、已审定差异、待分析和源不可得需分开表示，不能用一个绿灯掩盖 unknown。
4. **候选变更**：选择一个具体上游组合和差异集合，冻结来源及补丁的 keep/redo/delete 决策。复用现有兼容矩阵和运维工作流；如果需要调整语义、测试或依赖白名单，先形成范围及验证方案。候选树使用独立安装/lockfile/store，不能热改正在使用的源码链接或 profile。
5. **验证与决定**：按下述矩阵在候选环境执行，保存实际解析文件及测试证据；有失败、未运行、源不可得或语义未验证就分别标 FAIL/GAP/BLOCKED，不升级为已验证。审查候选结果后决定合入维护仓库；目标 profile 的切换、回退与宿主重启另遵循既有授权和证据规则。用户明确批准覆盖两个阶段时，不重复要求同一授权。

现有 `/ptc-hashline-upgrade` 的调用资格、范围、权限及 `candidate-verified` / `candidate-incomplete` 等状态保持原契约；该 skill 的显式用户调用限制不被“定期检查”绕过。按该 skill 执行候选验证时须满足其方案与 consent 契约；目标切换仍须有相应范围的明确授权。将来新增的只读检查应与该 skill 解耦，不能把只读报告当成它的授权、语义回归证明或切换资格。

## 持续发现的推荐实现

拟在现有 GitHub Actions 中增加独立的只读同步检查：每周定时运行并支持手动触发；普通 push/PR 使用固定来源夹具做离线回归。只读任务查询声明的官方来源并固定候选 ref/摘要，必要时将候选源码或包文本作为**数据**获取到隔离临时目录；不执行候选代码、不安装、不改 lockfile、源码或 profile，也不调用模型。输出机器结果和人可读报告作为 CI artifact；需长期追溯的结论按仓库约定人工整理入 `docs/acceptance/`。

仓库内拟维护一份同步基线和差异例外清单，记录经核实的上游引用、文件摘要、比较路径以及逐条例外的两端内容摘要、理由和复查条件。例外只匹配声明的精确路径及身份；任一端变化、出现新的嵌套字段、重复 id 或未能解析的标签时重新暴露差异，不用通配符忽略整个 persona、插件组或 read。刷新基线或例外本身须经审阅并附关联测试。

检查结果区分：`no-drift`（源完整且无未决差异）、`known-differences`（源完整，差异均有有效决定）、`needs-review`（发现新变化或例外失效）、`source-unavailable`（源/身份不完整）。后两类让同步检查任务失败并保留原因，不能输出“无需升级”；它们不应伪装成产品功能测试失败。该状态机仅为拟议检查器，不替换现有升级 skill 的四态评估结论。若服务端不提供可信快照或包内容，记录 GAP 并等待补证，不以静默跳过换绿。

## 三类验证矩阵

| 对象 | 必须比较和验证 | 结果解释 |
|---|---|---|
| PTC preset | 候选官方 PTC 与本项目顶层/嵌套插件、配置、顺序、persona/SDK 与实际装配；run_code 外层限制、子代理隔离、Intent 门、资源路径、跨平台 shell 选择 | 未解释的新增行、未知表达式、SDK/行为或权限变化为 GAP；不直接同步 persona/watchdog 或自动添加工具 |
| hashline/tool-edit | 两个候选包的声明与实际解析版本、lockfile、补丁文件名/键/摘要/标记；一物理 hashline 实例；逐补丁检查上游已修复与否 | 对每项补丁做 keep/redo/delete；标记证明补丁作用于构建文件，**不证明上游语义已修复**；须以对应真实回归决定 |
| tool-read | 对同一 DSH 候选比对 stock read 的参数、canonical value、渲染、错误、路径/链接、分页与截断、流式及资源、FS observation；另验证 tag/seen、cwd、BOM、MV/CAS | 新能力单独评估实现/不适用/延期及依赖白名单；不复制上游 read。需要改变 schema 时先修订规格，保持 canonical value 与输出 schema 一致并验证兼容；seen 不是权限边界 |

候选最低门禁遵循 [README 开发验证](../../README.md#开发验证)、[兼容矩阵](../../tests/compat/README.md)及[基础规格](../specs/2026-10-22-ptc-hashline-requirements-spec.md)：`pnpm check`、unit、integration、PTC、compat、check:preset、test:profile；交付类变更再跑 `pnpm test:delivery`，受默认策略影响时跑真实安装的 `test:host-policy --pack`。新变更必须配套验证实际版本、解析路径、补丁和同物理实例；失败/跳过不能称为通过。

CI 已有 [Windows/macOS/Linux 矩阵](../../.github/workflows/policy-contract.yml)，但配置存在不等于本轮三平台实测。真实模型对照不作为每次同步的自动门禁；若同步改变模型可见提示/SDK 且需要评估实际使用效果，单独设计有费用上限的实验并获得授权。固定 Provider 只证明宿主契约，不证明模型收益。

## 最小实施顺序与验收

这些是拟议工作包，不代表已实现或批准上游升级：

1. **同步基线与差异台账**：给出版本化的基线/候选身份、差异分类和已知差异理由；先拿到可信上游 commit/安装身份。验收：无来源或身份不明时为 GAP，新增未知项不能被已有保留规则吞掉。
2. **PTC 只读差异检查**：复用官方 preset/配置来源，检查顶层与嵌套 id、顺序、完整配置、平台表达式、资源以及已声明例外；增加新增行、删改、例外失效、相同版本不同字节和来源不可得的负向测试。验收：可在无凭据、无写 profile 环境生成可追溯差异；运行时行为需候选装配另证。
3. **read 与引擎兼容清单**：建立按来源路径/契约映射的 read 差异项，连接已有 compat/Session/PTC 测试，并对补丁语义逐项登记；新增上游流式/错误/schema 改变和未决补丁的失败测试。验收：未知或未测不进入 PASS，read 既有依赖与契约不退化。
4. **复用现有升级链**：让差异报告作为人工审阅的候选输入，只有在已确认的范围内扩展现有工具/技能；先检验 `semanticRegression: not-measured`、真实 assess 的候选文本缺失、历史交付 9 个 BLOCKED ID 是否适用，补上必需的真实证据，再评估候选和目标切换。不得把历史 21 PASS / 9 BLOCKED 或固定夹具扩大为该组合的通过。

报告保存路径遵循仓库规则：正式规格/计划在 `docs/specs/` / `docs/plans/`，每轮结果与机器摘要在 `docs/acceptance/`；候选源、原始日志和本地票据保留在 `.scratch/`。报告至少记录来源、引用和摘要、当前/候选组合、逐项差异及处理、命令与退出码、实际版本/补丁身份、未测项和下一次复查条件。
