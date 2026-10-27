# 上游同步检查：代码审查修复与复验

日期：2026-10-27。范围：[同步需求规格](../specs/2026-10-27-upstream-sync-requirements.md)交付后的两轴代码审查所列 5 项问题。原六张票据及原报告保留当轮结果，本文记录后续修复，不回写历史产物。

## 审查意见处置

| 意见 | 判定 | 根因与修复 | 可重跑证据 |
|---|---|---|---|
| Standards / 错误声称未联网 | ACCEPT | 报告沿用了首切片的固定文案；现在记录各包发布来源方式，区分固定响应、默认 npm 查询及注入 runner，不将失败查询当作未联网 | [发布比较器](../../presets/ptc-hashline/operations/sync-engines.mjs)、[报告](../../presets/ptc-hashline/operations/sync.mjs)、[回归](../../tests/integration/operations-sync-review.spec.ts) |
| Standards / 拒绝命令仍写配置 | ACCEPT | CLI 分两次写配置，checkout 校验发生在第一次写入之后；现在所有角色与 checkout 路径先验证，通过后由同一 saveConfig 调用保存，--create 也在校验之后执行 | [配置](../../presets/ptc-hashline/operations/config.mjs)、[CLI](../../presets/ptc-hashline/operations/cli.mjs)、回归的新配置/已有配置两种场景 |
| Standards / PTC 测试意外联网 | ACCEPT | 直接调用入口的一个用例遗漏固定发布源；补上同套件使用的响应，测试仍完整执行，不跳过或放宽超时 | [PTC 测试](../../tests/integration/operations-sync-ptc.spec.ts) |
| Spec / 单侧插件配置漏报 | ACCEPT | 行身份排除 config，同时跳过单侧行的叶比较；单侧行现在绑定完整行内容，双侧行继续保留逐叶比较 | [PTC 比较器](../../presets/ptc-hashline/operations/sync-ptc.mjs)、回归的来源独有/本项目独有两种场景 |
| Spec / read 旧决定未失效 | ACCEPT | token 差异身份只对固定词表和概念在场情况求摘要；现在相关 token 差异绑定实际文件内容摘要，来源多个文件按相对路径与摘要组合；数值检查点继续按声明值比较 | [read 比较器](../../presets/ptc-hashline/operations/sync-read.mjs)、回归的两端函数体变化场景 |

PTC 与 stock-read comparator 版本升至 2。旧决定的身份不再匹配时进入复查，不自动重写决定或历史报告。read 采用文件内容绑定，可能因同文件内无关编辑而保守触发复查；这不证明语义发生变化，不引入新的语法分析依赖。

## 本轮验证

- 新增回归通过公开检查入口取得差异后验证审阅决定失效，并覆盖配置拒绝无副作用及发布来源说明。修复前 7 项全部 FAIL；修复后 7 项全部 PASS。
- 定向命令：`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/operations-sync-check.spec.ts tests/integration/operations-sync-ptc.spec.ts tests/integration/operations-sync-read.spec.ts tests/integration/operations-sync-engines.spec.ts tests/integration/operations-sync-history.spec.ts tests/integration/operations-sync-review.spec.ts tests/integration/operations-cli.spec.ts tests/integration/operations-config.spec.ts --reporter=dot`：8 文件、107 项 PASS，exit 0，无跳过。
- `node node_modules/typescript/bin/tsc -p tsconfig.tests.json --pretty false`：exit 0。新增测试的类型错误曾在中间检查被发现并修正，最终结果以复跑为准。
- 独立验证副本使用当前工作树输入，`pnpm install --offline --frozen-lockfile`：exit 0，复用 123 个缓存依赖，下载 0；`pnpm check`：exit 0。未在日常宿主链接树构建。
- 实现、测试及配置共 217 个文件与隔离副本逐个 SHA-256 一致；清单在本轮被忽略的证据目录。正式交付门禁结果另在下节记录。

## 修复后真实只读冒烟

隔离的 DSH_HOME 中使用一次组合配置命令保存证据目录与本机 DSH checkout，再执行 `node scripts/sync-check.mjs`：两步均 exit 0。未使用固定发布响应；未调用模型。

检查编号 `20261027-063918-78bda6537d85`，状态 complete，43 条差异、0 缺口。结构化记录含两个包的 `releaseQueries.mode=npm`，报告明确显示默认 npm 发布查询，不再写未发网络请求。该次 complete 仅证明检查范围完成，不证明待分析项已兼容或候选已升级。

本地证据根：`.scratch/upstream-sync/review-fix-20261027/`，包括隔离源码副本、构建日志、交付日志、输入摘要和隔离冒烟产物；不随 clone 交付。历史报告中的错误文案保留，不当作修复后的验证结果。

## 完整交付门禁

隔离副本执行 `pnpm test:delivery --out ../delivery`：exit 0。[逐条报告](upstream-sync-review-fixes/2026-10-27-delivery-acceptance-report.md)和[机器摘要](upstream-sync-review-fixes/2026-10-27-delivery-acceptance-summary.json)单独归档，未覆盖先前同日交付报告。提交前仅去除生成报告与 sync-history 源码末尾的多余空行，报告结果和源码逻辑未改；原始字节仍保留在本地证据目录，源码另经 node --check 通过。

| 门禁 | 退出码 |
|---|---|
| pnpm build | 0 |
| pnpm -r check | 0 |
| pnpm check:tests | 0 |
| pnpm test:unit | 0 |
| pnpm test:integration | 0 |
| pnpm test:ptc | 0 |
| pnpm test:compat | 0 |
| pnpm check:preset | 0 |
| pnpm test:profile | 0 |

真实打包、安装与宿主装配验收为 21 PASS / 0 FAIL / 0 GAP / 9 BLOCKED。未执行的 ID 为 INC-02/03/04、UPG-02/05/08/09/10/11，与先前门禁逐 ID 相同，不记通过。该验收的候选安装 runner 仍为注入方式，不证明真实升级或补丁语义；SYNC 回归与修复后冒烟分别见上节。

## 剩余范围

macOS/Linux 实跑、引擎候选包语义与实际升级仍沿用原报告的 GAP 或范围边界。本轮不重新开展模型评测，不改变日常 profile，也不将回归通过解释为编辑收益证明。
