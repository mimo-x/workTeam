# Agent ID Boundary Specification

## Requirement: Cloud Agent requests use UUIDs

桌面端 SHALL 只把严格有效的云端 Agent UUID 放入 `/v1/agents/:id` 路径、云端私聊请求和云端群 `agentIds` 请求体。

### Scenario: Local Agent is saved without a cloud mapping

- **GIVEN** Agent 的本地 ID 为 `agent_coder` 且没有有效云端 UUID
- **WHEN** 用户保存 Agent 设置
- **THEN** 桌面端不调用 `/v1/agents/agent_coder`
- **AND** 本地 Agent 保持本地状态

### Scenario: Local Agent joins a cloud room

- **GIVEN** Agent 没有有效云端 UUID，或历史 `cloudAgentId` 不是 UUID
- **WHEN** 用户把 Agent 加入云端群
- **THEN** 桌面端先创建云端 Agent
- **AND** 只把后台返回的 UUID 放入群成员请求
