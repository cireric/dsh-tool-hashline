# Hashline 块定位缺失：归属、性质与修复必要性

> 后续状态（2026-10-25）：说明与诊断已通过[正式补丁及隔离交付验收](../acceptance/2026-10-25-hashline-block-locator-fix.md)。下文记录修复前的研究基线；空 resolver 与旧错误文案不代表修复后产物。块解析能力仍未实现。

日期：2026-10-25（Asia/Shanghai）。调查基线：本仓库 HEAD `66d2a42`、已安装 `@hy-sde-org/dsh-tool-edit` / `dsh-hashline` `0.2.1-alpha.4` 加本地补丁。当前用户的 E3 报告与验收索引改动保留。本次仅研究、纯引擎探针及记录问题，没有修改运行依赖、引擎或目标 profile。

## 结论

`PUT N*:` / `CUT N*` 不可用，是**上游显式留空的移植能力**，不是本仓库 `packages/tool-edit` 自己实现错误，也没有证据表明是本次默认编辑策略引入的回归。源码 TODO 表明该能力尚待实现；称为永久设计取舍超出现有证据。

工具说明继续推荐不可用语法、错误提示未说明解析器缺失，是另外两项已确认的不一致。建议优先修正说明与诊断；完整解析器接入是可选功能扩展，目前没有必要作为默认编辑策略修复的前提。本次没有实施这些建议。

## 1. 问题清单与处置建议

| 本地票据 | 已确认问题 | 性质 | 建议 |
|---|---|---|---|
| 01 | 当前 adapter 的块 resolver 恒返回 null，块替换/剪切不可执行 | 上游已知未实现能力；本项目继承的边界 | 记录为不支持；暂不补完整解析器 |
| 02 | 实际工具说明仍推荐 `PUT N*:` / `CUT N*` | 上游说明/实现不一致，同时影响本项目交付 | P2：应修正能力说明和替代写法 |
| 03 | 缺解析器被报成语言、空行/闭合行或解析错误 | 上游 adapter 与引擎错误分类不匹配 | P2：应明确 unavailable 原因，保留安全拒绝 |

票据与原始探针保存在被忽略的 `.scratch/hashline-block-locators/`；正式结论保存在本文。是否为 bug 按层判断，不能用“来自上游”或者“作者有意留空”同时回答全部问题。

## 2. 归属：三个包层次

1. 本仓库 [packages/tool-edit/src/index.ts](../../packages/tool-edit/src/index.ts)只有重导出；[package.json](../../packages/tool-edit/package.json)精确依赖上游 alpha.4。它是版本锚点，没有自己的块定位算法。
2. 上游 `@hy-sde-org/dsh-tool-edit` 是 DSH 适配器，决定把哪个 resolver 注入执行与预览。本地安装的 `dist/hashline/block-resolver.js` 恒返回 null；`.d.ts` 注释解释原生解析器未移植，并保留 TODO。本仓库现有 tool-edit/hashline patch 均没有修改这个模块或恢复块解析。
3. 上游 `@hy-sde-org/dsh-hashline` 是通用纯引擎。它定义可注入的同步 `BlockResolver`，接收路径、文本及起始行，返回块范围或 null；引擎预留接口不等于 DSH adapter 已经提供实现。

上游维护入口已迁到 [hy-sde/dsh-plugins](https://github.com/hy-sde/dsh-plugins)，独立仓库 [README](https://github.com/hy-sde/dsh-tool-edit#readme)指向该入口。本文没有向上游提交 issue 或 PR。

## 3. 上游意图与当前状态

查询时上游 main 为 `e5f236283c457fbe3e1eec61f79a50d7b38e733a`。其 [resolver 源码](https://github.com/hy-sde/dsh-plugins/blob/e5f236283c457fbe3e1eec61f79a50d7b38e733a/dsh-tool-edit/packages/tool-edit/src/hashline/block-resolver.ts)仍显式返回 null，注释解释移植时没有原版依赖的 native，保留接口等待后续解析器接入。这证明作者知道该空实现，不证明作者已决定永久不支持。

与此同时，[工具 constants](https://github.com/hy-sde/dsh-plugins/blob/e5f236283c457fbe3e1eec61f79a50d7b38e733a/dsh-tool-edit/packages/tool-edit/src/constants.ts)仍推荐上述块替换和块剪切；[README](https://github.com/hy-sde/dsh-plugins/blob/e5f236283c457fbe3e1eec61f79a50d7b38e733a/dsh-tool-edit/README.md)对移植完整度的描述也未充分反映此限制。因此，未实现本身有明确意图，而说明同步不足依然是问题。

该文件当前路径的历史查询只返回 [2026-09-09 monorepo 迁移提交](https://github.com/hy-sde/dsh-plugins/commit/57fbe6ed11e2f1b5b20c853965cc4eae5c481dab)。迁移前完整历史未穷尽，不能断言最初决策时间，亦不据此声称每个历史版本都没有实现。

上游当前 [package.json](https://github.com/hy-sde/dsh-plugins/blob/e5f236283c457fbe3e1eec61f79a50d7b38e733a/dsh-tool-edit/packages/tool-edit/package.json)声明版本 rc.3，registry latest 查询也为 rc.3，但本次未下载核验其发布 tarball，当前 main 又仍是空实现，**没有已验证可通过升级解决本问题的版本**。不建议据版本号直接升级。

## 4. 本地行为核验

直接调用已安装引擎的 `Patch.parseSingle` 与 `resolveBlockEdits`，注入实际 adapter 导出的 resolver；分别换用 js/ts/py/md 路径，固定同一文本。探针不执行文件系统编辑，不替代真实宿主测试：

| 语法 | 次数 | 引擎结果 |
|---|---|---|
| `PUT 1*:` | 4 | 全部拒绝 |
| `CUT 1*` | 4 | 全部拒绝 |
| `PUT >1*:` | 4 | 全部降为普通行后 insert，产生降级警告 |

所以应明确说“块替换和块剪切不可用”，不扩大成“所有 N* 一律抛错”。显式范围仍能用于编辑，但自动确定语法块边界这项能力确实缺失。

本地执行器多 section 先全部 prepare，再开始 commit；块替换/剪切解析失败在准备阶段拒绝，不应撤销拒绝来伪造可用性。先前报告中的最终文件字节不变，不单独证明零写入尝试，也不表示同一 PTC 程序更早的 edit 会被撤销。

引擎已有缺 resolver 的明确消息，但 adapter 传入的是一个存在的函数，因此没有进入 `!resolver` 分支，返回 null 后变成语言/锚点解析失败消息。修正应区分“adapter 没有该能力”和“可用解析器无法解析这次输入”，同时核验块后插入/粘贴的既有降级语义。

## 5. 是否违反本项目需求

[基础规格 §2](../specs/2026-10-22-ptc-hashline-requirements-spec.md)明确不重新实现 hashline 引擎、不做 AST/LSP；[默认策略规格 §2.1](../specs/2026-10-24-hashline-default-editing.md)也没有把语法或 AST 正确性作为 Hashline 的保证。当前交付不因此必须补一个块解析器。

此外，[10-23 能力分析 §3.3](2026-10-23-dsh-hashline-feature-analysis.md)已记载空 resolver，[兼容测试说明](../../tests/compat/README.md)已列出块操作未执行的缺口。这不是新发现的实现回归；本次真机结果使已有边界得到进一步印证。历史分析中“需 native”“即可接回”的措辞过窄或过于乐观：解析器可有其他实现形式，但接入与正确性仍需设计验证。

本项目当前仍把上游说明交给模型，因此来源在上游不免除本项目对实际交付说明的责任。可以接受功能边界，同时修正边界的表达。

## 6. 修复优先级与投入

**现在值得做：** 经正式 `patches/` 修正模型可见说明，明确不支持块替换/剪切及显式范围替代；让不可用错误准确指出 adapter 没有解析器。需新增针对性行为/说明回归，再按交付规则在隔离安装跑门禁。修正不应顺带删除通用引擎的块接口，或改变全部块后插入的语义。

**目前不建议做：** 为此引入解析器或直接升级依赖。普通 Hashline 编辑已有显式范围路径，本次没有统计块定位缺失导致的失败率、上下文成本或收益，不足以证明恢复功能的投入值得。

**后续值得评估的条件：** 实际任务反复需要跨语言块级编辑，显式范围明显增加出错/成本；或者上游交付了可核验的解析器实现。届时单独定义语言支持、块起止规则、快照文本一致性、CRLF/Unicode 坐标、资源生命周期、失败策略、跨平台依赖与验收，再比较自建 patch 和上游方案。

现有 LSP 客户端只有格式化/诊断接口；`BlockResolver` 当前为同步调用，LSP 请求异步，且文档符号范围未必等同现有块语义。因此“已有 LSP 文件，可用 documentSymbol 直接替换桩”只是未经验证的方案设想，不能作为已知低成本修复路线。

本次没有修改用户的真机报告、E3 验收记录或现有运行文件；也没有提交本轮研究文件。
