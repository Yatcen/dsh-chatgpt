# DeepSeek Harness Desktop 插件契约

首个验证目标为官方 Windows Desktop，源码基线为 `dsh-v0.2.2-rc.3`（`38a6a5c`）。上游使用 MIT 许可证，主要插件代码使用 TypeScript，Desktop 通过 Electron 启动本地 Node Host 并加载共享 Web 客户端。上游构建要求 Node.js ≥ 24.9。本机已确认 Node.js 24.15.0，尚未确认安装了目标 Desktop 发行包。 [官方发行](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.3) · [Desktop 源码说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/apps/desktop/README.md) · [许可证](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/LICENSE) · [构建配置](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/package.json)

## 插件加载与设置

- 发布包使用 `package.json` 中的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，声明明确的 `engines.dsh` 兼容版本。Desktop 的插件管理器负责启用 Bundle，Host 通过 Cordis 加载入口。离线测试使用项目内夹具。
- Desktop 发行版管理 `$DSH_HOME/profiles/desktop`，默认 Harness home 为 `~/.dsh`。启用的 Bundle 记入 profile 的 `dsh.profile.bundles`。插件可编辑字段通过 `.volatile()` 暴露，配置写入该 profile 的 Cordis patch。Profile、Harness home 和命令行 patch 按顺序覆盖。
- DSH 管理的默认凭据文件为 `$DSH_HOME/.credentials.yaml`。项目 OAuth 需要单独持有自己的注册和令牌，按 OpenAI 文档使用平台受保护存储。界面只接收账号显示信息、授权及有效期状态和模型列表。

[Bundle 发布契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/user/develop/basic/publish.md) · [Settings 实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/settings/settings/README.md) · [DSH 本地凭据](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/credentials/credentials-local/README.md) · [OpenAI 账户与会话](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

## 主模型

- Host 在 Cordis 注入 `llm` 后，用 `ctx.llm.registerAdapter([provider], adapter)` 注册一个 `LlmAdapter`。选择独立路由 `dsh-chatgpt`。通过 `providerInfo()`、`listModels()`、`resolveModel()` 提供模型与能力信息。设置页需要目录项和对应的设置命名空间，登录后的目录变化需通知客户端重新读取。
- 用已授权账户请求 `GET https://api.openai.com/v1/models`，展示 `visibility: "list"` 的条目，将模型 `slug` 传给 Responses。账户资格、套餐授权和模型可用性仍取决于用户注册、workspace 及实际请求结果。
- `stream(GenerateOptions)` 接收 DSH 构建的有序消息、工具定义、模型及 `AbortSignal`。生产适配器使用 `store: false`、`stream: true` 和完整必要上下文，把系统提示转换成 `instructions` 或 developer 消息。HTTP 流只有在 `response.completed` 时才构成正常完成。
- 输出按 DSH 的块序号发出 `block-start`、增量和 `block-end`，可用时在唯一 `finish` 前发出 `usage`。DSH 本地工具调用保留原始 JSON 参数和相关 ID，工具结果随历史回传。工具执行、权限和确认继续由 DSH 管理。取消须传入底层 HTTP 流，流中断和失败映射到对应的终态。

[DSH LLM 入口](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/llm/llm/src/index.ts) · [流式类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/llm/llm/src/types.ts) · [OpenAI 模型和推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) · [OpenAI 预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

## 独立子 Agent

- Host 用 `ctx.subagents.registerProvider(provider)` 注册外部后端，再通过 `@deepseek-ai/dsh-tool-subagent` 暴露具名委派工具。首版使用 `subagent_dsh_chatgpt`，任务在独立 Codex thread 中执行，输入为委派任务和选定工作目录。
- 外部后端的 `start(request)` 接收解析后的绝对 `cwd`、提示内容和取消信号。启动成功后返回独立运行 ID、`result` 和幂等 `dispose()`。DSH 负责子 Agent 的准入、最终结果送达、取消归属和生命周期管理。外部后端通过父会话呈现最终结果，内部 Codex 事件由插件消费。
- 子进程启动前，从与主模型共享的 OAuth 服务取得该账户有计划授权的 access token，仅传入这个子进程的 `ACCESS_TOKEN`。使用 OpenAI 文档指定的 Responses provider、stdio 和 HTTP/SSE。依次调用 `initialize`、`initialized`、`thread/start`、`turn/start`。检查 `turn/completed` 的真实状态，取消时结束当前运行并等待资源释放。
- DSH 自带的 Codex 子 Agent 由其自身原生 Codex 认证和权限配置驱动。它的配置字段没有动态 SIWC 授权或 provider override，因此适合作为进程管理参考。项目需在自己的后端中接入同一套 OAuth 服务；首个真实任务采用只读沙箱。若扩展为续聊，token 更新后按官方流程重启 app-server 并以 thread ID 恢复。

[DSH 子 Agent 契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/subagent/subagent/src/types.ts) · [官方 Codex 子 Agent Bundle](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/subagent/subagent-codex/README.md) · [OpenAI Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

## 离线验证

从项目根目录运行 `node --test test/dsh-contract.test.mjs`。夹具放在 `test/fixtures/dsh-contract.mjs`，测试覆盖模型发现与单个文本流终态、主模型取消、不同子任务独立返回结果，以及取消一个子任务时另一个仍能完成。测试使用本地服务替身。Desktop Bundle 加载、官方 OAuth、请求计费及真实 Codex 行为需另行端到端验证。
