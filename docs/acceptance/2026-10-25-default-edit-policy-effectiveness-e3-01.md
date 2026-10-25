# 默认编辑策略 E3 真实模冒烟（runId 20261025-e3-01）

2026-10-25：**E3 未整体通过。** 已执行 10 个真实模型子会话：样本 1（普通单点）3/3 PASS、样本 2（重复文本）3/3 PASS、样本 3（两处编辑）2 PASS / 1 FAIL（`90 天` 写成 `90天`）、样本 5（真实子代理）1 PASS，样本 4（明确用户覆盖）**BLOCKED**。真实模型请求共 64 次，全部 `wb:deepseek-v4.1-flash`。

四层结论（本组样本，不外推）：

| 层 | 结论 | 依据 |
|---|---|---|
| E1 工程契约 | 本轮未执行 | 见[前序报告](2026-10-25-default-edit-policy-fix-02.md) |
| E2 安装及宿主生效 | 本轮未执行，且本轮环境不适用 | read/edit 由 `link:` 指向本 checkout，非打包安装 |
| E3 模型行为 | **未整体通过**：3 项有结果、1 项 FAIL、1 项 BLOCKED | 本报告 |
| E4 推广收益 | 未触及 | 需要既有[推广评测方案](../plans/2026-10-25-default-edit-policy-promotion-evaluation-plan.md)的独立冻结 |

## 环境

Windows 10.0.26200、Node v24.19.0、DSH 0.2.1-rc.2、profile `web`（未切换、未升级、未重启）、PTC 呈现模式、沙箱 workspace-write 且 enforcement=partial、工作区 HEAD 66d2a42 且开始时干净。完整记录与差异见 `.scratch/hashline-default-editing/effectiveness/20261025-e3-01/environment.md`。

本轮独有的不利条件必须随结论一起读：

1. read/edit/hashline 经 **dev link** 从本仓库解析，结论不覆盖打包安装。
2. 工作区是本仓库，不是 run card 要求的本轮新建临时目录；fixture 只写在被忽略的 `.scratch/` 下，未触碰受版本控制文件（`git status` 结束时仍为空）。
3. **逐调用轨迹不可得**：子会话 `session.v4.jsonl.zstd` 解压后只有 header 一条事件，父会话日志在运行中也只剩 header。因此"模型用了哪种编辑模式"由子代理自述 + 最终字节 + 策略结构约束推定，记 GAP，不能等同轨迹直证。
4. 样本 1/2/3/5 由 `subagent` 驱动，子会话唯一入站消息是父代理模型生成的文本。这不影响默认路径判据，但使样本 4 无法用同一驱动执行。

## 实测

| 样本 | 会话数 | 结果 | 独立字节证据 |
|---|---|---|---|
| 1 普通单点 | 3 | PASS 3/3 | 三者均 `976EE054…`→`503DCE0E…`，仅第 2 行 active |
| 2 重复文本 | 3 | PASS 3/3 | 三者均 `9F112CA7…`→`DE2D1D60…`，仅生产段 retry=5，示例段 retry=3 |
| 3 两处编辑 | 3 | PASS 2 / FAIL 1 | `…→B1DCD9A1…`（`90 天`，两次）与 `…→B45C5DD1…`（`90天`，一次） |
| 4 明确用户覆盖 | 0 | BLOCKED | 夹具 `case4/account.txt` 保持 `976EE054…` 未被触碰 |
| 5 真实子代理 | 1 | PASS（一项 GAP） | `976EE054…`→`4B4493B4…`，仅第 3 行 reviewed |

所有样本的首次编辑都落在 Hashline 路径上，没有一次 `replace`/`patch`/`apply_patch` 尝试被策略拒绝的记录，也没有任何会话改用 `write` 或 shell 覆写夹具（这一点只能由最终字节与子代理自述支持，见 GAP 3）。

唯一 FAIL：样本 3 的第一次会话把 `90 天` 写成 `90天`。模型自己报告了这处差异，其余两行/其余两次会话字面正确。按 run card 的逐样本判据记为 FAIL，不因 2/3 正确而平滑掉。

唯一被记录的工具拒绝：样本 1 第三次会话首次 `edit` 把段头写成 diff 风格（`--- a/account.txt#5DB3`），被编辑器拒绝，未落盘；改正段头后一次成功。这是输入格式拒绝与正确恢复，不是策略拒绝或绕路。其错误文本本轮未能在仓库或安装包内定位到同源字符串，故仅作自述记录。

## 缺口与未覆盖

- 逐调用 call ID / tag / mode 的独立复核（GAP）。
- 样本 4（BLOCKED）：需要真实用户在自己的新会话里发送 `请只对 account.txt 的状态使用 replace，把 pending 改成 active。`，工作目录设为 `fixtures/case4`。
- 打包安装下的同组样本，以及 macOS/Linux。
- 成本预算：用户未声明上限；本轮子会话合计 ¥0.1521（父会话另计）。

## 留证

| 路径 | 内容 |
|---|---|
| `.scratch/hashline-default-editing/effectiveness/20261025-e3-01/environment.md` | 环境、解析路径、差异声明 |
| `.scratch/hashline-default-editing/effectiveness/20261025-e3-01/results.md` | 逐样本表、会话 ID、计量、初始/最终哈希 |
| `.scratch/hashline-default-editing/effectiveness/20261025-e3-01/fixtures/` | 10 个夹具目录及最终字节 |

本报告只称本组样本结果；不推导推广收益，不代替 E2 的安装证据，也不用于判断日常 profile 是否已生效。
