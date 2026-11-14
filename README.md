# dsh-chatgpt 插件

`dsh-chatgpt` 计划为 DSH 提供一个基于 OpenAI 官方授权通道的 ChatGPT 模型插件。符合条件的用户通过 **Sign in with ChatGPT** 明确授权后，插件使用其 ChatGPT 计划额度或可用 credits 完成合格请求；不要求用户复制浏览器 Cookie、ChatGPT 会话令牌或私有客户端凭据。

## 当前阶段

阶段：已立项，官方通道可行性已初步确认，DSH 接口待核实。

当前只有项目简报、官方集成基线和 Git 基线，没有插件代码、真实登录、模型调用或 DSH 集成。

Canonical root：

```text
D:\AI\WorkSpace\20-dsh-chatgpt插件
```

## 目标能力

插件计划提供两种明确模式：

1. **主模型模式**：DSH 通过插件直接调用官方 Responses 通道，并使用登录账户实际可见的模型目录。
2. **独立 Agent 模式**：DSH 启动官方 Codex app-server 子进程，创建独立 thread/turn，接收流式事件，并把最终结果返回给 DSH。

两种模式都必须使用同一套官方 OAuth 授权和用户选择的账户配置，但运行生命周期、上下文和工具权限相互隔离。

## 官方边界

- 官方支持的目标路线是 Sign in with ChatGPT，而不是从 ChatGPT 网页、Codex CLI 或桌面端提取现有 Cookie/令牌。
- 身份登录与 ChatGPT 计划使用是两项独立权限；只有实际授予 `chatgpt.tokens.use.direct` 后才能发起计划额度请求。
- ChatGPT 计划使用不会暴露用户的 ChatGPT 对话，也不会提供用户的 API key。
- 普通 OpenAI API 计费与 ChatGPT 订阅通常相互独立；符合条件的订阅 API credits benefit 是另一项需要单独领取的权益。
- 模型必须在运行时发现，不能写死为某个 GPT 型号，也不能把模型目录当作最终授权证明；成功完成一次推理才证明该次访问有效。
- 本地工具和子 Agent 可以由 Codex app-server 协调，但托管工具、输入类型和 Responses 能力受官方预览限制约束。

详见 [官方集成基线](docs/OFFICIAL_INTEGRATION_BASELINE.md)。

## 安全边界

- 不读取或导入浏览器 Cookie、ChatGPT/Codex 私有缓存、其他应用的认证文件或系统凭据。
- 不把 access token、refresh token、ID token、授权码或 PKCE verifier 写入 Git、日志、错误报告或 DSH 对话。
- 使用官方开发套件或经过文档验证的 OAuth PKCE 流程；令牌由本机受保护存储持有。
- 每位用户必须自行登录、选择 workspace 并授权计划使用；不得共享账户或代理其他用户额度。
- 计划额度不可用时明确失败或切换到用户主动配置的独立计费方式，不伪装成订阅额度调用。
- 不在用户未确认前启用远程托管、商业分发或自动消费额度。

## 文档

- [项目简报](docs/PROJECT_BRIEF.md)
- [官方集成基线](docs/OFFICIAL_INTEGRATION_BASELINE.md)
- [当前交接](HANDOFF.md)

## 当前验证

本阶段没有产品运行命令。立项基线至少应满足：

```powershell
git status --short --branch
git log --oneline -2
```

预期：分支为 `main`，存在 Git 基线，工作树干净。
