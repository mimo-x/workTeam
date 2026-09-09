## Context

当前 thread key 由 workspace、room/task、agent 和 model 拼接，Task 已有 contextEvents/contextVersion，RemoteAgentHost 也维护独立 thread Map。需要把隐含约束显式化。

## Goals / Non-Goals

**Goals:**

- 显式表示产品 Session 与 Provider Thread 的一对一或可恢复映射。
- 保持 Task Context 的版本和消费游标。
- 让本地和远程 Host 使用同一生命周期语义。

**Non-Goals:**

- 不实现跨 Provider 的上下文自动转换。
- 不把 Agent 的所有历史消息作为永久记忆。
- 不在本 change 设计完整的上下文摘要模型。

## Decisions

- AgentSession 是产品层对象，ProviderThread 是 Runtime 私有映射。
- Session key 至少包含 workspace、agent 和 task/room；Model 变更默认创建新 Thread。
- 共享上下文以结构化事件和版本游标为主，Session 私有草稿不共享。
- 恢复优先使用可验证的 provider thread；不可恢复时创建新 Session 并记录原因。

## Risks / Trade-offs

- [旧 thread key 无法反查] -> 提供迁移映射并允许一次性重建 Session。
- [上下文过大] -> 先按版本增量传递，摘要作为后续可替换策略。
