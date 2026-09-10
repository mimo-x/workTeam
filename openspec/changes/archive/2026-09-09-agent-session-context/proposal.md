## Why

当前 Session、Thread 和 Run 的关系主要隐藏在 Map、TaskRun 和房间消息中，无法为多个 Provider 提供一致的恢复、上下文共享和错误追踪语义。需要显式建立一次 Agent 工作的上下文生命周期。

## What Changes

- 增加 AgentSession 及 ProviderThread 的领域关系。
- 定义 Session 与 Agent、Task、Room、Workspace、Model 的关联。
- 统一上下文版本、消费游标、交接信息和恢复策略。
- 明确 Session 失败、取消、超时和重试语义。

## Capabilities

### New Capabilities

- \`agent-session-context\`: 管理 Agent 工作会话、上下文和 Provider Thread。

### Modified Capabilities

## Impact

- 影响 \`src/main/agent-team.ts\`、\`src/main/remote-agent-host.ts\` 及共享快照类型。
- 影响本地持久化、云端 Task 同步和实时事件。
- 需要避免不同 Agent、Task 或 Model 之间的上下文串线。
