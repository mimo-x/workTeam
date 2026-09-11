## MODIFIED Requirements

### Requirement: Backend and OpenIM Agent membership are reconcilable

系统 SHALL 能把后台正式 Agent 成员关系与 OpenIM 群成员投递结果关联，并为不一致状态提供诊断证据。

#### Scenario: Owned Agent is added to a group

- **WHEN** 后台提交自有 Agent 的正式房间成员关系
- **THEN** 房间查询返回该 Agent
- **AND** OpenIM Outbox 邀请同一 Agent 身份进入对应群

