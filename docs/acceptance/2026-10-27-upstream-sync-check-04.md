# 上游同步检查 — 票据 04 引擎发布更新与补丁影响验收

日期：2026-10-27
状态：本票交付范围 PASS（engines 区域从 not-covered 变为 covered，整体检查首次完整执行）；补丁与组合影响按设计停在「待验证」
运行平台：Windows（唯一实跑平台）。macOS/Linux 保留 GAP。

需求权威：[上游同步需求规格](../specs/2026-10-27-upstream-sync-requirements.md)。上游仓库只读查询；不改动「受控升级」的结论与授权契约（`upgrades.mjs` 未改动）。

## 1. 本票交付的行为

公开入口不变（`pnpm sync:check`），engines 区域现在真的比较，且**不取 latest 充当答案**：

| 事实 | 来源 | 记录方式 |
|---|---|---|
| 已发布版本**全量枚举** | `npm view <pkg> versions dist-tags --json`（只读） | 按语义版本排序，分稳定 / 预发布两个渠道分别列出 |
| 渠道分类 | 版本自身的预发布段 | 不按 dist-tag 分类：两个引擎包的 `latest` 都指向预发布 |
| 无标签的已发布版本 | 版本枚举 | 仍计入候选，并在记录里标为 untagged |
| 固定版本 → 候选的更新依据 | 本项目基线 + 版本枚举 | 列出候选及其中间已发布版本；「没有中间版本」只说明没有中间**发布** |
| 两个引擎的声明组合 | 本项目声明 vs 候选组合 | 只报待验证，不称组合已通过 |
| 本地补丁 | `patches/` 标记 + 解析后的构建文件 | 每项待验证：候选包文本不在只读查询范围内 |

### 为什么不能取 latest

真实查询显示：```hy-sde-org/dsh-hashline` 与 `dsh-tool-edit` 的 dist-tags 都只有 `{latest: 0.2.1-rc.3}`，而这两个包**没有发布任何正式版**。旧受控升级流程按 `latest` 取「release」，会把预发布读成正式版；本票的检查按语义版本分类，因此记录里明确写「该包未发布任何正式版，只有预发布」。这是一条观察，旧流程本身本票不改（授权契约不在本票范围）。

### 上限：只到「有更新、影响待查」

候选高于固定版本时生成差异，处置一律 `pending-analysis`，理由写明「有版本更新、影响待查」并给出复查条件；补丁项与组合项各自待验证，理由写明**版本号或标记存在都不是语义已修复的证据**。检查不安装、不下载、不改锁定版本、不切换目标。

## 2. 部分来源与超时（这是本票的行为变更）

| 情形 | 行为 |
|---|---|
| 三个来源层都没给 DSH 目录 | 停止，不写任何产物（仍是票据 01 的契约） |
| **命名了但不可用**的 DSH 目录 | 来源 / ptc / stock read 三个区域记 GAP 并标不完整；**engines 区域照常比较**（它不需要源码树），整体标不完整 |
| 单个引擎的发布查询失败 | 该引擎记 `BLOCKED`（含原因），另一引擎结果照常保留；不读历史结果 |
| 查询超时 | 记为超时（`查询超时`），不是「没有更新」 |
| 全部外部查询失败 | 本地三个区域照常完成，整体不完整 |

两方向都有用例：`still reports the engines when the DSH source itself is unusable` 与 `still reports the local areas when a release source fails`，并断言**任何一侧缺失都不会被汇总成完整或可升级**。

**没有缓存**：检查不使用上一轮的记录，任何一轮的外部结论都只来自本轮查询；`cacheUsed: false` 随区域结果写出，用例 `keeps no cache` 验证「上一轮成功、本轮失败」仍然报 BLOCKED。

## 3. 真实来源一轮（只读查询，2026-10-27）

| 项 | 结果 |
|---|---|
| DSH 来源 | 0.2.1-rc.2 @ `687f282`，工作树 clean |
| 覆盖 | source 18 / ptc 75 / stock-read 14 / engines 11 检查点；缺口 0；整体 **complete**，exit 0 |
| hashline | 固定 0.2.1-alpha.4；候选 0.2.1-rc.3；正式版 0 个；差异 `engines.hashline.update` |
| tool-edit | 固定 0.2.1-alpha.4；候选 0.2.1-rc.3；正式版 0 个；差异 `engines.tool-edit.update` |
| 补丁 | hashline 2 项、tool-edit 5 项，全部 pending-verification |
| 组合 | 两个包落在同一语义版本（0.2.1-rc.3），仍只报待验证 |
| 差异合计 | 43 条：保留 24、待分析 18、不适用 1 |

本地证据：`.tmp/sync-smoke/evidence/sync/20261027-170000-2b5502347cb2/`（被 Git 忽略）。

## 4. 夹具证据与真实来源证据分开

| 内容 | 证据类型 |
|---|---|
| 多渠道分类、无标签版本、中间版本、补丁待验证、组合待验证 | **夹具**（`tests/integration/operations-sync-engines.spec.ts`，14 例） |
| 部分失败、超时、无缓存、两方向的部分来源 | **夹具**（同上） |
| `--sources` 固定响应通过公开入口 | **夹具 + 子进程**（同上最后一组） |
| 两个引擎的真实候选版本 | **真实只读查询**（本轮，记录见上表） |

## 5. 执行结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 构建与类型检查 | `pnpm check` | PASS，exit 0 |
| 测试类型检查 | `tsc -p tsconfig.tests.json` | PASS，exit 0 |
| 集成层 | `vitest run --config vitest.integration.config.ts` | PASS，41 文件 / 510 例（本票新增 14 例；票据 01～03 改为注入固定发布来源，用例不再依赖网络） |
| 单元 / 兼容 / PTC 层 | `pnpm test:unit` / `test:compat` / `test:ptc` | PASS |
| preset 形状与内建依赖白名单 | `pnpm check:preset` | PASS（`sync-engines.mjs`、`sync-run.mjs` 已纳入） |
| 真实来源一轮 | `node scripts/sync-check.mjs --now 2026-10-27T20:00:00Z` | complete，exit 0（四个区域全覆盖，缺口 0） |

## 6. 未覆盖 / GAP

| 项 | 状态 | 说明 |
|---|---|---|
| 候选包内容 | GAP（设计如此） | 只读元数据查询不取得包字节，补丁与组合只能待验证；判定要靠既有受控候选验证流程。 |
| 更新内容（发布说明） | GAP | 只读查询不含 changelog；记录里明说「没有中间版本」不等于「没有改动」。 |
| 目标切换 | 不在本票 | 检查产出的是待分析记录，不是同意记录。 |
| 保留项跨轮绑定与复查 | GAP | 票据 05。 |
| 真实来源总验收与交付门禁 | GAP | 票据 06。 |
| macOS / Linux 实跑 | GAP | 未执行。 |

## 7. 下一步

票据 05「重复检查与差异复查决定」：从 `<evidenceDirectory>/sync/*/sync.json` 读历史做跨轮比较，区分首次 / 无变化 / 已知 / 新增 / 过期，把复查决定（跟进 / 保留 / 不适用）落盘并可再评估。
