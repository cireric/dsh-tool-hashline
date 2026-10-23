# 07: 真正 PTC 下编辑与意图门契约成立

**What to build:** 在独立 ptc-hashline preset 中，模型只直接调用 run_code；程序能消费 read 的 tag 与受限/降级指引并完成编辑。缺意图行的内层编辑仍被继承的 gate 判据约束。

**Blocked by:** 02 — 窗口读取只新增完整行 seen；03 — 无 tag 和读取失败均有可执行结果；06 — 独立 bundle 在干净 profile 中可安装。

**Status:** done (2026-10-23)

**Spec:** [权威规格入口](../spec.md)；FR-1/2/3/13/14、M3、NFR-5/6；首版不改 gate 基线行为。

- [x] 提供 test:ptc，真正通过 run_code 派发 read/edit；不能仅直接调用 ToolRuntime 冒充 PTC 集成。
- [x] 模型直接调用 read 得到 UNKNOWN_TOOL；程序内 tools.read 正常返回 canonical value。
- [x] 程序可读 tag、tagged、nextAction；完整、列截断、零行窗口以及空文件/超过快照上限/无 session 的不 mint 原因均有覆盖。
- [x] 生成的 SDK 中 tag/nextAction 均为 string 或 null，不能退化 unknown；可空输出在 schema 重校验和程序调用中成立。
- [x] 合法意图行下的程序内 read→edit 首次落盘；有意缺失门行的行为工具调用得到一次拒绝及理由，内层 dispatch 同样被拦。
- [x] 验证每轮最多拒绝一次及正常只读回合的基线行为，不将现有 watchdog 描述为每次调用永久硬拒绝的策略。
- [x] 正常工具名仍为 read/edit；用隔离负向夹具把编辑改名 edit_hashline，检出按工具名匹配导致的门失效，不能修改交付 preset 的正式工具名。
- [x] PTC 拒后场景保留缺 tag/mismatch 当前 tag 与有效重读指引；canonical nextAction 不能靠 content 或 session log 替代。
- [x] 扩展 test:profile，在实际挂载的独立 preset 验证门正负场景和 PTC 主路径，保留迁入资源的摘要不变；内部 warn/catch 的继承行为由契约回归覆盖。

## Comments

- 2026-10-23 实现完成。新增 `pnpm test:ptc`（`vitest.ptc.config.ts`）：`tests/ptc/carrier.ts` 实现生产 `PtcRuntime` 契约（language/programFormat/bindings/result 分类），`tests/ptc/harness.ts` 以真实 `ToolRuntime(mode:'ptc')` + 本地 fs + 上游 `edit` + 迁入的 watchdog 组装；程序一律经 `run_code` 派发。
- 覆盖（9 例全绿）：模型直接 `read` → `UNKNOWN_TOOL`，程序内 `tools.read` 正常；程序读 `tag/tagged/nextAction` 并用该 tag 首次编辑落盘；生成的 `tools:sdk` 段含 `tag: string | null` / `nextAction: string | null` 且不是 `unknown`；空文件、超快照上限、窗口截断等原因在程序内可见；缺 `Intent:` 行时首个行为动作被拒一次（'Intent' 文案）且第二轮放行；合法桶 `Intent: fix — …` 放行；纯只读程序不受门影响；把编辑改名为 `edit_hashline` 的隔离夹具不再被门拦下（按工具名匹配的负向证据）；PTC 内 mismatch 仍带当前磁盘 tag 与英文重读指引。
- `pnpm test:profile` 扩展：额外用 profile 解析到的 watchdog 资产做「缺行 deny / 合法行 allow」两断言，与实际安装的 bundle 资源一致。
- 口径/缺项：PTC 载体是进程内实现，覆盖 schema→SDK、`value` 传递、内层 dispatch 与`tools/pre-execute`；未覆盖 Node 子进程隔离/沙箱（`dsh-ptc-runtime-node` 的运行时属性，本机无模型 key，08 登记为明确缺项）。门控的 `agent/pre-step` 与 `session/event` 事件由夹具按真实形状投递，非真实 agent loop。
