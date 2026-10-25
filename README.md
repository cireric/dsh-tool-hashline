# dsh-tool-hashline

为 stock DSH 提供 **PTC Hashline Mode**（`ptc-hashline`）：模型通过 `run_code` 编排工具，自建 `read` 返回内容 tag，上游 `edit` 使用该 tag 编辑文件，并保留每回合 Intent 门。

验证基线为 DSH `0.2.1-rc.2`、hashline/tool-edit `0.2.1-alpha.4` 加本地补丁。项目仍为 private bundle；已验证能力与范围见[当前验收状态](docs/acceptance/2026-10-23-current-status-and-evidence-index.md)。

## 安装使用

准备符合 [package.json](package.json) 要求的 Node/pnpm、已构建的 DSH 源码目录，以及一个已初始化的测试 profile。以下路径和 profile 名称替换为实际值：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm install:profile --profile "hashline-test" --dsh-checkout "D:/path/to/deepseek-harness" --dry-run
pnpm install:profile --profile "hashline-test" --dsh-checkout "D:/path/to/deepseek-harness"
```

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
```

完整默认策略宿主验收另有 `pnpm test:host-policy --pack .scratch/<本轮唯一目录>`：先在独立验证副本运行 `pnpm check` 构建，再由此命令打包安装、通过真实 registry 挂完整 preset，并用固定适配器驱动真实 Agent、子代理和官方进程 PTC。它不调用真实模型，不证明模型纪律或收益；默认保留临时安装和逐条证据。也可传入 `test:delivery --keep` 留下的一次性 `dsh-profile-acceptance` 路径与新留证目录。不要在运行宿主链接的源码树里构建。

2026-10-25 的[修复后宿主验收](docs/acceptance/2026-10-25-default-edit-policy-fix-02.md)扩展后为 32 PASS / 0 FAIL：F-03 父用户来源误拒已修复，覆盖真实在线与持久化父会话及新增 E2 边界；此前 21 PASS / 1 FAIL 保留为历史红测。剩余 E2 子项、macOS/Linux 实跑与真实模型仍待验收。

`check` 包含构建和类型检查；`test:profile` 需要可用的 DSH CLI（可设置 `DSH_CLI`）。`test:delivery` 是真实宿主交付验收：它会 `pnpm pack` 四个交付包、装进一次性 DSH_HOME、用真实 launcher 装配 profile、跑门禁并把逐条证据写进 `docs/acceptance/<日期>-delivery-acceptance-report.md`（耗时数分钟；`--no-gates` 只跑装配与工作流）。外部夹具与各套件范围见 [integration](tests/integration/README.md)、[compat](tests/compat/README.md)；本地原始日志不随 clone 交付。

## 文档入口

运行目标包含 Windows、macOS 和 Linux。跨平台策略回归见 [CI 矩阵](.github/workflows/policy-contract.yml)，固定 Node 24 与 pnpm 11.28.5，分别使用各系统真实原生路径及 `file:` URL 测试。[fix-01 验收](docs/acceptance/2026-10-25-default-edit-policy-fix-01.md)已验证本轮 Windows 修复；macOS/Linux 实机结果待 CI，不以矩阵配置代替执行。read 的 `defaultEditPolicyGuidance` 默认关闭，仅本 preset 开启，其他挂载保留原指引。

- [需求规格](docs/spec/2026-10-22-ptc-hashline-requirements-spec.md)、[术语](GLOSSARY.md)、[架构决策](docs/adr/)
- [默认编辑策略 SRS](docs/specs/2026-10-24-hashline-default-editing.md)、[实施计划](docs/plans/2026-10-24-hashline-default-editing-implementation-plan.md)与[工程验收报告](docs/acceptance/2026-10-24-default-edit-policy-engineering.md)：默认 Hashline、受控降级与验收规则；票据 01～08 的工程切片已实现并验收；[推广评测方案](docs/plans/2026-10-25-default-edit-policy-promotion-evaluation-plan.md)已定稿（三阶段：探针 → 正式对照 → 推广判定），真实模型对照因缺可用驱动与模型凭据而 BLOCKED（票据 11）
- [当前验收与证据索引](docs/acceptance/2026-10-23-current-status-and-evidence-index.md)
- [上游功能分析](docs/background/2026-10-23-dsh-hashline-feature-analysis.md)：版本化研究快照，其中建议不代表已批准需求
- [运维 skills 需求](docs/specs/2026-10-23-ptc-hashline-operations-skills.md)与[实施计划](docs/plans/2026-10-23-ptc-hashline-operations-skills-implementation-plan.md)：incident、升级评估/方案/同意、获准后的隔离候选验证，以及获第二阶段同意后的目标切换与失败回退/交接已实现；真实宿主交付验收见[报告](docs/acceptance/2026-10-24-delivery-acceptance-report.md)（`pnpm test:delivery`）
- 运维 skill 入口：`/ptc-hashline-incident`、`/ptc-hashline-upgrade`（仅 PTC Hashline Mode 的真实用户显式调用；模型目录不包含、`skill` 工具加载被拒）

参与开发前阅读 [AGENTS.md](AGENTS.md)。
