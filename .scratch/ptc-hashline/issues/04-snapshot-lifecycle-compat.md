# 04: 连续编辑与有限守卫边界可回归

**What to build:** 两个窗口读取后保留 seen 并集；输入路径或 show path 编辑都能命中快照，编辑结果产出的新 tag 可继续使用。通过可重复的兼容用例固定上游有限守卫和外部漂移行为，避免将已知放行误认成严格保护。

**Blocked by:** 02 — 窗口读取只新增完整行 seen。

**Status:** ready-for-agent

**Spec:** [权威规格入口](../spec.md)；FR-7/8/9/13、R-2/4/7/8、ADR-0001；精确锁定的上游版本行为是本票兼容基线。

- [ ] 两次读取同文本只依赖引擎合并 seen；先读 1–50 与 400–450 行后，各窗口的已见锚点都能编辑，不自行预合并或为同键重复读另造记录。
- [ ] store key 使用 session.cwd 或 process.cwd() 与 filePath 的 path.resolve 结果；输入解析键和 show path 对应键不同时，两键都记录同文本和本次完整行集合，相同时仅一次，不另读文件。
- [ ] 相对路径、绝对路径、返回 show path 均走真实 read→edit；符号链接可用时验证别名/目标路径，平台不支持时报告缺项。
- [ ] 编辑完成后使用编辑结果的当前新 tag 再做一次实际改变，断言连续编辑后的磁盘结果及新快照可用。
- [ ] 文件外部漂移分别验证 recovery 成功、recovery 失败的 MismatchError、head/tail 的 HEADTAIL_DRIFT_WARNING 放行，不能统称拒绝。
- [ ] 缺 tag 文案沿用上游；mismatch 含独立计算的当前磁盘内容 tag 和有效英文 read/re-read 指引，不强求中文或任意时刻的 store.head。
- [ ] 固定跨 session 与同 session 快照淘汰导致的放行行为；不可把无 session 不 mint 描述为已消除全部快照缺失风险。
- [ ] 固定 recovery 能修改原未 seen 锚点、REM 无行锚点、block 仅检查原 anchor、mismatch 记录无 seen 当前快照后重试的实际结果。
- [ ] 完整/截断错误回显与 [0] 的既有用例保持通过；守卫只宣称上游有限保护，已知放行与普通未见锚点首次拒绝分别断言。
- [ ] 提供可执行 test:compat，沿用同物理引擎 identity 断言；用真实 ToolRuntime 覆盖应用链路，纯引擎用例补充边界。升级前的兼容检查不依赖人工冒烟。

## Scope boundary

本票不依赖独立 preset 或 PTC 呈现，宿主运行时即可验收；不为严格保护 fork 引擎或改上游编辑器。
