# DSH hashline 选型分析：三个社区插件，还是自己写？

- 日期：2026-10-22
- 基线：DSH `0.2.1-rc.2`（checkout 最近提交 2026-10-17）
- 对照实现：oh-my-pi（omp）`dc37184`（2026-10-08）、oh-my-openagent hashline-core
- 结论性质：代码级对比 + 决策建议；未在你的真实 DSH profile 上安装任何一个插件

---

## 0. 结论（先看这一段）

**一句话回答：不要纯选第三方，也不要从零自研——选「成熟第三方引擎 + 自研薄适配层」；验证阶段可以先用 hyperion 顶着。**

**不要从零复刻 omp 的 hashline。** 这不是一个"几千行的小工具"：omp 的编辑内核是
`crates/pi-edit` 约 7.7k 行 Rust，加上 coding-agent 侧约 1.5k 行 TS；hy-sde 的忠实
TS 移植是 10.3k 行引擎 + 8.4k 行插件，配 341 个测试。从零写的真实成本是 1–2 个人月，
而且 omp 还在按周改语义，你会同时背上"实现 + 追平"两份债。

**三个第三方里：**

1. **Rianico/dsh-better-edit：不建议。** 它钉在 DSH `0.1.6-alpha.2` 的 SDK 上，
   最后一次提交 2026-09-28；README 的 Roadmap 还写着"Re-check wiring vs next dsh
   (pinned `0.1.0-rc.6`)"、"Current `0.7.0`"，而包版本已经是 1.0.0 —— 文档和版本都
   停在 0.1.x 时代。DSH 已经走到 0.2.1-rc.2，跨了两个 minor，这不是"作者暂时没空"，
   而是**已知会漂移**。
2. **hy-sde/dsh-tool-edit：最接近 omp，但当前形态有一个关键缺口。** 它的引擎是逐
   commit 对齐 omp 的（提交信息直接引用 omp SHA），4-hex 文件 tag、`PUT/CUT/REM/MV`、
   named register、seen-line guard 都在。问题是：**它只注册 `edit`，不注册 `read`**，
   而 hashline 的 tag 必须由 read 输出带给模型；官方 DSH 的 `read` 不输出 `[path#tag]`。
   也就是说，在**官方 DSH** 上原样安装，`hashline` 模式缺少 tag 来源，第一次编辑就会
   撞上 `Missing hashline snapshot tag`。它的 `replace / patch / apply_patch` 模式不受
   影响。是否在你的环境里真的断，值得花 10 分钟实测（见 §6）。
3. **hyperion2144/dsh-hashline-edittool：开箱闭环最好，但它不是 omp 的实现。** 它用
   变长 Base62 的**逐行 anchor**（不是 omp 的"文件 4-hex tag + 行号"），自带 read /
   edit / write / grep / undo / ast / lsp 和 Web 卡片；一条 `dsh plugin add` 就能用，
   今天还在提交（0.10.3）。代价是 39k 行、tree-sitter / sqlite / ripgrep 依赖、以及
   "换了一套 anchor 契约"——你得到的不是 omp 的语义，而是另一套（更重的）设计。

**我的建议（按投入从低到高）：**

- **想最快验证 hashline 在你工作流里到底值不值**：先装 hyperion 跑一周 A/B；它闭环、
  活跃、可回退。把它当"效果验证器"，不是终态。
- **确认有效、且你要的是 omp 语义**：不要继续堆第三方，走**"复用引擎 + 自写薄适配层"**：
  依赖 `@hy-sde-org/dsh-hashline`（MIT、零运行时依赖、270 个测试），自己写 `read`
  （输出 `[path#TAG]` + 行号）和 `edit`（调用引擎），约 1.5–3k 行。这是"自研插件"，
  但不是"自研算法"，成本差一个数量级。
- **不想写代码、又要 omp 语义**：fork `dsh-tool-edit` 补一个 read 工具（或给上游提
  PR）。这是三条路里改动最小、又保住 341 个测试的做法。

---

## 1. 先分清两条"hashline"路线

社区里被都叫 hashline 的东西，其实是两套不同的坐标系统。选型前必须分清，否则会拿
"omp 还原度"去要求一个根本不打算还原 omp 的项目。

### 1.1 omp 路线：文件级 tag + 行号

omp 的补丁长这样（`clones/oh-my-pi/crates/pi-edit/prompts/hashline.md`）：

```text
[greet.py#A1B2]
PUT 1*:
+@cache
+def greet(name):
+    print(name)
```

- `[PATH#TAG]` 的 TAG 是**整篇文件**的 4 位十六进制指纹：xxh32 对"每行去掉行尾空格/
  Tab/CR"后的文本取哈希，再 `& 0xffff`（`clones/oh-my-pi/crates/pi-edit/src/store.rs:71-92`）。
- 正文用**原始行号** `N:TEXT`，不是逐行 hash。行号不随 hunk 位移。
- 操作符很丰富：`PUT N.=M:` 替换、`PUT N*:` 按语法块替换、`PUT <N`/`>N` 插入、
  `CUT` 删除并捕获、`@name` 命名寄存器、`REM` 删文件、`MV` 移动。
- 校验是"整文件指纹 + 行号 + 模型看过哪些行"（seen-line guard），不匹配时走 recovery /
  重新读取，而不是逐行 anchor 重映射。

**关键含义：read 输出不需要给每行加 hash，只需要在头部加一个 `[path#TAG]`。**
DSH 的 read 本来就已经输出 `N: text`（`packages/fs/tool-fs/src/read-render.ts:152-169`），
所以 omp 路线在 DSH 上的增量 token 成本几乎为零。

### 1.2 逐行 hash 路线：oh-my-openagent、hyperion、better-edit

oh-my-openagent 的 `hashline-core` 是另一套：每行 `LINE#HASH|`，用 `computeLineHash`
（xxhash32，trimEnd 后计算），编辑引用逐行校验（`clones/oh-my-openagent/packages/hashline-core/AGENTS.md`）。
hyperion 的变长 Base62 anchor、better-edit 的 3 字符 xxh32 anchor，都属于这一族：
**行是身份，hash 是地址**。

这族的好处是行级漂移可以重映射、跨会话 anchor 可以共享；代价是：

- read 的每一行都要多带 2–6 个字符。一次 2000 行 read 大约多 8–12 KB（2–3k tokens），
  长会话里这是持续成本；
- 需要维护"anchor 状态 / served set / 租约"这类基础设施（hyperion 为此上了 SQLite）；
- 与 omp 的补丁语法不兼容，模型 prompt 也要整套换掉。

**所以：如果你的目标是"omp 的 hashline"，第 1.2 族再优秀也不是答案；如果目标是
"编辑少回显、少 re-read"，两族都能达到，1.2 族的工程完成度反而更高。**

---

## 2. DSH 侧约束：为什么插件都长这样

1. **内置 `edit` 永远在 host 平面注册。** `packages/fs/tool-fs/src/edit.ts:76-168`
   注册 `edit`，没有 `enableEdit` 开关。任何插件想在 host 平面再注册一个同名 `edit`，
   boot 时会撞 "prompt section `tool:edit` is already registered"。
2. **唯一干净的替换点是 agent scope 的同名遮蔽。** 三个插件都利用这一点：在 agent
   创建时把自己的 `edit` 注册进当前 agent scope，遮蔽 host 的全局 `edit`。
   `dsh-tool-edit` 的 README 把这条机制讲得最清楚（`clones/dsh-tool-edit/README.md:145-179`）。
3. **read 是另一回事。** 谁想改变 read 的输出（加 tag / 加 anchor），就必须**同时**
   遮蔽 `read`；只改 `edit` 拿不到 tag。这正是 hy-sde 当前缺口所在。
4. **DSH 发版很快。** 0.2.0-rc.2 → 0.2.1-alpha.2（10-11）→ alpha.4（10-15）→
   rc.2（10-17）。插件的 peer 版本必须贴着走；落后一个 minor 就可能遇到服务改名/
   删除（例如 `dsh-invariants` 已被 harness 移除，hy-sde 在 10-11 专门提交移除了对它的依赖）。

---

## 3. 三个插件逐项评估

### 3.1 hy-sde/dsh-tool-edit（omp 忠实移植）

**事实**

| 项 | 值 |
|---|---|
| 版本 / 最近提交 | `0.2.1-alpha.4` / 2026-10-15 |
| peer 依赖 | `@deepseek-ai/dsh-*` `^0.2.1-alpha.4`，`cordis ~4.0.5-alpha.2` |
| 代码量 | `packages/hashline` 10.3k 行、`packages/tool-edit` 8.4k 行 |
| 测试 | 300+ 用例（hashline 270 + tool-edit 71 个 `it/test`；README 记 246+23） |
| 运行时依赖 | 引擎零依赖；插件只依赖 schemastery |
| 许可 | MIT，THIRD-PARTY-NOTICES 保留 omp 版权 |
| 安装 | `dsh plugin add` + **手工复制 agent preset**；同时禁用 `str_replace_editor` |

**优点**

- 语义最接近 omp：4-hex 文件 tag、行号、block op、register、`REM/MV`、seen-line
  校验、no-op loop guard、diff preview 都在。
- 追 omp 很勤：提交信息直接引用 omp commit（例如 `fix(...): enforce the seen-line guard
  by default (omp 760d5dfdee)`），不是"照着 README 猜"。
- 引擎抽成独立包、零依赖、MIT，**可以被你自己的插件复用**——这是它最大的战略价值。
- 内置 LSP（format-on-write / diagnostics-on-edit），在 stock DSH 上不需要改上游。

**缺点 / 风险**

1. **read 侧缺口（最重要）。** 插件只注册 `edit`（全包 grep 只有一处
   `ctx.tools.register`，`packages/tool-edit/src/index.ts:344`），系统提示却要求模型
   "Read the file first to get its `[path#tag]` header"（同文件 334-340）。官方 DSH 的
   read 输出只有 `<path>…</path><type>file</type><content>N: text…</content>`
   （`read-render.ts:152-169`），没有 tag。引擎侧 `assertSectionHashPresent` 在缺 tag 时
   直接抛错（`packages/hashline/src/patcher.ts:178-181`）。结论：**在官方 DSH 上，
   hashline 模式没有 tag 来源**。

   **但作者并不是"没写 read"——他写在了 fork 里。** `hy-sde/deepseek-harness`（master
   `1cec8fd`）的 `packages/fs/tool-fs/src/read.ts:13` 引入 `@deepseek-ai/dsh-hashline`，
   新增配置 `readSnapshotTags`（默认 true，`src/index.ts:65`），在
   `read.ts:262-306` 把整篇小文件记录进 per-session snapshot store，并由
   `read-render.ts:209-218` 在 `<content>` 前输出 `[path#TAG]`。插件测试也把这条
   契约写成 "restored in the fork (bfce5d6505)"（`packages/tool-edit/tests/hashline.spec.ts:183-191`）。
   所以缺口是**打包问题**，不是设计遗漏：read 改造留在 fork 的 `tool-fs` 里，没有随
   npm 插件发布。

   **为什么 read 不放进插件？** 这是有意的取舍，见 §3.1.1。
2. **安装不是一条命令。** 需要把 `examples/agent-preset/` 复制到
   `~/.dsh/.agent-presets/`，并且 preset 里不能带 `tool-fs`，否则 stock `edit` 会和
   它抢同一个 scope。对日常使用是持续的心智负担。
3. **单作者 + 快速追更。** 一周内多次 bump alpha；你 fork 之后每周都要 rebase。
4. **benchmark 的基线是 fork harness。** `benchmark/README.md` 明说记录数据来自
   hy-sde fork 的 `str_replace_editor`，在 stock 上重跑"不可直接比较"；收益数字
   （mutation 波 −31.7% wall time，通过率同为 100%）只能当方向性证据。

### 3.1.1 为什么 hy-sde 不把 read 做成插件？

一句话：**read 在 DSH 里不是"另一个工具"，而是 `tool-fs` 这个包的一行；改 read 的最小
方式是改 `tool-fs`，不是再注册一个同名工具。** 具体有四层考虑：

1. **重写 read 等于重做半个 tool-fs。** DSH 的 `read` 不只是文本窗口：它同时处理文件
   类型路由、图片/PDF/目录、附件、观测记录、read 卡片，而 `write` 也在同一个包里。
   omp 的 read 更夸张：`packages/coding-agent/src/tools/read.ts` 单文件 109.5KB，另有
   `read-format`/`read-archive`/`read-sqlite`/`read-pdf`/`read-selector` 等约 75KB
   协作模块。要在 DSH 上"完整复刻 read"是另一个项目，不是给 edit 配个附件。
2. **同名工具的注册面很窄。** host 平面再注册 `read` 会撞 prompt section（和 `edit` 一样）；
   agent 平面可以遮蔽，但这意味着每个 preset 都要挂 read 并省略 `tool-fs`。`edit` 是
   干净缝，`read` 牵连 skill 的 `read_skill`、附件、read card、观测策略，风险收益
   完全不划算。
3. **tag 必须在 read 的渲染路径里生成。** 要精确记录"模型看过哪些行"，必须拿到
   `window.lines`、`wideLineNumbers`、字节/列截断这些内部量（fork 的
   `read.ts:278-304` 正是用它们算 seen set）。在外面包一层再重算，迟早会和实际显示的
   行不一致——那比没有 tag 更危险。
4. **fork-first 的部署策略。** 作者的主力环境是 fork：`tool-fs` 有 `enableEdit` 开关、
   read 有 `readSnapshotTags` 开关。在 fork 里改 read 只需要 ~15 行，还能跟着 harness
   升级走；把这段代码复制进插件，等于在插件里养一个 `tool-fs` 分支。

**代价也很清楚**：npm 插件面向 stock DSH，却把"read 会产出 tag"当成既定事实写进
prompt 和 README（`constants.ts:69`、README:26）。结果就是 stock 用户拿到一个默认
模式不可用的编辑器，而作者真正的完整体验只在 fork 里。这是**打包/文档问题**，不是
引擎问题——引擎的接口（`getSessionSnapshotStore`、`formatHashlineHeader`、
`computeFileHash`）本来就是为"任意 read 生产者来 mint tag"设计的。

---

### 3.2 hyperion2144/dsh-hashline-edittool（自成一套的完整实现）

**事实**

| 项 | 值 |
|---|---|
| 版本 / 最近提交 | `0.10.3` / 2026-10-22（今天） |
| 构建 SDK | devDeps `0.2.0-rc.2`；peer 仅 `@deepseek-ai/schemastery >=3.18.3` |
| 代码量 | src 127 文件 / 39.1k 行；测试目录 162 个文件 |
| 运行时依赖 | `@vscode/ripgrep`、`diff`、`file-type`、`minimatch`、`web-tree-sitter` + 三个 grammar、`node:sqlite` |
| 安装 | 一条 `dsh plugin add`，自动遮蔽 read/edit/write/grep |
| 许可 | MIT |

**优点**

- **闭环完整**：read 输出 `ANCHOR:FILELINE`，edit 按 anchor 校验，失败时
  reject-and-serve（把当前行带新 anchor 回显），一次重试即可恢复。
- 工程完成度高：批量原子性、多文件分组、32 条上限、undo、AST grep/edit、LSP、
  Web 卡片、设置面板、热切换。
- 活跃：今天还在修 LSP backoff；0.10.3 的兼容表写到 0.2.0-rc.2。
- 对"外部改动"的处理比 omp 细：文件 checksum 变化触发 remap，而不是整篇失效。

**缺点 / 风险**

- **不是 omp 语义**：逐行 Base62 anchor、`anchor_start/anchor_end` 的 `replace/ins/del`
  契约、unified diff 输出，都和 omp 的 `[path#TAG] + PUT/CUT` 不同。你按 omp 经验写的
  prompt / 习惯要重新适应。
- **面积大**：39k 行、8 个工具、host + client 两个平面、SQLite 状态。出问题时排查面
  比一个 edit 工具大得多。
- **重依赖**：tree-sitter 语法包按 SHA-256 下载、ripgrep 二进制、`node:sqlite`；
  Windows 上多一层失败面（你当前就在 Windows）。
- **它替换 read/write/grep**：DSH 未来若改 read 的契约，它比"只换 edit"的插件更容易断。
- **单作者、迭代快**：0.10.x 仍在加功能，契约偶有 breaking（CHANGELOG 里 0.10 前后
  有 diff 形态、settings 语义的变更）。

### 3.3 Rianico/dsh-better-edit（版本已落后）

**事实**

| 项 | 值 |
|---|---|
| 版本 / 最近提交 | `1.0.0` / 2026-09-28 |
| 构建 SDK | devDeps 全部钉在 `@deepseek-ai/dsh-* 0.1.6-alpha.2` |
| 代码量 | src 67 文件 / 14.7k 行；测试目录 157 个文件 |
| 运行时依赖 | `diff`、`file-type`、`iconv-lite`、`xxhash-wasm`、`zod` |
| 安装 | 一条 `dsh plugin add`，遮蔽 read/edit |

**优点**

- 设计干净：3 字符 xxh32 anchor、空白不敏感（Prettier 不会让 anchor 失效）、
  位置无关（外部 shift 自动 rebase）、fail-closed reject-and-serve、持久化 undo。
- 体积比 hyperion 小得多，理解成本低。
- 它的上游 `pi-better-edit` 有 23/23 的正确性 battery，算法本身是经过验证的。

**缺点 / 风险**

- **兼容性**：SDK 钉在 0.1.6-alpha.2，DSH 已到 0.2.1-rc.2。跨 minor 的 API/服务变更
  （如 `dsh-invariants` 移除、sandbox 接口调整）很可能直接让它起不来；README 自己
  也把"Re-check wiring vs next dsh"列在 Roadmap。
- **文档停滞**：正文还写 "Current `0.7.0`"，实际 1.0.0；兼容性表述与代码不同步，
  说明维护者当前不在这个项目上。
- **同样不是 omp 语义**：3 字符逐行 anchor，无行号。

### 3.4 一张表

| 维度 | hy-sde/dsh-tool-edit | hyperion/dsh-hashline-edittool | Rianico/dsh-better-edit |
|---|---|---|---|
| 与 omp 语义 | **高**（逐 commit 对齐） | 低（另一套 anchor 契约） | 低（pi-better-edit 血统） |
| read→edit 闭环 | **缺**（需补 read） | 完整 | 完整 |
| 当前 DSH 0.2.1 兼容 | 最贴近（peer 0.2.1-alpha.4） | 接近（SDK 0.2.0-rc.2，今日更新） | 落后（SDK 0.1.6-alpha.2） |
| 维护活跃度 | 高（10-15 仍在 bump） | 高（10-22 仍在提交） | 低（09-28 后无提交） |
| 代码/依赖体量 | 18.7k 行 / 零重依赖 | 39.1k 行 / tree-sitter+sqlite+ripgrep | 14.7k 行 / xxhash-wasm |
| 安装成本 | 高（preset + 禁 str_replace） | 低（一条命令） | 低（一条命令） |
| 可复用性 | **引擎独立、MIT、可复用** | 单体，难拆 | 单体，难拆 |
| 主要风险 | read 缺口、单作者、fork 漂移 | 面积大、重依赖、契约不同 | 版本断层 |

---

## 4. 自研到底要写多少？

三种"自研"含义完全不同，成本差一个数量级：

| 方案 | 内容 | 估算 |
|---|---|---|
| A. 从零复刻 omp 算法 | 解析器、patcher、block resolver、register、recovery、snapshot store、diff、prompt、测试 | **1–2 人月**，且永久追 omp |
| B. 复用 `@hy-sde-org/dsh-hashline` + 自写适配 | read（tag+行号+snapshot 记录）、edit（校验、调用引擎、错误呈现）、prompt、少量 UI meta | **1.5–3k 行 / 1–2 周** |
| C. fork `dsh-tool-edit` 补 read | 加一个 read 工具 + 在 preset 里挂载，改 prompt | **200–500 行 / 1–3 天**（但要跟上游 rebase） |

对个人/小团队，**B 是性价比最高的"自研"**：算法和测试用别人的，产品形态（read 长什么样、
tag 怎么显示、哪些行算 seen、要不要 LSP）自己定。C 适合"只差一块拼图、且愿意跟上游"。

从零做 A 的唯一合理理由：你要把 hashline 做成 DSH 的核心能力并长期维护、且不接受
任何第三方引擎的语义。以你现在的使用场景（个人编程工作流），这个理由不成立。

---

## 5. 推荐路线

### 阶段 0：先验证"值不值"（1–2 天）

用 hyperion 做一次真实 A/B，不要凭 README 的 token 数字决策：

1. 建一个临时 profile，安装 `dsh-hashline-edittool`；
2. 选 10–15 个你最近真实做过的编辑任务（跨文件重构、改函数签名、移动代码块、
   修 bug），分别在 stock `edit` 和 hashline 下跑；
3. 记录：**首次通过率、调用次数、总 token、失败重试次数、wall time、误改次数**；
4. 特别观察：长文件（>1000 行）、重复行多的文件、外部格式化器介入的场景。

验收线建议：首次通过率 ≥ stock，调用次数 ≤ stock 的 80%，且没有一次静默错改。
达不到就不值得为它承担插件维护成本。

### 阶段 1：按结果选形态（1 周内）

- **验证有效 + 你认可 omp 的 `[path#TAG]` 语义** → 走 B：
  - 依赖 `@hy-sde-org/dsh-hashline`（或 vendor 进 `plugins/`，避免 npm 供应链）；
  - `read`：包一层 `ctx.fs`，输出 `[path#TAG]` + `N: text`，并把 snapshot 记进
    per-session store（引擎已提供 `getSessionSnapshotStore`、`formatHashlineHeader`、
    `computeFileHash`）；
  - `edit`：单工具、`input` 参数、调用 `Patcher`，错误照 omp 的文案回显；
  - 在 agent scope 注册，遮蔽 host 的 `read/edit`；不碰 host 平面。
- **验证有效 + 你只想要收益、不想维护** → 继续用 hyperion，锁定版本，关注 CHANGELOG；
  每次 DSH 升级先在临时 profile 冒烟。
- **验证无效** → 回到 stock `edit`，把精力放在 read 窗口/提示词/验证回路，而不是换工具。

### 阶段 2：如果走 B，最小模块清单

1. `read` 遮蔽：tag 计算、snapshot 记录、行号窗口、截断提示；
2. `edit` 遮蔽：参数 schema（`input`）、模式分派（hashline/replace）、错误映射、
   no-op loop guard；
3. prompt：把 omp 的 `hashline.md` 精简成 DSH systemPrompt section（注意别和 stock
   `tool:edit` section 重名）；
4. presentationMeta：至少给 Web 一个 diff 卡片；
5. 测试：直接复用引擎的 270 个用例 + 你自己的 read/execute 集成测试（10–20 个）。

---

## 6. 十分钟实测：确认 hy-sde 的 read 缺口

在临时 profile 里做，不动你日常 profile：

```powershell
# 1) 建临时 profile 并安装（按作者 README 的 preset 步骤）
dsh plugin --profile hashline-test add github:hy-sde/dsh-tool-edit
# 2) 复制 examples/agent-preset 到 ~/.dsh/.agent-presets/hashline-test
# 3) 启动后让 agent 做一次最简单的编辑：
#    "把 src/main.ts 第 10 行的 foo 改成 bar，用 edit 工具"
```

观察点：

- 模型是否能拿到 `[path#TAG]`？如果它写 `[src/main.ts]`（无 tag），报错是不是
  `Missing hashline snapshot tag`？
- 如果连续两次都拿不到 tag，就确认缺口成立：**要么补 read，要么换 hyperion**。

（如果作者已有配套 read 包或 fork 改造，这一步会直接通过；以实测为准。）

---

## 7. 风险清单

1. **单作者风险**：三个项目都是单人主导。hy-sde 和 hyperion 目前很勤，但都没有
   组织级 bus factor。缓解：锁版本、vendor 到 `plugins/`、保留回退到 stock 的路径。
2. **DSH 升级漂移**：0.2.x 仍在 rc，服务名/接口会变。任何插件升级 DSH 前先在临时
   profile 冒烟，再切日常 profile。
3. **插件权限**：三者都能读写整个工作区，且会接管 read/edit。安装前看一遍
   `cordis.patch.yml` 与 `package.json` 的依赖；不要把来路不明的 fork 装进主 profile。
4. **token 反向优化**：逐行 anchor 会增加 read 的固定开销。长会话、长文件场景要用
   真实 token 计量验证，别只看 edit 侧的节省。
5. **语义混淆**：omp 的 tag 是"整文件指纹"，一行改动会让整篇 tag 失效；逐行 anchor
   是"行身份"，两者对"外部改动"的反应完全不同。混用 prompt 会导致模型写出错误的
   补丁形状。

---

## 附录：证据索引

| 结论 | 证据 |
|---|---|
| omp 用文件级 4-hex tag + 行号 | `clones/oh-my-pi/crates/pi-edit/prompts/hashline.md`；`crates/pi-edit/grammars/hashline.lark` |
| omp tag = xxh32(normalized) & 0xffff | `clones/oh-my-pi/crates/pi-edit/src/store.rs:71-92` |
| hy-sde 是 omp 移植、4-hex、零依赖引擎 | `clones/dsh-tool-edit/packages/hashline/src/format.ts:97-131`；`packages/hashline/README.md` |
| hy-sde 追 omp commit | `git -C clones/dsh-tool-edit log`（2026-09-27 `enforce the seen-line guard by default (omp 760d5dfdee)` 等） |
| hy-sde 只注册 edit | `clones/dsh-tool-edit/packages/tool-edit/src/index.ts:334-344`（全包唯一注册点） |
| 缺 tag 会直接抛错 | `clones/dsh-tool-edit/packages/hashline/src/patcher.ts:178-181` |
| 官方 read 不输出 tag | `packages/fs/tool-fs/src/read-render.ts:152-169`；`read.ts:77-120` |
| DSH 内置 edit 无 enableEdit | `packages/fs/tool-fs/src/edit.ts:76-168` |
| 同名 edit 只能靠 agent scope 遮蔽 | `clones/dsh-tool-edit/README.md:145-179` |
| hyperion 用逐行 Base62、替换 read/edit/write/grep | `clones/dsh-hashline-edittool/README.md:42-64,133-171`；`cordis.patch.yml` |
| hyperion 版本/活跃度 | `package.json` 0.10.3；`git log -1` 2026-10-22 |
| better-edit 钉在 0.1.6-alpha.2 | `clones/dsh-better-edit/package.json` devDependencies |
| better-edit 文档/版本停滞 | `clones/dsh-better-edit/README.md:307-315`（"Current 0.7.0" / pinned 0.1.0-rc.6） |
| oh-my-openagent 是逐行 `LINE#HASH|` | `clones/oh-my-openagent/packages/hashline-core/AGENTS.md` |
| DSH 当前版本 | `deepseek-harness/package.json` → 0.2.1-rc.2 |

**外部链接**

- omp：https://github.com/can1357/oh-my-pi
- oh-my-openagent：https://github.com/code-yeongyu/oh-my-openagent
- hy-sde：https://github.com/hy-sde/dsh-tool-edit
- hyperion：https://github.com/hyperion2144/dsh-hashline-edittool
- better-edit：https://github.com/Rianico/dsh-better-edit
