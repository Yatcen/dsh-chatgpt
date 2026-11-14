# OpenAI 官方集成基线

核实日期：2026-11-14

本文件只记录创建项目时已由 OpenAI 官方资料确认的边界。产品、资格、模型和预览能力可能变化；开始实现前需要重新核实相关页面。

## 结论

项目存在一条官方可行路径，但不能简单理解为“把 ChatGPT 订阅当作普通 API key 使用”。

- Sign in with ChatGPT 允许符合条件的本地/开源应用请求独立的计划使用权限。
- 用户通过 OAuth PKCE 登录、选择账户/workspace 并明确授权；应用获得的是受 scopes 限制的 access token，而不是 API key 或 ChatGPT 对话访问权。
- 主模型可以通过官方本地开发套件或 Responses API 请求完成。
- 独立 Agent 可以由 Codex app-server 驱动，并使用同一类计划授权 access token。
- 远程托管、付费或商业分发可能需要申请或审批，不能仅凭本地开发流程直接上线。

## 官方事实与项目约束

### 1. 计划使用与身份权限分离

身份 scopes 不允许调用模型。插件必须检查用户是否实际授予 `chatgpt.tokens.use.direct`；如果只有身份登录，应保留连接状态但禁用计划调用。

项目约束：不得用“登录成功”代替“计划使用已授权”的判断。

### 2. 用户计划不等于 API key

计划授权允许符合条件的 Responses 请求，但不会返回用户 API key，也不会访问 ChatGPT 对话。普通 API 使用和 ChatGPT 订阅仍是不同计费系统；符合条件的订阅 API credits benefit 也属于单独领取、单独归属 API organization 的权益。

项目约束：界面和日志必须明确显示当前请求使用 ChatGPT plan、credits 还是用户主动配置的 API key。

### 3. 模型运行时发现

官方流程要求用当前 profile 的 access token获取模型目录，并使用返回的 model slug。Codex app-server 的 `model/list` 可能来自缓存目录，成功完成一次 inference 才是该模型本次可用的最终证据。

项目约束：不写死模型列表，不把模型名称与某个套餐永久绑定。

### 4. Codex app-server 可承载独立 Agent

官方文档提供了用计划授权 access token 启动 Codex app-server 的 Responses provider 配置。DSH 可以通过 stdio 驱动 `initialize`、`thread/start`、`turn/start`，消费流式事件并检查最终 turn 状态。

项目约束：插件负责 app-server 生命周期、token 更新后的重启、thread 恢复、审批和取消；不读取 Codex 其他客户端的登录状态。

### 5. 工具与输入存在预览限制

官方预览说明允许 Codex app-server 使用本地 shell、MCP 工具和子 Agent，但部分托管工具与 Responses 能力不受支持。图像生成、文件搜索、Code Interpreter、原生 computer use、托管 MCP/connectors 和 `tool_search` 等不能默认依赖；输入类型也受模型和流程限制。

项目约束：第一版 Agent 只验证一个只读本地任务，不把受限工具纳入 MVP 承诺。

### 6. 用量、撤销与恢复

用户在 ChatGPT 设置中管理用量和应用访问。插件需要处理用户未授权、额度耗尽、token 过期、撤销访问和账户切换；OpenAI 当前不一定主动通知应用连接已被撤销。

项目约束：在请求失败处返回可操作状态，不构造无限重试或自动切换到隐性付费路径。

## 推荐的最小技术路线

1. 先确认 DSH 插件契约和许可证。
2. 采用 OpenAI 官方 Sign in with ChatGPT 开源本地集成与受保护 profile 存储。
3. 主模型模式直接使用官方模型发现与流式 Responses 接口。
4. Agent 模式启动 Codex app-server 子进程，并只实现必要 RPC 生命周期。
5. 使用 fake profile 和 fake transport 完成契约测试后，再进行一次真实账户 dry-run。
6. 不建立第三种认证方式，除非用户明确要求 API key fallback。

## 官方来源

- [Sign in with ChatGPT Quickstart](https://developers.openai.com/siwc/quickstart)
- [Integrating Sign in with ChatGPT in an open-source app](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Codex app-server with ChatGPT plan](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
- [Managing billing for ChatGPT and the API platform](https://help.openai.com/en/articles/9039756-managing-your-work-in-the-api-platform-with-projects)
- [API credits benefit for eligible ChatGPT subscriptions](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions)
