# AGENTS.md — dsh-tool-hashline

## 按任务读取

- 开始修改前读 [README](README.md)、[术语](GLOSSARY.md)和[当前验收状态](docs/acceptance/2026-10-23-current-status-and-evidence-index.md)；做调查或验收前先查 `docs/background/`、`docs/acceptance/`、`tests/compat/` 与被忽略的 `.scratch/` 里同题的既有材料，重复取证须在报告里说明与存量的差异。
- 修改 read/edit/preset：读[权威规格](docs/spec/2026-10-22-ptc-hashline-requirements-spec.md)及相关 [ADR](docs/adr/)。历史交接和研究报告只作背景，不覆盖现行规格。
- 升级 hashline/tool-edit 或宿主：读[兼容矩阵与补丁维护规则](tests/compat/README.md)。
- 开发运维 skills：读[需求](docs/specs/2026-10-23-ptc-hashline-operations-skills.md)和[计划](docs/plans/2026-10-23-ptc-hashline-operations-skills-implementation-plan.md)；两份 skill 及其工作流已实现，最近一次真实宿主交付验收见[报告](docs/acceptance/2026-10-24-delivery-acceptance-report.md)。实现完成**不**等于获准真实升级：任何目标切换仍需用户当次明确同意。

## 实现边界

- 自有 read 在 `packages/tool-read`；hashline/tool-edit 是精确依赖的版本锚点。不得复制、fork 上游源码或 DSH；依赖修复通过 `patches/` 与 `pnpm patchedDependencies` 交付，不能只改 node_modules。
- read 运行时依赖仅限 Node 内置模块、hashline 锚点、`@deepseek-ai/dsh-tools` 和 `@deepseek-ai/dsh-fs` 契约；其它宿主包只作类型引用。现有依赖白名单测试必须保留。
- 保持工具名 `read`/`edit`、canonical value 与输出 schema 一致。PTC 消费 value；不恢复已否决的 stock read 装饰器路线。
- read/edit 使用有效 workingDirectory，并共享同一物理 hashline 实例。MV 两端目录约束、createIfAbsent、不覆盖、部分成功报告、磁盘先于快照的次序遵循 ADR-0003/0004；BOM 支持范围遵循 ADR-0005。
- seen 按上游有限守卫处理，read 只新增完整返回行，零完整行使用 `[0]`；不得将 seen 或 tag 描述为完整权限边界。
- preset 自带 persona/watchdog；保留 Intent 门判据和资源摘要检查，按已确认规格变更，不顺带调整基线行为。

## 验证与交付

按 README 运行受影响测试；依赖、preset 或运行契约变更需跑完整交付门禁。版本相同不能证明补丁生效，升级须核验实际解析路径、补丁与兼容矩阵。交付类变更另跑 `pnpm test:delivery`：它打包安装、用真实 launcher 装配，并把逐条证据写进 `docs/acceptance/`；不要把注入 runner 或一次性 profile 的结果说成真实升级。

保留用户已有工作树改动；不热改运行中宿主依赖，不自动重启或发布，目标 profile 切换需有用户明确授权。测试结果区分 PASS、FAIL、GAP 与 BLOCKED，不把 skipped、夹具或历史结果扩大为未执行的验收；结论同理——每条结论要能指回已有证据或它的产出点（代码、数据、责任层），指不回的写成待查项。细则见[证据可追溯](docs/agents/evidence-traceability.md)。

正式新需求/计划放 `docs/specs/`、`docs/plans/`；本地 issue、草稿和原始证据留在被忽略的 `.scratch/`。细则见[issue tracker](docs/agents/issue-tracker.md)、[领域文档约定](docs/agents/domain.md)。
