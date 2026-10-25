# 完整 preset 与进程 PTC：隔离宿主验收

- 日期：2026-10-25；Windows x64、Node `v24.19.0`、pnpm `11.28.5`。
- 输入：`cc9dca2` 加 [fix-01](2026-10-25-default-edit-policy-fix-01.md) 修复；本轮新增测试驱动，没有更改产品策略。
- 方案：[实际生效验收方案](../plans/2026-10-25-default-edit-policy-effectiveness-test-plan.md) E2。
- 结论：**FAIL：22 条已执行场景中 21 PASS、1 FAIL。完整 preset 与实际进程后端已运行，合法父用户覆盖来源被误拒。**
- [机器摘要](2026-10-25-default-edit-policy-full-host-summary.json)保存逐场景判定、版本/摘要、实际后端、父来源证据及 E2 分项缺口。

## 1. 本轮比上一轮增加了什么

[fix-01](2026-10-25-default-edit-policy-fix-01.md)只挂 scoped read/edit 子集。本轮用真实安装包、官方 app-boot/loader/preset registry，选择未经裁剪的完整 `ptc-hashline`，创建生产 AgentLoop/Agent/Session，并实际调用官方 subagent 工具与 Node PTC 进程后端。

不存在用手造 Agent/Session 或进程内 PTC carrier 代替上述链路的情况。每条用户消息由测试创建、来源为 `user` 的夹具；适配器按固定脚本输出 Intent 和调用，不调用真实模型。它验证执行契约，不能证明真实模型会这样选择、理解、恢复或停止。

宿主装配使用官方 base+headless bundle，加上官方 Web 层中关闭宿主重复工具的覆盖项、真实 preset registry 和 subagent-model-selection-settings。测试禁用 headless 应用入口、自动标题模型及遥测；没有禁用或删除目标 preset 中的启用项。普通 standard 对照也取自安装包的官方声明。

开发测试入口最初放在维护目录，导致嵌套 Loader 从维护目录解析 bare imports，出现 `never started`。把空宿主入口放到隔离安装资源根，并补齐官方 Web 的模型选择宿主服务后完整挂载成功。这个初始化问题已定位为测试宿主问题，不登记为产品缺陷，也没有通过裁剪 preset 解决。

实际环境：

| 项目 | 结果 |
|---|---|
| DSH | `0.2.1-rc.2` |
| hashline/tool-edit | `0.2.1-alpha.4` + 当前精确补丁 |
| 物理 hashline | read/edit 解析到同一实例 |
| PTC | 官方 TypeScript、`isolation: process` |
| 沙箱回执 | `workspace-write`、`denied: false`、`enforcement: partial` |
| 模型调用 | 固定适配器请求 56 次；真实模型运行 0 次 |
| 观察 | 实际 tools/result、29 条策略回执、writeText 尝试与最终磁盘字节 |

`enforcement: partial` 按原样报告，不宣称完整隔离。副作用观察只包装了真实 `writeText`，没有替换 provider；不将它扩大成所有 delete/mkdir/其他潜在副作用的全面审计。

## 2. 已执行场景

| 场景组 | 结果 | 实际检查 |
|---|---|---|
| 受管拒绝、连续 Hashline、完整策略关闭对照 | 3 PASS | 缺声明 replace 被策略拒绝且零 writeText；两次 Hashline 使用真实 string/header；仅撤 contentPolicyModule 的完整 preset 可 replace |
| 实际 prompt/SDK/canonical 长行指引 | 1 PASS | 独立策略段、三原因、无擅自调配置/重挂载建议 |
| replace / patch / apply_patch 用户覆盖 | 3 PASS | 三种方式先无声明拒绝，再凭当前真实 Session 的唯一 user 夹具引用完成预期修改 |
| 4 MiB N-1/N/N+1、目标与无关长行 | 5 PASS | 4194303 字节可 mint，4194304/4194305 不 mint；有效 snapshot 降级；长行受限范围放行、完整普通行不借无关截断放行 |
| 混合请求与载荷冲突 | 2 PASS | 新建+未声明普通更新写前拒绝，新文件不存在；冲突载荷拒绝；零 writeText |
| 外部漂移与程序部分成功 | 2 PASS | 旧读取依据失效不写；前笔 Hashline 落盘后后笔失败，不被误报回滚 |
| 真实委派、自身 read、persona 覆盖 | 1 PASS | 父 read 引用被 `EDIT_POLICY_READ_CROSS_SESSION` 拒绝；子自行 read 后正确编辑；persona 覆盖后策略仍在 |
| 合法父用户来源追溯 | **1 FAIL** | 实际子代理引用本次父用户要求，被错误判为无关会话 |
| 官方 standard 同进程对照 | 1 PASS | 无策略段/无 fallbacks 字段，原生 replace 正常；目标 preset 仍拒绝无声明 replace |
| 创建/空文件/删除、BOM+CRLF 移动、空白/连续 BOM | 3 PASS | 新建沿 stock write；空文件与删除沿既有契约；Hashline PUT+MV 字节保真；空白/连续 BOM 不误放为普通空文件 |

合计为 **21 PASS / 1 FAIL**，不是整份 E2 的所有子项均已覆盖。

创建类特别边界：上游 create-shaped edit 在 observation policy 下仍可能拒绝缺失目标，这是 E1 已记录的旧限制。此处实际确认该错误不是 `EDIT_POLICY_*`，随后使用 stock write 完成真正新建；没有把新建的 edit 路径伪记成成功，也没有放松宿主策略。

父 read 隔离最初的测试断言写成 READ_UNKNOWN；实际返回更明确的 READ_CROSS_SESSION。已修正测试预期为真实契约，没有修改运行时错误或放宽守卫。

## 3. F-03：合法父用户覆盖来源被误拒

**判定：FAIL。** 对应 SRS FR-03、POLICY-09/POLICY-21；不影响前轮 F-01/F-02 修复已经通过的事实。

复现链为：

1. 在父 Agent 通过真实 user-source 消息给出唯一要求：只对 `delegated.txt` 用 replace 把 old 改为 NEW。
2. 父 Agent 经真实 `run_code → tools.subagent` 委派该任务。
3. 官方 spawn provider 创建同 preset 的真实子 Session；其 `header.parentSession` 指向父 Session。
4. 子自行 read，随后在 `user-override` 中引用父 Session ID、原用户片段、目标与 replace 方式。
5. 工具返回 `EDIT_POLICY_USER_SOURCE`：声称该 ID 既非当前会话也非委派父会话。

机器证据同时显示：父 Agent 仍在线；父 Session 中恰有一条符合引用的 user 消息；子 header 的父 ID 与被引父 ID 相同；`session.parentSession` 属性为 `undefined`；目标最终仍为 `old\n`，该目标 writeText 尝试为 0。

根因在 [verifyUserOverride](../../presets/ptc-hashline/policy/default-edit-policy.mjs)：实现读取 `session.parentSession`，并期待有 `.id` 和 `.snapshotEvents()` 的父 Session 对象。真实宿主没有这一对象属性，当前逻辑未走真实宿主的父来源查询/关联接口。

这是一条合法覆盖被误拒的功能问题。当前证据没有显示非法写入或授权绕过；父 read 隔离反而已正确拒绝。修复不能简单信任 header/fork 血缘，也不能搬运父 read/seen；应按规格核验真实委派关联、原始 user 事件与本次范围，查询不可用时继续明确拒绝。

同一失败已经在保留安装与**重新四包打包安装**两种运行中稳定复现。测试没有用 skip、宽松断言或手造父对象掩盖它。本轮仅登记新缺陷和红测，没有更改产品的父来源逻辑。

## 4. 可重跑入口及证据

新增 [完整宿主驱动](../../scripts/test-default-edit-host.mjs)，通过 `pnpm test:host-policy` 调用。在独立验证副本中先构建，使用唯一留证目录：

```powershell
pnpm check
pnpm test:host-policy --pack .scratch/host-policy/<runId>
```

`--pack` 复用已有交付安装逻辑，打包四个产物、安装到新 DSH_HOME、调用真实 launcher，然后启动本轮矩阵；测试安装和工作区保留。驱动不会自动构建，以免热改运行宿主链接的 dist。调用者应在隔离副本构建，或在已安排的停用窗口构建。

也可复用已保留的一次性安装：

```powershell
pnpm test:host-policy "<isolated>/dsh-home/profiles/acceptance" ".scratch/host-policy/<fresh-runId>"
```

仅接受名为 `dsh-profile-acceptance` 的测试安装 manifest；不会默认选择日常 profile。已有 `host-result.json` 的留证目录拒绝覆盖。当前受测实现会因 F-03 返回 **exit 1**，这是测试有效抓到缺陷，不是应消除的测试报错。

本轮原始留证（均被 Git 忽略，不随 clone 交付）：

| 路径 | 内容 |
|---|---|
| `.scratch/hashline-default-editing/effectiveness/20261025-e2-01/` | 探索装配、完整矩阵原型和运行证据 |
| `.scratch/hashline-default-editing/effectiveness/20261025-e2-02/` | 正式驱动首次重跑、父引用原始证据 |
| `.scratch/hashline-default-editing/effectiveness/20261025-fix-01/logs/host-full-pack.log` | 一键重新打包安装并执行的实际 exit 1 日志 |
| `.scratch/hashline-default-editing/effectiveness/20261025-fix-01/tree/.scratch/host-e2-final/` | 上述新安装事实、完整 raw host-result 与工作区 |
| `.scratch/hashline-default-editing/effectiveness/20261025-e2-final/` | 最终驱动的真实解析路径/版本、单引擎、回执、父关系、最终磁盘证据 |

正式仓库保存必要脱敏摘要与可重跑脚本，不复制原始会话/所有工具正文。脚本用固定模型适配器，不能将其请求数或脚本成功率转写为真实模型采用率/成本。

## 5. 尚未覆盖及推进顺序

机器摘要的 `E2Coverage` 按原方案逐项列出：E2-01/02/04/05 当前路径 PASS；E2-09 因父来源失败为 FAIL；E2-03/06/07/08/10/11/12 仍有部分子项 GAP。已执行场景不因同组另一个缺口被抹掉，也不以 21 条 PASS 覆盖剩余项。

尚需补齐：完整作用域的无必要上下文异常；更多字节窗口、混合拓扑/载荷组合；有效 cwd/配置变化与 remount 生命周期；实际内部 retry 竞争、取消/unknown；单 BOM 空文件填充所需字节保真及更多目标冲突。E1 中部分已有注入回归，不扩大成这些实际后端路径已跑过。

macOS/Linux 真实执行仍为 GAP（已有 CI 配置但未触发）。本轮没有更新日常 profile、重启宿主或执行真实模型；E3/E4 仍 BLOCKED。

下一步优先修 F-03，并补真委派、仅 fork 血缘、无本任务关联、错父会话、父不在内存与查询不可用的正反向。之后重跑本入口并完成其余 E2 子项，再给用户准备 DSH 真实模型行为任务。目前不需要用户在 DSH 重复这个已能自动复现的失败。
