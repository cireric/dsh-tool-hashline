# 默认编辑策略：路径与 read 指引修复验收 fix-01

- 日期：2026-10-25，约 09:30–09:37（Asia/Shanghai）。
- 基线：`cc9dca2` 加本轮未提交修复；pnpm **11.28.5**，Node `v24.19.0`，Windows x64。
- 输入：[local-01 的 F-01/F-02](2026-10-25-default-edit-policy-effectiveness-local-01.md)；用户明确要求修复并兼容 Windows/macOS/Linux。
- 结论：**两项已确认问题在 Windows 的工程回归及打包安装探针通过；macOS/Linux 已增加 CI 执行入口，尚未实机执行。**
- [机器可读摘要](2026-10-25-default-edit-policy-fix-01-summary.json)保存受测源码/补丁 SHA-256、完整门禁退出码及范围限制。没有把矩阵配置当作已执行的跨平台 PASS。

## 1. 修复内容

### F-01：原生路径先于 URL 协议识别

[精确 tool-edit 补丁](../../patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch)使用 Node `isAbsolute(address)` 先判断本机原生绝对路径，再判断 URL scheme。文件路径交给 `pathToFileURL` 转换，已经是 `file:` URL 的地址保持不变。

Windows 盘符路径和 UNC 不再被当作 URL 协议；macOS/Linux 的 POSIX 绝对路径、普通相对路径继续由 Node 的本机路径语义处理。没有手工替换斜杠或手写 URL 转义，也没有放宽模块缺失的 fail-closed 行为。

补丁由 pnpm 真实安装应用，lockfile 由 pnpm 重新生成；版本仍为 tool-edit `0.2.1-alpha.4`，其 `patch_hash` 更新为：

`22be5b94b4f3ae03b6f0b056b4f8ee2f203ac52bb187ad8e8818dc8292797fba`

原工作树和运行宿主的 node_modules 均未热改。后续把修复应用到某个日常 profile 仍是独立目标切换。

### F-02：目标 preset 显式启用受控 read 指引

[read 配置](../../packages/tool-read/src/config.ts)新增 `defaultEditPolicyGuidance`，默认 false；[目标 preset](../../presets/ptc-hashline/preset.patch.yml)显式开启，[preset 检查器](../../scripts/check-preset.mjs)验证该项。

[nextAction](../../packages/tool-read/src/next-action.ts)按该配置返回指引：

- 无 Session：停止，先建立编辑会话并重新 read；缺上下文不提供降级资格。
- 快照门槛：引用真实 read，取得获准的完整原文、唯一定位及所需保真后，才可声明 `snapshot-limit`；缺依据停止。
- 长行或零完整行字节窗口：可分页补足先补读；不可分页补足的目标范围，仍需获准渠道的完整原文及保真依据才能声明 `window-limit`。不建议擅自改配置、重挂载或重复无效窗口。
- 未配置的其他 read 挂载：恢复开发前的原指引，不混入本策略的 fallback/readCallId 文案。

read 输入、canonical value、输出 schema、窗口/tag/seen 规则未变。策略指引配置仅改变 nextAction 文案，渲染继续消费同一个 canonical value。

## 2. 新回归与跨平台执行入口

| 测试入口 | 真实验证内容 |
|---|---|
| [模块地址集成测试](../../tests/integration/default-edit-policy-module-address.spec.ts) | 在当前 OS 创建真实文件；原生绝对路径、同卷相对路径和 file URL；文件名含空格、中文、`#`、`%`；真实 edit 返回默认策略拒绝而非模块不可用；缺失模块仍拒绝；磁盘及本次 writer 记录 |
| [read 指引集成测试](../../packages/tool-read/tests/integration/policy-guidance.spec.ts) | 目标/非目标配置分别验证无 Session、snapshot、列限、零窗口；canonical 与渲染一致；保留 tag/window 与 value 字段 |
| [单元测试](../../packages/tool-read/tests/unit/next-action.spec.ts)、[配置测试](../../packages/tool-read/tests/unit/config.spec.ts) | 默认关闭、显式开启及 managed read 引用契约；现有 legacy 文案边界 |
| [三平台 CI](../../.github/workflows/policy-contract.yml) | Windows/macOS/Linux、Node 24、pnpm 11.28.5；冻结安装、check、unit、默认策略 integration/read 指引/PTC |

各 CI OS 会使用自身真实路径调用实际编辑器，并非在 Windows 伪造一条 POSIX 字符串来冒充 Linux 测试。CI 文件仅在本地新增，未推送、未触发，macOS/Linux 的实机结果均为 **GAP**。

未执行网络共享上的 UNC、非 Local provider 或其他 Node 版本专项验收，不新增这些环境的通过声明。

## 3. 实际执行结果

原始证据根：`.scratch/hashline-default-editing/effectiveness/20261025-fix-01/`，被忽略、不随 clone 交付。

| 执行 | 结果 | 证据 |
|---|---|---|
| 新回归在修复前运行 | **FAIL：8 failed / 5 passed** | `logs/red-regressions.log` |
| 修复后冻结安装 | **PASS：exit 0**；独立 tree/store，正式 patch 应用 | `logs/clean-install-2.log` |
| `pnpm check` | **PASS：exit 0** | `logs/check.log` |
| 新回归在修复后运行 | **PASS：13 passed** | `logs/green-regressions.log` |
| `pnpm test:delivery --keep --out .scratch/delivery-fix-01` | **exit 0：21 PASS / 0 FAIL / 0 GAP / 9 BLOCKED**；本轮没有使用 `--no-gates` | `logs/delivery-full.log` 及副本 `.scratch/delivery-fix-01/` |
| 实际安装产物三臂探针 | **PASS**：原生路径与 file URL 都返回 `EDIT_POLICY_FALLBACK_REQUIRED`，Hashline 修改正确；未挂策略对照可正常 replace | `packed-probe-result.json` |
| 安装产物 read 长行指引 | **PASS**：使用安装 preset 的真实 read 配置，无调大配置/重挂载建议；关闭策略指引的对照仍有 legacy 文案 | `packed-probe-result.json` |

首轮补丁封装安装曾因 CRLF 下 hunk 计数未重算而失败（`logs/clean-install.log`）。修正 diff hunk 格式后重新生成 lockfile，并实际安装通过；不将首次失败隐藏为从未发生，也没有通过直接改 node_modules 绕过补丁交付。

完整 delivery 内部实际执行的所有门禁如下，均为 **exit 0**：

| 构建/检查 | 回归/装配 |
|---|---|
| `pnpm build` | `pnpm test:unit` |
| `pnpm -r check` | `pnpm test:integration` |
| `pnpm check:tests` | `pnpm test:ptc` |
| `pnpm check:preset` | `pnpm test:compat` |
| — | `pnpm test:profile` |

这些退出码来自 delivery 的真实 `gates` 清单，已复制进机器摘要；内部 gate 输出未保存为逐套件完整日志，因此不编造各全量套件的测试计数。套件自身的 skipped 不能因此推导为已执行 PASS。

9 个 BLOCKED 是运维驱动未覆盖的验收 ID：INC-02/03/04、UPG-02/05/08/09/10/11；它们不由本轮的 21 个 PASS 覆盖。该驱动的注入候选 runner、一次性 profile、未做人工运维冒烟等原有边界全部保留。

## 4. 安装及输入一致性

本轮先在隔离副本重现，再更新精确 patch 和 lockfile，用独立 store 冻结安装，最后打包四包并安装到一次性 DSH_HOME。read/edit 的实际物理 hashline 入口一致，记录为 `samePhysicalEngine: true`。

摘要中的 14 个产品/测试/CI 输入均核对为与受测副本字节一致。后补的 README、兼容维护说明和验收文档未改运行代码，不重复执行无关门禁。原工作树源码保留修复，但其 node_modules/dist 未刷新；日常宿主不因此自动升级。

安装探针读取安装 preset 的实际模块表达式和 read 配置，再挂 scoped read/edit 子集。本轮已证明 F-01/F-02 在真实安装包的对应路径通过；**不是完整 preset、实际 PTC 后端、真实子代理或真实模型的完整验收。**

## 5. 五轴自审与后续

按 code-review-and-quality 自审产品修复及回归：路径交由 Node 处理；模块缺失继续 fail closed；无新运行依赖、无额外策略文件 I/O；目标配置默认关闭并由 preset 开启；测试走真实 ToolRuntime、Local filesystem 和 canonical 渲染。未发现本轮修复的阻塞项；这是自审，不标为独立审查。

F-01/F-02 的 **Windows 修复已验证**。仍需三平台 CI 实际运行、完整目标 preset/真实委派/实际后端验收，最后才是用户 DSH 模型行为样本与既有冻结收益评测。未调用真实模型、未发布、未重启、未切换日常 profile。
