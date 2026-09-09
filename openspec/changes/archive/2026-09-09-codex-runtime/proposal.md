## Why

Codex 是当前唯一已经可运行的内置执行链路，但其实现直接暴露给 AgentTeam 和 RemoteAgentHost。需要将现有能力迁移为第一个 AgentRuntime 适配器，验证通用协议不会破坏当前产品。

## What Changes

- 将 Codex App Server 封装为 CodexRuntime。
- 映射 Codex thread、turn、事件、Skills、审批和错误。
- 保留当前本地工作区、沙箱、审批和模型选择行为。
- 支持旧模型失败时显示具体 Provider 错误，不自动切换模型。

## Capabilities

### New Capabilities

- \`codex-runtime\`: 提供 Codex App Server 的内置 Runtime 支持。

### Modified Capabilities

## Impact

- 影响 \`src/main/codex-app-server.ts\`、\`src/main/agent-team.ts\`、\`src/main/remote-agent-host.ts\`。
- 需要兼容当前 Codex CLI 版本、模型列表和本地认证。
- 需要增加 Runtime Adapter 集成测试。
