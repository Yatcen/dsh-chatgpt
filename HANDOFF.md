# Project Handoff

最后更新：2026-11-14

项目根目录：`D:\AI\WorkSpace\20-dsh-chatgpt插件`

当前阶段已交付 Windows Desktop 的可安装插件。隔离 profile 已通过真实账户的主对话与 Codex 子任务验收，额度判断和证据范围已写入实测记录。

当前版本为 `v0.1.0`，首次 Git 基线为 `85a3530`。

## 已完成

- 已分配永久项目编号 `20`，建立唯一 canonical root。
- 已创建 README、Project Brief、官方集成基线、HANDOFF、`.gitignore` 和 `.env.example`。
- 已确认 Sign in with ChatGPT 是计划额度集成的官方目标路线，普通 API key 计费不是同一机制。
- 已确认主模型可使用官方 Responses 路径，独立 Agent 可使用 Codex app-server 路径。
- 已明确禁止 Cookie/令牌提取、账户共享、隐性付费 fallback 和未经批准的远程托管。
- 已登记到工作区 `PROJECTS.json` 与 `PROJECTS.md`。
- 已完成首次 Git 基线。证据：提交 `85a3530`（`chore: establish project baseline`）。
- 固定首个目标为官方 Windows Desktop `0.2.2-rc.3`。已核对 MIT 许可证、Cordis Bundle、LLM 流、外部子 Agent、配置目录和生命周期。见 [DSH 插件契约](docs/DSH_PLUGIN_CONTRACT.md)。
- 已实现共享 SIWC OAuth、Windows DPAPI 存储、Responses 流适配器、模型设置卡和独立 Codex app-server 后端。
- 9 项本地测试通过。官方 Windows Desktop `0.2.2-rc.3` 解包运行，在独立 `desktop` profile 中使用官方捆绑 CLI 安装，实测 `DESKTOP_ACCOUNT_OK`、`DESKTOP_STREAM_OK` 与 `DESKTOP_DELEGATION_OK`。真实 Codex `0.142.3` 的 stdio 初始化也已验证。

## 真实验收

- 已验证真实 workspace 授权、模型列表、主对话流式返回，以及 Codex 子任务完成回传。用户确认测试期间应用的 ChatGPT 套餐权限始终开启，Credits 回退始终关闭。两次成功请求均使用订阅内额度，均未使用 Credits。逐笔扣减量无法核对。

## 已知风险

- DSH 的产品形态或许可证可能不符合计划使用资格。
  保护措施：在编码前核实 DSH 来源和分发方式；需要审批时先完成申请。
- OAuth 凭据若通过日志、配置或子进程参数泄露，会造成账户风险。
  保护措施：使用受保护存储，access token 只通过子进程环境传递，所有认证字段从日志中排除。
- 主模型与 Agent 的接口需求可能不同。
  保护措施：先实现两个具体适配入口，不提前抽象成通用多 Provider 框架。
- 模型与工具能力随账户、workspace 和预览状态变化。
  保护措施：运行时发现、按实际 scopes 和请求结果判断，不写死权限。

## 下一项任务

如需逐笔核对，需有带请求时间和扣减来源的 OpenAI 用量记录，或保留测试前后的额度与 Credits 余额变化。 [实测记录](docs/DESKTOP_VALIDATION.md#2026-11-14-实测)

## 最小启动与验证

```powershell
Set-Location 'D:\AI\WorkSpace\20-dsh-chatgpt插件'
npm ci --omit=peer
npm test
npm pack
```

打包产物可使用官方 Desktop 插件管理命令安装。详情见 [README](README.md#安装和使用)。

立项验证证据：工作区登记可解析，永久编号 `20` 唯一；项目分支为 `main`；首次基线包含 6 个受版本控制的文件。

## 关键决定

- 2026-11-14：项目只采用 OpenAI 官方 Sign in with ChatGPT 计划授权，不接受 Cookie、内部令牌或其他客户端凭据复用。
- 2026-11-14：主模型走直接 Responses 路径；独立 Agent 走 Codex app-server 路径。
- 2026-11-14：第一实现任务必须先核实 DSH 插件契约，不依据名称猜测技术栈。
- 2026-11-14：真实 OAuth 和额度消耗必须在 fake adapter 契约验证后进行。
