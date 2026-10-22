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
编辑侧查快照用的键，由会话工作目录与传入路径解析得出；read 侧必须算出同一个键。
_Avoid_: key、path key、snapshot key

**零行窗口**:
一次成功读取但窗口内没有任何返回行。它本身不新增任何 seen 行，也不撤销此前已有的 seen 记录。
_Avoid_: 空读、空窗口、无结果

**行为改变型回合**:
会委派、拒绝、提问或改文件的用户回合；意图门只对这类回合收首行门行。
_Avoid_: 写操作回合、动作回合
