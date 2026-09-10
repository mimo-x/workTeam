## Context

AgentTeamService 和 RemoteAgentHost 当前直接调用 CodexAppServer 的 thread、turn、skill 和事件方法。Codex JSONL 事件不能直接成为跨 Provider 合同。

## Goals / Non-Goals

**Goals:**

- 定义足以支持本地 CLI、HTTP 和本地 Server 的最小 Runtime 接口。
- 统一事件、取消和错误语义。
- 通过适配器迁移现有 Codex 链路。

**Non-Goals:**

- 不在本 change 接入第二个 Provider。
- 不规定所有 Provider 必须支持写文件或审批。
- 不把 OpenIM 消息协议当作 Runtime 协议。

## Decisions

- 业务层依赖 \`AgentRuntime\`，CodexAppServer 由 \`CodexRuntime\` 适配器包装。
- 用能力声明表达可选能力；业务层在能力不足时拒绝不适用操作。
- 事件使用统一 envelope，保留 Provider 原始事件用于诊断。
- Runtime 不持有业务 Agent 身份，只处理 Session 和执行输入。

## Risks / Trade-offs

- [不同 Provider 能力不对称] -> 能力协商和显式 unsupported 状态，不伪造能力。
- [共享事件流发生串线] -> 每个事件必须携带 runtime/session/turn 标识并由编排层路由。
