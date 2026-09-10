## Why

当前 AgentTeam 和 RemoteAgentHost 直接依赖 CodexAppServer，Provider 差异已经渗透到业务编排、事件处理和错误处理。接入 Claude、OpenCode、Antigravity 或外部 Agent 前必须建立统一 Runtime 边界。

## What Changes

- 定义 AgentRuntime 的 Session、消息、取消、事件、错误和能力接口。
- 统一流式进度、完成、失败、取消和审批事件。
- 让 AgentTeam 与 RemoteAgentHost 依赖 Runtime，而不是 CodexAppServer。
- 保留 Codex 作为第一个 Runtime Adapter。

## Capabilities

### New Capabilities

- \`agent-runtime\`: 提供 Provider 无关的 Agent 执行协议和事件模型。

### Modified Capabilities

## Impact

- 影响 \`src/main/agent-team.ts\`、\`src/main/remote-agent-host.ts\` 和 \`src/main/codex-app-server.ts\`。
- 会改变主进程运行时依赖注入和事件路由。
- 需要保证现有本地执行、审批、取消和错误行为兼容。
