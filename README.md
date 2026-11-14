# dsh-chatgpt 插件

`dsh-chatgpt` 通过 OpenAI 官方 **Sign in with ChatGPT** 为 DSH 提供 ChatGPT 模型。符合条件的用户授权后，插件可用其 ChatGPT 订阅额度完成合格请求。Credits 的使用由用户在 ChatGPT 用量设置中管理。

## 当前阶段

已提供可安装的 `dsh-chatgpt 0.1.1`，支持官方 Windows Desktop `0.2.2-rc.3`。v0.1.0 已在隔离 Desktop 中用真实账户验证 GPT 主对话流和独立 Codex 子 Agent 回传。测试期间 Credits 回退始终关闭，两条路径的真实验收请求均使用 ChatGPT 订阅内额度，均未使用 Credits。具体扣减量无法逐笔核对。见 [实测记录](docs/DESKTOP_VALIDATION.md#2026-11-14-实测)。

## 安装和使用

1. 从项目根目录运行 `npm pack` 生成 `dsh-chatgpt-0.1.1.tgz`，或使用已打好的包。
2. 打开官方 Desktop 一次以创建 profile。启用 **Manage dsh Command** 后完全退出 Desktop，在新开的 PowerShell 中执行：

   ```powershell
   dsh plugin --profile desktop add ./dsh-chatgpt-0.1.1.tgz
   ```

3. 重启 Desktop，从 **Settings → Models → ChatGPT** 点击 **Continue with ChatGPT**，再打开授权链接。自行选择 ChatGPT 账号与 workspace，授权计划用量，随后返回 Desktop。对话输入框的模型选择器会展示该账户当前公开的模型。
4. 使用独立子 Agent 时，通过 ChatGPT 行的 **Edit** 填写官方 Codex `codex.exe` 的绝对路径。若用 Windows npm 安装 Codex，请使用对应平台包 `vendor/.../bin/codex.exe` 中的二进制。可填写列表中的模型 slug，也可留空采用列表首个模型。对话中要求当前 Agent 使用 `subagent_dsh_chatgpt` 委派一个只读文本任务。
5. 在 ChatGPT 卡片中切换账户、注销或打开计划用量页。卸载时退出 Desktop，执行 `dsh plugin --profile desktop remove dsh-chatgpt`。

两条路径由同一个 OAuth 服务取得 access token。令牌在 Windows 上通过当前用户 DPAPI 存放于 `$DSH_HOME/dsh-chatgpt`。子 Agent 每次新建一个只读 Codex thread，使用独立的临时 `CODEX_HOME`，完成后向父会话交付结果。此版本以文本对话和单次委派为验收范围。

如果本地 HTTP 代理能访问 OpenAI，打开 **Settings → Models → ChatGPT → Edit**，在 `proxyUrl` 填写本机 HTTP 代理地址，例如 Clash Verge 的 `http://127.0.0.1:7897`。插件使用该入口获取模型、调用 Responses、刷新授权和启动 Codex。Clash Verge 中更换出站线路时可以沿用这个地址。留空则使用 Harness 的网络设置。当前线路需能访问 `api.openai.com` 和 `auth.openai.com`。

### Windows 下的 MemSearch

如果同一个 Desktop profile 已安装 MemSearch 0.1.8 或 0.1.9，新版启动后会自动修复索引进程闪出命令窗口的问题，保留自动捕获、索引和维护任务。补丁只匹配这两个版本的原始运行文件。若已知版本被重装覆盖，插件会重新检查。使用自定义源码链接或其他版本时，插件跳过兼容修复。首次升级按上面的安装步骤完全退出 Desktop，再安装新版并打开。若 DSH 日志提示需要重启，请再重启一次以加载补丁。

Canonical root：

```text
D:\AI\WorkSpace\20-dsh-chatgpt插件
```

## 目标能力

插件提供两种模式：

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
- [DeepSeek Harness Desktop 插件契约](docs/DSH_PLUGIN_CONTRACT.md)
- [当前交接](HANDOFF.md)

## 当前验证

从项目根目录用 Node.js 24.9 或以上版本运行：

```powershell
npm ci --omit=peer
npm test
npm pack
```

本地测试覆盖 OAuth 回调、授权范围、刷新并发、Windows 凭据存取、主对话流和取消。Desktop 端到端夹具及真实账号验收步骤见 [验证说明](docs/DESKTOP_VALIDATION.md)。
