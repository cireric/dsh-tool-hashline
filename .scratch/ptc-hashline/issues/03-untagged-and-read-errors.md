# 03: 无 tag 和读取失败均有可执行结果

**What to build:** 对空文件、超过快照上限的文本和无 session 调用，read 返回可用窗口与明确降级指引；对读取失败返回真实错误，不伪造 tag。用户能据返回结果选择 write、显式替换/补丁或修正读取条件。

**Blocked by:** 01 — 普通文本 read→edit 首次成功。

**Status:** ready-for-agent

**Spec:** [权威规格入口](../spec.md)；FR-3/9/14、snapshotMaxBytes 配置、NFR-2/3/5。

- [ ] BOM 先 strip，再 normalizeToLF；tag 与上游一致。BOM、CRLF、空白行、尾换行的窗口与 stock 对照，不新增虚构末尾行。
- [ ] 归一化文本为空时不 mint，返回空窗口、totalLines=0、tagged=false、tag=null，nextAction 引导用 write 创建内容。
- [ ] 无 agent.session 时不 mint，不依赖一次性 store 建立假共享；nextAction 说明原因并给显式替换/补丁路径。
- [ ] snapshotMaxBytes 默认 4194304，比较归一化文本的 UTF-8 字节数；达到阈值即不 mint，保留窗口并给降级 nextAction，不把 stat.size 作为最终门槛。
- [ ] 验证阈值 N-1/N/N+1、多字节字符、BOM/CRLF 归一化差异和 size 未知；配置非法值挂载失败。
- [ ] 大文件和 size 未知文件仍仅一次 stat + 一次全文 readText，不加流式读取；文档和返回值不宣称 4 MiB 是读取内存上限。
- [ ] 真实上游 edit 的 replace/patch 模式在无 tag 场景可用；验证不依赖 hashline seen 许可。
- [ ] 不存在时同步发 absent observed 并报 FS_NOT_FOUND；目录报 FS_NOT_REGULAR_FILE；二进制/非法 UTF-8 报 FS_NOT_TEXT，均不 mint。
- [ ] provider 无权限、取消及其他异常保留原 code/message，用可控 provider 与 stock read 对照；异常经 ToolRuntime 形成 isError，不空 catch 或伪装为不存在。
- [ ] 全部成功不 mint 情况均满足 tagged=false、tag=null、非空 canonical nextAction；随票交付单元和真实宿主集成用例，不只验证渲染文本。
