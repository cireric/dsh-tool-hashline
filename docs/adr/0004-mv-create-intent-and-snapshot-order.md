# MV：目标端走写意图创建，快照迁移只在磁盘移动之后

日期：2026-10-23
状态：已采纳（MV 观测修复计划阶段 B/C）
关联：[ADR-0003 有效工作目录](./0003-effective-working-directory.md)、
[实测报告](../../.scratch/ptc-hashline/2026-10-23-relative-path-mv-rem-report.md)、
[修复验收](../acceptance/2026-10-23-mv-observation-acceptance.md)

## 背景

真实 profile 下 hashline MV 移到**不存在**的新路径被 observation policy 拒绝，磁盘不变：

```text
edit requires reading "<dest>" first          # 首次：目标从未观察 → FS_NOT_OBSERVED
cannot edit "<dest>": not found                # 补读目标后：目标被观察为 absent → FS_NOT_FOUND
```

调用链为 `Patcher.commit → EditFilesystem.move → EditSession.writer.move → this.write`，
而 `writer.write` 走 `fs/edit-intent`。该瀑布的语义是"改一个模型已经看过的文件"，
未观察与"确认不存在"都必须拒绝；把 MV 的目标创建也塞进它，等于要求模型先 read 一个
**不存在**的文件——这在策略层永远不可能满足。

同一文件的 `fs/write-intent` 本来就是为创建设计的：未观察或确认缺失返回
`{ kind: 'createIfAbsent' }`，由 provider 原子拒绝并发创建者。

同时引擎把 `snapshots.relocate(source, destination)` 放在 `fs.move(...)` **之前**：
移动被拒绝时源快照已经消失、目标出现迁移快照，而文件仍在源路径。

## 决策

1. **MV 目标端用写意图，不用编辑意图。** 目标是新路径，因此：
   containment 检查 → `stat` 确认目标不存在（存在即拒绝，含目标已被 read 的情况）→
   用本次 stat 结果 `emit('fs/observed', absent)` 归属当前 exec/session →
   `fs/write-intent` → 只接受 `createIfAbsent`（无 policy 时显式构造）→
   `fs.writeText(target, content, intent, signal, sandbox)`。
   不降级为无保护写入，不用 `fsp.rename` 绕过策略。
2. **普通 `writer.write()` 保持 `fs/edit-intent` 不变**：PUT/replace/patch 的
   read-before-edit 契约不因 MV 放宽。
3. **快照迁移跟随磁盘结果。** `fs.move` 成功后才 `relocate` 并记录目标快照；
   失败时源/目标快照保持迁移前状态。磁盘成功而快照提交失败时报告
   "磁盘已移动、快照未完整提交"，不退化为"移动失败"，也不做未经验证的反向移动。
4. **两步移动的部分成功必须可见。** 目标创建成功后，删除源失败或删除前被取消，
   一律抛错（工具结果为 `isError`），message 写明"目标已创建、移动未完成"、两端路径、
   已知删除状态与补救指引，并保留 cause。创建结果不确定的 provider 异常报
   "目标状态待核验"，不自动重试整条 MV、不盲目删除目标。创建失败时保留 provider 自己的
   `FsErrorCode`（`FS_SANDBOX_DENIED`、`FS_PERMISSION_DENIED` 等），只有非 FsError 才降级
   为 `FS_IO_ERROR`。
5. **多节批次沿用引擎的"已写/未写"包装。** 上游 `hashline/execute.js` 自行循环 commit，
   不经过 `Patcher.apply`，因此失败时原本只报失败节自身。补丁在该循环里补上与
   `Patcher.apply` 同口径的 `Failed to write … Sections already written: …. Sections not written: ….`，
   使"前序节已落盘 + 当前 MV 部分成功"同时可见。

## 边界（不要当成已解决）

- 不是原子 rename：**先条件创建目标，再删除源**。两次系统调用之间不存在事务。
- `createIfAbsent` 只防覆盖目标，不防源在读取后被外部替换；源删除仍是范围受限的
  Node `rm`，没有 provider 的版本条件删除。需要强保证应另立 provider/API 改造。
- 多节编辑可能已有前序节落盘；本条只保证 MV 自身不谎报状态，不宣称整批回滚。
- 失败的快照断言以"prepare 已完成、commit 未调用"为比较点；前置读取与错误回显
  可以依法更新记录的 recordedAt/LRU，不要求整次失败调用的 store 逐项不变。

## 维护边界

- 两份补丁都是**精确版本绑定**，升级前先看上游是否已修：
  `patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch`（目录 + MV 创建 + 部分成功）、
  `patches/@hy-sde-org__dsh-hashline@0.2.1-alpha.4.patch`（commit 次序）。
  已修则删补丁并更新 `tests/compat/README.md` 基线与 `pnpm-lock.yaml`；未修则重做，
  不得只改 `node_modules`。
- 回退 MV 修复时同时回退：tool-edit 的 move 分支、hashline 的 commit 次序、两条
  `patchedDependencies` 登记与 lockfile。**不要**顺带回退 ADR-0003 的目录补丁。
- 测试夹具默认挂 `fs-observation-policy`：删掉这个挂载会让本类回归重新变成假绿。
