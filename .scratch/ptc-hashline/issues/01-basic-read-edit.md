# 01: 普通文本 read→edit 首次成功

**What to build:** 在真实宿主工具运行时中，以自建 read 读取普通小文本，返回可共享的内容 tag；同 session 用该 tag 修改完整返回的行锚点，首次即成功落盘。此票交付最小可验证路径，不依赖完整 preset 或 UI。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

**Spec:** [权威规格入口](../spec.md)；FR-3/4/6/7/8、NFR-1/2/4/5；DSH 0.2.1-rc.2，hashline/tool-edit 精确锁定 0.2.1-alpha.4。

- [ ] 注册完整 read，参数保持 file_path/offset/limit；不用 post-execute 装饰器，不修改或复制上游引擎与编辑器实现。
- [ ] 普通有效小文本的 canonical value 包含 path、tag、tagged、offset、lines、totalLines、nextAction；tagged=true，tag 与引擎独立计算相同，nextAction=null。
- [ ] tag/nextAction 的 nullable schema 使用 oneOf；为后续 PTC 类型生成保留正确的 string 或 null 契约。
- [ ] 默认窗口返回行号、正确 footer；tag header 位于 stock 文本信封的 content 内首行。
- [ ] 快照归属 exec.agent.session；cwd 与 store key 算法保持 edit 一致；普通路径 read 后能查到同 hash 快照。
- [ ] read 与 edit 解析到同一物理 hashline 模块，并对声明的精确版本和模块 identity 作断言。
- [ ] 成功 read 发 present observed，version 来自唯一 stat；真实 stock write 随后成功，去掉 emit 的阴性对照报 FS_NOT_OBSERVED。
- [ ] 使用真实 ToolRuntime 与上游 edit 验证 read→edit 首次成功，断言实际磁盘文本改变；测试不能用自制 edit 代替上游。
- [ ] 有效文本读取仅一次 stat、一次 readText；跨进程同内容 tag 一致。自建 read 没有宿主包运行时 import 或空 catch，错误不得被吞掉。
- [ ] 随此票建立可执行的 test:unit 与 test:integration 入口及必要夹具；类型检查与本票行为测试通过，历史 post-execute 实验不算新增功能覆盖。

## Scope boundary

窗口截断、配置边界由 02 交付；无 tag 与读取错误由 03 交付；多路径键、连续编辑和上游有限守卫边界由 04 补齐；完整卡片由 05 交付。后续票未完成前，本票成功不代表插件已可投入日常 profile。
