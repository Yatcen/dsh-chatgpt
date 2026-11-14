# Project Handoff

最后更新：2026-11-14

项目根目录：`D:\AI\WorkSpace\20-dsh-chatgpt插件`

当前阶段：已立项，官方通道可行性已初步确认，DSH 接口待核实

当前版本：`main`；首次 Git 基线待记录

## 已完成

- 已分配永久项目编号 `20`，建立唯一 canonical root。
- 已创建 README、Project Brief、官方集成基线、HANDOFF、`.gitignore` 和 `.env.example`。
- 已确认 Sign in with ChatGPT 是计划额度集成的官方目标路线，普通 API key 计费不是同一机制。
- 已确认主模型可使用官方 Responses 路径，独立 Agent 可使用 Codex app-server 路径。
- 已明确禁止 Cookie/令牌提取、账户共享、隐性付费 fallback 和未经批准的远程托管。
- 已登记到工作区 `PROJECTS.json` 与 `PROJECTS.md`。

## 当前未完成

- 尚未获得 DSH 的完整名称、canonical root、仓库 URL、许可证、版本和插件接口。
- 尚未确认 DSH 主模型 Provider、流式事件、工具调用和独立 Agent 的具体契约。
- 尚未核实 DSH 的分发形态是否符合 Sign in with ChatGPT 的 open-source/local eligibility。
- 尚未安装官方 DevKit、Codex app-server 或任何依赖。
- 尚未接入真实账户、执行 OAuth、列出模型或发送模型请求。

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

目标：取得并只读检查 DSH 的官方仓库或本地 canonical root，形成一份最小插件契约说明。

验收标准：确认 DSH 版本、许可证、运行语言、插件加载方式、主模型 Provider 接口、独立 Agent 接口、流式事件、工具/审批/取消机制、配置与凭据目录；据此确定首个 fake adapter 的文件位置和最小测试命令。

不要做：不修改 DSH，不安装依赖，不执行 OAuth，不读取现有 ChatGPT/Codex 认证文件，不发送模型请求，不设计通用多 Provider 层。

## 最小启动与验证

```powershell
Set-Location 'D:\AI\WorkSpace\20-dsh-chatgpt插件'
git status --short --branch
git log --oneline -2
```

当前没有产品运行命令。

## 关键决定

- 2026-11-14：项目只采用 OpenAI 官方 Sign in with ChatGPT 计划授权，不接受 Cookie、内部令牌或其他客户端凭据复用。
- 2026-11-14：主模型走直接 Responses 路径；独立 Agent 走 Codex app-server 路径。
- 2026-11-14：第一实现任务必须先核实 DSH 插件契约，不依据名称猜测技术栈。
- 2026-11-14：真实 OAuth 和额度消耗必须在 fake adapter 契约验证后进行。
