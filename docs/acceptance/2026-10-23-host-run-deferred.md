# 真实宿主 + 模型的一轮 PTC：现状与下一步（2026-10-23）

这份文件记录“真实宿主 + 真实模型跑一轮 run_code”这一项为什么**当前不能用 CLI 脚本化**，
以及两条可行的落地路径。它不把该项计为通过。

## 已确认的事实（源码证据，DSH 0.2.1-rc.2）

1. **headless 组合不带 preset 名单，也拒绝带 preset 的会话**：
   `packages/bundle/headless/src/index.ts:213-219` —— 会话若记录 `agentPreset`，一次性 runner
   直接抛错“the one-shot runner does not compose”；同文件 :336 的注释也写明该 bundle “composes no
   preset roster”。
2. **preset 的挂载发生在 Web/API 层**：`packages/bundle/web-app/cordis.patch.yml:586` 注册
   `agent-preset-registry`；`packages/api/session-controller/src/agent.ts:388/469/490` 的
   `composeAgent()` 才把 preset 的插件行挂进 agent scope。
3. **模型路由可由启动环境改指向**：`packages/llm/llm-deepseek/src/config.ts:118` 定义
   `BASE_URL_ENV = 'DEEPSEEK_BASE_URL'`，:300 用它作为 baseURL 回退；API key 走
   `DEEPSEEK_API_KEY`（`llm-deepseek-api-key`）。因此本地 mock Messages 服务是可行的。
4. 现在能自动化的“真实宿主”证据只到：`pnpm test:profile` 用真实 `dsh --profile … --dump-config`
   组合出唯一 `ptc-hashline` preset，并在子进程用构建产物完成 read→edit；**没有**经过 Web 的
   preset 挂载，也没有模型参与。

## 路径 A（推荐，可脚本化）：Web profile + mock Messages + 会话语义断言

1. 临时 profile 的 `dsh.profile.bundles` 增加 `@deepseek-ai/dsh-web-app`（该 bundle 才带 preset
   名单与 agent loop 的 host 面），保留本 bundle。
2. 启动 `dsh --profile ptc-hashline`，环境变量：
   `DEEPSEEK_BASE_URL=http://127.0.0.1:<port>`、`DEEPSEEK_API_KEY=test`。
3. 本地 Messages/SSE mock（可直接用已发布的 `@deepseek-ai/dsh-llm-mock-server`）按剧本返回：
   第一轮 assistant 消息含一个 `run_code` 工具调用，程序内容为
   `const r = await tools.read({file_path}); await tools.edit({input:'['+r.path+'#'+r.tag+']\nPUT …'})`；
   第二轮返回收尾文本。
4. 通过 Web/API 客户端（web client 或 typert 客户端）以 `agentPreset:'ptc-hashline'` 创建会话并发送
   任务；轮询到 idle。
5. 断言：`tool/call` 只有 `run_code`；`tool/ptc-dispatch` 出现 read/edit；磁盘文本改变；
   首行有 `Intent:` 时不拒、去掉后只拒一次且理由含 `Intent`；mock 服务收到的请求数符合剧本。

产物：`scripts/test-host.mjs` + `scripts/fixtures/mock-llm.mjs`，作为 `pnpm test:host`
（无 DSH web 组合或 mock 启动失败时明确报 GAP，不静默跳过）。

## 路径 B（立即可做，人工冒烟）：Web GUI 手动一轮

用上面的 profile 启动 Web（真实 key 或 mock），在界面选择 `ptc-hashline`，执行：
“读取 memo.txt，把第 2 行改成 TWO”。观察并留存：模型只调 `run_code`、程序内 read/edit 的
`ptc-dispatch`、磁盘结果、缺 `Intent:` 时的单次拒绝。判定以会话日志 + 磁盘为准，不看模型自述。
人工冒烟只能作为补充，不能替代路径 A 的脚本判定。

## 为什么现在停下

headless 路线被事实 1 直接排除；Web 路线的剩余未知集中在 typert/web 客户端的会话语义（创建、
发消息、等待 idle）与 mock SSE 帧格式。这需要一轮专门的实现与调试，不适合在本次收尾里仓促拼装。

## 路径 A 的实现锚点（2026-10-23 追加）

已确认 registry 暴露了不经过 Web UI 的挂载入口：

```ts
// packages/preset/agent-preset-registry/src/index.ts:373
async acquireScope(id?: string): Promise<{ key: ScopeKey } & AsyncDisposable>
```

因此 A 的驱动不必是 Web 客户端：可以在临时 profile 的用户层（`cordis.patch.yml`）挂一个
**host 测试插件**，由它：

1. `const scope = await ctx.get('agentPresets').acquireScope('ptc-hashline')`；
2. 用该 `scope.key` 创建 agent（与 session-controller 的 composeAgent 同一把 key），把工作目录指向
   临时目录；
3. `agent.followup(...)` 发送任务，监听 `agent/status` 到 idle；
4. 把会话事件与磁盘结果写到 JSON，退出进程。

模型侧仍用 `DEEPSEEK_BASE_URL` 指向本地 Messages mock（`BASE_URL_ENV`，`llm-deepseek/src/config.ts:118,300`）。
剩余未知：agent 创建 API 接受 scope key 的确切字段，以及 mock SSE 帧格式（优先用已发布的
`@deepseek-ai/dsh-llm-mock-server`，避免手写帧）。这两点确定后即可把 A 落成 `pnpm test:host`。
