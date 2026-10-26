# PTC Hashline 运维 skills：真实宿主交付验收报告（票据 08）

运行时间：2026-10-26T00:42:53.078Z

本报告由 [delivery-acceptance.mjs](../../scripts/delivery-acceptance.mjs) 在本机真实安装上执行一次得到；每条判定都附退出码或实测值。它 **不是** 一次真实上游升级：固定候选与一次性 profile 是规格 D16/UPG-13 规定的验收形态。

## 判定汇总

| 验收 ID | 判定 | 用例数 |
|---|---|---|
| SCOPE-01 | PASS | 7 |
| SCOPE-02 | PASS | 1 |
| SCOPE-03 | PASS | 3 |
| SCOPE-04 | PASS | 2 |
| SCOPE-05 | PASS | 2 |
| SCOPE-06 | PASS | 3 |
| SCOPE-07 | PASS | 1 |
| PACK-01 | PASS | 5 |
| INC-01 | PASS | 1 |
| INC-02 | BLOCKED | 0 |
| INC-03 | BLOCKED | 0 |
| INC-04 | BLOCKED | 0 |
| INC-05 | PASS | 1 |
| INC-06 | PASS | 1 |
| INC-07 | PASS | 2 |
| CONFIG-01 | PASS | 3 |
| UPG-01 | PASS | 2 |
| UPG-02 | BLOCKED | 0 |
| UPG-03 | PASS | 2 |
| UPG-04 | PASS | 3 |
| UPG-05 | BLOCKED | 0 |
| UPG-06 | PASS | 2 |
| UPG-07 | PASS | 2 |
| UPG-08 | BLOCKED | 0 |
| UPG-09 | BLOCKED | 0 |
| UPG-10 | BLOCKED | 0 |
| UPG-11 | BLOCKED | 0 |
| UPG-12 | PASS | 1 |
| UPG-13 | PASS | 2 |
| REG-01 | PASS | 9 |

合计：PASS 21 / FAIL 0 / GAP 0 / BLOCKED 9。

判定口径：同一 ID 下任一用例失败即 FAIL；否则任一条如实记录的缺口即 GAP；否则至少一条实测通过即 PASS；没有用例即 BLOCKED。

## 安装与装配（PACK-01）

| 环节 | 判定 | 实测 |
|---|---|---|
| pack | PASS | packed dsh-tool-hashline, @dsh-tool-hashline/hashline, @dsh-tool-hashline/tool-read, @dsh-tool-hashline/tool-edit （每个包 manifest 的 files 决定装进 tarball 的内容） |
| install | PASS | installed into <temp>\dsh-home\profiles\acceptance |
| engine-patches | PASS | both anchors installed from patches/ + patchedDependencies and carry their marker (hashline=true, tool-edit=true) |
| resolve | PASS | bundle root <temp>\dsh-home\profiles\acceptance\node_modules\dsh-tool-hashline; no checkout path in any shipped artifact (patch, personas, skills, operations, watchdog) |
| compose | PASS | dsh --profile acceptance --dump-config exit 0; preset, read/edit, operations provider and watchdog present; no checkout path |

## 按规格要求的六类分开列

| 类别 | 覆盖的验收 ID | 判定 | 用例数 |
|---|---|---|---|
| 技能隔离（打包、装配、入口与调用资格） | PACK-01, SCOPE-01, SCOPE-02, SCOPE-03, SCOPE-04, SCOPE-05, SCOPE-06, SCOPE-07 | PASS | 24 |
| incident 可观察性 | INC-01, INC-05, INC-06, INC-07, CONFIG-01 | PASS | 8 |
| 升级评估 | UPG-01 | PASS | 2 |
| 同意流程 | UPG-03, UPG-07 | PASS | 4 |
| 执行 / 回退 | UPG-04, UPG-06, UPG-12, UPG-13 | PASS | 8 |
| 既有功能回归 | REG-01 | PASS | 9 |

## 逐条证据

### SCOPE-01 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| the installed preset row list is what the driver mounts | PASS | the installed preset declares 23 rows; the operations skill root resolves inside the install: true |
| the shipped skill bodies still name the operations entry | PASS | operations/cli.mjs mentions per body: {"ptc-hashline-incident":5,"ptc-hashline-upgrade":9} |
| the installed preset lists both skills for its own agent | PASS | catalog entries ["ptc-hashline-incident@ptc-hashline-operations","ptc-hashline-upgrade@ptc-hashline-operations"] |
| each body loads with a resource base inside the install | PASS | body paths {"ptc-hashline-incident":"<temp>\\dsh-home\\profiles\\acceptance\\node_modules\\dsh-tool-hashline\\presets\\ptc-hashline\\skills\\ptc-hashline-incident","ptc-hashline-upgrade":"<temp>\\dsh-home\\profiles\\acceptance\\node_modules\\dsh-tool-hashline\\presets\\ptc-hashline\\skills\\ptc-hashline-upgrade"}; root <temp>\dsh-home\profiles\acceptance\node_modules\dsh-tool-hashline\presets\ptc-hashline\skills |
| the general skill provider still works beside the operations one | PASS | a `filesystem` provider entry is present in the same catalog |
| the installed bundle ships exactly the two delivered skills | PASS | shipped ["ptc-hashline-incident","ptc-hashline-upgrade"] |
| installed CLI resolves this session's projection | PASS | context exit 0; header=ptc selected=ptc-hashline |

### SCOPE-02 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| a preset that never declared the provider cannot see or load them | PASS | other preset declared rows ["skill-filesystem","tool-skill"]; catalog 32 entries, operations loadable [false,false], general provider true |

### SCOPE-03 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| a second provider with the same name in ONE revision is rejected | PASS | duplicate registration: {"rejected":true,"message":"ptc-hashline-operations-skills-again (@deepseek-ai/dsh-skill-filesystem): a skill provider named \"ptc-hashline-operations\" is already registered in this scope"} |
| one agent scope does not own the provider | PASS | after disposing the first agent the revision still lists ["ptc-hashline-incident","ptc-hashline-upgrade"] |
| a retired revision leaves nothing behind, so the name is reusable | PASS | after unregister + release, a new revision lists ["ptc-hashline-incident","ptc-hashline-upgrade"] |

### SCOPE-04 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| family marker alone does not qualify | PASS | context on a session whose header says ptc but which selected nothing |
| a hand-typed --preset does not authorize | PASS | context --preset ptc-hashline exit 2; presetArgumentIgnored=ptc-hashline |

### SCOPE-05 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| a historical target cannot authorize the caller | PASS | context --target-session session-delivery-history-0001 from a non-target session exit 2 status wrong-preset |
| the analysed session is reported separately | PASS | context --target-session session-delivery-history-0001 from this session exit 0 |

### SCOPE-06 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| an assisted session may analyse, never approve | PASS | context as session-delivery-assisted-0001 exit 0 mayApproveUpgrade=false |
| an assisted report is attributed, not read as consent | PASS | incident as session-delivery-assisted-0001 exit 0; mayApproveUpgrade=false |
| an assisted session cannot record an approval | PASS | consent as session-delivery-assisted-0001 exit 2; consent still pending |

### SCOPE-07 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| the model-facing skill tool refuses, and the user path still resolves | PASS | skill tool refusal "skill \"ptc-hashline-incident\" is not available for model invocation"; user-invocable [true,true] |

### PACK-01 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| pack | PASS | packed dsh-tool-hashline, @dsh-tool-hashline/hashline, @dsh-tool-hashline/tool-read, @dsh-tool-hashline/tool-edit （每个包 manifest 的 files 决定装进 tarball 的内容） |
| install | PASS | installed into <temp>\dsh-home\profiles\acceptance |
| engine-patches | PASS | both anchors installed from patches/ + patchedDependencies and carry their marker (hashline=true, tool-edit=true) |
| resolve | PASS | bundle root <temp>\dsh-home\profiles\acceptance\node_modules\dsh-tool-hashline; no checkout path in any shipped artifact (patch, personas, skills, operations, watchdog) |
| compose | PASS | dsh --profile acceptance --dump-config exit 0; preset, read/edit, operations provider and watchdog present; no checkout path |

### INC-01 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| an inner edit failure survives a successful run_code | PASS | incident exit 0; events run_code,edit; edit kind suspected-implementation-defect |

### INC-02 — BLOCKED

本次运行不测该 ID；它的证据在 incident 分类与严重度：tests/integration/operations-incidents.spec.ts（票据 02）。本轮**不**据此声明该项通过。

### INC-03 — BLOCKED

本次运行不测该 ID；它的证据在 成功但结果不对：tests/integration/operations-incidents.spec.ts（票据 02）。本轮**不**据此声明该项通过。

### INC-04 — BLOCKED

本次运行不测该 ID；它的证据在 日志完整性（torn/seq 缺口/重复）：tests/integration/operations-incidents.spec.ts、tests/integration/extract-runtime-evidence.spec.ts（票据 02）。本轮**不**据此声明该项通过。

### INC-05 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| the secret never reaches an exported file and the source log is untouched | PASS | summary/incident/excerpt/baseline free of the test secret; source log byte-identical (87c40b2c16b7) and still holds the secret |

### INC-06 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| a suspected defect becomes a needs-triage ticket without being called a confirmed bug | PASS | tickets ["suspected-implementation-defect:needs-triage","user-reported-mismatch:needs-triage"] |

### INC-07 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| a repeat is linked to the existing tickets and appends nothing | PASS | second run exit 0; tickets 2/2; associated [{"duplicate":true,"appended":false,"statusChanged":false}]; every ticket byte-identical true |
| a later success records 「本次已恢复」 and closes nothing | PASS | wider run exit 0; recoveries 1; tickets 2; recovery statement on file true |

### CONFIG-01 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| explicit assignment then reuse | PASS | config exit 0/0; both roles configured from <temp> |
| relative path refused | PASS | config --set-evidence-dir relative-evidence exit 3 |
| both workflows read the same saved roles and the same projection | PASS | config from the upgrade chain: repo same, evidence same; assess gated by the same projection (eligible) |

### UPG-01 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| an unavailable query is unverified, never "the latest" | PASS | assess exit 2; conclusion insufficient-evidence; verified false |
| every query lands with its channel, status and query time | PASS | assess exit 0; conclusion recommend-candidate; records 9; verified true; gaps ["upgrade target","provider","model"] |

### UPG-02 — BLOCKED

本次运行不测该 ID；它的证据在 DSH 契约与逐项补丁决策：tests/integration/operations-upgrade-assessment.spec.ts（票据 04）。本轮**不**据此声明该项通过。

### UPG-03 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| a bound proposal is written; no candidate tree, no switch | PASS | propose exit 0; proposal 20261102-042000-862f74926190; consent pending; no candidate directory |
| a quote the session never wrote records nothing | PASS | consent with an unwritten quote exit 2; consent still pending |

### UPG-04 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| the approved candidate is validated in its own tree | PASS | validate exit 0; verdict candidate-verified; runner injected; commands 5 |
| the validated combination is the approved one | PASS | resolved 0.2.1-alpha.5/0.2.1-alpha.5 vs approved 0.2.1-alpha.5/0.2.1-alpha.5 |
| the candidate phase touched no target | PASS | the target profile is byte-identical to its pre-candidate snapshot |

### UPG-05 — BLOCKED

本次运行不测该 ID；它的证据在 版本/目标/基线漂移令旧授权失效：tests/integration/operations-upgrade-proposal-consent.spec.ts、tests/integration/operations-target-switch.spec.ts（票据 05/07）。本轮**不**据此声明该项通过。

### UPG-06 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| no target verification reads as a pass when the target was never installed | PASS | failed steps ["target-install"]; target checks {"target-versions-match-approved":"absent","target-patch-markers":"absent","target-resolved-paths-and-shared-instance":"absent","target-read-edit-short-link":"absent"} |
| the rollback baseline really came back | PASS | verified 5 restored item(s), all matching: lockfile=true, @hy-sde-org__dsh-hashline@0.2.1-alpha.4.patch=true, @hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch=true, hashline=true, tool-edit=true |

### UPG-07 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| no flag and no empty reply can stand in for the user | PASS | consent --yes exit 3; empty --reply exit 3; consent still pending |
| one explicit two-phase reply is recorded once, with its binding | PASS | consent exit 0; records 1; scope {"candidateValidation":true,"switch":true} |

### UPG-08 — BLOCKED

本次运行不测该 ID；它的证据在 官方 DSH 只给人工建议、不修改安装：tests/integration/operations-upgrade-assessment.spec.ts（票据 04）。本轮**不**据此声明该项通过。

### UPG-09 — BLOCKED

本次运行不测该 ID；它的证据在 方案外改动保留失败、不放宽断言：tests/integration/operations-candidate-validation.spec.ts（票据 06）。本轮**不**据此声明该项通过。

### UPG-10 — BLOCKED

本次运行不测该 ID；它的证据在 受影响文件有用户改动则停止切换：tests/integration/operations-target-switch.spec.ts（票据 07）。本轮**不**据此声明该项通过。

### UPG-11 — BLOCKED

本次运行不测该 ID；它的证据在 关键基线 unknown 不切换、不宣告成功：tests/integration/operations-upgrade-assessment.spec.ts 与本轮的 UPG-01 GAP 行（票据 04）。本轮**不**据此声明该项通过。

### UPG-12 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| a partial failure restores only this round, and says so | PASS | switch exit 2; conclusion switch-failed-restored; rollback phase restored; external changes 0; restoredFiles 5 |

### UPG-13 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| a fixed candidate is validated end to end in a one-off profile | PASS | candidate 0.2.1-alpha.5/0.2.1-alpha.5 → candidate-verified; switch switch-failed-restored; target <temp>\profiles\delivery-target |
| no daily profile, other profile or official install was touched | PASS | the host profile list is unchanged (desktop,node_modules,web) and every write went to the run's own temporary home |

### REG-01 — PASS

| 用例 | 判定 | 实测 |
|---|---|---|
| pnpm build | PASS | exit 0 |
| pnpm -r check | PASS | exit 0 |
| pnpm check:tests | PASS | exit 0 |
| pnpm test:unit | PASS | exit 0 |
| pnpm test:integration | PASS | exit 0 |
| pnpm test:ptc | PASS | exit 0 |
| pnpm test:compat | PASS | exit 0 |
| pnpm check:preset | PASS | exit 0 |
| pnpm test:profile | PASS | exit 0 |

## 本轮回归门禁

| 命令 | 退出码 | 记录 |
|---|---|---|
| pnpm build | 0 | exit 0 |
| pnpm -r check | 0 | exit 0 |
| pnpm check:tests | 0 | exit 0 |
| pnpm test:unit | 0 | exit 0 |
| pnpm test:integration | 0 | exit 0 |
| pnpm test:ptc | 0 | exit 0 |
| pnpm test:compat | 0 | exit 0 |
| pnpm check:preset | 0 | exit 0 |
| pnpm test:profile | 0 | exit 0 |

## 未覆盖 / 边界

- NO HUMAN EVER TYPED /ptc-hashline-incident or /ptc-hashline-upgrade IN A REAL HOST as part of this run. What is measured is the AUTOMATABLE part: the packed install, the real launcher composing the preset, the entry visibility and refusal through the real registry/loader, and both workflows driven through the installed CLI. A real session with a person at the keyboard remains a user operation, and this report does not pretend to have had one.
- The acceptance profile is NOT a replica of the daily web profile. It boots @deepseek-ai/dsh-base + @deepseek-ai/dsh-headless from the registry at 0.2.1-rc.2, carries the four packed packages and the verification-only driver packages, and nothing else. Whatever the daily profile does on top of that is outside this run.
- The upgrade chain installs through an INJECTED runner: the pipeline is measured on the approved inputs, but no real dependency install happened. `result.json` / `switch.json` say `runner.source: injected`. `upgrade validate` and `upgrade switch` therefore run IN-PROCESS against the installed module (a child process cannot receive an injected runner); every refusal that must be a real exit CODE goes through a real child process instead.
- The switch targets a one-off profile inside a temporary DSH_HOME. The daily profile, every other profile and the official DSH install are untouched, and no host process is killed or restarted.
- The fixed candidate and pinned metadata replace a live registry query (D16/UPG-13). A real upstream upgrade still needs its own user-initiated assessment, proposal and consent.
- Semantic regression of a patch (did upstream implement the same behaviour?) is not measured by any of these rows: the candidate report says `semanticRegression: not-measured` for every item.
- This profile carries the official DSH host, so the assessment reached `verified: true`. That is a statement about the METADATA channels only: no dependency was installed, no target was switched, and nothing here authorizes a real upgrade.
- The fixture session logs carry no `request/header` event, so the assessment baseline reports `provider` and `model` as unknown. That is a property of this fixture, not evidence that the workflow loses them: the incident chain reads them from the same projection whenever a real log has them.
- The switch measured the FAILURE path: the target install was refused and the round restored itself. The success path (`switch-applied`) is covered by the target-switch suite, not by this run.

## 报告怎么读

- 评估的结论只对本次查到的元数据成立：`verified` 为 false 时最多到 `recommend-candidate`，绝不得说成「无需升级」，也不据此宣告升级成功（UPG-11）。
- 候选验证与目标切换的安装 runner 是注入的：`result.json` / `switch.json` 里记 `runner.source: injected`。它们证明的是流水线在批准输入上的行为，不是真实依赖安装成功。
- 目标切换只作用于一次性 profile 安装树；日常 profile、其它 profile 与官方 DSH 安装均未改动。
- 本文件由脚本生成，手工修改会在下一次运行中被覆盖；要改措辞请改 `scripts/delivery-acceptance-report.mjs`。
