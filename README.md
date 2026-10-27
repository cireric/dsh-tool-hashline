# dsh-tool-hashline

为 stock DSH 提供 **PTC Hashline Mode**（`ptc-hashline`）：模型通过 `run_code` 编排工具，自建 `read` 返回内容 tag，上游 `edit` 使用该 tag 编辑文件，并保留每回合 Intent 门。

验证基线为 DSH `0.2.1-rc.2`、hashline/tool-edit `0.2.1-alpha.4` 加本地补丁。项目仍为 private bundle；已验证能力与范围见[当前验收状态](docs/acceptance/2026-10-23-current-status-and-evidence-index.md)。

**项目状态（2026-10-26）：本轮评测收尾，转为按需维护。** 按用户确认的[阶段决策](docs/acceptance/2026-10-26-evaluation-stage-decision.md)，接受完整 S0 的 FAIL 并保留 GAP，停止扩样；S1/S2 延期未执行。日常推荐 PTC、Hashline 手动可选，默认推广暂停，日常 profile 未改。评测基础设施保留可复用；[恢复计划](docs/plans/2026-10-26-evaluation-finalization-plan.md)与历史证据保留。

## 项目组成

- `packages/tool-read`：自有普通文本 read，向 PTC 的 canonical value 返回 tag、窗口与后续操作指引。
- `packages/hashline`、`packages/tool-edit`：上游引擎和编辑工具的精确版本锚点；兼容修复通过 `patches/` 与 pnpm 补丁配置交付。
- `presets/ptc-hashline`：独立 persona、Intent watchdog、默认编辑策略，以及 `/ptc-hashline-incident`、`/ptc-hashline-upgrade` 两份运维 skill。skill 仅供本 preset 的真实用户显式调用，模型目录不包含且模型加载被拒。
- `tests/`、`scripts/`：契约回归、安装验证与隔离打包宿主验收。自有 read 的附属测试位于包内。

选用本 preset 时，其内部默认编辑策略要求适用的既有文本更新优先使用 Hashline，受控替代更新需提供依据。运维 skill 的实现和候选验证不代表获准升级；目标切换仍需用户当次明确同意。

## 安装使用

准备符合 [package.json](package.json) 要求的 Node/pnpm、已构建的 DSH 源码目录，以及一个已初始化的测试 profile。以下路径和 profile 名称替换为实际值：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm install:profile --profile "hashline-test" --dsh-checkout "D:/path/to/deepseek-harness" --dry-run
pnpm install:profile --profile "hashline-test" --dsh-checkout "D:/path/to/deepseek-harness"
```

依赖使用 pnpm 的默认盘级 store，仓库不声明 `store-dir`、也不在 checkout 内建 store。默认 store 与仓库不在同一卷时（例如 store 在 `C:`、仓库在 `D:`），硬链接无法跨卷，pnpm 改用 `<盘符>:\.pnpm-store` 并打印 `... cannot be hard linked ... Using the store at ...` 的 WARN；那是同卷回退，不是安装失败。`nodeLinker: hoisted` 由 `pnpm-workspace.yaml` 提供，不依赖 `.npmrc`。

安装脚本将本 checkout 的 bundle 与三个包链接到指定 profile，并验证组合和资源解析。安装后手动重新启动该测试宿主，在新会话选择 **PTC Hashline Mode**。

这是开发链接安装：构建和依赖变更会影响使用该 checkout 的宿主，更新前应安排停止使用的窗口。

## 使用边界

- `read` 与 `edit` 使用会话有效工作目录；相对 `MV DEST` 也以该目录为基准，不以源文件父目录为基准。
- MV 不覆盖已有目标，但移动和多节编辑可能部分完成；失败后先核验实际状态，不能假设自动回滚。
- BOM 保真已验证范围为 Local provider 的 hashline 路径、零或单个 BOM；其它模式与后端不沿用该保证。
- `read` 会读取全文，4 MiB 是生成 tag 的默认门槛，不是内存上限；截断或无 tag 时按 `nextAction` 处理。
- seen 是有限守卫，与宿主 observed 策略不同，不是权限边界。
- 当前不提供语法块定位：`PUT N*:` / `CUT N*` 不可用，使用显式范围 `PUT N.=M:` / `CUT N.=M`。块后形式可能降为普通行后操作，不代表具备块定位能力；检查编辑结果中的警告。

## 开发验证

```powershell
pnpm check
pnpm test:unit
pnpm test:integration
pnpm test:ptc
pnpm test:compat
pnpm check:preset
pnpm test:profile
pnpm test:delivery
pnpm sync:check
```

完整默认策略宿主验收另有 `pnpm test:host-policy --pack .scratch/<本轮唯一目录>`：先在独立验证副本运行 `pnpm check` 构建，再由此命令打包安装、通过真实 registry 挂完整 preset，并用固定适配器驱动真实 Agent、子代理和官方进程 PTC。它不调用真实模型，不证明模型纪律或收益；默认保留临时安装和逐条证据。也可传入 `test:delivery --keep` 留下的一次性 `dsh-profile-acceptance` 路径与新留证目录。不要在运行宿主链接的源码树里构建。

`check` 包含构建和类型检查；`test:profile` 需要可用的 DSH CLI（可设置 `DSH_CLI`）。`test:delivery` 是真实宿主交付验收：它会 `pnpm pack` 四个交付包、装进一次性 DSH_HOME、用真实 launcher 装配 profile、跑门禁并把逐条证据写进 `docs/acceptance/<日期>-delivery-acceptance-report.md`（耗时数分钟；`--no-gates` 只跑装配与工作流）。外部夹具与各套件范围见 [integration](tests/integration/README.md)、[compat](tests/compat/README.md)；本地原始日志不随 clone 交付。

**上游同步检查（手动、只读）**：`pnpm sync:check` 读取本机指定 DSH 源码目录，记录来源身份与本项目基线，比较 PTC 预设的工具组成、配置、提示与相关契约，对照上游普通文本 stock read 的参数、返回值、截断、大文件与错误处理，并评估 hashline / tool-edit 的**已发布候选**与本地补丁影响，写出 `<evidenceDirectory>/sync/<checkId>/{report.md,sync.json}`；`--checkout <绝对路径>` 指定本次来源，`--set-checkout <绝对路径>` 保存本机来源，`--sources <文件|JSON>` 固定本轮发布来源响应（外部来源边界，复现与测试用），`--decisions <文件>` 指定审阅决定记录（默认 `<证据目录>/sync/decisions.json`）。来源优先级为 `--checkout` > `DSH_CHECKOUT` > 本机配置（`config --set-dsh-checkout`），三者都没有时报告缺少配置、既不扫描磁盘也不回退；命名了但不可用的目录会记 GAP 并继续跑不需要源码树的引擎比较。差异逐对象记录（含稳定标识、两端内容身份、影响、处置、依据与复查条件）；上限等数值按值比较，写法差异不算差异；已发布版本**全量枚举**后按语义版本分稳定 / 预发布两渠道，不取 `latest` 充当答案，无标签的已发布版本也算候选；候选包文本不在只读查询范围内，补丁与组合影响只到「待验证」，不安装、不改锁定、不切换目标；查询失败或超时记 BLOCKED 而不是「没有更新」，也不复用上一轮结果。**重复运行**会读上一轮记录与决定记录做跨轮比较，区分首次检查 / 无新增变化 / 已知差异 / 新增变化 / 旧决定需复查：决定绑定它审阅过的两端内容身份，任一端变化或该端本轮没取得内容即回到复查，通配写法与重复 id 会被拒绝，历史缺失、读不出与格式不支持分别报告而不是伪装成「没有变化」；模板见 [decisions.template.json](presets/ptc-hashline/operations/decisions.template.json)。配置模板见 [config.template.json](presets/ptc-hashline/operations/config.template.json)；覆盖范围、退出码与已知缺口见[票据 01](docs/acceptance/2026-10-27-upstream-sync-check-01.md)、[票据 02](docs/acceptance/2026-10-27-upstream-sync-check-02.md)、[票据 03](docs/acceptance/2026-10-27-upstream-sync-check-03.md)、[票据 04](docs/acceptance/2026-10-27-upstream-sync-check-04.md)与[票据 05](docs/acceptance/2026-10-27-upstream-sync-check-05.md)；最终真实来源验收与交接见[票据 06](docs/acceptance/2026-10-27-upstream-sync-check-06.md)。

## 文档入口

真实模型评测的无凭据验证、三臂隔离宿主冒烟、冻结协议及后续付费实验命令见 [evaluation README](scripts/evaluation/README.md)。运行驱动默认只做 preflight；完整真实 S0 第二轮已执行但未通过，正式对照尚未执行；缺失成本记 unknown，基础设施通过不代表收益或推广通过。

运行目标包含 Windows、macOS 和 Linux；[CI 矩阵](.github/workflows/policy-contract.yml)使用各系统原生路径与 `file:` URL 回归。已执行平台和未覆盖范围以验收索引为准。read 的 `defaultEditPolicyGuidance` 默认关闭，仅本 preset 开启。

- [文档导航](docs/README.md)：按主题关联规格、ADR、计划与各轮验收。
- [当前验收与证据索引](docs/acceptance/2026-10-23-current-status-and-evidence-index.md)：当前结论、历史失败与修复关系、剩余缺口。
- [基础规格](docs/specs/2026-10-22-ptc-hashline-requirements-spec.md)、[术语](GLOSSARY.md)、[架构决策](docs/adr/)：功能契约与设计依据。

参与开发前阅读 [AGENTS.md](AGENTS.md)。
