# Project Brief

项目名称：dsh-chatgpt 插件

唯一根目录：`D:\AI\WorkSpace\20-dsh-chatgpt插件`

当前阶段：已立项，官方通道可行性已初步确认，DSH 接口待核实

## 目标用户

- 已使用 DSH，并拥有符合条件的 ChatGPT 账户与计划额度的本地用户。
- 希望在 DSH 中把 GPT 作为主模型或独立 Agent 使用，但不想配置独立 API key 的开发者。
- 需要通过官方授权、可撤销连接和明确用量入口管理模型访问的用户。

## 要解决的问题

DSH 需要一种官方、可维护的方式调用 GPT。传统 API key 使用独立的 API 计费，不能默认消耗 ChatGPT 订阅额度；复制网页 Cookie、内部令牌或其他客户端认证文件又不安全，也不属于可接受的集成方式。

项目需要验证 Sign in with ChatGPT 是否适用于 DSH 的分发和运行形态，并在 DSH 插件边界内同时支持：

1. GPT 作为 DSH 主模型参与正常对话和推理。
2. GPT 通过 Codex app-server 作为独立 Agent 接收任务、使用获准的本地工具并返回结果。

## 成功后的用户结果

用户在 DSH 中选择“Continue with ChatGPT”，通过浏览器完成官方登录和授权后，可以：

- 查看当前连接实际可用的模型。
- 选择 GPT 作为 DSH 主模型并完成一次请求。
- 启动一个独立 Agent thread，完成一个有明确输入和输出的子任务。
- 在 ChatGPT 设置中管理访问和用量，并能注销或重新授权。
- 清楚区分 ChatGPT 计划用量、可用 credits 与独立 API key 计费。

## 本阶段唯一交付物

建立项目身份、Project Brief、官方集成基线、README、HANDOFF 和首次 Git 基线；不实现真实认证或模型调用。

## 明确不做

- 本轮不编写 DSH 插件代码，不安装 DevKit、Codex CLI 或 app-server。
- 不接入真实 ChatGPT 账户，不发起 OAuth，不消耗任何计划额度或 credits。
- 不读取或复用浏览器、ChatGPT 桌面端、Codex CLI 或其他应用的现有认证状态。
- 不承诺所有 ChatGPT 套餐、workspace、模型和工具均可使用。
- 不实现远程 SaaS、多人共享账户、额度转售或后台代调用。
- 不提前搭建多 Provider 抽象、复杂重试、并发池、队列或通用 Agent 框架。

## 输入

- DSH 的源代码位置、版本和插件接口文档。
- DSH 对主模型 Provider 与独立 Agent 的调用契约。
- 用户选择的本地 ChatGPT 连接与实际授予的 scopes。
- 运行时模型目录、任务输入、允许的本地工具和预算限制。

## 输出

- 主模型模式：符合 DSH Provider 契约的流式或完整响应、用量状态与可操作错误。
- Agent 模式：独立 thread/turn 的事件、最终状态、结构化结果和必要的审批请求。
- 本地连接状态：账户显示信息、是否授予计划使用、可用模型和管理用量入口；不向 DSH UI 暴露令牌。

## 数据保存位置

计划本地优先保存：

```text
项目仓库/                    只保存插件源码、测试和非敏感配置
用户配置目录/                DSH 插件设置与所选 profile ID
系统受保护凭据存储/          OAuth 凭据，由官方开发套件或验证后的认证层管理
用户配置目录/agent-state/     独立 Agent thread ID 与可恢复的非敏感状态
```

具体目录必须在确认 DSH 的插件约定和目标操作系统后确定。令牌与授权码不得落入项目仓库。

## 外部服务或账号

- ChatGPT Plus 或 Pro 等符合官方计划使用条件的账户；实际资格由 OpenAI 和 workspace 策略决定。
- OpenAI Sign in with ChatGPT OAuth 与 `https://api.openai.com/v1` Responses 资源。
- 可选 Codex app-server，用于独立 Agent 生命周期和本地工具协调。
- 独立 OpenAI API key 只能作为用户明确选择的备用计费方式，不能冒充计划额度。

## 建议架构

### 主模型路径

```text
DSH 主模型接口
→ dsh-chatgpt 插件
→ Sign in with ChatGPT 本地运行时
→ Responses API
→ DSH 消息流
```

### 独立 Agent 路径

```text
DSH 子任务
→ dsh-chatgpt 插件
→ Codex app-server 子进程
→ thread/start + turn/start
→ 本地工具、审批和子 Agent
→ 结构化结果返回 DSH
```

第一版只实现这两个具体入口，不建立额外通用 Provider 框架。

## 最主要的风险

1. **资格风险**：DSH 的许可证、分发方式或运行形态可能不符合 Sign in with ChatGPT 计划使用条件。

   保护措施：在编码前确认 DSH 是否属于本地开源/个人项目，或是否需要申请 private/commercial access。

2. **契约风险**：尚未获得 DSH 插件 API、生命周期、流式事件和 Agent 接口。

   保护措施：下一任务先只读检查 DSH 代码和官方插件约定，再决定语言、目录和最小适配面。

3. **认证风险**：错误保存、记录或传递 OAuth 凭据会造成账户泄露。

   保护措施：使用官方开发套件和受保护存储；令牌只在认证层与 app-server 子进程环境中短暂存在。

4. **能力差异风险**：模型、工具、输入和额度由账户、workspace 与预览限制决定。

   保护措施：运行时发现模型，显式展示 plan usage 状态，针对不支持能力返回清楚错误，不写死能力假设。

## 第一里程碑验收方式

在本地、单用户、无远程托管的 DSH 环境中完成一次受控 dry-run：

1. 使用官方 Sign in with ChatGPT 流程登录并授予计划使用权限。
2. 验证返回 scopes 包含 `chatgpt.tokens.use.direct`，令牌不进入日志。
3. 运行时列出当前连接可见模型。
4. 选择一个可用模型，作为 DSH 主模型完成一次最小文本请求。
5. 使用同一连接启动 Codex app-server，作为独立 Agent 完成一个不修改文件的只读任务。
6. 验证主模型和 Agent 的上下文、生命周期与结果彼此独立。
7. 验证注销、授权失效或额度耗尽时给出可操作错误。
8. 在 ChatGPT 用量设置中确认此次请求归属计划用量；不配置 API key，不发布或远程托管。

## 最小验证命令

本轮只验证立项文件和 Git 基线：

```powershell
git status --short --branch
git log --oneline -2
```

实现阶段的命令需在读取 DSH 源码和工具链声明后补充。

## 进入实现前待确认

- DSH 的完整名称、canonical root 或官方仓库 URL 是什么？
- DSH 使用什么语言和插件格式？是否已有 Provider/Agent 示例？
- DSH 是否为开源、本地个人项目，许可证是什么？
- 主模型是否要求流式输出、工具调用、图片/文件输入和结构化输出？
- 独立 Agent 需要哪些 DSH 工具、审批、取消、超时和 thread 恢复能力？
- 首期只支持 Windows，还是也必须支持 macOS/Linux？
- 是否接受只有符合条件的 Plus/Pro 与获准 workspace 才能使用计划额度？
