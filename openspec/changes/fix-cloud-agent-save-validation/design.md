## Context

桌面端的 Agent 设置保存有两条路径：未登录后台时调用本地 `AgentTeamService.saveAgents`，登录后台时先调用 `POST /v1/agents`，再同步工作区。此前测试只覆盖了本地路径；云端路径失败时，`BackendClient.rawRequest` 丢弃了服务端 `error.details`。

## Decisions

- 用独立模块构造云端 Agent payload，避免 UI 组件内隐藏请求契约。
- 在发起云端请求前校验 mention、文本长度、Runtime endpoint、Runtime 参数和 Skill 引用。
- 后台返回的字段详情只格式化路径和消息，不回显任何凭据内容。
- 保留现有后端 schema 作为最终校验来源，前置校验只改善常见错误反馈。

## Validation

- BDD 覆盖默认云端 payload、非法 mention、非 HTTPS endpoint 和后台字段级错误格式化。
- 运行桌面测试、lint、typecheck、build 与 Bug 门禁。
