# 运行修复验收记录：D1 目录适配 / D2 persona 保留

日期：2026-10-23
计划：本地 `.scratch/ptc-hashline/runtime-fix-plan.md`
原始实测报告：本地 `.scratch/ptc-hashline/runtime-verification-report.md`（保留原 FAIL，不改写；不随 clone 交付）
旧验收追溯：[2026-10-23-acceptance-traceability.md](./2026-10-23-acceptance-traceability.md)（其计数是修复前基线）

本记录只陈述本次实际执行过的命令与观察。未执行的项列为 GAP，不用配置检查、进程内测试或历史记录替代。

> 后续状态见[当前验收与证据索引](2026-10-23-current-status-and-evidence-index.md)。下文 GAP/计数是本轮历史结果，本地计划、日志和备份不属于版本库交付。

## 1. 判定摘要

| 项 | 判定 | 证据 |
|---|---|---|
| D1 相对路径 hashline | PASS | 真实 Session + 真实 `WorkingDirectory`；`working-directory.spec.ts` 10/10 |
| D1 REM / MV（会话目录内） | PASS（范围见 §4） | 同上；MV 两个端点都检查，原路径消失、目标内容一致。**该 PASS 的夹具未挂 `fs-observation-policy`**，不覆盖真实 profile 的写入意图契约 |
| D1 越界 REM/MV | PASS | 仍拒绝（`outside the working directory`），未放宽包含关系 |
| D1 运行中切换目录 | PASS | `workingDirectory.set` 后 read/edit 都用新目录，header 初始目录保持不变 |
| D1 多会话 | PASS | 两个 cwd 不同的 Session 交错 read/edit，snapshot 与磁盘互不串 |
| D2 已修复部署插件 | PASS | 真实 prompt registry + scope 链 + 插值；`persona-preservation.spec.ts` 9/9 |
| D2 修复前版本 | 失败（符合预期） | 同一矩阵 9/9 失败，最终文本只剩 `You are a helpful assistant.` |
| D2 未启用插件对照 | PASS | `persona-scope-contract.spec.ts` 3/3 |
| 真实宿主重挂载 | **GAP** | 见 §6 |
| 真实模型多回合外显 | **GAP** | 见 §6 |

## 2. 环境与命令

- 仓库：`D:/Project/source/__TEST__/dsh-plugins/dsh-tool-hashline`（Windows，Node 24）。
- `pnpm test:*` 在 workspace-write 下会因 esbuild 以管道 stdio 启动子进程而 `spawn EPERM`；本次验收使用等价入口
  `node node_modules/vitest/vitest.mjs run --config <cfg>` 与 `node node_modules/typescript/bin/tsc -p <cfg>`，
  必要时一次性放宽沙箱。命令本身来自根 `package.json` 的脚本。
- 依赖补丁：`pnpm patchedDependencies` → `patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch`，lockfile 含 `patch_hash`。

## 3. 门禁结果（修复后）

| 命令 | 结果 |
|---|---|
| 3 个包 `tsc -p packages/*/tsconfig.build.json` | exit 0 |
| 包与测试类型检查（`tsconfig.json` / `tsconfig.tests.json`） | exit 0 |
| unit | 44 passed / 8 files |
| integration | 67 passed / 8 files |
| ptc | 9 passed / 2 files |
| compat | 15 passed / 1 file |
| `node scripts/check-preset.mjs` | OK：不变量、caps、门与资源摘要通过 |
| `node scripts/test-profile.mjs` | OK：干净 profile 安装、dsh 组合、read→edit 落盘、门正负 |
| 集成层重复 5 次、兼容层重复 5 次 | 全绿 |

**偶发记录**：把多层连续跑在同一批处理里时，观察到三次单例失败（集成层 1 次、兼容层 1 次、PTC 门 1 次），
均未捕获到测试名；随后 unit/integration/ptc/compat 分别重复 5/5/10/5 次、以及三轮"四层连续"重跑全部通过。
按"不可复现的环境偶发"记录，不作为通过依据，也不忽略；判定以单独重复运行的结果为准。

## 4. D1 用例矩阵

文件：`packages/tool-read/tests/integration/working-directory.spec.ts`（真实 Agent、真实 `WorkingDirectory`、真实 upstream `edit`）。
夹具故意让 `LocalFileSystem` 的默认目录 = 进程 cwd，Session 目录 = 临时目录，且 Session **没有** `cwd` 属性。

| 用例 | 修复前 | 修复后 |
|---|---|---|
| 相对 header 首次编辑 | 失败 `File not found: rel.txt` | 通过，只有会话目录文件改变 |
| replace / patch 相对 path | — | 通过，命中会话目录 |
| 绝对 show path | — | 通过 |
| REM（会话目录内） | 失败 `File not found` | 通过，文件被删除 |
| MV（会话目录内） | — | 通过，源消失、目标内容一致 |
| 越界 REM/MV | — | 通过：仍拒绝 |
| 运行中切目录 | 失败 | 通过，后续使用新目录 |
| 多会话交错 | — | 通过，不串目录/快照 |
| seen 并集/首次拒绝/`[0]` 哨兵 | — | 通过 |
| show path / 别名双键（符号链接可用时） | — | 通过 |

修复前 3/3 失败（只写了当时的最小红色用例），失败原文见 `.scratch/ptc-hashline/evidence/phase-a-red.txt`。

> **2026-10-23 补记（不改写上面的结论与计数）**：本节的 MV / REM 用例当时运行在
> `packages/tool-read/tests/integration/working-directory-harness.ts`，该夹具**没有挂载**
> `@deepseek-ai/dsh-fs-observation-policy`。因此这里的「MV 通过」只证明目录解析与内容结果，
> **不证明**真实 profile 下的写入意图契约——真实会话里 MV 到不存在的新目标被
> `fs/edit-intent` 以 `FS_NOT_OBSERVED` / `FS_NOT_FOUND` 拒绝（见
> 本地 `.scratch/ptc-hashline/2026-10-23-relative-path-mv-rem-report.md` §3，不随 clone 交付）。
> 夹具现已默认挂载策略，修复与新的矩阵见
> [2026-10-23-mv-observation-acceptance.md](./2026-10-23-mv-observation-acceptance.md)。

## 5. D2 用例矩阵

文件：`tests/integration/persona-preservation.spec.ts` + `persona-harness.ts`。
注册表、scope 合并、模板插值、assemble 瀑布都是宿主的真实实现；persona 是仓库自带的
`presets/ptc-hashline/personas/orchestrator.md`。插件从部署目录动态导入（`HIDE_HARNESS_IDENTITY_PATH` 可覆盖）。

| 场景 | 修复前（1.3.0） | 修复后（1.4.0） |
|---|---|---|
| 已有 agent 安装 | 失败：Phase 0/六桶/suffix 之前的 persona 被替换 | 通过：Phase 0、六桶、完整 Intent 格式、其余段落、suffix 全保留 |
| `agent/created` 新建 agent | 失败 | 通过 |
| 整段文本比较 | 失败 | 通过：仅第一句 `You are a coding agent powered by the {{model}} model.` 改为中性句，其余逐字一致 |
| 无品牌命中的多段 persona | 失败：被替换为默认短句 | 通过：prefix/suffix 原样保留 |
| 子 agent scope | 失败：父 persona 丢失 | 通过：子 scope 自己的 persona 生效，父 scope 不受影响 |
| 多次 assemble / context refresh | 失败 | 通过：`#brand-scrubbed` 只加一次，refresh 后仍是改写文本，Phase 0 只出现一次 |
| 卸载 + 重新挂载 | 失败 | 通过：无重复监听、无残留覆盖段落 |
| `text` / `complete` 旧配置 | — | 加载期显式拒绝（`removed in 1.4.0`），含 `text: ''` |
| complete persona | — | **保留但不改写**：`assemble()` 在瀑布之后恢复 complete 段落。按计划 §2.2 单独报告，不宣称已去品牌 |

同一矩阵对旧版本 9/9 失败、对修复版本 9/9 通过；未启用插件的对照 3/3 通过。

部署侧实际改动（用户授权后写入 `D:/Project/source/__TEST__/default/plugins/hide-harness-identity/`）：
`index.js`、`cordis.patch.yml`、`package.json`（1.3.0 → 1.4.0）、`README.md`、`locale/{zh,en}.json`。
原文件（含 locale）备份在 `.scratch/ptc-hashline/backup/hide-harness-identity/`。仓库内的
`tests/fixtures/hide-harness-identity/` 是同一份候选副本，用于无部署时可重复的回归。

**已知文本边界**：改写发生在 `renderPrompt()` 之前；监听器只把 `{{variable}}` 展开用于句式判定，
不会把变量值写回文本。只通过变量出现在**非自我介绍句**里的品牌字样，要到渲染后才出现，不在本插件能力内。

## 6. GAP（未执行，不用替代证据）

1. **真实宿主重挂载**：当前会话就跑在该宿主里，计划明确禁止替换服务、也不要求改动日常 profile；
   未执行"禁用/重挂载 → 新会话"的真实链路。已做的是隔离 profile 的 `test:profile` 组合与依赖解析。
2. **真实模型外显**：没有可用模型路由驱动 ≥3 个真实用户回合；未验证模型是否在每次行为改变型回合
   首行写出门行，也未做只读回合与故意缺门的负向对照。mock 模型测试未构建，因此不冒充通过。
3. **最终请求文本**：`persona-preservation` 证明的是 **assemble 输出**（registry → 瀑布），
   没有捕获 adapter 转换后的最终 `system/message`。宿主若还有 adapter 层改写，需要另一次取证。
4. **complete persona 的去品牌**：按 §2.2 保持完整提示语义，未改写；若要求该分支也去品牌，需另定方案。
5. **平台**：只在 Windows 上执行；符号链接用例按平台能力跳过或执行，POSIX 未验证。

## 7. 与 watchdog 契约的区分

- **机制契约**：仍是"每轮最多拒绝一次"、桶判据与 `BEHAVIOR_TOOLS` 集合不变；`tests/ptc/gate.spec.ts` 9 个用例通过。
  本次修复没有改变门策略，也没有把一次性放行改成持续阻断。
- **模型外显**：本轮**没有**验证真实模型是否遵循门行格式。PTC + Hashline 闭环通过不等于 Intent 验收通过；
  旧报告的 Intent FAIL 仍然成立，直到 §6.2 被真实模型回合覆盖。

## 8. 解析路径与补丁生效

```text
edit_entry  = <repo>/node_modules/@hy-sde-org/dsh-tool-edit/dist/index.js
engine_entry= <repo>/node_modules/@hy-sde-org/dsh-hashline/dist/index.js
patch_applied=true   (session.js 读 workingDirectory.get)
mv_containment=true  (writer.move 两端检查)
```

隔离 profile（`test:profile`）链接本仓库的 `packages/tool-edit`，其裸导入按真实路径向上解析到
仓库 `node_modules`，因此加载的是打补丁的副本；profile 断言 read/edit 仍解析到**同一个物理** hashline 引擎。

## 9. 回退

- D1：回退补丁文件与 `patchedDependencies`、read 的 cwd 算法与测试、lockfile。只回退一侧会让 store key 再次分裂。
- D2：回退外部插件 `index.js` / `cordis.patch.yml` / `package.json` / `README.md` / `locale/*.json`
  （备份在 `.scratch/ptc-hashline/backup/hide-harness-identity/`），然后重新挂载宿主。
