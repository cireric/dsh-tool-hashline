# 块定位能力说明与诊断修复验收

2026-10-25：票据 02、03 在源码及隔离交付安装中修复通过。**定向回归 13 PASS / 0 FAIL；新打包完整宿主 33 PASS / 0 FAIL；九项完整交付门禁均 exit 0。** 交付验收 ID 为 21 PASS / 0 FAIL / 9 BLOCKED，未执行项不计通过。[机器摘要](2026-10-25-hashline-block-locator-fix-summary.json)记录受测输入哈希、安装路径、逐场景状态和各门禁退出码。

依据：[问题调查](../background/2026-10-25-hashline-block-locator-assessment.md)与[修复计划](../plans/2026-10-25-hashline-block-locator-guidance-fix.md)。本轮 Windows x64、Node v24.19.0、pnpm 11.28.5；官方宿主 DSH 0.2.1-rc.2，hashline/tool-edit 锚点仍为 0.2.1-alpha.4。

## 实际变化

- [tool-edit 精确补丁](../../patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch)不再把 `PUT N*:` / `CUT N*` 描述为可用操作，而是明确本构建缺少语法块 resolver，并推荐显式范围。
- adapter 将缺失的 resolver 表示为 `undefined`，同时更新其 `.d.ts` 类型和注释。通用引擎已有的无 resolver 分支因此能准确报告 unavailable，避免误报为语言、空行/闭合行或解析错误。
- 未增加解析器或运行依赖，未修改 hashline 通用引擎算法。块替换/剪切继续拒绝，块后插入/寄存器粘贴继续按既有 after-line 降级语义执行并报告警告。
- pnpm 在隔离副本重新生成 lockfile，随后以 frozen-lockfile 安装验证。新 tool-edit `patch_hash` 为 `9d337a0c718b9ff818656be1abb69b080946609ab802ad0ed9c039a6ec140d8b`；hashline 补丁不变。三平台 CI 已纳入新回归，macOS/Linux 实跑尚未执行。

## 测试与证据

新增[公共工具边界回归](../../tests/integration/hashline-block-capability.spec.ts)，使用实际 ToolRuntime、自有 read、上游 edit、Local provider 与 observation policy；不直接断言私有 resolver 实现。

| 验证 | 结果 | 观察 |
|---|---|---|
| 旧安装红测 | 9 FAIL / 4 PASS | 工具说明和 8 项块操作诊断失败；已支持的显式范围、块后插入/粘贴和批量拒绝基线通过 |
| 新补丁冻结安装后的定向回归 | 13 PASS / 0 FAIL | js/ts/py/md 的块替换/剪切均准确拒绝、零 provider 写入且磁盘未变；显式范围成功；after-line 插入/粘贴保持结果与警告；后 section 块失败使首次提交前拒绝 |
| `pnpm check` | exit 0 | 构建与源码/测试类型检查 |
| 新打包完整 preset + 官方进程 PTC | 33 PASS / 0 FAIL | 包括新场景：实际 schema 说明、两次准确拒绝、显式替换和块后插入的独立最终字节，provider 写入恰为 2 次 |
| 完整 `pnpm test:delivery --keep` | exit 0 | build、workspace check、check:tests、unit、integration、ptc、compat、check:preset、profile 均 exit 0；未用 `--no-gates` |

完整宿主通过真实 launcher/registry 挂完整 preset，固定适配器驱动实际 Agent/Session 和官方进程 PTC；**真实模型请求为 0**。PTC isolation 为 process，sandbox enforcement 为 partial。实际安装确认 read/edit 共享同一物理 hashline。

摘要核验当前正式补丁、lockfile、回归和宿主驱动与受测树逐字节一致，实际安装的 resolver 为新表示。原工作区的 `node_modules` resolver 仍保留旧空函数，说明本轮没有热改原运行依赖；原 dist 未构建。本轮未安装或切换用户日常 profile、重启宿主或发布。**当前运行中 DSH 会话不会因修改源码和补丁文件自动获得新说明。**

原始证据位于被忽略的 `.scratch/hashline-block-locators/fix-01/`：`environment.json` 与 `commands.jsonl` 固定输入和命令；`logs/red-block.log` / `green-block.log` 保留红绿对照；`frozen-install.log` / `full-host.log` / `delivery.log` 保留退出码；`tree/.scratch/block-host/host-result.json` 与 `tree/.scratch/block-delivery/` 保存逐条事实。pnpm 脚本前隐式 store/非 TTY 安装检查的警告未记成通过，安装依据是显式 frozen 安装及新打包安装。

## 审查与边界

已检查正确性、接口/类型一致性、依赖与资源影响；未发现需阻断的代码问题。红测实验确认测试能抓住旧能力说明和错误分类，绿测及完整宿主确认替代范围路径未退化。

这次修复的是能力说明与诊断，不是实现 AST 定位。既有 E2 其它子项、真实模型 E3/E4 和 macOS/Linux 尚未执行的结论不因本轮通过而改变；先前的真实模型报告与用户工作树改动保留。
