## Purpose

让用户和系统通过受控注册中心发现可用 Agent，并在使用前获得清晰的身份、能力和授权信息。

## ADDED Requirements

### Requirement: Registry stores discoverable Agent metadata

注册中心 SHALL 保存 Agent 稳定身份、所有者、可见性、Manifest、版本和来源，并只向请求者返回其有权查看的字段。

#### Scenario: Search public Agents

- **WHEN** 已认证用户搜索公开 Agent
- **THEN** 系统返回可展示的 Agent 元数据，不返回私有指令或凭证

### Requirement: Agent registration is authorized

注册中心 SHALL 要求 Agent 所有者或有权限的管理员注册、更新、撤销和删除 Agent。

#### Scenario: User edits another user's Agent

- **WHEN** 用户尝试修改不属于自己的私有 Agent
- **THEN** 请求被拒绝且 Agent 数据保持不变

### Requirement: Availability is separate from discoverability

注册中心 SHALL 分别表示 Agent 是否可被发现、是否已获授权以及 Runtime 当前是否在线。

#### Scenario: Registered local Agent is offline

- **WHEN** Agent 已注册但没有在线 Host 或 Runtime
- **THEN** Agent 仍可被发现，但状态显示为 offline，执行操作不会伪造在线
