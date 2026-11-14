# Windows Desktop 验证

目标为官方 DeepSeek Harness Desktop `0.2.2-rc.3` x64。开发验收使用校验过 SHA-512 的官方 Windows 安装包解包运行，使用独立 `DSH_HOME` 和 Electron 用户数据目录。包由官方 Desktop 自带 CLI 安装，随后从实际 Desktop 设置页和会话界面执行测试。 [官方发行](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.3)

## 隔离测试

1. 先用 `npm ci --omit=peer`、`npm test` 和 `npm pack` 检查本地代码及安装包。使用一个新的绝对路径作为 `DSH_HOME`。启动并退出解包的 Desktop 一次，创建隔离 `desktop` profile。
2. 通过官方 Desktop CLI 对该 profile 执行 `dsh plugin --profile desktop add <tgz 文件路径>`。应用未注册 CLI 时，也可用解包的 Electron 二进制设置 `ELECTRON_RUN_AS_NODE=1` 后执行 `resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js`，参数保持一致。重新启动图形程序前清除该环境变量。
3. 在隔离 profile 的 `cordis.patch.yml` 插入测试模块，关闭隔离环境的 DeepSeek 会话上传：

   ```yaml
   - insert:
       - id: dsh-chatgpt-desktop-fixture
         name: 'C:/path/to/project/test/fixtures/desktop-fixture.mjs'
   - id: session-log-deepseek
     disabled: true
   ```

4. 用 .NET Framework 4 的 `csc.exe` 编译 `test/fixtures/codex-app-server.cs`，引用 `System.Web.Extensions.dll`。将 `DSH_CHATGPT_CODEX_EXECUTABLE` 指向生成的 exe。同一启动进程设置 `DSH_TELEMETRY_DISABLED=1`、`DEEPSEEK_API_KEY=fixture-desktop-only`，以便无 DeepSeek 账户的隔离 Desktop 可进入工作台。
5. 以独立 Electron `--user-data-dir` 和仅用于隔离测试的 `--remote-debugging-port=18743` 启动 Desktop。在一个独立测试目录安装 `playwright-core`，再执行 `node test/desktop-smoke.mjs <测试目录>`。预期输出 `DESKTOP_ACCOUNT_OK`、`DESKTOP_STREAM_OK`、`DESKTOP_DELEGATION_OK`，测试后退出该 Desktop 实例。

测试通过合成授权回调驱动实际 PKCE、签名校验和本地凭据存储。真实宿主用生产代码加载模型、解析 SSE 并执行 `subagent_dsh_chatgpt`。替身检查 Codex 的模型、同一 access token、只读沙箱和独立 thread，验证父会话最终收到子 Agent 结果。

## 真实账户验收

使用另一个新的隔离 profile 或已安装插件的正常 Desktop profile，填入官方 Codex 二进制路径。通过模型设置页打开 OpenAI 授权链接，由账号持有人登录、选择 workspace，并授权计划使用。

1. 选择一个实际列出的 GPT 模型，发送 `只回复 DSH_LIVE_MAIN_OK`，确认收到文本流并完成。
2. 在新会话中明确要求使用 `subagent_dsh_chatgpt` 委派只读文本任务 `只回复 DSH_LIVE_CODEX_OK`，确认父会话收到子 Agent 的结果。
3. 打开 ChatGPT 卡片里的 **Manage ChatGPT usage**，查看该应用的计划使用。使用的是何种额度以 OpenAI 侧显示为准。 [OpenAI 账户与用量](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

### 2026-11-14 实测

| 项目 | 结果 |
| --- | --- |
| 授权 | 隔离 Windows Desktop `0.2.2-rc.3` 收到用户授予的 ChatGPT 计划访问权限。 |
| 主对话 | `dsh-chatgpt` 路由的 `gpt-5.6-luna` 流式返回 `DSH_LIVE_MAIN_OK`。DSH 会话记录包含 6 个文本增量、用量事件和正常终态。 |
| 独立子 Agent | `subagent_dsh_chatgpt` 启动官方 Codex app-server。父会话收到独立子任务的 `subagent-settled` 事件，终态为 `completed`，回传 `DSH_LIVE_CODEX_OK`。 |
| 额度归属 | 主对话和 Codex 子 Agent 的两次真实请求均使用 ChatGPT 订阅内额度，均未使用 Credits。两条路径均通过同一份 SIWC 计划授权成功完成。用户确认截图中的设置在整个测试期间保持一致，`dsh-chatgpt` 已启用，应用上限为 100%，达到用量上限后允许应用使用 Credits 的开关处于关闭状态。截图未提供逐笔扣减数据，无法核对每条请求的具体扣减量。 |

截图中的 100% 表示应用可用比例上限。额度判断依据是请求成功、使用 ChatGPT 计划授权和 Credits 回退关闭。 [OpenAI 应用用量设置说明](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage)

真实验收沿用首次打开授权页时安装的 `0.1.0` 构建。后续交付包补充了拒绝计划权限后重新请求同意，以及缺少原始回放时保留工具命名空间的处理。这两项已随交付包通过隔离测试。发布预检还发现系统可能自动分配浏览器拦截的回调端口，现改用浏览器可访问的动态端口范围，并通过本地 OAuth 测试。

## v0.1.1 Windows 兼容性回归

- 在正式 Windows Desktop 0.2.2-rc.3 上，通过同一个本地 HTTP 代理验证了真实 Luna 流式对话和授权刷新。上游 5xx 和请求 ID 由本地回归测试覆盖。
- 将同一静默启动补丁提前应用于正式 Desktop 的 MemSearch 0.1.8 后，真实 GPT‑6.1‑Sol 回复正常流式结束。MemSearch 自动落盘，本地搜索命中新索引。150 秒监测未发现可见命令窗口。
- v0.1.1 安装包通过官方 CLI 装入独立 Windows Desktop 0.2.2-rc.3。与原版 MemSearch 0.1.9 并存时自动应用补丁。运行中恢复原厂文件后，插件再次应用补丁。隔离夹具通过授权、主对话流和 Codex 委派。补丁热重载后再发送一条夹具消息，确认自动捕获和向量索引文件均已生成，35 秒监测未发现可见命令窗口。真实账号记录来自上面两次正式 Desktop 回归以及前述 v0.1.0 额度验收。
