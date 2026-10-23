# 08: 全规格验收可从干净环境重复执行

**What to build:** 实施者能按规格命令，从构建到干净 profile 重复证明本期能力，并将每条需求追溯到实际用例和证据。安装、使用与已知限制文档反映最终行为，不依赖人工冒烟判断完成。

**Blocked by:** 04 — 连续编辑与有限守卫边界可回归；05 — read 提示与卡片在回放后仍可用；07 — 真正 PTC 下编辑与意图门契约成立。

**Status:** done (2026-10-23)

**Spec:** [权威规格入口](../spec.md)；§8.1、M4、NFR-3/5/6；其他票为本票传递前置，不另重复列阻塞边。

- [x] 按实际用例补齐 FR-1 至 FR-14、NFR-1 至 NFR-6、§4 安装契约的追溯；记录用例 ID、命令和判定，不以检查组名称替代具体覆盖证据。
- [x] build、既有递归 check/test，以及 test:unit、test:integration、test:ptc、check:preset、test:profile、test:compat 均可执行；每个失败以非零退出和可见原因报告。
- [x] 编排使用前序票已交付的测试，不把全量测试留到本票才写，也不添加仅镜像实现的冗余测试。
- [x] 在干净临时 profile 重复构建、依赖解析、bundles 登记、安装、真实重挂载、唯一 preset 发现和真实 PTC 编辑；原 ptc-roles 项目不可用时仍通过。
- [x] 最终组合的 read 投影、窗口限制、无 tag 指引和编辑结果一致；真实普通、截断、空窗口、降级结果与卡片/回放检查共同覆盖。
- [x] 正常未见锚点拒绝、错误回显重试、跨 session/淘汰/recovery/REM/block/mismatch 等有限守卫边界均有明确断言，不能把已知放行算成严格保护通过。
- [x] 对平台或权限导致的未执行用例明确列缺项；必要验收缺项不能计为通过。符号链接等平台能力限制与执行证据一致。
- [x] 安装和使用文档写明构建/激活/重挂载、全文读取成本、长行配置补救、无 tag 降级、seen 与 observed 的区别及有限保护范围；清除活跃入口中的历史 stub 指引。
- [x] 升级流程指向可执行 compat gate；本期仍 private，不发布 npm、不接入日常 profile。只有证据满足规格判定后才把实施标为完成。

## Comments

- 2026-10-23 验收编排完成。追溯表：`docs/acceptance/2026-10-23-acceptance-traceability.md`（FR-1…14 / NFR-1…6 / §4 安装契约逐条映射到用例与判定，并单列未执行项）。
- 复跑结果（同一提交）：`pnpm build` 0；`pnpm check` 0；`pnpm test` 0；`pnpm test:unit` 42 passed；`pnpm test:integration` 43 passed；`pnpm test:ptc` 9 passed；`pnpm test:compat` 15 passed；`pnpm check:preset` 0；`pnpm test:profile` 0（含 `dsh --dump-config`、profile 内 read→edit 落盘、门正负）。
- 文档：README 重写为安装/激活/重挂载、全文读取成本、长行补救、无 tag 降级、seen 与 observed 区别、有限保护范围与升级 gate；AGENTS/HANDOFF 的「脚手架/stub」表述已替换；`tests/compat/README.md` 记录锁定行为与缺项。
- 未执行项（明确不计通过）：`PUT N*` block 编辑（无 blockResolver）；真实宿主 + 真实模型的一轮 PTC（本机无 key）；PTC 子进程隔离/沙箱；非 Windows 符号链接平台。NFR-4 的两处运行时导入偏差在追溯表中有专段说明。
- 本期仍 private、不发布 npm、不接日常 profile。
