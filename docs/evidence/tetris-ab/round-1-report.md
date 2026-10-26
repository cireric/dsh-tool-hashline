# Tetris A/B 实验最终分析报告 — ptc-hashline vs ptc — 2026-10-26

> **单次运行，n=1，不构成统计结论。** 本报告只描述这一次观察到的差异，并明确标出哪些差异不能归因到 Hashline。

被测对象：

| | 臂 A | 臂 B |
|---|---|---|
| 目录 | `tetris-1/` | `tetris-2/` |
| 会话 id | `session-446fb78a-37a2-44d4-9985-d7c4d838e387` | `session-af0bf0bd-5dd0-41bd-a96d-eb4f23025acc` |
| agentPreset | `ptc-hashline`（`agent-preset/selected` 事件） | `ptc`（默认，无选择事件） |
| 模型 / 档位 | wb / deepseek-v4.1-flash，reasoningEffort=high | 同左 |
| 上下文窗口 | 1,000,000 | 1,000,000 |
| 沙箱 / 审批 | workspace-write / ask | workspace-write / ask |
| 会话起止（+08:00） | 11:09:01 → 11:24:28（927 s） | 11:14:58 → 11:25:20（621 s） |
| token 总量 | **7.9 M**（实验者提供） | **4.1 M**（实验者提供） |
| 基线一致性 | 11 个未改动文件 sha256 与基线全等 | 同左 |

公共基线：未改动文件组合哈希 `3d1f0c57…81fb0`；`tasks.md` sha256 `df836b1e883dc174d3f9bb2e5c3d51a26415329ae654604805db48ead8747907`。

---

## 1. 结论摘要

1. **质量：两臂三条任务全部通过**（T1 12/12、T2 7/7、T3 17/17），编译零警告、`make test` 全绿、无「改错目标」。人工读 diff 也没有发现「checker 绿但意图没达成」的静默错误。
2. **成本：A 明显更贵。** token 7.9 M vs 4.1 M（**1.93×**）；三任务墙钟 581 s vs 383 s（1.52×）；模型轮次 59 vs 40（1.48×）。但**能归给编辑机制的只有很小一部分**：A 的任务期读取里，只有 4.3% 能归到「为领新 tag 而重读」，85.6% 是「读完之后不再改该文件」的验证性重读（§7）。
3. **编辑形态的差异是真实的，但方向反了。** A 用 18 次 edit（内含 43 个 hashline 操作、11 次调用是多 hunk）完成 B 需要 55 次 edit 的同样工作量（§4.1）；可是 A 的 `run_code` 程序更多（56 vs 37）、模型轮次更多（1.48×）——**批处理省下的编辑调用，被「读—改—读」的节律吃掉了**。
4. **归因：本次差异不能写成「Hashline 的优势/劣势」。** 两臂 preset 的差异面远大于 edit 工具注册——系统提示、意图门、工具白名单都不同（§2）。按实验包 §一 的判据，只能称为**「preset 组合差异」**。
5. **任务包在这轮没有兑现它自己的「可区分性」假设。** T1/T3 设计上要逼出「同一段代码出现多次」的文本匹配歧义，但 B 的 55 次 edit **零失败**，一次「不唯一」都没撞上：它的 `old_string` 中位 2 行、56% 是多行、最长 27 行——**唯一性是靠邻域上下文买下来的，而这份上下文本来就在它的窗口里，边际成本≈0**。因此「精确文本匹配脆弱」这个命题，本次既没被证实也没被否证，只是**没有被检验到**。
6. **checker 有区分度。** 基线上 t1 3 红 / t2 2 红 / t3 5 红，与实验包 §八 记载一致；两臂全绿说明绿态可达（此前「绿态未用参考实现跑通」的缺口，这次由两臂各自补上）。

---

## 2. 归因边界（先看这一节，再读任何结论）

按实验包 §一 的要求本应 diff 两个 preset 的定义目录。本次无法定位 `ptc-hashline` 的 preset 定义文件，于是改用更直接的证据：**从会话日志里取出两臂实际收到的 system prompt 与工具声明做逐行比对**。

| 维度 | 臂 A（ptc-hashline） | 臂 B（ptc） | 是否只是 edit 注册差异 |
|---|---|---|---|
| system prompt 体量 | 58,682 字符 / 784 行（CRLF） | 48,261 字符 / 1,030 行（LF） | ✗ |
| 章节结构 | 有 `Phase 0 — Intent Gate`、`Delegation`、`Communication`、`Failure recovery`、`Verification — EVIDENCE, NOT ASSERTION`、`Hard blocks` 六节 + `Writing code for run_code` | 只有 `Writing code for run_code` | ✗ |
| 意图门 | enforce；会话内 3 条 `Intent:` 门行、2 次 `intent-gate-watchdog` 注入 | 无 | ✗ |
| edit 工具 | hashline DSL（`PUT N.=M:` / `PUT >N:` / `CUT` / `MV`，锚点为 read 返回的 `[path#tag]`） | `replace`（`old_string` / `new_string`，精确唯一匹配） | ✓（本项是差异之一） |
| 工具白名单 | 有 `ralph`，无 `schedule_*` | 有 `schedule_create/update/delete`，无 `ralph` | ✗ |
| 逐行差异 | LF 归一后 552 行不同（A 独有 399 行，B 独有 153 行） | — | ✗ |

**判据落点：实验包 §一 的第二条 ——「差异还包括系统提示 / 委派 / 白名单 → 结论只能标为 preset 组合差异」。**

补充混杂项（务必计入解读）：

- A 的一次 edit 是被**意图门策略**拒掉的，不是 hashline 机制失败；这 1 次失败不该计入编辑工具的失败率。
- A 的推理里多次出现「先写门行再动手」的自我调度，这部分开销属 preset 而非 Hashline。
- 两臂**并行执行**（A 11:09–11:24，B 11:14–11:25，重叠约 9.5 分钟），墙钟受同机争用影响，只能当参考量级。

---

## 3. 交付物验收

| 任务 | 臂 A | 臂 B | 基线（必须红） |
|---|---|---|---|
| T1 配色预设 | **PASS** 12/12 | **PASS** 12/12 | FAIL（3 红：mono 非灰度、contrast 亮度差不足、`--palette=bogus` 未退 2） |
| T2 计分规则变体 | **PASS** 7/7 | **PASS** 7/7 | FAIL（2 红：隐藏探针编译不过、`--rules=bogus` 未退 2） |
| T3 布局常量 + 无头测试 | **PASS** 17/17 | **PASS** 17/17 | FAIL（5 红：无 layout.h、render.c 未 include、宏仍重复定义、tests 只有 1 个 .c、编译期断言失败） |
| checker 自检 | `--selftest` 4/4 PASS | | |

`make test` 断言数：基线 3017 → A **3055**（新增 `test_scoring_rules`、`test_game_rule_scoring`），B **3139**（新增 `test_palettes`、`test_scoring_rules`、`test_game_rules_wiring`）；两臂新布局测试各 11 条。两臂 `make all` 均 0 warning、0 编译错误。

逐行 checker 输出见附录 A（A/B 各三份 + 基线三份 + selftest），原始文件在 `.probes/tetris-ab/check-*.txt`。

---

## 4. 逐任务成本

内层工具计数取自会话日志的 `tool/ptc-dispatch` 事件（PTC 里 `run_code` 程序内部的实际工具调用），不是模型可见的 `run_code` 次数。

| 任务 | 臂 | 墙钟 | 模型轮次 | edit 成功 | edit 失败 | 失败后重试 | read | write | pwsh | grep | 编译错误 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T1 | A | 286.7 s | 25 | 5 | 2 | 2 | 14 | 0 | 8 | 1 | 0 |
| T1 | B | 200.7 s | 18 | 23 | 0 | 0 | 5 | 1 | 5 | 4 | 0 |
| T2 | A | 182.2 s | 21 | 8 | 1 | 1 | 15 | 0 | 5 | 1 | 0 |
| T2 | B | 124.1 s | 13 | 22 | 0 | 0 | 5 | 0 | 5 | 1 | 0 |
| T3 | A | 112.0 s | 13 | 5 | 0 | 0 | 8 | 2 | 6 | 3 | 0 |
| T3 | B | 57.8 s | 9 | 10 | 0 | 0 | 2 | 2 | 5 | 1 | 0 |
| **合计** | **A** | **581.0 s** | **59** | **18** | **3** | **3** | **37** | **2** | **19** | **5** | **0** |
| **合计** | **B** | **382.6 s** | **40** | **55** | **0** | **0** | **12** | **3** | **15** | **6** | **0** |

（前置的探索/确认两轮：A 42.9 s / 34 次内层调用，B 55.7 s / 38 次；两臂的前置提示词几乎相同，已从任务对照中剔除。）

读这张表要注意的三件事：

- **A 用更少的 edit 完成同样的工作量。** 18 次成功 edit 产生 +606/−56 行改动；B 用 55 次 edit 产生 +621/−69 行。hashline 的块级 `PUT N.=M:` 确实把「一次改一片」做到了，B 则是「一次改一处」。
- **A 的 read 是 B 的 3 倍**（37 vs 12），且 A 多是整文件读：T1 里 `src/render.c` 被读 6 次、`README.md` 4 次，单这一轮 A 的 read 返回 78,797 字符，B 只有 5,846 字符。
- **失败全部集中在 A，且都不是「匹配不上 / 不唯一 / 改错目标」**（见 §5）。

### 4.1 编辑粒度（量化）

| 指标 | A（hashline） | B（replace） |
|---|---|---|
| 成功 edit 调用 | 18 | 55 |
| 调用内含的编辑操作 | **43** 个 `PUT` | 55 个 old/new 对 |
| 一次调用含多个 hunk（多段） | **11 / 18** | —（无此概念） |
| 操作类型分布 | 替换 `N.=M` ×28、后插入 `>N` ×13、前插入 `<N` ×2 | 唯一串替换 ×55 |
| 单次操作规模 | 替换区间中位 3 行（最大 49 行），body 中位 5 行（最大 155 行） | `old_string` 中位 2 行（最大 27 行），中位 39 字符 |
| 净增 ≈550 行摊到每次 edit | ≈30 行/次 | ≈10 行/次 |
| 承载这些 edit 的 `run_code` 程序 | **56** | **37** |

一句话：A 的编辑是**块级、多 hunk**，B 的编辑是**点状、单点**。但 A 的编辑调用只有 B 的 1/3（18 vs 55），`run_code` 程序反而多 1.5 倍（56 vs 37）——省下的编辑调用没有换来更少的往返。

---

## 5. 失败明细

臂 B：**0 次失败**（55 次 edit + 3 次 write 全部一次成功）。

臂 A：3 次失败，逐条如下（时间轴为会话相对时间）：

```
T1 t+360.0s | 类型：策略拒绝（意图门，不是编辑机制） | 目标 tetris-1/include/render.h [tetris-1/include/render.h#148A]
摘录：Error: 被拒的是 run_code 程序里的内层 edit 调用。[intent-gate] 这一次调用没有门行垫底 —— 本轮还没有出现过那个六桶行。
恢复：重发同一调用 → 撞上第二条错误（语法）

T1 t+363.9s | 类型：hashline 语法（缺冒号） | 目标同上
摘录：Error: line 2: `PUT` without `:` is clipboard-backed and takes no body rows.
        Add `:` after the locator to write literal content (`PUT >40:` then `+TEXT` rows).
恢复：把 `PUT 4.=7` 改成 `PUT 4.=7:` 后同一 tag 直接成功（+3.4 s）

T2 t+731.7s | 类型：锚点范围未展示（tag 只覆盖部分行） | 目标 tetris-1/README.md [tetris-1/README.md#FFC8]
摘录：Error: This edit anchors to lines 104 of tetris-1/README.md that [tetris-1/README.md#FFC8] never displayed
        (it showed a partial range, a search hit, or a folded summary).
恢复：按提示用同一 tag 重发即成功（+9.4 s），未重新 read、未改用 write
```

按实验包的四类分类：**锚点/tag 被拒 2（1 次策略、1 次范围未展示）、匹配不上 0、不唯一 0、改错目标 0**，另有 1 次纯语法错误。最坏情况用两次重试恢复（第二次成功），**没有一次通过 `write` 整文件重写或 shell 绕过**（这正是 A 的 preset 里明令禁止的降级路径，它的行为与规则一致）。

B 虽然有 1 次 `write` 全量重写 `src/main.c`（T1），但那不是失败后的绕过——它没有前置失败，且重写后基线 `main.c` 的原有逻辑逐行保留（diff 无删除行，见 §6）。

---

## 6. 人工判读（diff 审核）

### 6.1 有没有静默改错目标

**没有。** 两臂的改动文件集合都在预期内：

| 文件 | A | B | 说明 |
|---|---|---|---|
| `include/layout.h`（新增） | +23 | +18 | T3 要求 |
| `tests/test_layout.c`（新增） | +52 | +54 | T3 要求 |
| `src/render.c` | +176/−47 | +175/−59 | 配色表 + include layout.h |
| `src/main.c` | +78/−1 | +48/−1 | 命令行解析 |
| `src/score.c` | +57/−1 | +58/−1 | 规则集 |
| `src/game.c` | +11/−2 | +8/−2 | 换计分入口 |
| `include/{render,score,game}.h` | +33 | +36 | 接口 |
| `Makefile` / `.gitignore` | +16 | +17 | 新测试目标 |
| `README.md` | +35/−2 | +47/−17 | 文档（两臂都主动补了） |
| `src/{board,piece,rng,input,platform}.c`、`include/{board,piece,rng,input,platform,tetris}.h` | **0 改动** | **0 改动** | 与基线 sha256 全等 |

两臂对 `tests/test_core.c` **只有新增、没有删除行**（A +162，B +209），既有断言一条没动。

### 6.2 有没有为过验收而做的最小改法

没有绕过。两臂都做了超出 checker 覆盖范围的自我验证：

- A 在 T3 把改动前的 `tetris.exe` 备份，抓前后两帧逐字符比对（日志：`first-frame character content identical: True`），验证「抽宏不改渲染结果」；还用 PowerShell 批量跑 `--palette=` 的 6 种非法形态确认退出码。
- B 在 T3 用 `git diff --no-index` 复核 `render.c` 的差异，并为配色写了整块单元测试（`test_palettes`：名字解析、classic 逐值、mono 的 R=G=B、contrast 的亮度差与 0.68 暗部余量、越界索引），把「契约」变成可回归的测试。

### 6.3 两处语义偏差（都不违约，但要记下来）

1. **NES 规则下的 T-Spin 提示。** B 只在计分函数里忽略 T-spin，`lock_piece` 里的 T-spin 判定仍然生效，所以 `--rules=nes` 时命中 T-spin 仍会弹 `T-SPIN` toast；A 在锁定路径把 `tspin` 归零（`game.c` 里多一处 `if (g->rules == RULES_NES) tspin = TSPIN_NONE;`），toast 不再出现。提示词冻结的是**计分**，两者都合规；但「任何 T-spin 都按普通消行」的意图，A 贯彻得更彻底。
2. **NES 分支的清零语义。** B 的 `score_nes` 每次调用显式把 `combo`/`b2b` 置 0；A 的 `nes_clear` 不碰这两个计数（最终状态等价，因为锁定路径每块都重置 combo）。B 更防御，A 更少写。

### 6.4 代码风格与接口面

- 两臂都零警告、命名与既有代码一致、注释均为英文且密度偏高（都超出基线密度，但不是风格冲突）。
- **测试面设计不同**：B 为测配色在 `render.h` 新增两个生产 API（`render_piece_color`、`render_field_background`），并把 `render.c/input.c/platform.c` 链进 `test_core`；A 不增加任何测试专用 API，配色靠 CLI 抓帧验证。A 的接口面更窄，B 的测试覆盖更细。
- **同一个可测性目标，两条不同的路**，没有哪条明显更优；但 B 的做法把「只为测试存在」的函数放进了产品头文件。

---

## 7. 成本差异来自哪里（第二次取证后已修正）

初版把 A 的读取放大主要归给「tag 随每次编辑失效，必须重读才能领新 tag」。**逐条归因后这个说法站不住。**

判据：把每次「编辑之后又读了同一文件」的 read 分成两类——读完之后**还要**改该文件（可能是为领新 tag），读完之后**不再**改该文件（只能是验证/定位）。结果：

| 臂 A 的任务期 read | 次数 | 返回字符 | 占 read 体量 |
|---|---|---|---|
| 任务内首次读（多数是 `limit=1`，只为领 tag） | 16 | 6,676 | 6.7% |
| 编辑后重读，且之后还要改该文件（机制性） | 4 | 4,315 | **4.3%** |
| 编辑后重读，且之后不再改该文件（验证） | 14 | 85,272 | **85.6%** |
| 编辑之前的重读（定位/回看） | 3 | 3,373 | 3.4% |
| 合计 | 37 | 99,636 | 100% |

最刺眼的一处：T1 里 A **连续 3 次整文件重读 `src/render.c`**（每次 19,873 字符，合计约 60 KB），而该文件在此后的 T1 里再也没有被编辑过。B 的任务期 read 只有 12 次（9 次首次读 + 3 次验证读），且几乎全是 `offset/limit` 局部读；它的编辑不依赖 tag，55 次 edit 大多发生在「本会话早就读过」的文件上。

所以成本差的结构是：

- **编辑机制本身的税很小**——只有 4.3% 的读取体量能归到「为领 tag 而重读」；
- **真正的放大项是「用整文件重读来验证」这一行为**——占 85.6%；
- **两臂的验证次数其实相当**（A 的 pwsh 19 次 / B 15 次，且每任务都跑 make + test + 抓帧），差别在**媒介**：A 在编译验证之外又叠加了整文件重读，B 只做编译/运行验证。

token 差可以用「更胖 × 更多轮」近似对上：轮次 59/40 = 1.48×，单轮平均 token 7.9M/59 ÷ 4.1M/40 ≈ 1.30×，乘积 ≈ 1.92，与观察到的 1.93× 吻合。而 88 KB 的重读一旦进入上下文，会在该任务后续每一步重复计费——这也是为什么 read 体量差 5× 而 token 只差 1.9×。三个因子（prompt 体量 +10.4 KB、门禁与门行、重读）在日志里无法定量拆开。

**成本结论的准确写法：这次看到的是「ptc-hashline 组合贵约 2 倍」；其中能直接归给编辑机制的只是很小一部分（读取体量的 4%），大头是随这个 preset 一起带来的「重读式验证」行为。**

### 7.5 可以下的结论（按置信度分层）

| # | 结论 | 关键证据 | 置信度 |
|---|---|---|---|
| 1 | **精确文本匹配的「唯一性成本」在实践中≈0** | B 55 次 edit 零失败；`old_string` 中位 2 行、56% 多行、最长 27 行——用邻域上下文换唯一性，而上下文本来就在窗口里 | 高（观察充分 + 机制清楚） |
| 2 | **hashline 的块级/多 hunk 编辑能力真实存在** | 18 次调用含 43 个 `PUT`，11/18 是多段调用；单次替换中位 3 行、最大 49 行 | 高（直接计数） |
| 3 | **它并没有减少模型往返，反而增加** | `run_code` 程序 56 vs 37；模型轮次 59 vs 40；编辑调用却只有 B 的 1/3（18 vs 55） | 中高（门禁与重试有贡献，但「读—改—读」节律是主因） |
| 4 | **A 的成本大头不是 tag 机制，而是验证式重读** | 机制性重读 4 次/4,315 字符（4.3%）；「读完不再改」的重读 14 次/85,272 字符（85.6%） | 高（判据明确）；**但「为什么重读」未定** |
| 5 | **hashline 引入的是全新的失败类别：工具礼仪** | A 的 3 次失败 = 策略门 1 + DSL 语法 1 + 锚点行未展示 1；匹配不上/不唯一/改错目标均 0 | 高 |
| 6 | **「更安全」在本任务包上没有被证实** | 两臂「改错目标」都是 0；B 连歧义都没撞上，安全性没有可比较的触发点 | 高（但属「未检验」，不是「已否证」） |
| 7 | **质量无可判别差异** | checker 三任务全绿；人工 diff 审核未见静默错误；两臂未改动文件与基线 sha256 全等 | 高（限 checker 与本次 diff 覆盖范围） |

**不能下的结论**（写清楚，免得被引用走样）：

- 不能给出「Hashline 值多少个 token」的系数——1.93× 里机制、门禁、prompt 体量、重读习惯四者无法定量拆分。
- 不能说 hashline 更安全或更不安全：本次没有触发安全差异的样本。
- 不能外推到别的语言/代码库：这是一个 12 k 行 C 项目、单会话、三条中等规模任务。
- 不能忽略「重读」这个变量本身可能是个例：它是**这一次**的模型行为，下一轮可能变。

---

## 8. 按实验包 §七 的判定表逐条对照

| 判据 | 本次是否命中 | 允许的结论 |
|---|---|---|
| 某臂出现 ≥1 次「改错目标」且 checker 仍绿 | 否（两臂 0） | 不成立，无质量差异证据 |
| 某臂「不唯一/匹配不上」失败达 5 倍以上、checker 全绿 | 否（A 这两类均为 0，失败是策略与协议） | 不成立，不进入质量结论 |
| 两臂 checker 全绿、失败次数都为 0 | 不完全（A 有 3 次，但都不是歧义类失败） | 不能说「无差别」，也不能说「有质量差别」 |
| 两臂 checker 都红 | 否 | — |

结论落点：**本次得到的是一个可用的成本对照，不是质量对照；且成本对照的归因只能到「preset 组合」这一层。**

---

## 9. 实验协议偏差（影响复现，必须记录）

1. **没有按 §二 建 `runs/<臂>/tetris` 结构**：两臂直接在仓库根 `tetris-1/`、`tetris-2/` 工作，会话 cwd 是工作区根。本次我把两棵树复制到 `.probes/tetris-ab/runs/{A,B}/tetris` 后跑 checker，**原树未改**（checker 只读 run 树）。
2. **提示词不是逐字原样**：路径 token 由 `tetris/` 换成 `@tetris-N/`，另有首尾空格差异。归一化后逐行比对，三任务提示词与 `tasks.md` **完全一致**（13/17/12 行，差异 0 行）——语义等价，但不是「不增删一个字」。
3. **多了两轮前置提示词**（「工作目录是 @tetris-N/…先探索，回复 OK」＋「严禁越界，回复 OK」），不在任务包里；两臂措辞几乎相同，成本已单列。
4. **两臂并行执行**（重叠约 9.5 分钟），墙钟不可当受控量。
5. **A 额外受意图门约束**（enforce），B 无；这是 preset 差异，不是实验者施加的。
6. token 总量由实验者提供，会话日志里没有 usage 字段，无法从日志复算，也无法拆到单任务。

---

## 10. 本报告不能说明什么

- **n=1**：每臂一次运行，不能推出显著性，也不能排除单次随机性（模型采样、时钟、并行争用）。
- **归因**：两臂 preset 在系统提示、意图门、工具白名单上都不同，任何差异都不等于 Hashline 单独的作用。
- **可区分性**：B 零失败意味着本任务包没有把「精确文本匹配的歧义风险」逼出来；T1/T3 的假设在本次**未被检验**，既不算证实也不算否证。
- **风格与结构**：checker 只覆盖提示词里冻结的契约，其余（接口面、测试设计、文档质量）出自人工读 diff，带主观性。
- **成本拆分**：1.93× 的 token 差无法在「edit 机制 / prompt 体量 / 门禁开销 / 上下文重发」之间定量分解。

---

## 11. 如果要做第二轮（建议）

1. **对齐两臂的其余差异面**：统一 system prompt 与工具白名单，只保留 edit 注册差异；否则永远只能得到「组合差异」。
2. **把歧义真正做出来**：在 T1/T3 里放入 2–3 段**逐字相同**的代码块（如三个相同的边框绘制块、两段同构的规则分支），让 `old_string` 必然歧义，才能检验「精确匹配脆弱」这个命题。
3. **串行执行**，避免墙钟争用；每任务记录 token 增量（需要 harness 提供 usage 或分段日志）。
4. **保持现有 checker**：它已验证有区分度（基线 3/2/5 红），且两臂都能跑绿，是可直接复用的判据。

---

## 附录 A：checker 原样输出

### A · T1

```
PASS  make all 退出码 0   -- code=0
PASS  编译零警告   -- warning 数=0
PASS  make test 全绿   -- code=0
PASS  默认帧可解析   -- rows=24
PASS  default: 第 0 行是场地边框   -- "+- TETRIS --"
PASS  default: 侧栏左上角在第 24 列   -- "  +- HOL"
PASS  default: 场地底边闭合   -- "+--...-+ "
PASS  classic 调色板未变   -- 238,160,0 | 238,40,40 | 0,102,238 | 0,204,0 | 238,214,0
PASS  --palette=mono 全部灰度   -- 18,18,18 | 225,225,225 | 81,81,81 | 71,71,71 | 95,95,95 | 190,190,190
PASS  --palette=contrast 亮度差 >= 96   -- 5 色
PASS  --palette=bogus 退出码 2   -- code=2
PASS  --palette=bogus 有错误输出
SUMMARY {"task":"t1","runDir":".probes\\tetris-ab\\runs\\A","total":12,"failed":0,"verdict":"PASS"}
```

### A · T2

```
PASS  make all 退出码 0   -- code=0
PASS  编译零警告   -- warning 数=0
PASS  make test 全绿   -- code=0
PASS  隐藏探针编译通过（score_clear_rules 契约成立）
PASS  nes/guideline 计分断言全部成立
PASS  --rules=nes 可运行且画面正常   -- rows=24
PASS  --rules=bogus 退出码 2   -- code=2
SUMMARY {"task":"t2","runDir":".probes\\tetris-ab\\runs\\A","total":7,"failed":0,"verdict":"PASS"}
```

### A · T3

```
PASS  make all 退出码 0   -- code=0
PASS  编译零警告   -- warning 数=0
PASS  make test 全绿   -- code=0
PASS  include/layout.h 存在
PASS  layout.h 导出 CVW
PASS  layout.h 导出 CVH
PASS  layout.h 导出 FIELD_X
PASS  layout.h 导出 FIELD_Y
PASS  layout.h 导出 PANEL_X
PASS  layout.h 导出 PANEL_W
PASS  render.c 包含 layout.h
PASS  render.c 不再重复定义布局宏
PASS  tests/ 下至少两个 .c 文件   -- test_core.c,test_layout.c
PASS  布局约束编译期断言成立
PASS  default: 第 0 行是场地边框   -- "+- TETRIS --"
PASS  default: 侧栏左上角在第 24 列   -- "  +- HOL"
PASS  default: 场地底边闭合   -- "+--...-+ "
SUMMARY {"task":"t3","runDir":".probes\\tetris-ab\\runs\\A","total":17,"failed":0,"verdict":"PASS"}
```

### B · T1

```
PASS  make all 退出码 0   -- code=0
PASS  编译零警告   -- warning 数=0
PASS  make test 全绿   -- code=0
PASS  默认帧可解析   -- rows=24
PASS  default: 第 0 行是场地边框   -- "+- TETRIS --"
PASS  default: 侧栏左上角在第 24 列   -- "  +- HOL"
PASS  default: 场地底边闭合   -- "+--...-+ "
PASS  classic 调色板未变   -- 238,214,0 | 0,102,238 | 0,204,0 | 238,160,0 | 0,226,226
PASS  --palette=mono 全部灰度   -- 8,8,8 | 170,170,170 | 96,96,96 | 132,132,132 | 163,163,163 | 81,81,81
PASS  --palette=contrast 亮度差 >= 96   -- 5 色
PASS  --palette=bogus 退出码 2   -- code=2
PASS  --palette=bogus 有错误输出
SUMMARY {"task":"t1","runDir":".probes\\tetris-ab\\runs\\B","total":12,"failed":0,"verdict":"PASS"}
```

### B · T2 / T3

与 A 逐行相同（仅 `runDir` 不同）：T2 7/7 PASS，T3 17/17 PASS。

```
SUMMARY {"task":"t2","runDir":".probes\\tetris-ab\\runs\\B","total":7,"failed":0,"verdict":"PASS"}
SUMMARY {"task":"t3","runDir":".probes\\tetris-ab\\runs\\B","total":17,"failed":0,"verdict":"PASS"}
```

### 基线（证明 checker 真的在判）

```
SUMMARY {"task":"t1","runDir":".probes\\tetris-ab\\runs\\base","total":12,"failed":3,"verdict":"FAIL"}
SUMMARY {"task":"t2","runDir":".probes\\tetris-ab\\runs\\base","total":6,"failed":2,"verdict":"FAIL"}
SUMMARY {"task":"t3","runDir":".probes\\tetris-ab\\runs\\base","total":11,"failed":5,"verdict":"FAIL"}
--selftest: 4/4 PASS
```

### 真实抓取的一帧（臂 A · 默认 classic，`probe-frame-text.mjs`）

行首编号即 canvas 行号；第 0 行第 24 列起是侧栏（checker 断言的三处地标之一）。

```
 0|+- TETRIS -----------+  +- HOLD ---------------+
 1||                    |  |                      |
 2||                    |  |                      |
 3||                    |  |                      |
 4||                    |  +----------------------+
 5||                    |  +- NEXT ---------------+
 6||                    |  |                      |
 7||                    |  |                      |
 8||                    |  |                      |
 9||                    |  |                      |
10||                    |  |                      |
11||                    |  |                      |
12||                    |  |                      |
13||                    |  |                      |
14||                    |  |                      |
15||                    |  |                      |
16||                    |  +----------------------+
17||                    |   SCORE                0
18||                    |   LEVEL                1
19||                    |   LINES                0
20||                    |   TIME             00:01
21|+--------------------+   BEST               212
22|LEFT/RIGHT move   UP/X rotate   Z ccw   A 180
23|SPACE drop  C hold  P pause  R restart  Q quit
```

---

## 附录 B：证据文件清单

全部在 `.probes/tetris-ab/`（`check-*.txt` 已转 UTF-8；`A.jsonl` / `B.jsonl` 是逐帧解码后的会话日志，可用 `node decode.mjs <session.v4.jsonl.zstd> <out.jsonl>` 重新生成）：

| 文件 | 内容 |
|---|---|
| `decode.mjs` | 逐帧解压 `session.v4.jsonl.zstd`（240 帧 / 197 帧，0 失败） |
| `probe-shape.mjs` `probe-meta.mjs` `probe-diff-preset.mjs` `probe-sys.mjs` | 事件结构、preset/模型、工具声明、system prompt 抽取 |
| `probe-tools.mjs` `stats.mjs` `probe-cost.mjs` `probe-payload.mjs` `probe-shell.mjs` `probe-reads.mjs` | 逐任务调用统计、轮次、工具返回体量、shell 与读模式 |
| `probe-edits.mjs` `probe-dump.mjs` | 逐条 edit/write 轨迹（含 hashline 锚点解析）与失败原文 |
| `probe-edit-result.mjs` | **edit 返回体形状**：hashline 会回显改动区并带新 `#tag`，replace 只回一句「updated」 |
| `probe-timeline.mjs` `probe-reread.mjs` `probe-readargs.mjs` | 逐文件 read/edit 时序、重读归因（机制性 vs 验证性）、read 的 `offset/limit` 参数 |
| `probe-granularity.mjs` | **编辑粒度**：`PUT` 区间跨度/body 行数/多 hunk 比例，`old_string` 行数与字符数 |
| `probe-promptdiff.mjs` | 交付提示词 vs `tasks.md` 逐行比对（归一后差异 0 行） |
| `probe-frames.mjs` | 抓帧取色（classic 与基线同族，无新增颜色；差异只因随机方块不同而出现的 0.15/0.22/0.45/0.68 暗部） |
| `probe-frame-text.mjs` | 抓一帧并按行号打印字符网格（附录 A 那帧的原样来源） |
| `A.jsonl` `B.jsonl` | 两臂完整会话日志（解码后） |
| `check-{A,B,base}-t{1,2,3}.txt` `check-selftest.txt` | checker 原样输出 |
| `diff-base-A.txt` `diff-base-B.txt` | 两臂 vs 基线的完整 diff（1055 / 1126 行） |
| `sys-A.txt` `sys-B.txt`（及 `-lf` 版） | 两臂 system prompt 原文 |
| `runs/{A,B,base}/tetris/` | checker 用的三棵 run 树（复制品，原树未改） |
