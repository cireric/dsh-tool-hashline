# 02: 窗口读取只新增完整行 seen

**What to build:** 用户按 offset/limit 读取受行数、列长和输出字节上限约束的窗口；只有完整返回的行新增 seen。截断或零返回行仍得到可执行的 nextAction，避免重复读取同一前缀。

**Blocked by:** 01 — 普通文本 read→edit 首次成功。

**Status:** done (2026-10-23)

**Spec:** [权威规格入口](../spec.md)；FR-3/5/7/10/11、NFR-2/5；采用 ADR-0001 的完整行口径。

- [x] 默认 2000 行、2000 字符、51200 字节与 stock 对齐；offset/limit 为正整数，limit 超配置上限及 offset 越界按规格报错，错误时不 mint。
- [x] 分别验证普通分页 footer、列截断后缀与累计字节 capped footer；默认 200 KB 单行只要求列截断，多条未超列限的行才用于字节封顶用例。
- [x] 窗口只把未列截断的完整返回行号交给引擎 record，不把截断后缀当成文件内容；未 seen 锚点在未漂移且快照保留时首次被拒。
- [x] 字节上限小于首条展示行大小时返回零行窗口；全部返回行都列截断时同样按零完整行处理，传 [0] 而非空 seen。
- [x] 验证 [0] 初始拒绝、不撤销已有 seen、删掉哨兵会退化放行；完整错误回显后可原样重试，截断错误回显不扩充 seen。
- [x] 截断窗口的 canonical nextAction 提示调高 maxLineLength，必要时联动 maxBytes，并重新挂载后再读，或显式 replace/patch 降级；零返回行指明字节上限补救。
- [x] 不新增列分页或非 stock read 参数；同配置重复读取不能被描述为能够获得长行剩余列。
- [x] enabled、limit、maxLineLength、maxBytes 的有效值生效；数值配置为有限正整数，非法值挂载失败并指出配置项。snapshotMaxBytes 的阈值行为由 03 验证。
- [x] enabled=false 时自建 read 不注册；测试 stock read 与自建 read 的互斥、双关闭的排障状态、同时开启的挂载失败文案。
- [x] 单元与真实 ToolRuntime 集成随行为交付，并通过 test:unit/test:integration 运行；一次读取的 stat/readText 数量不增加。
## Comments

- 2026-10-23 实现完成。窗口语义在 `src/window.ts`（列截断先于字节封顶、超界抛 `FS_NOT_FOUND`、`totalLines` 覆盖全文），seen 只用 `complete` 行、零完整行传 `[0]`，见 `src/index.ts` 的 record 段。
- 证据：`pnpm test:unit` 40 passed；`pnpm test:integration` 21 passed（新增 `tests/integration/window-read.spec.ts` 14 例 + `tests/unit/seen-set.spec.ts` 4 例）。
- 覆盖：分页 footer / 列截断后缀 / `Output capped` footer 三态；200 KB 单行只触发列截断（无 capped footer）；60×1000 字符多行触发字节封顶且 seen=1–51；`maxBytes` 小于首行得到零行窗口、seen=[0]、nextAction 指向 maxBytes；配置 `limit`/`maxLineLength` 生效；非法配置挂载失败并点名；`enabled:false` 不注册、stock read 互斥、双关闭无 read、双开启挂载失败（root scope 文案为 `tool "read" is already registered (…)`，per-agent scope 才是规格引用的 `in this scope`，断言按正则匹配前缀）；未见锚点首次被拒、错误回显后可原样重试、`[0]` 不撤销既有 seen、删掉哨兵（invalidate 后无 seen 重录）后退化放行；read 参数面仍只有 file_path/offset/limit；一次读取 stat/readText 数量不变。
- 交接：`snapshotMaxBytes` 阈值行为按票面由 03 验证；"截断错误回显不扩充 seen"与 recovery/REM/block 等边界统一在 04 的 compat 用例固定。
