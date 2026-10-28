# 请求级意图门方案 B · 票据 04：澄清等待与回答路由（工程验收）

日期：2026-10-27。范围：[票据 04](../../.scratch/intent-gate/issues/04-clarification-wait-and-answer-routing.md)；需求正文见[正式规格](../specs/2026-10-27-intent-gate-b-requirements.md)，前序切片见[01](2026-10-27-intent-gate-b-01-declare-before-publish.md)、[02](2026-10-27-intent-gate-b-02-bounded-repair.md)、[03](2026-10-27-intent-gate-b-03-input-exceptions.md)。

本文只记录**本票**结果。中途纠正（05）、恢复（06）、真实 CLI/浏览器呈现端与完整交付（07）未实施；日常 profile 未切换，未安装、未重启、未发布、未启动真实模型。

## 结论

在 01～03 的同一系统 seam 上新增 5 个宿主用例，**37/37 用例 PASS**（01 的 13 + 02 的 10 + 03 的 9 + 本票 5）。澄清等待**不引入私有开关**：等待由宿主的持久 \`ask_user_question\` 调用开启、由该调用的结算或真实用户输入关闭；门在此状态上追加三项记账——(1) 03 的输入例外全部关闭（A/B 待答中裸「继续」不是选择，仍要声明）；(2) 要调用工具的回复被停止（未回答就不行动，沉默不是同意）；(3) 宿主以 \`user-question-reply\` 送达的回答一律按真实输入处理，必须声明，绝不当成社交回应。暂停本身由 preset 钉住的**阻塞式**提问提供，\`check:preset\` 在该行改成 timed 时失败。

## 关键设计与接口组合

| 环节 | 实现 |
|---|---|
| 等待信号 | 只听宿主的持久信号：\`tool/call\`（直接调用）或 \`tool/ptc-dispatch-start\`（PTC 程序内调用）名字为 \`ask_user_question\` ⇒ 开启等待；\`tool/result\` / \`tool/ptc-dispatch\` 的同名结算 ⇒ 关闭；若结算内容是宿主的 pending 结果（\`{"pending":true}\`）则保持开启。门不猜"这条回复像不像问题" |
| 暂停 | preset 保留 \`tool-ask-user\` 的阻塞式（legacy）提问：工具不返回，请求就停在那里，用户不回答则程序不可能往下走。\`check:preset\` 断言该行不得写 \`mode: timed\`（timed 会返回 pending 并邀请模型"继续别的独立工作"，与本规格的暂停相反） |
| 等待期间不行动 | 任何一次尝试只要**含 tool-call** 且在等待中，就以 \`INTENT_DECLARATION_AWAITING_ANSWER\` 终止（保留 usage，不发布正文，不派发）；这不是措辞问题，因此**不消耗**声明修复预算 |
| 回答路由 | 宿主用 \`user-question-reply\` 的 source kind 把回答作为 user 角色消息送进会话；\`isHumanInput\` 把它与注入通知/工具结果区分开，\`classifyInput\` 在等待期间一律返回 \`owes\`，因此回答必须重新声明理解 |
| 独立请求不被误伤 | 等待状态按 sessionId 保存；真实用户输入（回答或新请求）结束等待的门控影响，另一主会话完全不受影响 |
| 提问形态（语义） | persona：只在"会改变工作"时提问；展示候选解读的**工作差异**、可给推荐、允许自由补充；缺单项事实就直接问那一项；先做已获授权的只读核实；问题回复不含任何动作；沉默不是同意 |

## 逐条验收判据与证据（宿主用例，均为外部断言）

| 票据判据 | 结果 | 证据 |
|---|---|---|
| persona 按工作后果判据识别关键意图歧义；等价实现/轻微细节自行判断；缺必需信息直接问、不编造备选 | PASS（文案契约）/ GAP（语义有效性） | persona 新增「Asking instead of guessing」段落（只问会改变工作的、候选差异、推荐、单项事实、先做只读核实）；固定适配器只证明规则被调用，不证明模型识别歧义的能力（IGB-AC-12） |
| 发问前可做必要只读核实；明确需要取舍就直接问，不借调查延迟已知选择 | PASS（persona 契约）/ GAP（语义） | 同上段落；本票不做机械强制（无法区分"调查"与"拖延"） |
| 多解问题展示工作差异、可推荐、允许补充；缺单项信息直接问；不要求普通请求先获确认 | PASS（persona 契约）/ GAP（语义） | 同上；IG01-01 等普通请求用例显示正常请求照常推进、不额外确认 |
| 问题作为合格正式回复交付后进入澄清等待；当前请求的后续工具不执行；同时给出澄清与行动时不能让行动先跑 | PASS（可机械证明的部分） | IG04-01：问题经宿主工具提出，写入副作用发生在**回答之后**（日志次序 ask < answer < write），程序在提问处被宿主阻塞；IG04-02：等待中要动手的回复被 \`INTENT_DECLARATION_AWAITING_ANSWER\` 停止，\`acted-early.txt\` 不存在。**边界**：同一程序内"先写后问"的次序在门可见范围之外（门看的是整条回复，不解析程序体），见"失败与缺口" |
| 用户沉默不默认同意；A/B 待答中的「继续」不自动选推荐项，回答选项结合待答问题解释，不误当社交回应 | PASS | IG04-02（沉默期间零行动、零副作用，且不消耗修复）；IG04-04（待答中裸「继续」被判为缺声明 → 修复后回复是"仍在等你选 A 或 B"）；IG04-03（宿主的回答消息必须声明，不当社交） |
| 用户选择/补充明确意图后按最新要求更新理解再继续，原授权与约束仍保留；不同主会话及同会话新独立请求不被全局等待误伤 | PASS | IG04-03（回答后以声明继续）；IG04-05（另一主会话照常行动）；单测/集成层覆盖"新用户输入结束等待的门控影响" |
| 通过公开用户输入/回答入口在完整宿主证明发问、零后续执行、未回答、含糊回答与明确回答的外部轨迹；不直接改私有等待字段 | PASS | 发问=宿主工具调用（\`tool/ptc-dispatch-start\`）；回答=公开 \`ctx.userQuestions.answer(...)\` 入口（IG04-03 断言 \`accepted === true\` 并收到 \`user-question-reply\` 消息）；未回答/含糊/明确三态分别在 IG04-02 / IG04-04 / IG04-03 |
| 把"已报告需要澄清后的流程保证"与"真实模型会不会发现歧义"分别记证据 | PASS（本文与 findings.boundaries 均声明） | 本文结论栏与 host-result.json 的 boundaries：固定适配器不证明模型发现歧义的能力 |

## 执行命令与退出码

| 命令 | 退出码 | 结果 |
|---|---|---|
| pnpm check | 0 | build + 三包 tsc + tsc -p tsconfig.tests.json |
| pnpm check:preset | 0 | 资源 digest（persona 与 gate 随本票更新）、三项 bounds、阻塞式提问行断言 |
| pnpm test:unit | 0 | 23 文件 / 322 用例（新增 3 项等待状态契约） |
| pnpm test:integration | 1 | 564 PASS / 3 FAIL，3 项为本机 git 属主/身份既存环境失败（非本票引入；总计 567 用例） |
| pnpm test:ptc | 0 | 9 文件 / 33 用例 |
| pnpm test:compat | 0 | 2 文件 / 21 用例 |
| pnpm test:profile | 0 | profile 内 gate 资产：无声明被停、有声明放行 |
| node scripts/test-intent-gate-host.mjs --pack .tmp/intent-gate-host-24 | 0 | 37/37 用例 PASS；realModelRequests = 0 |
| pnpm test:delivery | 1 | PASS 20 / FAIL 1（REG-01）/ BLOCKED 9；唯一失败门禁 = pnpm test:integration（同 3 个环境失败） |
| git diff --check | 0 | 无空白错误 |

### 失败与缺口

- **FAIL（既存环境，非本票引入）**：tests/integration/operations-baseline.spec.ts 2 项与 operations-cli.spec.ts 1 项（本 checkout 的 .git 属主为 BUILTIN/Administrators、本机未配 git 身份）。修复需改动用户机器配置，本票无授权，如实保留。
- **GAP（后续票据）**：中途纠正（05，必须复用本票的等待/请求身份判断，不能把普通进度询问当纠正）；恢复/压缩（06，必须持久化 accepted/lastOutcome/等待状态，否则重载后可能重新开启或丢失等待）；真实呈现端（07，问题面板与正文的呈现顺序只能在 07 穿透）；真实语义效果（IGB-AC-12）。
- **GAP（本票边界）**：
  - 同一程序内"先行动、后提问"的次序不可机械拦截：门检查的是整条回复（是否含 tool-call），不解析 run_code 程序体。persona 禁止该写法、宿主在提问处阻塞，但"程序内次序"仍在门可见范围外。若宿主将来把提问做成"先登记后执行"的独立事件，可在 05/07 重新对齐。
  - timed 提问模式会让宿主返回 pending 并邀请模型继续独立工作，与本规格的暂停相反；本票用 timed 变体**只为**确定性地到达 pending 状态（headless 宿主没有回答者让阻塞提问挂住），生产组合仍用阻塞式，并由 check:preset 钉住。
  - 「用户沉默」在阻塞式下表现为"没有输入"，因此"沉默不默认同意"由宿主阻塞 + 本票的零行动规则共同保证；真实的 UI 超时交互未在本票覆盖。
  - 固定适配器只证明路由、状态与提示契约；模型是否真的会发现歧义、是否给出有差异的候选，属语义效果，未被本票证明。

## 原始证据（本地，不随 clone 交付）

| 路径 | 内容 |
|---|---|
| .scratch/intent-gate/evidence/intent-gate-b-04-host/host-result.json | 本次 --pack 验收的 37 个用例、逐用例结论、提问/回答/写入的日志次序、等待中的停止码、边界声明 |
| .scratch/intent-gate/evidence/intent-gate-b-04-host/installation.json | 一次性 profile 与打包/装配 notes |
| .scratch/intent-gate/evidence/2026-10-27-delivery-run-intent-gate-b-04.md + .json | 本轮 pnpm test:delivery 生成的报告与摘要（仓库内报告保留既有轮次，未被覆盖） |

## 未授权事项

未安装到日常 profile、未重启、未发布、未切换升级目标、未调用真实模型或付费评估。
