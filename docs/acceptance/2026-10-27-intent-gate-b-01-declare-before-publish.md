# 请求级意图门方案 B · 票据 01：先声明、后展示与派发（工程验收）

日期：2026-10-27。范围：[票据 01](../../.scratch/intent-gate/issues/01-declare-before-publish-and-dispatch.md) 的纵向切片，需求正文见[正式规格](../specs/2026-10-27-intent-gate-b-requirements.md)。

本文只记录**本票**执行到的结果，不代表 IGB-AC 全组或整个新规格通过；自动修复（02）、输入例外（03）、澄清等待（04）、中途纠正（05）、恢复（06）、真实呈现端与完整交付（07）均未在本票实施。日常目标（日常 profile）未切换，未重启、未发布、未安装，也未调用真实模型。

## 结论

本票在隔离打包安装的完整 preset 上完成系统 seam 验收：**13/13 用例 PASS**，拒绝路径的「发布 / 调用记录 / 程序开始 / 磁盘副作用」四个观察点全为零，接受路径四者齐全且正文、工具参数、usage、replay 元数据保真。仓库门禁：`pnpm check`、`check:preset`、`test:unit`、`test:ptc`、`test:compat`、`test:profile` 全部 exit 0；`test:integration` exit 1，**3 个失败均为本机 git 环境既存问题**（见"失败与缺口"），与本次 diff 无关。

## 交付内容

| 产物 | 位置 |
|---|---|
| 请求级门插件（官方 `llm/stream` waterfall 暂存 → 校验 → 原样放行或策略停止） | [intent-gate-watchdog.mjs](../../presets/ptc-hashline/intent-gate-watchdog.mjs) |
| persona Phase 0 改为「每请求首条正式回复声明、自然语言、无六桶」 | [orchestrator.md](../../presets/ptc-hashline/personas/orchestrator.md) |
| preset 行：删除 `gate: enforce` 开关，声明暂存上限 | [preset.patch.yml](../../presets/ptc-hashline/preset.patch.yml) |
| 资源摘要基线与契约检查同口径迁移（digest、上限、禁止旧 gate 开关） | [check-preset.mjs](../../scripts/check-preset.mjs) |
| 机械检查单测（12 项） | [intent-gate-declaration.spec.ts](../../tests/unit/intent-gate-declaration.spec.ts) |
| 请求作用域与放行契约（11 项，驱动两个官方 seam） | [intent-gate-request-scope.spec.ts](../../tests/integration/intent-gate-request-scope.spec.ts) |
| 旧按工具名拒绝的退役负向对照（5 项） | [gate.spec.ts](../../tests/ptc/gate.spec.ts) |
| 安装完整 preset 的系统 seam 验收入口 | [test-intent-gate-host.mjs](../../scripts/test-intent-gate-host.mjs)（`pnpm test:host-gate`） |

## 前置声明：精确匹配、资源与测时（IG-B-15）

这些数值与规则写在插件头部、preset 行和 `check:preset` 断言里，三处不一致会让 `check:preset` 失败。

- **精确匹配规则**。判定对象是一次尝试的**最终**正文：文本块按首次出现顺序直接拼接（块之间不插入分隔符），取第一行（去掉行尾 CR）；去掉行首 BOM / NBSP / 空格 / 制表符后，必须以 `intent` + 可选空格 + `:` 开头（大小写不敏感），且标记之后的剩余部分 trim 后非空。**不**验证桶词（已退役）、分隔符、依据从句、承诺尾句，也**不**验证语义是否正确；只有 `block-end` 的最终块参与判定，先前的 delta 被最终文本覆盖时不作数。
- **暂存上限**：`maxBufferedChars = 262144`（计 `text-delta`/`reasoning-delta` 文本、`tool-call-delta` 参数、`block-end` 文本或参数中的字符）；`maxBufferMs = 120000`（从开始消费上游流到收到 `finish` 的单调时长）。命中任一上限即按策略失败 `INTENT_DECLARATION_LIMIT` 停止，**不**放行未经检查的正文。
- **生成上限**：本机制不改请求、不改 `maxTokens`、温度或重试策略；provider 生成上限仍由宿主与适配器决定。
- **测时规则**：所有时间戳都取自门外——固定适配器的 chunk 时间戳与 `agent/assistant-stream` 首个 `text-delta` 帧时间。每用例记录首个（受检）尝试的 `requestToFirstProviderChunkMs`、`providerSpanMs`（provider 自身首末块间隔，**不是**用户可见时间）、`providerFinishToFirstPublishedMs`（门在 provider 完成后扣住多久才放行；拒绝时为 0 次发布）、`requestToFirstPublishedMs`（用户看到首字的真实等待）。用例 IG01-02 与 IG01-10 的第二条请求是同一请求的机器续步（不受检），其 `requestToFirstPublishedMs` 与首块时间同量级、`providerFinishToFirstPublishedMs` 为负，正是"暂存延迟"的对照读数。

## 逐条验收判据与证据

| 票据判据 | 结果 | 证据 |
|---|---|---|
| 一条可演示的真实用户输入贯穿官方装配、固定适配器、正式回复与真实工具执行，保留既有 read/edit 与其它运行策略 | PASS | IG01-01 / IG01-02：真实 `followup` 用户消息；`composedPreset = ptc-hashline`；工具面仍含 `read`/`edit`/`run_code`/`subagent`；程序经官方进程 PTC（`ptc.isolation = process`）执行并改文件 |
| persona 用 `Intent:` + 自然语言，不强制六桶；机械检查首行标记与非空正文，兼容大小写/空格；语义质量不由正则保证 | PASS | 宿主读到的 `deployment:persona-prefix`：`hasPhaseZero=true`、`saysNoBuckets=true`、`saysLiteralMarker=true`、`stillDemandsSixBuckets=false`；大小写/空格容差由 IG01-03 与单测覆盖；插件头部与 persona 都写明"机械检查不证明理解" |
| 前列明精确匹配、暂存资源/时间/生成上限与测时规则；不无限缓存，不复制/fork 宿主 | PASS | 上文"前置声明"；`check:preset` 断言 preset 行的两个上限等于模块 `DEFAULT_LIMITS`；IG01-12 用 64 字符上限证明超限即停 |
| 合格纯答案与多工具程序在通过检查前无正文发布、无程序启动；接受后正文/工具参数/usage/replay 保真 | PASS | IG01-01（纯答案：`assistant/message` 文本、`usage`、`replayState` 逐项相等，发布流文本逐字等于正文）；IG01-02（多工具程序：`tool/call` 参数保留、4 次 dispatch、两个文件落地、`replayState.blocks` 保真） |
| 缺标记、空正文、跨块/跨 chunk 首行、临时 delta 与最终文本不一致均有负向对照；不合格旧程序零启动；本票不交付自动修复 | PASS | 缺标记 IG01-05、空正文 IG01-06、最终文本优先 IG01-08、跨块/跨 chunk 拼接 IG01-04（应通过）；拒绝后旧程序零启动 IG01-07；自动修复未实现，IG01-09 显示同一用户请求第二次尝试不再重新受检（本票无修复预算） |
| 用公开流与真实执行入口区分"调用被记录""程序/工具开始执行"与副作用 | PASS | 四个独立观察点分别计数：`agent/assistant-stream` 文本帧（发布）、`tool/call` 会话事件（记录）、`tool/ptc-dispatch-start`（程序开始）、`tools/result` 加被 instrument 的 `fs.writeText`（副作用）。拒绝用例四项全零，接受用例四项齐全 |
| 只作用于候选组合的受管主 agent，不误拦非目标 preset、子代理与辅助调用；新旧规则不叠加，资源基线与契约检查一致迁移 | PASS | 子代理 IG01-10（后台 continuable 子会话无声明仍发布、零 policy 拒绝）；官方 `standard` preset IG01-11（无声明照常发布，随后受管 preset 仍拒绝）；辅助调用 IG01-13（`purpose: compaction` 的直连调用原样返回）；旧按工具名拒绝退役由 `tests/ptc/gate.spec.ts` 5 项负向对照钉住；`check:preset` 的 persona/插件 digest 与上限断言已同步 |
| 在隔离完整宿主的同一系统 seam 上证明本切片；留存命令、退出码、身份与覆盖；不宣称整个新规格通过，不切换日常目标 | PASS（本票范围） | 见下文命令表与"身份"；`findings.boundaries` 与本文范围声明均拒绝扩大结论；未安装、未重启、未切换 profile |

## 执行命令与退出码

| 命令 | 退出码 | 覆盖与备注 |
|---|---|---|
| `pnpm check` | 0 | build + 三包 tsc + `tsc -p tsconfig.tests.json`（含新增 spec 类型检查） |
| `pnpm check:preset` | 0 | 资源 digest、两个暂存上限、禁止旧 `gate` 开关、persona 资产地址 |
| `pnpm test:unit` | 0 | 23 文件 / 309 用例（含新增 intent-gate-declaration 12 项） |
| `pnpm test:integration` | 1 | 44 文件 / 549 用例：546 PASS，3 FAIL 全为本机 git 环境既存问题（见下节），含新增 intent-gate-request-scope 11 项 PASS |
| `pnpm test:ptc` | 0 | 9 文件 / 33 用例（gate.spec.ts 5 项为旧机制退役负向对照） |
| `pnpm test:compat` | 0 | 2 文件 / 21 用例 |
| `pnpm test:profile` | 0 | 真实 CLI 装配 `--dump-config` exit 0；profile 内 gate 资产：无声明被停、有声明原样放行 |
| `pnpm test:delivery` | 1 | PASS 20 / FAIL 1（REG-01）/ BLOCKED 9；唯一失败门禁 = `pnpm test:integration`（同 3 个环境失败）。原始报告与 summary 见"原始证据" |
| `node scripts/test-intent-gate-host.mjs --pack .tmp/intent-gate-host-12` | 0 | 13/13 用例 PASS；`scriptedLlmRequests = 20`、`realModelRequests = 0` |
| `git diff --check` | 0 | 无空白错误 |

上表是**最终 diff** 上的最后一次执行（宿主验收在 `.tmp/intent-gate-host-12` 重跑，13/13 仍 PASS；同一份未变化的最终 diff 复用本轮门禁读数）。此前 `pnpm test:delivery` 轮次的门禁表与上表一致，其原始报告另存于"原始证据"。

### 失败与缺口（按 PASS / FAIL / GAP / BLOCKED 分类）

- **FAIL（既存环境，非本票引入）**：`tests/integration/operations-baseline.spec.ts` 2 项与 `operations-cli.spec.ts` 1 项。根因两条，均与本 diff 无关（本票未触及 `presets/ptc-hashline/operations/`）：
  1. 本 checkout 的 `.git` 属主是 `BUILTIN/Administrators`，而当前用户是 `JOYIN-DEV\lenovo`，git 报 `dubious ownership` 并拒绝执行 → baseline 把 `repository.commit` 记为 `unknown`。复现：`git -C . rev-parse HEAD` → exit 128。
  2. 本机未配置 git 身份（`git config user.email` 为空），测试夹具在临时仓库里 `git commit` 失败：`Author identity unknown ... fatal: unable to auto-detect email address`。
  修复这两条需要改动用户机器的 git 配置或属主，本票未获此类授权，故**如实保留 FAIL 并登记**，不静默跳过、不改写测试断言。
- **GAP（本票未覆盖，属后续票据）**：自动修复与预算（02）、输入例外（03）、澄清等待（04）、中途纠正（05）、恢复/持久化（06）、真实 CLI/浏览器呈现端穿透与完整交付汇总（07）；真实模型是否更少误读/漏问（IGB-AC-12）——固定适配器不能证明。
- **GAP（本票已知边界）**：
  - 真实 `compaction` 请求在本宿主里没有真正发出（固定适配器未声明 context capacity，compaction 引擎自报 `no context capacity for ig-fixed/fixed; continuing the turn`），因此"辅助调用免声明"在宿主上是用**同形直连调用**（`purpose: 'compaction'`）验证的；真实压缩流本身未在本轮跑通。压缩与标题引擎确实会打该标记：`dsh-compaction-basic/lib/index.js:320`、`dsh-session-title-llm/lib/index.js:196`。
  - 全缓冲使首字延迟等于整段生成时间（IG01-01：`providerSpanMs=47`、`requestToFirstPublishedMs=77`）；这是本规格接受的严格展示优先代价，交互成本需在 07 与效果评估中继续度量。
  - 拒绝路径只把 `usage` 保留到 `assistant/attempt` 流中；原 provider 终态与策略判定的分开记账、被拒成本的逐笔对账属 02。
  - 宿主运行日志另见一条与本机制无关的既存噪声：`agent "<id>": agent/disposed listener threw: TypeError: Cannot read properties of undefined (reading 'catch')` —— 本插件只注册 `agent/pre-step` 与 `llm/stream`，不注册 `agent/disposed`；成因属宿主侧 disposer，本轮未定位到具体宿主插件，登记为待查（不影响任何用例判定）。

## 身份

- 安装：`test-intent-gate-host.mjs --pack` 用 `pnpm pack` 打包 4 个交付包并装入一次性 `dsh-profile-acceptance`（`installation.json` 记录 profile 与 notes）。
- 宿主与引擎：`@deepseek-ai/dsh 0.2.1-rc.2`；`@hy-sde-org/dsh-tool-edit` 与 `@hy-sde-org/dsh-hashline` 均 `0.2.1-alpha.4`。
- 资产：安装树内 `presets/ptc-hashline/intent-gate-watchdog.mjs` sha256 `bf057fb1cba3e967daada2cd641376949cf55e438c3eff775c49a3c23bf8d1c2`、`personas/orchestrator.md` sha256 `b697335305e674f7082cf58dcfb9920036ad9f28e8f5fd1d069a736b3ae1f55d`（与仓库工作树一致，证明打包安装带的是本次改动）。
- preset 行实测：`intent-gate-watchdog` → `{ maxBufferedChars: 262144, maxBufferMs: 120000 }`，无 `gate` 开关。

## 原始证据（本地，不随 clone 交付）

| 路径 | 内容 |
|---|---|
| `.scratch/intent-gate/evidence/intent-gate-b-01-host/host-result.json` | 本次 `--pack` 宿主验收的全部用例、逐用例结论、四个观察点计数、测时读数、宿主日志、边界声明 |
| `.scratch/intent-gate/evidence/intent-gate-b-01-host/installation.json` | 一次性 profile 路径与打包/装配 notes |
| `.scratch/intent-gate/evidence/2026-10-27-delivery-run-intent-gate-b-01.md` 与 `.json` | 本轮 `pnpm test:delivery` 生成的报告与机器摘要（仓库内 `docs/acceptance/2026-10-27-delivery-acceptance-report.md` 保留上一轮票据 08 的结果，未被本轮覆盖） |

## 未授权事项（本票未做）

未安装到日常 profile、未重启宿主、未发布、未切换升级目标、未启动真实模型或付费评估。上述任一项仍需用户当次明确同意。
