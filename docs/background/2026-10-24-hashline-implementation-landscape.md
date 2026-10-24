# Hashline 实现路线与本项目后续方向

调研日期：2026-10-24  
范围：oh-my-pi 当前公开实现文档、DeepSeek Harness GitHub 社区 hashline 项目的公开仓库说明，以及本项目现有实现/验收状态。  
用途：架构背景与后续需求讨论，不构成已批准的功能规格或升级授权。

## 结论摘要

Hashline 的核心不是某一种短哈希，而是把模型看到的文件快照、可定位的行/块锚点和写入前验证连成闭环。本项目已采用 hy-sde 的 hashline 引擎与 DSH 编辑工具，并自行实现面向 PTC 的 `read` value；有效工作目录、同一物理引擎实例、MV 创建意图/快照顺序和有限 seen 语义已有专门处理。

后续建议按此顺序推进：

1. 先关闭目标 DSH 环境中的端到端验收缺口，明确 session resume 时快照/seen 的行为。
2. 再评估编辑结果的可理解性和文本字节保真范围，例如恢复原因、警告、diff、mixed EOL 与末尾换行。
3. 将 undo、grep/AST/LSP 视为独立可选能力，先定范围和持久化/安全契约，不扩大 read 运行时依赖。
4. 依赖升级继续以解析路径、实际 patch 证据和兼容矩阵为门槛。

这些是基于现有证据的方向建议，不是已批准需求。当前验收索引明确列出的 gaps 仍应以其原有范围为准。

## 1. Hashline 的共同技术骨架

公开实现大致由以下部分组成：

```text
可编辑文件读取
  → 生成内容版本标识与行/块锚点
  → 保存快照及可见内容来源
  → 编辑请求引用旧快照与锚点
  → 写入前验证文件版本、锚点、范围和重叠
  → 提交并返回新锚点、差异或可恢复错误
```

oh-my-pi 文档描述 `[PATH#TAG]` 文件级 tag、原始快照行号、多种 PUT/CUT/INS/PASTE/REM/MV 操作、seen 行限制、块锚点和 stale recovery。工具以一次调用应用 hashline；它会准备请求后提交各 section，文件系统层故障仍可能产生部分成功。成功结果可包含新 tag、预览、diff、诊断、move 信息和 warnings。[oh-my-pi edit 文档](https://github.com/can1357/oh-my-pi/blob/main/docs/tools/edit.md)；[oh-my-pi hashline prompt](https://github.com/can1357/oh-my-pi/blob/main/crates/pi-edit/prompts/hashline.md)

oh-my-pi 的 read 面比本项目更宽：支持路径选择器、结构摘要、范围读取和多种来源；对可编辑的本地读取记录 session snapshot/seen。hashline header 只在可编辑、非 raw 的适用读取中输出。[oh-my-pi read 文档](https://github.com/can1357/oh-my-pi/blob/main/docs/tools/read.md)

短 tag/锚点仅是定位协议的一部分。正确性还依赖快照保存、seen provenance、碰撞和歧义处理、文件版本 CAS、字符编码与换行策略，以及失败后的反馈。

## 2. oh-my-pi 与 DSH 社区路线

### oh-my-pi

- 文件级四位十六进制 tag 绑定规范化快照；行号在同一 patch 中指向原始快照。
- seen 记录用于限制模型修改未展示内容；成功编辑返回可继续使用的新 tag。
- stale recovery 尝试用快照历史和内容映射安全恢复；不确定时应退回 mismatch/reveal，而非猜测。
- 可用语法包括范围/块替换、插入、剪切/寄存器粘贴、删除和移动；tree-sitter 可解析的 block anchor 会从起始行解析到语法节点末尾。
- 新近公开 issue 记录了 session resume 后内存快照缺失导致 seen 检查无法还原的问题，修复路线是在 provenance 不足时拒绝锚点替换并要求重新完整读取。[issue 与修复讨论](https://github.com/can1357/oh-my-pi/issues/16171)

这条路线提供的是活跃上游行为参考，不代表本仓库锁定的 `0.2.1-alpha.4` 已包含当前 main 的全部行为。升级前必须以本仓库版本锚点和 patch 检查为准。

### hy-sde/dsh-tool-edit：本项目当前采用的引擎路线

该项目将 `@hy-sde-org/dsh-hashline` 作为纯编辑引擎，将 `@hy-sde-org/dsh-tool-edit` 作为 DSH `edit` 插件。编辑器还提供 replace、patch、apply_patch，并声称支持 optional LSP 格式化与诊断；它把 filesystem observation、edit intent 和版本检查接入 DSH 契约。[仓库 README](https://github.com/hy-sde/dsh-tool-edit)

这是本项目的直接依赖路线。本仓库使用精确版本锚点和本地 patch，没有复制上游实现；自有 `tool-read` 负责让 tag 和补救字段进入 PTC 消费的 canonical value。[workspace 锁定](../../pnpm-workspace.yaml) · [read 主链路](../../packages/tool-read/src/index.ts) · [兼容矩阵](../../tests/compat/README.md)

### 社区项目的不同取舍

以下细节来自项目自己的 README，属于作者声明；本次没有克隆、运行或独立验证这些项目。

| 项目 | 作者描述的路线 | 可供本项目评估的问题 |
|---|---|---|
| [magian1127/deepseek-harness-hashline](https://github.com/magian1127/deepseek-harness-hashline) | 独立 `hashline_read`/`hashline_edit`，也可替换内置 read/edit；4 位行哈希、锚点编辑、整批校验/拒绝重叠、版本 CAS，并声明保留 BOM、EOL、mixed EOL 和末尾换行；失效锚点唯一匹配时可重定位，否则失败。项目标为 experimental。 | 批量编辑原子性、文本字节保真和显式锚点/整批验证矩阵。自动重定位是否符合本项目的有限守卫决策。 |
| [ddv12138/dsh-hash-edit](https://github.com/ddv12138/dsh-hash-edit) | 3 位 base-62 行锚点，read/replace/undo；README 声明跨重启持久化 undo，过期或歧义锚点严格拒绝。 | undo 的状态持久化、撤销时的版本条件与冲突处理。 |
| [InklingYoshi584/dsh-tool-hashline](https://github.com/InklingYoshi584/dsh-tool-hashline) | read/edit/grep；行锚点校验，不自动恢复 stale anchor；grep 结果可直接供 edit 使用；提到 context hash 和多个编辑操作。 | grep→edit 闭环、错误可解释性；对不自动恢复策略的取舍。 |
| [hyperion2144/dsh-hashline-edittool](https://github.com/hyperion2144/dsh-hashline-edittool) | README 描述更广的工具组，包括可变长度锚点、undo、AST grep/edit 和 LSP。 | 判断扩展是否应留在可选工具层，以及由谁维护 AST/LSP 依赖与兼容性。 |

不同项目的锚点格式、store、读写契约及部署模型并不兼容，不能仅凭 README 的相似功能就替换本仓库的引擎。

## 3. 本项目已有能力与限制

- 自有 `read` 返回 `{path, tag, tagged, offset, lines, totalLines, nextAction}`，并把 PTC 所需字段放进 canonical value。读取全文后再构造受限展示窗口。[read 实现](../../packages/tool-read/src/index.ts) · [需求 FR-3/FR-5/FR-7](../specs/2026-10-22-ptc-hashline-requirements-spec.md)
- read 与 edit 使用有效 working directory；snapshot key 包含输入路径与模型可回抄的 show path；两端须解析到同一物理 hashline 实例。[ADR-0003](../adr/0003-effective-working-directory.md)
- seen 按上游有限守卫处理。read 只加入完整返回行；零完整行使用 `[0]`；不能声称 seen 是完整权限边界。恢复、快照淘汰、跨 session 和 replace/patch 等存在明确边界。[ADR-0001](../adr/0001-inherit-bounded-seen-guard.md)
- MV 的目标创建、不覆盖、部分成功和磁盘先于 snapshot 的顺序由本地 patch 维护。[ADR-0004](../adr/0004-mv-create-intent-and-snapshot-order.md)
- BOM 保真目前限于 Local provider 的 hashline 路径、零或单个 BOM；连续 BOM 被拒绝。其他 provider 和 edit 模式没有从当前证据获得相同保证。[ADR-0005](../adr/0005-bom-preserving-hashline-read.md)
- 当前验收记录有真实 sandbox、多 provider、更广泛 BOM 模式和完整真实 PTC 后端生命周期等范围限制。它记录已有门禁结果，但本调研没有重跑门禁。[验收索引](../acceptance/2026-10-23-current-status-and-evidence-index.md)

## 4. 下一步方向建议

### P0：端到端证据与 session resume 语义

先按目标部署补真实 PTC 执行后端和目标 filesystem provider 的验证。尤其需要针对“进程/会话恢复后 session snapshot store 是否仍有 seen provenance”作需求决策：选择持久化必要状态，或在缺少 provenance 时让相关编辑 fail closed 并要求重新读取。不要把 oh-my-pi 当前修复直接移植到本项目；本项目现有规格接受若干上游有限守卫边界，需要先修订规格及验收矩阵。

依据：本项目当前验收索引明确写明真实后端生命周期、sandbox/provider 与 BOM 范围限制；oh-my-pi 的 resume issue 展示了相邻实现中快照生命周期可能影响 seen 约束。[本项目验收索引](../acceptance/2026-10-23-current-status-and-evidence-index.md) · [oh-my-pi issue #16171](https://github.com/can1357/oh-my-pi/issues/16171)

### P1：结果诊断与字节保真契约

评估返回值和展示结果是否需要更清楚地呈现恢复原因、drift warning、编辑后新 tag、有限预览或 diff。先明确 PTC `value` 与用户可见 `content`/卡片分别承载哪些信息。

另行定义 BOM、CRLF、mixed EOL、末尾换行在 Local 及其他 provider、hashline 与 replace/patch 模式中的支持矩阵。社区 README 中的字节保真声明可提供测试维度，但不能直接作为本项目承诺。

依据：oh-my-pi 文档列出新 tag、预览、diff、warnings 与多 section 结果；本项目已有 BOM ADR，但验收范围窄于所有 provider/模式。[oh-my-pi edit 文档](https://github.com/can1357/oh-my-pi/blob/main/docs/tools/edit.md) · [本项目 ADR-0005](../adr/0005-bom-preserving-hashline-read.md)

### P2：undo 与搜索/结构编辑作为可选能力

如要提供撤销，独立确定记录存储位置、持久化期限、内容敏感性、版本冲突、跨进程恢复和部分成功行为。不要默认将 undo 数据塞入现有 snapshot store。

如要做 grep→edit、AST 或 LSP，先检查 DSH 现有工具及 hy-sde tool-edit 是否已覆盖目标，再决定是否新增工具或复用上游能力。将它们保持在可选工具层，避免增加 `tool-read` 运行依赖和核心 read/edit 闭环的升级负担。

依据：ddv 项目将跨重启 undo 作为独立功能；其他社区路线把 grep、AST/LSP 放在编辑工作台周围，而非锚点格式本身。[ddv README](https://github.com/ddv12138/dsh-hash-edit) · [hy-sde README](https://github.com/hy-sde/dsh-tool-edit) · [Inkling README](https://github.com/InklingYoshi584/dsh-tool-hashline)

### 持续要求：按版本维护上游兼容证据

升级 hashline、tool-edit 或 DSH 时，逐项核对本地 patch 是否已被上游解决、实际解析路径和补丁标记，再运行 compat 与真实 Session 定向矩阵。不要以“版本号相同”推断 patch 已生效。[兼容矩阵与升级规则](../../tests/compat/README.md)

## 5. 证据边界

- oh-my-pi 链接指向公开 GitHub 文档/源码页面，main 会变化；其行为不能直接等同本项目锁定的上游版本。
- 社区插件的功能描述主要来自各自 README。没有对其进行本地构建、测试或独立性能对比。
- 本项目现状依据仓库代码、规格、ADR 和验收索引；调研过程中没有运行测试。
- 建议是待确认的产品/架构方向，不修改现行规格，也不授权真实 profile 升级或目标切换。
