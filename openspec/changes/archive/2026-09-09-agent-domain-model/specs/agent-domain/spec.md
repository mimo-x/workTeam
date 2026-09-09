## Purpose

为内置 Runtime 和注册中心 Agent 提供稳定、可扩展且与具体 Provider 无关的产品领域模型。

## ADDED Requirements

### Requirement: Agent identity is stable

系统 SHALL 为每个 Agent 分配创建后保持不变的唯一身份，并将展示资料、归属和可见性与该身份关联。

#### Scenario: Agent keeps its identity after runtime changes

- **WHEN** 用户将 Agent 从一个 Runtime 切换到另一个 Runtime
- **THEN** Agent ID、名称、归属、历史消息和历史 Task 关联保持不变

### Requirement: Agent manifest declares behavior and capabilities

系统 SHALL 为每个可发现 Agent 提供包含职责、能力、权限要求、Runtime 绑定和版本的 Manifest。

#### Scenario: Client displays a discoverable Agent

- **WHEN** 客户端读取有效 Manifest
- **THEN** 客户端可以展示 Agent，并基于其能力决定可用操作

### Requirement: Provider details stay outside Agent identity

系统 SHALL 将 Provider、Model、Session 和外部通信 ID 作为 Agent 运行或映射信息保存，不得用其替代 Agent 稳定身份。

#### Scenario: External identity changes

- **WHEN** Agent 的 OpenIM ID 或 Provider session ID 发生变化
- **THEN** Agent 的稳定身份和产品层历史关联不变
