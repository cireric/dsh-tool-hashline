# 06: 独立 bundle 在干净 profile 中可安装

**What to build:** 从本仓库构建并在干净临时 profile 安装唯一 ptc-hashline preset，能加载本仓库的 read、上游 edit 和内置 gate 资源，执行基础 PTC read→edit。原 ptc-roles 项目被弃置也不影响安装和基线核验。

**Blocked by:** 01 — 普通文本 read→edit 首次成功。

**Status:** ready-for-agent

**Spec:** [权威规格入口](../spec.md)；§4/4.1/4.2、FR-1/2/8/10/11、M2、ADR-0002。

- [ ] 根 bundle 声明 ptc-hashline，picker 只增加此一个本项目 preset；不另交付独立 ptc-gate 或五角色子代理系统。
- [ ] 三个 workspace 包构建为目标宿主可加载的 JavaScript 入口及类型声明，根 build 真正产出文件；不以 Vitest 可加载 TS 代替宿主加载证明。
- [ ] 迁入 commit 3d8f36eb8def861c3f2aa7d5f7b4983d96c92341 的 gate persona/watchdog，首版正文与行为逐字保留，保留来源、SHA 和原有归属声明，只把资源地址改为本 bundle。
- [ ] profile 能解析 bundle 的 package.json、persona/watchdog 子路径及 read/edit 包；显式建立依赖，登记 dsh.profile.bundles，安装后真正重新挂载。
- [ ] preset 关闭 stock read/edit 并接入自建 read、上游 edit，其他行为配置沿用基线；tool-presentation=ptc、gate=enforce、tool-subagent.maxDepth=1。
- [ ] 三个窗口上限在 stock config 与自建 read config 同值；两边数值不一致、资源正文摘要漂移、非白名单配置变化时核验失败。
- [ ] 本仓库保存独立基线 patch、资源摘要与来源；允许 preset id/展示元数据、三处功能差异和资源定位差异，其余变化失败，不依赖原项目最新状态或联网追踪。
- [ ] 提供 check:preset、可执行安装流程及基础 test:profile；构建/核验失败以非零退出和原因报告；本 profile 内 read/edit 的引擎仍为同物理实例。
- [ ] 干净临时 profile 不安装 ptc-roles，原项目/clone 不可访问时仍能发现并挂载唯一 preset；实际执行一次基础 run_code 内 read→edit 并断言落盘。
- [ ] 挂载时保留工具名 read/edit；重复 read provider 的挂载失败可检出。本票只做基本成功路径，全部降级与门正负场景由 07 扩充。

## Scope boundary

只操作验收用临时 profile，不发布到 npm，不切换日常 profile。窗口/降级全量场景不作为本票前置条件，故不阻塞于 02/03。
