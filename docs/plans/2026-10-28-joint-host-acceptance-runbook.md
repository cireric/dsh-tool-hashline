# 联合宿主与交付门禁：历史运行手册（执行前须对齐契约）

> 文档状态（2026-10-28）：原 P5/T3 手册保留装配与取证命令；格式拒绝、声明修复、展示前校验等旧预期已被取代。执行前按联合入口复核用例；本文不是最新门禁结果，也不再将所有剩余事项归因于环境。 现行范围和公共工作顺序见[联合工作入口](2026-10-28-intent-gate-repair-implementation-plan.md)，最新执行状态见[状态索引](../acceptance/2026-10-23-current-status-and-evidence-index.md)。

<details>
<summary>展开原方案与操作步骤（按当时时点阅读）</summary>

日期：2026-10-28
依据：[意图门修复计划](2026-10-28-intent-gate-repair-implementation-plan.md) P5、[工具路径修复计划](2026-10-28-ptc-hashline-tool-routing-repair-plan.md) T3、[联合工程验收](../acceptance/README.md#历史原件 "归档原件：docs/acceptance/2026-10-28-joint-repair-engineering.md")（当前 PASS/GAP/BLOCKED 状态）、[当前状态索引](../acceptance/2026-10-23-current-status-and-evidence-index.md)。

## 1. 为什么需要这份手册

联合修复目前唯一挡住「工程完成」的就是 P5/T3：完整 preset、隔离打包安装、真实 launcher/registry/loader、真实 CLI/Web 呈现端与交付门禁。本文环境做不到——沙箱拒绝一切嵌套进程（`spawnSync … EPERM`）与文件安全调用（`edit` 写路径 `SetFileSecurityW EACCES`），`vitest`、`pnpm build`、`pnpm pack`、`test:host-gate`、`test:delivery` 全都起不来（证据见验收报告 §8）。

## 2. 前置条件（缺一项就跑不全，如实记 BLOCKED）

- Node `^22.19.0 || >=24.0.0`、pnpm 11.x，且**允许子进程**（vitest/esbuild、pnpm、真实 launcher 都要）。
- 可写的临时目录：`TEST:host-gate`/`test:delivery` 会在其中 `pnpm pack` 四个交付包并装进一次性 `DSH_HOME`。
- 一个**不是日常 profile** 的目标：本手册只用 `--pack` 造出的一次性安装，禁止指向日常宿主。
- `test:profile` 需要可用的 DSH CLI（`DSH_CLI` 指向它）。
- **不**需要真实模型：所有门禁都用固定适配器。真实模型属于 P6/T4，另需授权（见[联合清单](2026-10-28-joint-real-model-evaluation-manifest.md)）。

## 3. 命令与证据落点（按顺序跑，逐条记退出码）

| # | 命令 | 覆盖 | 证据落点 |
|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | 依赖身份 | 终端输出 + `pnpm-lock.yaml` 摘要 |
| 2 | `pnpm check` | 构建 + 三包 `tsc` + 测试类型检查 | 退出码 |
| 3 | `pnpm test:unit` | 意图门机械检查、问题身份/等待、P4 账本、T2 判读 | 套件计数 |
| 4 | `pnpm test:integration` | 请求级作用域、等待与答案关联、P4 上限与取消、persona 契约、T2 artifact、提取器接线 | 套件计数（注意：`extract-runtime-evidence.spec.ts` 与 operations 相关用例需要子进程；若仍失败，先判环境再判代码） |
| 5 | `pnpm test:ptc` | PTC 内层派发、read→edit、策略 | 套件计数 |
| 6 | `pnpm test:compat` | 上游兼容与 MV/快照次序 | 套件计数 |
| 7 | `pnpm check:preset` | preset 形状、行内上限、**两个资产摘要** | 退出码（资产摘要漂移即失败，属预期保护） |
| 8 | `pnpm test:profile` | 安装 profile 组合与资源解析 | 退出码 + 解析路径 |
| 9 | `pnpm test:host-gate --pack .scratch/<新目录 A>` | 整宿主：声明、声明专用修复与同请求续步、输入例外、**澄清等待与答案关联**、中途纠正、日志推导恢复、P4 取消、交叉场景 | `<A>/host-result.json` 与逐例记录；跑完先用 `node scripts/host-gate-evidence.mjs --evidence <A>/host-result.json --require <本轮必需的 case id>` 预检（0 = 通过，2 = 不通过，逐条列出原因） |
| 10 | `pnpm test:surface-gate --pack .scratch/<新目录 B>` | 客户端呈现边界（`agent/assistant-stream` 帧）；校验前零可见正文 | `<B>/surface-result.json`；跑完用 `node scripts/host-gate-evidence.mjs --kind surface --evidence <B>/surface-result.json` 预检（0 = 帧层通过且列出 `browser-not-verified` 这个 GAP，2 = 不通过） |
| 11 | `pnpm test:delivery` | 真实打包安装、真实 launcher 装配、交付门禁 | `docs/acceptance/<日期>-delivery-acceptance-report.md` + summary.json |

**每个 `--pack` 目录必须新建**：同日已有报告不覆盖；两个 gate 用两个不同目录。

跑完之后用**候选表**把四份产物合成一个判定（这是唯一允许你写「候选 X 通过」的地方）：

```powershell
node scripts/candidate-evidence.mjs \
  --installation <A>/installation.json \
  --host       <A>/host-result.json \
  --surface    <B>/surface-result.json \
  --delivery   docs/acceptance/<日期>-delivery-acceptance-summary.json \
  --out        <本轮证据根>/candidate-evidence.txt
```

退出码：`0` PASS、`2` GAP/BLOCKED、`3` FAIL、`1` 输入不可用。规则：host 与 surface 记录的两个资产摘要不一致 → **FAIL**（说明它们不是同一条候选）；缺任一 gate 产物 → **BLOCKED**；delivery 里有 GAP/BLOCKED id → **GAP**；全部成立才是 **PASS**。

## 4. 逐条验收映射（哪些 ID 必须由哪一步证明）

### 4.1 意图门（P5 → FIX 系列）

| ID | 期望 | 由哪一步证明 |
|---|---|---|
| FIX-01/02 | 支付案例：歧义问清 / 明确与双路径直接交付 | 9（固定适配器只能证明流程，语义属 P6；此处只证明「澄清路径可走通、不显示错误」） |
| FIX-04 | 问题专用 `run_code` 提出，同程序无相关副作用 | 9（`tool/ptc-dispatch` 配对 + 磁盘 marker） |
| FIX-05 | 裸「继续」/「收到」/沉默不解锁，即使后续 Intent 合格 | 9 |
| FIX-06 | 匹配选择/自由补充/取消按真实语义处理；错 ID/陈旧结果不解锁 | 9（宿主问题面板入口） |
| FIX-07 | 同会话独立请求不被锁，原问题仍在；多会话不串 | 9 |
| FIX-08 | 首次格式失配期间无用户可见 Failed，旧正文/调用零执行 | 10（控制器帧）+ 9（副作用）。**P3 未实现前此项应记 FAIL/GAP，不得记 PASS** |
| FIX-09 | 无工具声明通过后，未解歧义进入澄清而非执行 | 9 |
| FIX-10 | 修复耗尽一次协议暂停，无第三次生成 | 9 |
| FIX-11 | 取消/网络/截断保持语义，取消后零新派发 | 9 |
| FIX-12 | 四个断点保留问题/预算/最新约束，不重复声明或执行 | 9（真实 resume + 压缩）。目前只有 seam 级证据，这里要复核 |
| FIX-13 | 正文/参数/usage/replay 保真，被拒成本不丢 | 9 + 11（`accounting` 块可与日志对账） |
| FIX-14 | 非目标 preset/子代理/标题压缩不受门影响，正常首答不多一次往返 | 9 |
| FIX-15 | 合格 Intent 但漏问明确判语义 FAIL | P6（冻结判读表），不在本手册范围 |

### 4.2 工具路径（T3 → TOOL 系列）

| ID | 期望 | 由哪一步证明 |
|---|---|---|
| TOOL-01 | 实际请求含 read/edit SDK，隔离安装可成功执行 | 9（请求声明 + 一次真实 edit） |
| TOOL-02 | 文本读取与适用更新进入受管工具，canonical 值正确消费 | 9 + 5（ptc 套件） |
| TOOL-03 | 搜索/创建/shell/专用任务选择适当 | 9 |
| TOOL-04 | 先工具后旁路、失败后旁路也判不合格 | 9 的负向例 + `scripts/tool-usage-judgement.mjs` 复核同一批日志 |
| TOOL-05 | 非文件任务不因零 read/edit 误判；unknown 不算零旁路 | 9 + 判读工具（`no-file-work` / `unknown`） |
| TOOL-06 | 声明恢复与澄清等待不允许旧程序或提前业务动作 | 9（与 FIX-04/05/08/09 同轨迹互证） |
| TOOL-07 | cwd、引擎身份、默认编辑策略、BOM/MV 不退化 | 2/4/5/6/11 |
| TOOL-08 | 真实模型采用与正确性 | P6/T4（不在此手册） |

## 5. 跑完怎么写结果

1. 新开 `docs/acceptance/<日期>-joint-host-acceptance.md`（不与本手册、不与同日其他报告合并），逐条写：命令、退出码、覆盖、证据路径、结论（PASS/FAIL/GAP/BLOCKED）与剩余缺口。
2. **同一份未变化的最终 Diff 可以共用一组门禁证据**；只要随后改了代码/规格/persona/preset，必须补跑受影响部分。
3. 任何一项没跑或环境不足：写 BLOCKED 并给命令与错误原文，不用相邻层 PASS 代替。
4. 绝不要为了通过而临时摘掉 preset 行、改固定适配器输出或跳过 `check:preset` 的摘要校验。
5. 交付类变更（`test:delivery`）若通过，也只证明装配与门禁，不代表真实模型效果，也不构成安装/切换授权。

## 6. 已知会挡住或需要判断的点

| 点 | 说明 |
|---|---|
| `test:integration` 里的 `extract-runtime-evidence.spec.ts` | 该套件用子进程跑 CLI；在没有子进程权限的环境会整体失败（本机实测 18 条），那是环境不是代码 |
| 呈现端 vs 浏览器 | `--kind surface` 预检只证明**控制器帧**（浏览器会收到的字节），不证明页面真的渲染成那样；artifact 里 `browserScreenshot: false` 时预检固定记一条 `browser-not-verified` GAP。要消掉它只能在真实浏览器里穿透。 |
| `docs/acceptance` 当日文件 | `test:delivery` 会写当天的报告；如当日已有报告，先改日期目录/文件名，避免覆盖 |
| 套件分诊 | 在本机把 spec 跑在纯 node runner 上时，用 `node scripts/suite-triage.mjs --from <triage.log> --out <dir>` 把「跑绿 / runner 缺特性 / 沙箱拒绝 / 子进程无输出」分开，避免把环境限制读成产品失败；换到有权限宿主后，真实数字必须由 `pnpm test:unit`/`test:integration` 重新取证 |
| P3（请求层「恢复中」） | 未实现，FIX-08 / IGB-AC-18 在整宿主上仍是 FAIL/GAP，直到用户选定[选项包](2026-10-28-intent-gate-ux-recovery-options.md)中的一条路线（Client 面插件 / 改写 IG-B-05、IG-B-20 / 上游 seam） |
| 真实模型 | 一律不属于本手册；需要[联合清单](2026-10-28-joint-real-model-evaluation-manifest.md)第 2 节的参数与预算授权 |

</details>
