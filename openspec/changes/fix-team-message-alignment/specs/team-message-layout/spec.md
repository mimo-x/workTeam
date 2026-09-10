## Purpose

确保所有 Team Chat 会话按照消息归属显示一致的左右布局。

## ADDED Requirements

### Requirement: Identity-based message alignment

消息布局 SHALL 使用当前用户身份而不是发送者角色类型决定左右位置。

#### Scenario: Current user message

- **WHEN** 消息发送者 ID 为 `local_user`
- **THEN** 消息显示在右侧

#### Scenario: Friend or Agent message

- **WHEN** 消息发送者是好友或 Agent
- **THEN** 消息显示在左侧

#### Scenario: System message

- **WHEN** 消息类型为系统消息
- **THEN** 消息以居中提示形式显示
