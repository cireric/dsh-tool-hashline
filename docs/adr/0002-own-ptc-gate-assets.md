# 独立整合 ptc-gate

2026-10-22 用户确认：本仓库整合 ptc-gate 所需资源，不依赖 ptc-roles 原项目继续存在或安装在 profile 中。选择自行承接 gate 资源的维护成本，以获得独立部署能力；不整合五角色子代理。

迁入资源的基线为规格已锁定的 commit `3d8f36eb8def861c3f2aa7d5f7b4983d96c92341`。第二轮用户确认：只交付 ptc-hashline 一个 preset；首版保持 persona/watchdog 正文和行为，只修改资源地址，之后由本仓库独立演进。来源、摘要及契约测试保存在本仓库，验证不依赖原项目继续存在。
