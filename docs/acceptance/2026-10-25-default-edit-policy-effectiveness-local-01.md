# 默认编辑策略：本地实际生效验收 local-01

- 日期：2026-10-25，执行时间约 09:16–09:22（Asia/Shanghai）。
- 受测提交：`cc9dca2c555db5681fa6b9bfa76b97f06ceb78c5`。
- 方案：[实际生效验收方案](../plans/2026-10-25-default-edit-policy-effectiveness-test-plan.md)。
- 结论：**FAIL。Windows 下出厂配置的策略模块加载失败，不能进入真实模型验收。** Hashline 基础编辑仍可用；这不等于默认编辑策略正常运行。
- 本轮执行测试与诊断，未修产品代码、未切换日常 profile、未重启宿主、未请求真实模型。

## 1. 分层结论

| 层次 | 状态 | 实际证据与边界 |
|---|---|---|
| E1 当前提交工程契约 | FAIL | 原生 Windows 路径触发策略加载失败；主 seam 与 PTC 都复现。仅在诊断夹具转成 file URL 后，定向集成 65 项及 PTC 14 项通过 |
| E2 打包安装与完整宿主生效 | GAP；已执行的安装策略探针 FAIL | 四包打包安装、真实 launcher compose 和运维流程执行；安装产物的 scoped read/edit 子集同样复现加载错误。完整 preset 挂载、实际 PTC 后端、真实委派尚未执行，不用子集代替 |
| E3 模型行为 | BLOCKED | 先修已证实的本地阻塞；本轮零次真实模型请求，未要求用户运行 DSH |
| E4 推广收益 | BLOCKED | 未进入既有推广方案的冻结对照；不能从诊断通过推导收益 |
| 日常 profile 生效 | BLOCKED | 本轮未安装、切换、重启或在日常会话执行；隔离安装不能替代此项 |

## 2. 环境及隔离

本轮在 Windows x64、Node `v24.19.0`、pnpm `11.28.5` 运行。真实 launcher 使用本机已有 DSH checkout 的 `apps/cli/lib/bin.js`；交付安装宿主依赖为 `0.2.1-rc.2`。

原始留证根为被忽略的 `.scratch/hashline-default-editing/effectiveness/20261025-local-01/`，不随 clone 交付。该目录包含 `environment.json`、`commands.jsonl`、逐命令 `logs/`、探针及 JSON 结果。

源码和 `.git` 元数据复制到该根下 `tree/`。E1 依赖复制自现有 hoisted node_modules，未重新干净安装；workspace 锚点在副本内物化，构建后同步副本内 dist。因此 E1 是“现有依赖快照验证”，不是 clean install。pnpm 在此副本报告运行前依赖校验尝试因非交互目录清理而中止，随后继续执行脚本；这一警告保留在日志中，不宣称该依赖准备通过。

另外执行的 delivery 将四个 pack 产物装入独立 DSH_HOME，真实执行安装。随后从该安装资源根解析 read/edit、策略及宿主依赖，复现同一错误，排除了“只有复制依赖才会失败”的解释。整个过程未改原 checkout 的 node_modules 或 dist。

本机 pnpm 启动器所在包为 `11.22.0`；仓库内自动切换后实际执行的是 `11.28.5`。沙箱内版本命令卡住，沙箱外实际返回 `11.28.5`，后续测试在获准的沙箱外执行。没有把沙箱内未完成的命令记成业务 FAIL。

| 输入 | SHA-256 |
|---|---|
| pnpm-lock.yaml | `f32b9a1ab1487fa4eb07a816e2e1536dfc55b20bc3ec51531095cc9cdbe53f46` |
| pnpm-workspace.yaml | `a41027b9b44ca4f5f0a32102bc7e5f9231e95fa339da6b4432a86170b6092095` |
| tool-edit 精确补丁 | `e5e0867a52e054765634faf1e6677f46191e9b491a051eda73ac5f32bf5288e8` |
| hashline 精确补丁 | `fc7153f6db42469debf90e47a4fd89a538dba7622a8cdc56e6bfa8be10460beb` |

## 3. 原产品输入的门禁结果

下表为各自真实运行结果，不合并成一次全绿执行。日志文件名相对于本轮留证根的 `logs/`。

| 命令 | exit | 结果 | 日志 |
|---|---|---|---|
| `pnpm check` | 0 | PASS：构建、包类型检查、测试类型检查 | `01-check.log` |
| 定向 integration：`tests/integration/default-edit-policy` | 1 | FAIL：51 failed / 14 passed，8 个文件 | `02-policy-integration.log` |
| 定向 PTC：`tests/ptc/default-edit-policy` | 1 | FAIL：9 failed / 5 passed，5 个文件 | `03-policy-ptc.log` |
| `pnpm test:unit` | 0 | PASS：55 passed；包含 evaluation 协议自检 10 项 | `04-unit.log` |
| `pnpm test:integration` | 1 | FAIL：53 failed / 354 passed / 9 skipped；10 failed files / 22 passed files / 1 skipped file | `05-integration.log` |
| `pnpm test:ptc` | 1 | FAIL：9 failed / 24 passed，5 failed files / 4 passed files | `06-ptc.log` |
| `pnpm test:compat` | 0 | PASS：21 passed | `07-compat.log` |
| `pnpm check:preset` | 0 | PASS：静态资源、caps、Intent 与摘要检查通过 | `08-preset.log` |
| `pnpm test:profile` | 0 | PASS：基础安装/launcher/单实例/旧补丁、PUT/MV/REM、BOM、Intent 探针 | `09-profile.log` |
| `pnpm test:delivery --no-gates --keep --out .scratch/delivery-local-01` | 0 | 运维交付范围：20 PASS / 0 FAIL / 1 GAP / 9 BLOCKED；REG-01 为 GAP | `10-delivery.log` |

定向命令分别为 `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/default-edit-policy` 与 `pnpm exec vitest run --config vitest.ptc.config.ts tests/ptc/default-edit-policy`。

本轮 delivery 显式用了 `--no-gates`，因为门禁已按上表另行执行。不能将它称为“完整交付门禁全绿”，也不能将其运维验收 ID 的 PASS 当成默认编辑策略 PASS。其报告与 summary 位于副本 `tree/.scratch/delivery-local-01/`；不会覆盖已有正式报告。

### 两项隔离输入问题的复核

完整 integration 的 53 项失败包含：默认策略 51 项，以及 `operations-baseline.spec.ts` / `operations-cli.spec.ts` 各 1 项。后两者硬编码预期维护仓库为 dirty；副本最初只复制 tracked 文件，未同步原工作树已有的未跟踪验收方案，因此当时为 clean。

将该原有方案原样同步到副本后，只复核这两个文件，**32 passed、exit 0**（`11-baseline-input-control.log`）。没有修改断言或产品实现，也不将完整 integration 原运行改记为通过。9 个 skipped 原样保留为未覆盖，不计 PASS。

## 4. F-01：Windows 路径导致策略模块不可加载

**判定：FAIL，阻塞默认策略验收。** 涉及 POLICY-01/11/12/17/19/20 等依赖实际策略加载的工程项。

精确补丁中的 [createPolicyInstance](../../patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch)用以下表达式区分 URL 与路径：

```js
const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(address)
  ? address
  : pathToFileURL(address).href;
```

Windows 的 `D:\...` 或 `C:\...` 匹配该正则，被当作 URL 直接传给 `import()`。实际报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`，随后工具返回 `EDIT_POLICY_UNAVAILABLE`。策略文件存在，同一文件用 `pathToFileURL(address).href` 可成功导入，导出 `createPolicy` 为 function。

[出厂 preset](../../presets/ptc-hashline/preset.patch.yml)的 `contentPolicyModule` 表达式返回 `path.join(...)` 的原生绝对路径；因此错误同时存在于源码定向夹具和真实 pack 安装中，不是虚构输入。不能通过只修改测试为 URL 就宣布产品已修复。

### 已执行的安装产物对照

探针从真实安装的 preset YAML 求值模块表达式，使用安装包的真实 ToolRuntime、scoped read/edit、Local filesystem 与 observation policy。每臂独立夹具，初始内容均为 `one\ntwo\nthree\n`，先 read，再尝试 replace 第二行，最后 Hashline 改第三行。

| 安装探针配置 | replace 实际结果 | replace 后磁盘 | 最后 Hashline | 策略 prompt 段 |
|---|---|---|---|---|
| 出厂原生路径 | `EDIT_POLICY_UNAVAILABLE` | 未变 | 成功，第三行变为 THREE | 存在 |
| 仅诊断：同一模块地址转 file URL | `EDIT_POLICY_FALLBACK_REQUIRED` | 未变 | 成功，第三行变为 THREE | 存在 |
| 不挂策略的对照 | replace 成功 | 第二行变为 TWO | 成功，第三行变为 THREE | 不存在 |

**策略 prompt 出现、SDK 存在、replace 被拒都不足以单独证明策略正常加载。** 第一臂恰好全部表象成立，但实际处于不可用 stand-in。拒绝码和成功降级等行为必须一起核验。

本探针只手动挂了 read/edit 子集，未挂完整 preset；没有实际 PTC 后端和真实模型。它足以证明安装包的加载错误，不能取代完整 E2 验收。磁盘内容已独立核对，但本探针没有完整 provider 副作用记录，不扩大为“全程绝无中间写入”的证明。

留证：`probe-result.json`、`packed-probe-result.json`、`probe.mjs`、`packed-probe.mjs`。

### 归因诊断，不是产品修复

仅在隔离副本的两个测试 harness 中，将传入 `contentPolicyModule` 的地址转为 file URL；未改上游安装文件、产品 patch 或原工作树。

- 定向 integration：**65 passed，exit 0**（`12-url-control-integration.log`）。
- 定向 PTC：**14 passed，exit 0**（`13-url-control-ptc.log`）。
- 改动由 `url-control-harness.diff` 留证，完成后两份 harness 已恢复，`url-control-restored.json` 记录 `restored: true`。

这支持“原路径解析错误导致该组失败”的归因，包括 retry 拒绝回执用例；不证明出厂配置已经可用，不覆盖完整回归或指令一致性。产品修复仍应通过 `patches/`、patchedDependencies 与 lockfile 交付，并重新干净安装验证。

## 5. F-02：read nextAction 与目标策略指引不一致

**判定：FAIL（已执行指引函数及实际安装 read；未执行完整 preset）。** 对应 SRS FR-03/FR-07 与 POLICY-01。

实际构建后的 [next-action](../../packages/tool-read/src/next-action.ts)仍输出：

- 无 Session：建议改用 replace/patch。
- 目标长行：建议增大 `maxLineLength`，并说明配置改变需要 remount。
- 零完整行字节窗口：建议增大 `maxBytes`。

在 pack 安装的 scoped read/edit 探针中读取真实 3000 字符行，canonical nextAction 同样包含“更大 maxLineLength、配置改变需 remount”的建议，三组配置结果一致。函数探针的无 Session/零窗口结果已留证，但没有声称在完整 preset 中执行了无 Session 调用。

[SRS FR-07](../specs/2026-10-24-hashline-default-editing.md)要求无必要会话上下文时不推荐受管降级，受限指引不暗示擅自改配置或重挂载；协调只作用目标 preset，保留其他 preset 原行为。目前 [read 入口](../../packages/tool-read/src/index.ts)未提供实施计划 D6 所述的目标 preset 指引配置。这也意味着非目标 read 被加入新降级术语的隔离兼容性需要补验，不能直接全局改文案解决。

修复后需从实际完整 preset 验 canonical value 和渲染、与最终 prompt/SDK 的一致性；未配置策略的非目标对照需保持基线。

## 6. 下一轮顺序与用户 DSH 交接条件

1. 修 F-01 的 Windows 路径/URL 识别，按精确补丁维护，不以测试 harness 的 URL 适配充当修复。
2. 修 F-02 的目标 preset 指引，增加目标/非目标与无 Session/长行/零窗口的契约覆盖。
3. 在修复提交及干净安装上重跑原生路径的定向集成/PTC，然后完整门禁。保留本轮红测和诊断对照。
4. 补完整 preset 的隔离装配验收，跑默认拒绝、合法三原因、混合写前拒绝、真实委派与实际 PTC 后端；只注册测试过的子集不算完成。
5. 前述通过后，提供用户可直接粘贴到 DSH 的任务及证据清单，再进行真实模型行为验收。

**当前无需用户在 DSH 运行。** 现有本地和安装产物证据已能确认阻塞；先修复再让用户投入真实环境测试。日常 profile 切换仍需当次明确授权，不能因本报告建议下一轮而自动执行。

本轮原工作树仅新增方案、报告与验收入口引用；产品实现及依赖声明未修改。原始脚本、完整日志、已保留的测试安装和 fixture 均为本地证据，不随 clone 交付。
