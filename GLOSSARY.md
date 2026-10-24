# dsh-tool-hashline

本仓库在 stock DSH 上补齐 hashline 编辑闭环：read 产出内容标识，edit 凭标识校验并落盘。本表只收本项目特有、且容易与相邻机制混淆的词。

## Language

**tag**:
整篇归一化文本的 4 位大写十六进制摘要，用于引用一版内容；它本身不证明当前会话仍保留该内容的 seen 记录。
_Avoid_: hash、version、snapshot id

**seen 行**:
一版内容中已记录为完整展示的行号集合；read 完整返回的行、编辑结果及错误中的完整回显都可能贡献记录。它表示工具层的展示事实，不保证 PTC 程序把这些内容全部打印给模型。
_Avoid_: 已读行、observed 行、read 行

**observed（已观察）**:
宿主文件策略记录的一次读取事实，决定后续写入是否被允许；与 seen 行是两套独立机制，各自按不同的键记录。
_Avoid_: 已读、read 过、seen

**show path**:
read 返回给模型的规范绝对路径，也是模型抄进编辑 header 的那个字符串。
_Avoid_: 绝对路径、file path、realpath

**store key**:
编辑侧查快照用的键，由会话的**有效**工作目录（宿主 `workingDirectory` 服务，不是 header 初始目录）与传入路径解析得出；read 侧必须算出同一个键。
_Avoid_: key、path key、snapshot key

**零行窗口**:
一次成功读取但窗口内没有任何返回行。它本身不新增任何 seen 行，也不撤销此前已有的 seen 记录。
_Avoid_: 空读、空窗口、无结果

**空文件**:
归一化文本不含任何字符的普通文本文件，包括零字节文件与仅含单个前导 BOM 的文件。仅含空白或连续 BOM 的文件不属于此概念。
_Avoid_: 零行窗口、零字节文件（仅是其中一种）

**目标窗口受限**:
当前 read 窗口上限使修改目标所需的完整行锚点或上下文无法通过分页获得的状态。它与是否已从获准的替代渠道取得完整内容是两个独立事实。
_Avoid_: 目标未覆盖、无关行截断

**行为改变型回合**:
会委派、拒绝、提问或改文件的用户回合；意图门只对这类回合收首行门行。
_Avoid_: 写操作回合、动作回合

**安装资源根**:
当前运行的 PTC Hashline bundle 所提供的资源位置；它不必是维护该项目的工作树。
_Avoid_: 项目根、维护仓库

**维护仓库**:
为本机 PTC Hashline 运维工作明确指定的源码工作树，负责承载依赖与补丁维护；不随当前业务项目切换。
_Avoid_: 当前工作目录、安装资源根

**升级目标**:
用户同意在候选验证后应用指定变更的项目或安装位置；它不因正在被使用就自动获得升级授权。
_Avoid_: 当前 profile、维护仓库

**候选验证**:
在独立环境中检验拟升级的 PTC Hashline 组合，尚不将该组合应用于用户的升级目标。
_Avoid_: 已升级、目标切换

**候选目录 / 候选树**:
方案只命名、验证时才创建的 `<evidenceDirectory>/upgrades/<proposalId>/candidate/`：`tree/` 是维护仓库快照（含未提交改动），自带 lockfile 与 store；`logs/` 是每条命令一份的完整输出；`result.json` 是机器可读结论。
_Avoid_: 目标安装树、日常 profile、仓库根 `.pnpm-store`

**候选基线**:
安装后在候选树里**重新采集**的解析结果（引擎版本、物理 realpath、补丁标记与摘要），用来证明本次验证的就是方案批准的那个组合。
_Avoid_: 方案里的 baselineHash（那是验证前的输入）、版本号相同即视为兼容

**目标切换**:
把已验证且获得用户同意的 PTC Hashline 变更应用到指定升级目标——方案里点名的那一个 profile 安装树，加上维护仓库自己的依赖与补丁。
_Avoid_: 候选验证、检查更新、全部 profile

**切换记录**:
`<evidenceDirectory>/upgrades/<proposalId>/switch.json`：本轮改了哪些文件（`writtenFiles` 的 before/after sha256）、每一步的退出码、目标解析到的引擎版本与补丁标记，以及三态结论；只追加列表，不改写方案、同意记录与候选报告。
_Avoid_: 已升级、升级成功、回退完成

**回退范围**:
方案 `rollback` 声明、回退时唯一会动的东西：本轮改动的依赖、补丁与安装状态。用户未提交输入与无关文件不在范围内，也永不覆盖。
_Avoid_: 全量还原、git reset、stash

**交接（handover）**:
切换失败但目标已被外部改动、备份不全或恢复后核对不到 baseline 时，只留证、停止，不覆盖任何文件，由用户看 `switch.json` / `rollback.json` 决定下一步。
_Avoid_: 自动修复、重试到成功、部分回退
