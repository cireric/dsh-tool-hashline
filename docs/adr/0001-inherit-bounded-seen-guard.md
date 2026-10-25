# 继承上游有限的 seen 守卫

2026-10-22 用户确认：继续复用上游 hashline 与 tool-edit，把“没看过的行改不动”收窄为上游实际提供的有限保护。接受 recovery、REM/block、快照淘汰及无 tag 降级等边界，不在本期扩大编辑端以实现全部受影响行的严格保护；read 只把完整返回的行新增到 seen，截断行不新增，记录合并仍交由引擎。

零完整行时传 [0] 仅保持初始限制，不撤销既有 seen，也不禁止后续完整错误回显扩充 seen。需求依据见[基础规格 FR-7 与 §7.3](../specs/2026-10-22-ptc-hashline-requirements-spec.md)，可重跑边界见[兼容矩阵](../../tests/compat/README.md)。
