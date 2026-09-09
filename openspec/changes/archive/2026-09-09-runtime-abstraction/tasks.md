## 1. Runtime Contract

- [x] 1.1 定义 AgentRuntime、Session、Turn、Capability 和统一事件类型；通过 TypeScript 类型检查验证
- [x] 1.2 定义结构化 RuntimeError 和原始诊断字段；用不支持模型样例验证不会产生 \`[object Object]\`

## 2. Adapter Boundary

- [x] 2.1 创建 CodexRuntime 适配层并映射现有 CodexAppServer 调用；通过 Codex 现有集成测试验证行为不变
- [x] 2.2 修改 AgentTeamService 和 RemoteAgentHost 的构造依赖为 AgentRuntime；通过类型检查验证不再直接依赖 Provider 类

## 3. Event and Failure Handling

- [x] 3.1 统一进度、审批、完成、失败和取消事件并覆盖未知事件；增加事件路由测试
- [x] 3.2 保留 Provider 原始错误和 request/session/turn 标识；运行 \`npm run lint\` 与 \`npm run build\` 验证
