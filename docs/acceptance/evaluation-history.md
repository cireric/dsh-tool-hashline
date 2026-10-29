# 评测结论与保留边界

本页蒸馏已有记录，没有执行新实验。逐轮原文与 JSON 见[历史原件](README.md#历史原件)，不累计不同轮次的样本、Token 或测试数量。

## 已交付的维护工具

2026-10-25～26 的分阶段工作交付了：身份/协议冻结、独立 initial/expected、按目标判读、父子会话与 fork 去重、取消留证、请求捕获/重放、首次指标的显式范围、全任务文件与成本检查、任务集生成及离线判定。使用方法只维护在 [evaluation README](../../scripts/evaluation/README.md)，字段契约见[协议](../specs/2026-10-25-real-model-evaluation-protocol.md)。

固定 Provider 的完整宿主结果证明基础设施链路，不证明真实模型收益。任务集宿主轮为 39 个样本、31 PASS / 6 GAP / 2 FAIL、81/81 请求对账；apply_patch 新路径创建与末尾换行仍有失败对照，不能借其它成功任务关闭。旧候选安装曾发生传递引擎版本/物理实例漂移；因此升级和验证必须核对解析路径、补丁与共享实例。

## 真实运行分开计证

| 运行 | 已有结论 |
|---|---|
| E3 冒烟 | 有真实子会话，但未整体通过，历史载荷/部分成本仍 unknown；不替代正式 S1 |
| S0 首轮 | 首请求 reasoning 阶段超时，1 CANCELLED / 8 BLOCKED，usage unknown |
| 单请求诊断 | 原 reasoning 控制未发送；修正后的追加请求返回工具调用，usage 14,827 Token；未执行工具，不算完整 S0 |
| S0 第二轮 | [完整原报告](2026-10-26-evaluation-real-s0-modelscope-02.md)：9 项、28 请求、398,176 Token，3 PASS / 3 GAP / 3 FAIL，最终 6/9 正确，整体 FAIL |
| S0 后续离线审计 | 修正坏 header 的形状误标；实际模式仍 unknown。未发现明确提示冲突，模型提前结束的内部原因未证实；S0 FAIL 不变 |

## 当前维护决定

按[阶段决策](2026-10-26-evaluation-stage-decision.md)停止扩样，S1/S2 延期未执行，默认推广暂停。成本少而任务未完成不是收益。原三臂配置不构成原生 preset 的纯策略消融，结论不能外推所有模型和任务。

重开须有具体使用问题、执行前冻结的新条件、模型/参数和新费用授权。真实 sandbox/多 provider、多平台、其它取消时点、HTTP wire 和独立模型耗时等仍是 GAP，不因整理文档而关闭。
