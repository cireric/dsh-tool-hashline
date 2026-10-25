# 块定位能力说明与诊断修复计划

2026-10-25。依据[调查](../background/2026-10-25-hashline-block-locator-assessment.md)，用户已授权直接修复票据 02、03。

实施状态：源码与隔离交付验收完成；13 项定向、33 项完整宿主及九项交付门禁通过，详见[验收报告](../acceptance/2026-10-25-hashline-block-locator-fix.md)。日常 profile 未切换。

范围：通过 tool-edit 精确补丁，使模型可见说明明确块替换/剪切不支持、推荐显式范围；利用引擎已有的无 resolver 诊断，保持拒绝与块后插入/粘贴降级语义。不增加解析器、依赖、语言支持或目标 profile 切换。

实施：adapter 将缺失能力明确表示为 undefined（同步声明同步更新），由引擎既有分支处理；constants 不再把 PUT N*: / CUT N* 列为可用的基本形式。引擎源码与算法不变。

验证沿用既有 ToolRuntime read/edit 公共边界：模型可见 schema 描述、实际错误结果、独立最终字节和 provider 写入记录。覆盖 js/ts/py/md 的块替换/剪切、显式替换/剪切、块后插入与多 section 准备失败。新增测试先在旧安装红测，再由新补丁的冻结安装绿测。完整 preset 再补真实进程 PTC 正反向探针。

所有安装/构建在独立副本执行；pnpm 11.28.5 生成 lockfile，再冻结安装核验真实解析路径和文件摘要。运行 check、完整交付门禁及打包完整宿主回归。Windows 实跑与 macOS/Linux 未执行状态分别记录。历史报告不覆盖，保留用户已有 E3 改动；不热改原 node_modules/dist、不重启或发布。
