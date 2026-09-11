## ADDED Requirements

### Requirement: Contact creation opens a new Agent draft

通讯录的“创建 Agent”入口 SHALL 打开 Agent 设置并自动创建、选中一个新的本地 Agent 草稿。

#### Scenario: Create from contacts

- **GIVEN** 用户位于通讯录且本地 Agent 数量少于 24 个
- **WHEN** 用户点击“创建 Agent”
- **THEN** 设置弹窗打开并选中新 Agent 草稿，而不是已有 Agent

#### Scenario: Creation limit

- **GIVEN** 用户已有 24 个本地 Agent
- **WHEN** 用户点击“创建 Agent”
- **THEN** 不再新增草稿，已有 Agent 配置保持不变
