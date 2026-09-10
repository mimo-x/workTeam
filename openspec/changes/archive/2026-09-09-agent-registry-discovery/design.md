## Context

业务后台已经管理用户、Agent、房间、Task 和实时 Host，OpenIM 负责消息。现有 Agent API 可作为 Registry 的演进基础，但需要补充 Manifest 和状态语义。

## Goals / Non-Goals

**Goals:**

- 以业务后台作为 Agent 目录和授权来源。
- 为内置与自定义 Agent 提供同一发现接口。
- 严格隔离公开元数据与私有配置。

**Non-Goals:**

- 不由 Registry 执行 Agent；
- 不在本 change 实现所有 Runtime；
- 不允许通过 Registry 下发任意本地命令。

## Decisions

- 使用现有认证和 PostgreSQL 数据模型扩展 Registry。
- Agent Manifest 版本化，公开字段与私有字段分离。
- 在线状态由本地 Host/远程 Runtime 心跳更新，目录存在不代表可执行。
- 能力声明用于 UI 和调度提示，执行前仍由 Runtime 与权限策略校验。

## Risks / Trade-offs

- [在线状态过期] -> 设置心跳 TTL，并在查询返回 age/status。
- [Manifest 暴露敏感信息] -> 服务端按可见性过滤指令、路径、凭证和 endpoint 私密字段。
