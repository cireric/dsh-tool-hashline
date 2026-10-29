# 默认编辑策略 F-03 修复与复验

> 归档说明（2026-10-29）：本文保留原轮次结果；文中历史 `.scratch/...` 路径现位于[本地原始证据归档](../evidence/README.md#本地原始证据)。一次性探针和候选环境已清理，当前重跑入口见项目 README。

2026-10-25：**F-03 已修复；本轮扩展后的完整宿主 32 PASS / 0 FAIL，定向回归 27 PASS / 0 FAIL，九项交付门禁均 exit 0。** 交付验收 ID 为 21 PASS / 9 BLOCKED，未执行项没有记为通过。机器清单见[摘要](README.md#历史原件 "归档原件：docs/acceptance/2026-10-25-default-edit-policy-fix-02-summary.json")。此前[完整宿主报告](README.md#历史原件 "归档原件：docs/acceptance/2026-10-25-default-edit-policy-full-host.md")的 21 PASS / 1 FAIL 是修复前历史结果。

本轮仅证明 Windows、pnpm 11.28.5、官方 DSH 0.2.1-rc.2 下新打包的一次性安装中的已执行路径。macOS/Linux 实跑、剩余 E2 子项与真实模型 E3/E4 尚未完成；没有切换日常 profile、热改原安装依赖、重启或发布。

## 修复内容与约束

此前实现期待不存在的 `session.parentSession` 对象，导致真实子代理合法引用父用户请求时误拒。现在通过宿主公开的 `sessionQuery.observeSession` 查询实时或持久化会话，核验子会话自身的 canonical subagent projection、父会话 canonical catalog 及父方自身的对应委派事件；仅凭 `header.parentSession`、fork 血缘或继承的委派记录均不放行。每次查询都释放观察租约，查询不可用或关联不完整时明确拒绝。

实现位于[来源核验模块](../../presets/ptc-hashline/policy/user-source.mjs)，由[默认策略](../../presets/ptc-hashline/policy/default-edit-policy.mjs)调用。引用可显式指定父 ID，也可从已验证的祖先链定位包含原文的最近来源；没有扫描无关会话。统一校验引用的 eventSeq、字符范围与 quote 一致性，保留已有 path/mode 与编辑执行检查。

宿主将初始委派任务记成 user 形状，但任务本身由模型生成，因此本轮同时排除了它作为新的人类授权。fork 继承消息、assistant/tool/agent-message 转述也不能充当原用户来源。该逻辑只核验来源事实，不判断自然语言是否语义授权某操作；语义责任仍在模型与验收。父 read/seen 不会被复制到子会话，也没有新增持久授权缓存。

父来源只取本任务委派建立前的自身用户事件。委派建立后的父新请求若没有可核验的本任务关联，继续拒绝，不从血缘推断授权。这是当前支持边界，不能据此宣称所有续派场景已覆盖。

## 实测结果

| 验证 | 结果 | 证据含义 |
|---|---|---|
| 修复前定向红测 | 4 FAIL / 6 PASS | 先复现缺陷；非 skip 或削弱断言 |
| 最终定向回归 | 27 PASS / 0 FAIL | 父来源 15、既有用户覆盖 7、模块地址 5 |
| 新打包完整宿主（最初修复复验） | 26 PASS / 0 FAIL | 完整 preset、真实 registry/Agent/Session/subagent、官方进程 PTC |
| 补齐 E2 场景后的完整宿主 | 32 PASS / 0 FAIL | 新增混合目标整笔拒绝、跨 Session 事实隔离、cwd 变化失效、PTC catch 语义、单 BOM 空文件填充、MV 目标冲突 |
| `pnpm check` | exit 0 | 构建、源码与测试类型检查 |
| 完整 `pnpm test:delivery --keep` | exit 0 | 21 PASS / 0 FAIL / 9 BLOCKED，未使用 `--no-gates` |
| 九项交付门禁 | 全部 exit 0 | build、workspace check、check:tests、unit、integration、ptc、compat、check:preset、profile |

真实宿主覆盖了在线父用户来源、无需猜 ID 的父引用、仅血缘无委派记录拒绝、模型委派文本不能自授授权，以及父 Agent/Session 均已从内存卸载后通过真实持久化查询成功引用。最后一项不是 observation double。父 read 跨会话仍拒绝，子自行 read 后可正常编辑。

定向观察替身补充查询失败/服务缺失、错子任务、继承 catalog/descriptor、canonical identity 缺失、晚于委派的来源、循环祖先、矛盾 seq/range 等边界，拒绝用例同时核验零写入与磁盘未变。替身结果不扩大为相应冷存储路径已全部实跑。

完整宿主使用固定 LLM 适配器，89 次脚本请求、**0 次真实模型请求**；PTC 为 `isolation: process`，沙箱 enforcement 为 partial。它证明装配和运行路径，不证明真实模型纪律、成本收益或完整沙箱隔离。

新安装核验 read/edit 解析到同一物理 hashline。上游锚点仍为 0.2.1-alpha.4，沿用 F-01/F-02 的工具补丁；本轮增加自有 preset 模块，不引入新运行依赖。摘要记录受测文件哈希，当前源码、隔离受测树及实际安装的来源模块已逐字节核对一致。

## 留证与复跑

原始日志与会话证据保存在被忽略的 `.scratch/hashline-default-editing/effectiveness/20261025-fix-02/`：

| 相对路径 | 内容 |
|---|---|
| `commands.jsonl`、`logs/parent-final.log` | 时间、命令、退出码及最终 27 项结果 |
| `logs/check-final.log`、`logs/delivery-full.log` | 最终类型检查与完整交付命令 |
| `logs/host-e2-residual-r5.log` | 最新真实四包打包安装及 32 项宿主结果 |
| `tree/.scratch/host-e2-residual-r5/host-result.json` | 解析路径、安装哈希、逐场景回执与磁盘结果 |
| `tree/.scratch/delivery-e2-final-r5/` | 最终交付报告及九项门禁退出码 |
| `logs/host-e2-residual.log`、`logs/host-e2-residual-r4.log`、`logs/delivery-e2-final.log` | 初次短文件夹具、cwd 清理问题和未显式指定 DSH CLI 的失败，均在后续修正/重跑中关闭 |

开发过程中的第一次类型检查失败（测试夹具类型断言）及第一次绿色尝试失败（移除旧变量后的残留引用）均留在原始日志；修正后以上最终检查与完整回归通过。pnpm 脚本前的隐式依赖检查有 store/非 TTY 警告，本轮没有把该隐式检查记为通过；安装依据是隔离树显式 frozen-lockfile 安装、新打包安装及实际解析/哈希证据。

按 README 在独立副本先构建，再执行 `pnpm test:host-policy --pack .scratch/<fresh-run>`。不要在运行中宿主链接的源码树内构建。复跑保留唯一留证目录，不覆盖历史结果。

## 剩余验收

F-03 的原失败已闭环，E2 核心矩阵继续推进但整体尚未完成。已真实宿主覆盖受限+普通目标整笔拒绝、跨目标 preset 与交错目标会话、cwd 变化后旧证据拒绝、catch 后内层拒绝仍可见、单 BOM 空文件填充及 MV 目标冲突不覆盖。剩余项包括无 session/SDK 与多种窗口上限组合、同会话 remount 后旧引用失效、真实后端 retry 竞争/取消/unknown、MV+内容混合和更多字节/载荷组合；E1 注入证据不能替代这些 E2 路径。

下一阶段需要真实 DSH 用户会话和实际模型。已准备本地[DSH 真实模型运行卡](../evidence/README.md#本地原始证据 "本地归档原件：.scratch/default-edit-effectiveness/dsh-real-model-run-card.md")：包含隔离夹具、不给出 Hashline 提示的普通任务、明确用户覆盖、真实子代理样本及逐项留证字段。它是本地草稿，不随 clone 交付；执行前还需记录目标 profile 与模型环境。

macOS/Linux 真实执行为 GAP，已有 CI 配置但本轮未触发。E3/E4 真实模型行为与收益为 BLOCKED；日常 profile 未切换。当前无需用户在 DSH 重复已自动修复并验证的 F-03，后续真实模型阶段仍需单独的环境与执行安排。
