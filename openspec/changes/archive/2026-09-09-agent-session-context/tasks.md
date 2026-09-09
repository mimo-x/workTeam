## 1. Session Model

- [x] 1.1 增加 AgentSession、ProviderThread 和 SessionState 类型；通过类型检查验证关联字段完整
- [x] 1.2 将现有 thread key 和 runs 映射到 Session；用同一 Agent 两个 Task 的测试验证隔离

## 2. Context Lifecycle

- [x] 2.1 统一 Task Context 版本和 Agent 消费游标；增加重复消息不会重复消费的测试
- [x] 2.2 定义取消、失败、超时、恢复和重试状态迁移；用状态迁移测试验证非法转换被拒绝

## 3. Integration

- [x] 3.1 迁移 AgentTeamService 和 RemoteAgentHost 的 Session 创建/复用路径；运行 Agent 集成测试验证
- [x] 3.2 输出 Session/Run 诊断事件并更新本地快照；运行 \`npm run build\` 和 \`npm run lint\` 验证
