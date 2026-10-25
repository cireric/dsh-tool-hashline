# AGENTS.md — dsh-tool-hashline

## 按任务读取

- 修改前读 [README](README.md)、[术语](GLOSSARY.md)和[当前验收状态](docs/acceptance/2026-10-23-current-status-and-evidence-index.md)。
- 调查或验收：查 `docs/background/`、`docs/acceptance/`、`tests/compat/` 与 `.scratch/` 的同题材料；重复取证说明与存量的差异。
- 修改 read/edit/preset：读[基础规格](docs/specs/2026-10-22-ptc-hashline-requirements-spec.md)及相关 [ADR](docs/adr/)；涉及默认编辑策略另读[策略规格](docs/specs/2026-10-24-hashline-default-editing.md)。
- 升级 hashline/tool-edit 或宿主：读[兼容矩阵与补丁维护规则](tests/compat/README.md)。
- 开发运维 skills：读[需求](docs/specs/2026-10-23-ptc-hashline-operations-skills.md)和[计划](docs/plans/2026-10-23-ptc-hashline-operations-skills-implementation-plan.md)。
- 整理文档或清理临时材料：读[文档维护约定](docs/agents/documentation.md)；文档入口见 [docs/README](docs/README.md)。

## 实现边界

- 自有 read 在 `packages/tool-read`；hashline/tool-edit 是精确依赖的版本锚点。不得复制、fork 上游源码或 DSH；依赖修复通过 `patches/` 与 `pnpm patchedDependencies` 交付，不能只改 node_modules。
- read 运行时依赖仅限 Node 内置模块、hashline 锚点、`@deepseek-ai/dsh-tools` 和 `@deepseek-ai/dsh-fs` 契约；其它宿主包只作类型引用。现有依赖白名单测试必须保留。
- 保持工具名 `read`/`edit`、canonical value 与输出 schema 一致。PTC 消费 value；不恢复已否决的 stock read 装饰器路线。
- read/edit 使用有效 workingDirectory，并共享同一物理 hashline 实例。MV 两端目录约束、createIfAbsent、不覆盖、部分成功报告、磁盘先于快照的次序遵循 ADR-0003/0004；BOM 支持范围遵循 ADR-0005。
- seen 按上游有限守卫处理，read 只新增完整返回行，零完整行使用 `[0]`；不得将 seen 或 tag 描述为完整权限边界。
- preset 自带 persona/watchdog；保留 Intent 门判据和资源摘要检查，按已确认规格变更，不顺带调整基线行为。

## 验证与交付

按 README 运行受影响测试；依赖、preset 或运行契约变更需跑完整交付门禁。版本相同不能证明补丁生效，升级须核验实际解析路径、补丁与兼容矩阵。交付类变更另跑 `pnpm test:delivery`：它打包安装、用真实 launcher 装配，并把逐条证据写进 `docs/acceptance/`；不要把注入 runner 或一次性 profile 的结果说成真实升级。

保留用户已有工作树改动；不热改运行中宿主依赖，不自动重启或发布。任何升级目标切换都需用户当次明确同意，候选验证或实现完成不代表获准切换。测试结果区分 PASS、FAIL、GAP 与 BLOCKED，不把 skipped、夹具或历史结果扩大为未执行的验收；每条结论须能指回证据或产出点（代码、数据、责任层），否则记待查项。细则见[证据可追溯](docs/agents/evidence-traceability.md)。

正式新需求/计划放 `docs/specs/`、`docs/plans/`；本地 issue、草稿和原始证据留在被忽略的 `.scratch/`。细则见[issue tracker](docs/agents/issue-tracker.md)、[领域文档约定](docs/agents/domain.md)。
