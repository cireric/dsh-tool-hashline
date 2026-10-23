# hashline 编辑的 BOM 保持：编辑适配器专用读取入口

日期：2026-10-23
状态：已采纳（mv-rem-bom-and-snapshot-repair-plan r2 阶段 B）
关联：[ADR-0003](./0003-effective-working-directory.md)、[ADR-0004](./0004-mv-create-intent-and-snapshot-order.md)、
[修复验收](../acceptance/2026-10-23-bom-and-snapshot-repair-acceptance.md)、[当前状态与证据索引](../acceptance/2026-10-23-current-status-and-evidence-index.md)

## 背景

修复前，已复现的 hashline 写通路径（纯 PUT、PUT+MV、纯 MV）会丢弃文件开头的 UTF-8 BOM。实测归因
（本地 `.scratch/ptc-hashline/evidence/20261023-1453/07-bytes-bom-attribution.log`，不随 clone 交付；当前回归入口见上述索引）：

- 宿主 `FileSystem.readText` 的契约是"解码后的 UTF-8 文本"，**不承诺**保留 BOM。已核实的固定
  provider（`LocalFileSystem`）用 `new TextDecoder('utf-8', { fatal: true })`
  （`fs-local/src/fsio.ts:348`），默认 `ignoreBOM: false`，因此先吃掉一个前导 BOM。
- `EditFilesystem`（`tool-edit`）没有 `readBinary`，于是 `Patcher` 的
  `#readBinaryBom` 短路返回 `""`；`prepare` 里 `stripBom(text).bom` 也为空，`persisted`
  就不含 BOM——落盘即丢标记。

单纯的 PUT 同样复现，所以这不是 MV 的问题，而是编辑适配器与 provider 解码语义之间缺失的一环。

## 决策

在 **tool-edit 的本地精确版本补丁**内增加一个专用读取入口
`FileReader.readTextPreservingBom(target, signal)`，由 `createEditSession` 构造，
只被 `EditFilesystem.readText` 调用：

1. `stat` 取 v0（缺失 → `FS_NOT_FOUND`，非普通文件 → `FS_NOT_REGULAR_FILE`）；
2. `fs.readText`（沿用 provider 的 UTF-8 / 二进制检查）；
3. `fs.readByteRange(target, { offset: 0, length: 3 })` 取原始前缀；
4. 再 `stat` 取 v1；v1 缺失或 `version` 不同 → `FS_STALE_VERSION`；
5. 前缀是 `EF BB BF` → 在文本前恢复**一个** `U+FEFF`；否则原样返回；
6. 只有前述全部通过后才 `emit fs/observed(present, v0)`。

写入仍完全走原有 `writer`/`policy`/`sandbox`；引擎的 `stripBom`/`normalizeToLF`/`hash`/
`restoreLineEndings` 与 tag 算法都不改。

**支持范围（有意收窄）**：已核实的固定 Local provider、**零或单个**初始 BOM。
若前缀是 `EF BB BF` 而解码文本仍以 `U+FEFF` 开头，说明存在连续前导标记：专用入口在恢复、
成功 observed 与 `snapshot.record` 之前抛普通 `Error`（"当前 hashline 保真编辑不支持连续前导
BOM，文件未修改"），不发明 `FS_*` 码，也不走 mismatch/recovery 自动改写。要支持多标记必须先统一
read/edit/diff 的规范，不在本轮范围。

## 为什么不选其它路线

- **实现引擎 `readBinary`**：引擎承诺返回全文字节，接 `readBytes` 会多一次全文读取；只返回前
  三字节则违约。
- **给引擎新增 `readBom` 接口**：要同时改两份补丁，扩大上游面。
- **全局改 `reader.readText`**：会改变 replace / patch / apply_patch 与 hashline diff preview 的
  既定行为，等于顺手重定义所有编辑模式的解码语义。

因此保留一个明确的、仅 hashline 适配器可见的能力。JS 与导出的 `.d.ts` 一起交付，
`readTextPreservingBom` 是必填方法（不做 optional + 静默降级）。

## 后果

- BOM、CRLF/LF 与末尾换行在支持范围内逐字节保持；无 BOM 文件不会被凭空加上标记。
- 每次 hashline 适配器 read 多一次三字节范围读取与一次收尾 `stat`；REM、noop、recovery、
  preflight 也走这条入口。`read` 工具本身不变（仍一次 `stat` + 一次 `readText`）。
- 三次读取**不是**一个原子快照；版本检查只是把窗口缩小。已知并发窗口与"MV 源删除无版本条件"
  一样，是本轮接受边界。
- `replace`/`patch`/`apply_patch` 的 BOM 行为未做系统确认，本轮只保证不退化。
- 升级 `dsh-tool-edit` 时必须重新核对：上游若已提供保 BOM 的读取语义，删除补丁；否则按新版本
  重做，不得只改 `node_modules`。
