# ptc-hashline 实施票索引

2026-10-22 用户确认并发布；当前仅完成拆票，尚未开始实现。[规格入口](spec.md)指向权威 v3。

| 票 | 标题 | 直接阻塞 |
|---|---|---|
| [01](issues/01-basic-read-edit.md) | 普通文本 read→edit 首次成功 | 无 |
| [02](issues/02-complete-line-windows.md) | 窗口读取只新增完整行 seen | 01 |
| [03](issues/03-untagged-and-read-errors.md) | 无 tag 和读取失败均有可执行结果 | 01 |
| [04](issues/04-snapshot-lifecycle-compat.md) | 连续编辑与有限守卫边界可回归 | 02 |
| [05](issues/05-read-presentation-replay.md) | read 提示与卡片在回放后仍可用 | 01 |
| [06](issues/06-independent-profile-bundle.md) | 独立 bundle 在干净 profile 中可安装 | 01 |
| [07](issues/07-ptc-intent-contract.md) | 真正 PTC 下编辑与意图门契约成立 | 02、03、06 |
| [08](issues/08-repeatable-acceptance.md) | 全规格验收可从干净环境重复执行 | 04、05、07 |

票据的 ready-for-agent 表示已具备实施说明，不能绕过 Blocked by。首次可执行票只有 01；01 完成后，02、03、05、06 可开始。仅在全部直接阻塞票完成后推进后继票。

每票随行为交付测试，08 负责最终编排与证据汇总。M1–M4 保留为规格的交付检查点；这些票按可验收行为切分，不把里程碑机械拆成代码层。

计划命令的首次责任：01 建立 test:unit/test:integration；04 建立 test:compat；06 提供 build/check:preset/基础 test:profile；07 提供 test:ptc 并补完整门验收；08 验证全部接口与需求追溯。当前这些新接口仍未实现。
