# PTC Hashline 运维 Skills 开发实施计划

日期：2026-10-23  
版本：r6；状态：需求已收敛至权威规格，本文为从属实施参考，尚未授权开发或真实升级。
范围：两个仓库内维护、仅对 `ptc-hashline` 生效的 skill；问题取证与三方升级检查/评估/经用户同意后执行。

需求、工作流和验收要求以[需求规格](../specs/2026-10-23-ptc-hashline-operations-skills.md)为准。本文保留技术调查、建议方案、实施顺序与验证方法；与规格不一致时先修订本文，不以本文扩展需求。需求定稿不触发开发，实施仍需用户明确指令。

本文已从 `.scratch/ptc-hashline-operations-skills/implementation-plan.md` 迁入版本库，此处为唯一实施计划。

## 1. 使用方式

拆票从需求规格的工作流与验收 ID 出发，使用本文 M0—M5 安排依赖顺序；阶段不是必须一一对应的大票。每张实现票引用对应规格条款/验收 ID，并写明可独立验证的交付结果。布局和技术方案可在规格边界内调整，无须把常规实现选择重新当作产品需求。

依据：[根 AGENTS](../../AGENTS.md)、[权威规格](../spec/2026-10-22-ptc-hashline-requirements-spec.md)、[GLOSSARY](../../GLOSSARY.md)、[ADR-0003](../adr/0003-effective-working-directory.md)/[0004](../adr/0004-mv-create-intent-and-snapshot-order.md)/[0005](../adr/0005-bom-preserving-hashline-read.md)。前一设计 `.scratch/ptc-hashline/2026-10-23-operational-observability-and-upgrade-policy.md` 为本地历史讨论，不是实施必需文件；其已确认要求已纳入正式需求与本计划。需求以权威规格及后续用户指令为准。

## 2. 设计再验证的结果

### 2.1 既有源码调查：实施前复核

| 事实 | 代码证据 | 设计含义 |
|---|---|---|
| 现 preset 已有 scoped skill-filesystem / tool-skill | `presets/ptc-hashline/preset.patch.yml:139`—`:150` | 不需要新建 skill 注册服务或改 DSH |
| provider 注册到调用 context 的层，dispose 时注销并失效缓存 | 宿主 `packages/skill/skill/src/index.ts:379`—`:425` | 专用 provider 只在本 preset 层挂载 |
| filesystem provider 支持 providerName、includeDefaultRoots、customSkillDirs | 宿主 `packages/skill/skill-filesystem/src/index.ts:46`—`:87` | 能保留原通用 provider，另加唯一名称的专用 provider |
| skill loader 以 `scope: exec.agent` 查询；显式用户加载也查 scope | 宿主 `packages/skill/tool-skill/src/index.ts:135`、`:188` | 模型目录与用户加载入口都应验证隔离 |
| bundle 已通过 createRequire(baseUrl) 解析自有资源 | preset persona prefix | skill 路径可以相对安装 bundle 解析，避免个人绝对路径 |
| 根包 files 已包含 presets，exports 有 ./presets/* | 根 package.json | assets 可随包交付，仍须实测 pack 与解析 |

以下为原计划编写时的**静态源码调查**，本次文档收敛没有重新验证宿主源码或安装产物。scope/cache/实际打包仍要通过下面的运行测试证明；不能把“API 支持”当成“新功能已验收”。执行前确认目标安装产物的 API 与这些源码一致。

### 2.2 选定挂载方案

两份 skill 存在 `presets/ptc-hashline/skills/`，不放入项目 `.agents/skills`、`.dsh/skills` 或用户全局扫描目录。

保留现有 `skill-filesystem` 与 `tool-skill` 行；仅在本 preset 的 plugins 中新增第二个官方 filesystem provider：

```yaml
# 示意，customSkillDirs 的绝对路径由 bundle/package.json 所在目录解析。
- id: ptc-hashline-operations-skills
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    providerName: ptc-hashline-operations
    includeDefaultRoots: false
    watch: false
    customSkillDirs: [<installed-bundle>/presets/ptc-hashline/skills]
```

使用现有 `!!js` / baseUrl 资源解析惯例，具体 YAML 形态必须经过真实 loader 验证。唯一 providerName 避免与原 provider 同层重名。私有根只包含这两个目录；watch=false 使已交付版本在挂载期间稳定，修改后重新挂载。

不挂在 profile 顶层、不写用户全局 skills、不创建第三个总控 skill、不引入新的常驻插件。保留原有技能目录与工具能力。

两份 SKILL.md 均设置标准 frontmatter：`disable-model-invocation: true`、`user-invocable: true`。不把它们注入模型自动发现目录，不让模型通过 tools.skill 自行加载。目标 preset 内由真实用户首行 `/ptc-hashline-incident` 或 `/ptc-hashline-upgrade` 触发宿主用户入口；正文加载后执行仍遵守 PTC 的 run_code 约束。普通报错或自然语言任务相似度不构成自动启动条件。

源码验证：宿主 skill-filesystem 的 parseInvocationPolicy 识别上述标准字段；tool-skill 的模型 execute 检查 isModelInvocable，用户 pre-step 入口只识别真实 user source 的显式手势。最终仍须对安装版本实测，不能只测 frontmatter 文本。

### 2.3 模式边界的实现依据

模式资格、调用会话与历史会话区分、子 agent 权限、离线工具边界及失败停止行为，统一见[规格：模式边界与调用资格](../specs/2026-10-23-ptc-hashline-operations-skills.md#模式边界与调用资格)。本节方案只解释实现途径，不构成操作系统级鉴权。

## 3. 仓库布局与职责

建议布局如下；只有实际需要时才拆更多文件：

```text
presets/ptc-hashline/
  skills/
    ptc-hashline-incident/SKILL.md
    ptc-hashline-upgrade/SKILL.md
  operations/
    cli.mjs                     # context / baseline / incident / upgrade-assess 入口
    baseline.mjs                # 实际加载组合采集
    incidents.mjs               # 通用异常汇总与本地问题包
    upgrade.mjs                 # 元数据评估与升级执行的范围校验
    references/                 # 实际复用的 schema、规则、升级契约映射
tests/integration/
  operations-skills.spec.ts
  operations-incidents.spec.ts
  operations-upgrade.spec.ts
tests/ptc/
  operations-skills.spec.ts
```

以上名称可在保持边界前提下合并，不机械创建空文件。两份 SKILL.md 只放触发条件、操作顺序、判断和停止条件；大矩阵与模板按需引用。参考路径以各 skill 资源根解析，不假定会话 cwd 是本仓库。

工具/API 参数、命令从实际 manifest 与 SDK 读取。通过 `run_code` 调用 skill/shell 等 tools；普通问题取证不调用 edit 改工作文件。依赖升级由包管理工具执行，不能用 hashline 手改 lockfile。

公共代码复用现有解码/配对组件，避免把旧提取器强改成多职责单文件。若共享代码迁移，旧 CLI 参数、退出码与既有输出版本兼容需回归；打包后的 operations 不能依赖被 files 排除的根 scripts 或 `.scratch` 历史文件。

## 4. Incident 实施入口

行为及输出见[规格：Incident 工作流](../specs/2026-10-23-ptc-hashline-operations-skills.md#incident-工作流)。实现重点是复用现有解码/配对能力，将上下文核验、基线采集、异常分类和问题包输出接成短链路；对应 M2 及 INC/CONFIG 验收项。不得将旧提取器已有的 Intent 取证范围误当作完整 incident 能力。

## 5. Upgrade 实施入口

检查、提案、用户同意、候选验证、目标切换和回退行为见[规格：Upgrade 工作流](../specs/2026-10-23-ptc-hashline-operations-skills.md#upgrade-工作流)。按 M3/M4 分阶段实现；先验证检查与无副作用的拒绝路径，再接固定候选和一次性目标。方案记录与执行入口共享规格规定的版本、基线和目标绑定契约。

## 6. 实施阶段与完成标准

### M0：冻结输入和登记设计增量

- 记录实施时的 HEAD、暂存/未暂存/未跟踪变更摘要，保护当时实际存在的用户改动；不把计划编写期间的工作树快照当成永久状态。
- 把本次新增 scoped provider 作为既有 preset delta 的明确扩展，更新规格/ADR 或相应契约说明与检查白名单；不默默放宽全部 preset 校验。
- 不改 persona/watchdog 正文和摘要。新增 skill 资源摘要如需校验，使用独立清单，不重写 gate 基线。

完成：变更范围明确，输入受保护，现有历史门禁未被改写。

### M1：只实现 scoped 发现与交付

创建两个简短 SKILL.md 和专用 provider 行，验证资源路径来自已安装 bundle；不增加新运行服务。

完成：本模式用户入口可发现并显式加载；模型自动目录不含两份 skill，模型 tools.skill 加载被拒绝；其它模式同 cwd 下用户入口亦不可加载；scope dispose/重新挂载不泄漏或重复注册，原有 skills 正常。

### M2：共享 baseline/context 与 incident MVP

实现范围核验、基线采集与离线问题包，复用旧工具逻辑并保持其兼容性。未完成升级执行时，upgrade 入口明确只支持检查，不虚假承诺执行能力。

完成：内层失败、成功结果主动报错、预期拒绝、残缺日志与非目标模式均有回归；默认不采集正文和秘密。

### M3：upgrade 检查、方案与用户同意流程

实现元数据适配、影响评估输入、补丁台账与 proposal/consent 记录。网络以固定来源 fixture 测试，不让测试依赖当天最新版本。

完成：无关更新能给暂缓；推荐能产生具体方案与询问；拒绝/未回复不产生任何升级副作用；陈旧/变更 proposal 不复用批准。

### M4：获同意后的候选验证与目标同步

按 D16，使用固定候选与一次性 profile/安装树验证推荐、同意、拒绝、切换及回退；测试中的用户同意是显式夹具，不能外推为真实升级授权。不为验收更新日常版本；真实上游升级另行由用户主动发起并确认。

完成：候选失败不触碰目标；仅候选同意不执行目标切换；批准的准确目标与版本可复现应用，回退可验证。

### M5：真实安装与回归

验证 package files/exports、临时安装、非仓库 cwd 的技能资源读取、真实用户显式调用后的 PTC 执行与模式隔离。更新 README/AGENTS 的最小入口说明，复用单一规则资料；不将 skill 文本全部加入常驻 persona。

完成：所有必要测试通过，有一个目标模式与一个非目标模式的实际装配证据，附报告与未覆盖范围。

## 7. 验收追溯与测试设计

完整场景和判定统一维护在[规格：验收要求](../specs/2026-10-23-ptc-hashline-operations-skills.md#验收要求)，沿用 SCOPE/PACK/INC/CONFIG/UPG/REG ID；拆票和交付报告引用这些 ID，不另建第二份判定矩阵。

scope/provider 用宿主真实 registry 测试；最终模式隔离使用真实 preset loader 装配。若现依赖不含 loader，实施前选择最小测试依赖或临时 profile 方案，不将平铺 fixture 冒充最终验收。网络元数据使用固定来源 fixture，执行/回退使用固定候选与一次性 profile；这些方案服务于规格验收，不代表真实升级授权。

## 8. 门禁、风险与交付报告

先跑新增定向测试与类型检查；preset、打包及依赖发生变更后运行 build、check、unit、integration、PTC、compat、check:preset、test:profile，再跑 PACK/SCOPE 实际装配。逐条记录退出码、用例名、计数和 skipped，不反复无理由重跑。

主要风险与处置：

- scoped provider 路径正确但打包漏资源：干净 pack/install 且脱离源码路径验证。
- 同名 skill 被外部 project/global 自行复制：本 bundle 不向这些根安装；测试确认本 bundle 无泄漏，不承诺控制用户额外安装。
- 上游日志或 skill API 漂移：版本化解析与能力检查，不静默退化为全局技能。
- 用户批准范围误判：精确 proposal/hash/目标绑定，用户回复来源可核查，变化重新询问。
- 记录含秘密或 `.scratch` 丢失：最小导出、脱敏验证、重要问题明确归档。

交付报告存本功能的新证据目录，分别报告：技能隔离、incident 可观察性、upgrade 评估、同意流程、执行/回退、既有功能回归。报告应明确本轮是否仅验证了模拟候选，不能写成已经升级真实上游或日常 profile。

回退仅撤除新增 provider 行及本功能资产/脚本/文档增量，恢复匹配的契约检查；保留用户问题包与历史证据，不回退已有 BOM/MV/CAS 修复。

## 9. 开发入口

收到明确开发指令后，先读 AGENTS、权威需求规格和相关 ADR，再按本文技术参考与 tickets 实施。当前只有文档收敛授权；不创建功能资产、不执行依赖升级或 profile 切换。
