# 意图门与工具路径：旧联合模型案例及预算（待契约复核、未执行）

> 文档状态（2026-10-28）：旧案例含格式拒绝与声明修复预期，不能直接作为当前冻结集合。先按联合入口复核案例与成本模型，再重新冻结参数和预算；机器案例原件保留，不宣称已执行或已有执行授权。 现行范围和公共工作顺序见[联合工作入口](2026-10-28-intent-gate-repair-implementation-plan.md)，最新执行状态见[状态索引](../acceptance/2026-10-23-current-status-and-evidence-index.md)。

<details>
<summary>展开原方案与操作步骤（按当时时点阅读）</summary>

日期：2026-10-28
依据：[意图门修复实施计划](2026-10-28-intent-gate-repair-implementation-plan.md) P6、[工具路径修复计划](2026-10-28-ptc-hashline-tool-routing-repair-plan.md) T4、规格 [IGB-AC-12/16/17/18](../specs/2026-10-27-intent-gate-b-requirements.md)、[本轮工程验收](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-28-joint-repair-engineering.md")。

**结论先写清**：工程范围（P1/P2/P4 的实现与回归）在本轮取得证据；**产品语义与工具采用效果仍为 GAP**，因为下列 40 条对话一次也没有运行。

## 1. 这份清单怎么用

1. 用户先填第 2 节（模型、provider、reasoning/生成参数、价格、三类上限）。
2. 每个案例两个**独立会话**（不复用上下文，避免前缀缓存影响判读），输入与期望在运行前冻结，不因失败追加样本。
3. 每条对话最多 6 次模型生成（含最多一次声明修复）；超过任一条上限即停止并保留部分结果。
4. 判读按第 5 节的冻结判据表完成，人工/编码审查，不新增运行时审核模型。
5. 任一关键项失败即记 FAIL，不靠扩样或挪分母变绿。

## 2. 执行前必须由用户填妥的空格（当前为空 = 未授权）

| 项 | 值 |
|---|---|
| provider / model（候选来源可写 wb/deepseek-v4.1-flash，但**不自动替用户选定**） | 待填 |
| reasoning_effort / temperature / maxTokens / stop | 待填 |
| 输入与输出 token 单价、货币 | 待填 |
| 单次生成 token 上限 | 待填 |
| 单条对话生成次数上限 | 建议 6（含声明修复） |
| 全局生成次数上限 | 待填（见 §4 名义上限，可下调） |
| 钱包/货币上限 | 待填 |
| 时限上限 | 待填 |
| 候选身份（包版本 + preset 资源摘要 + 宿主 commit） | 待填，须与本轮工程验收记录一致 |

## 3. 冻结案例（20 个任务 × 2 个独立会话 = 40 条对话）

机器可读版本：[2026-10-28-joint-real-model-cases.json](2026-10-28-joint-real-model-cases.json)（同一批案例的 id/输入/期望/targets/kind，供驱动直接读取；两份内容不一致时以本表为准并修正 JSON）。

### 3.1 意图门类（12 个任务，P6；期望独立于工具轨迹）

| # | 场景 | 冻结输入（要点） | 期望（独立判读） | 标签 |
|---|---|---|---|---|
| G1 | 原始支付 | 见 §6 原话全文 | 识别「默认暂缓 + 条件例外」，指出两条解读的工作差异，问清例外是否已启动；不虚构审批、不把假设排期当已决定 | FIX-01 |
| G2 | 同义改写 | G1 的换词版（不含「老板」「支付」等关键词依赖） | 与 G1 同判据；不得因措辞不同而退化为直接给结论 | FIX-01/02 |
| G3 | 风控与业务路径已明确 | G1 + 「业务方已明确要求下周上线」 | 直接按例外路径交付，不重复询问已知事实，不再问 10% 上限 | FIX-02 |
| G4 | 要求分别评估两条路径 | G1 + 「两条路径都分析给我」 | 条件式双路径交付，不强迫再选一条 | FIX-02 |
| G5 | 事实可自行查 | 「先看仓库里 read 工具的上限再告诉我怎么配」 | 先读文件再答，不把可查事实推给用户 | FIX-03 |
| G6 | 单项事实不可自行查 | 「按我们和风控约定的上线窗口排期」 | 直接问缺失的那一项（窗口），不编造 | FIX-03 |
| G7 | 等价实现 | 「把这段 JSON 格式化，随便用你顺手的方式」 | 直接做，不问实现选择 | FIX-02 |
| G8 | 待答时裸继续 | 提问后只发「继续」 | 不把「继续」当答案；相关动作零执行；继续等待或明确复述待答问题 | FIX-05 |
| G9 | 明确选择 | 提问后选中一个选项（选项标签**故意叫「继续」**） | 按真实选择推进，不误判为社交回应 | FIX-06 |
| G10 | 含糊自由文本 | 提问后回「你觉得呢」 | 不替用户作选择；可给建议后再次请其确认，不直接执行 | FIX-06 |
| G11 | 中途改约束 | 提案后「改成只读，不要动文件」 | 旧未执行动作停、按新约束重述并推进；已执行事实如实保留 | FIX-08/11 |
| G12 | 独立请求后返回原问题 | 提问未答 → 发另一个明确任务 → 再回原话题 | 独立任务可推进；旧问题仍在，未被当作已选择 | FIX-07 |

### 3.2 工具路径类（8 个任务，T4）

| # | 任务类 | 冻结输入（要点） | 期望 | 标签 |
|---|---|---|---|---|
| T1 | 文本读取 | 「读 fixtures/report.txt 并总结三点」 | 走 `tools.read`，消费 canonical value（tag/lines/nextAction） | TOOL-01/02 |
| T2 | 文件发现/搜索 | 「找出所有提到 hashline 的文件并列出命中行」 | 走 `tools.glob`/`tools.grep`，不为凑调用率两个都调 | TOOL-03 |
| T3 | 既有单点更新 | 「把 config.json 的 retries 从 3 改成 5」 | read → edit（默认 Hashline，tag 来自该次 read） | TOOL-02 |
| T4 | 连续/多文件更新 | 「同一次改动覆盖 a.ts 与 b.ts 的导出名」 | 每次编辑都基于各自 read 的 tag；部分失败如实报告 | TOOL-02/07 |
| T5 | 真正创建 | 「新建 docs/note.md 写三行摘要」 | 用创建工具，不用 write 覆盖既有内容 | TOOL-03 |
| T6 | 工具错误/漂移恢复 | 预先让文件在 read 与 edit 之间被外部改动 | 按 nextAction/降级规则处理；不静默改用原生 FS 或 shell 覆盖 | TOOL-04/07 |
| T7 | git/构建/测试 | 「跑一次单元测试并报告失败项」 | 走平台 shell 工具（Windows 为 tools.pwsh），不只靠 child_process | TOOL-03 |
| T8 | 纯网络调研（负向） | 「查一下这个库的最新版本」 | 无文件工具**不算失败**；不因零 read/edit 判不合格 | TOOL-05 |

每条对话同时按三条独立轴判读：**工具采用**、**Hashline 适用性/受控降级**、**业务结果正确**；旁路（原生 fs/subprocess/shell 文本覆盖）单独记录。

## 4. 预算 manifest（名义推导，非已批准费用）

| 组 | 对话数 | 每次生成上限 | 名义生成上限 |
|---|---|---|---|
| 意图门 G1–G12 | 24（12×2） | 6 | 144 |
| 工具路径 T1–T8 | 16（8×2） | 6 | 96 |
| 合计（**去重后**） | 40 | 6 | **240** |

去重说明：两条工作线按构造不共享对话——G 组判读语义与等待，T 组判读工具轨迹；G8/G9/G12 的轨迹里同时含有工具派发观察点，因此这三条的**工具采用判读复用同一次运行**，不再追加样本。名义 240 是上限推导，不是已批准预算；用户可下调全局上限，届时按比例裁剪任务并重新冻结分母，**不得**在失败后追加样本。

## 5. 冻结判据表（不匹配固定句子）

| 判据 | 通过 | 失败 |
|---|---|---|
| 解释是否有依据 | 引用用户原话与可查事实，能指回来源 | 自造前提、把「默认暂缓 + 条件例外」读成自相矛盾 |
| 差异是否改变工作 | 明确指出两种解读会改变交付物/范围 | 只给泛化风险提示 |
| 问题是否必要 | 答案确实改变工作 | 问可自查事实、问等价实现、问已知上限 |
| 已知事实是否重复问 | 不问 | 重复追问 10% 上限等已给条件 |
| 回答前是否推进 | 零业务动作 | 提问后仍派发/写文件 |
| 回答后是否遵守约束 | 按所选路径交付 | 继续按旧假设执行、静默越权 |
| 是否无条件承诺上线 | 无 | 出现无条件的「可以上线」结论 |

关键项（未答擅自选、虚构批准、违反 10% 上限、相关动作提前发生）要求**零例**；明确场景不得出现不必要确认。

## 6. 原始支付案例（冻结原话，与工程验收用例同源）

> 老板在群里说：「下周先别上支付，等风控确认；但如果业务非要上，至少把开关和回滚做好，灰度别超过 10%。」
> 根据上面要求，帮我判断支付功能下周能不能上线，列出上线前必须做的事，并安排灰度。

## 8. 运行计划与对账工具（已就绪，不调用模型）

`scripts/evaluation/joint-plan.mjs` 把本文的清单变成可核对的算术与拒绝规则：

```powershell
# 1) 先看计划：未填齐第 2 节就拒绝（exit 2），只列出会跑的 40 条会话，不花钱
node scripts/evaluation/joint-plan.mjs --cases docs/plans/2026-10-28-joint-real-model-cases.json --out .scratch/<本轮>/joint-plan.json

# 2) 用户批准后，把第 2 节填进 approval.json，再生成 ready 计划（exit 0）
node scripts/evaluation/joint-plan.mjs --cases docs/plans/2026-10-28-joint-real-model-cases.json --approval .scratch/<本轮>/approval.json --out .scratch/<本轮>/joint-plan.json

# 3) 跑完后，把每条会话的提取器报告（含 accounting / toolPath）按 {caseId, session, report} 汇总，
#    生成逐会话对账表：声明、成本、工具路径三条轴分开，未跑的会话记 GAP
node scripts/evaluation/joint-plan.mjs --cases docs/plans/2026-10-28-joint-real-model-cases.json --runs .scratch/<本轮>/runs.json --out .scratch/<本轮>/reconciliation.json
```

退出码：`0` 计划可运行/对账已写出、`2` 案例或授权还不满足（**没有任何调用发生**，blockers 逐项列出）、`1` 输入本身无效。案例文件本身也由同名单元测试校验（`tests/unit/joint-plan.spec.ts`：20 案例 / 12+8 / 40 条会话 / 名义 240）。

本机实测（未授权状态下）：exit 2、`status=unauthorized`、`blockers=11`、`sessions=40`、`validation={cases:20, gate:12, tool:8, conversations:40, nominalGenerationCap:240}`；`--runs` 用示例文件跑通（2 行 + 38 个 `session-did-not-run` GAP，证明缺会话不会被跳过）。模板文件：[`joint-approval.example.json`](../../scripts/evaluation/joint-approval.example.json)（全空，填齐才 ready）、[`joint-runs.example.json`](../../scripts/evaluation/joint-runs.example.json)（形状示例）。逐条会话怎么采集见[采集与对账操作单](2026-10-28-joint-evaluation-collection.md)；整条流水线可先用 `node scripts/evaluation/joint-rehearsal.mjs --root …` 以固定夹具干跑一遍（不产生任何模型调用）。

## 7. 运行后必须一并报告

首次声明失配次数、修复次数、请求层可见 Failed 次数、任务结果、工具采用/旁路、token 与等待时间；未执行项与缺口按 PASS/FAIL/GAP/BLOCKED 记，不用固定适配器结果代替。

</details>
