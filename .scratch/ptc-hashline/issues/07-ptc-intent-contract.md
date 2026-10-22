# 07: 真正 PTC 下编辑与意图门契约成立

**What to build:** 在独立 ptc-hashline preset 中，模型只直接调用 run_code；程序能消费 read 的 tag 与受限/降级指引并完成编辑。缺意图行的内层编辑仍被继承的 gate 判据约束。

**Blocked by:** 02 — 窗口读取只新增完整行 seen；03 — 无 tag 和读取失败均有可执行结果；06 — 独立 bundle 在干净 profile 中可安装。

**Status:** ready-for-agent

**Spec:** [权威规格入口](../spec.md)；FR-1/2/3/13/14、M3、NFR-5/6；首版不改 gate 基线行为。

- [ ] 提供 test:ptc，真正通过 run_code 派发 read/edit；不能仅直接调用 ToolRuntime 冒充 PTC 集成。
- [ ] 模型直接调用 read 得到 UNKNOWN_TOOL；程序内 tools.read 正常返回 canonical value。
- [ ] 程序可读 tag、tagged、nextAction；完整、列截断、零行窗口以及空文件/超过快照上限/无 session 的不 mint 原因均有覆盖。
- [ ] 生成的 SDK 中 tag/nextAction 均为 string 或 null，不能退化 unknown；可空输出在 schema 重校验和程序调用中成立。
- [ ] 合法意图行下的程序内 read→edit 首次落盘；有意缺失门行的行为工具调用得到一次拒绝及理由，内层 dispatch 同样被拦。
- [ ] 验证每轮最多拒绝一次及正常只读回合的基线行为，不将现有 watchdog 描述为每次调用永久硬拒绝的策略。
- [ ] 正常工具名仍为 read/edit；用隔离负向夹具把编辑改名 edit_hashline，检出按工具名匹配导致的门失效，不能修改交付 preset 的正式工具名。
- [ ] PTC 拒后场景保留缺 tag/mismatch 当前 tag 与有效重读指引；canonical nextAction 不能靠 content 或 session log 替代。
- [ ] 扩展 test:profile，在实际挂载的独立 preset 验证门正负场景和 PTC 主路径，保留迁入资源的摘要不变；内部 warn/catch 的继承行为由契约回归覆盖。
