## 1. Adapter

- [x] 1.1 实现 CodexRuntime 并封装现有 CodexAppServer；通过 Codex 启动和 Session 测试验证
- [x] 1.2 映射 Codex 事件、审批、取消和结构化错误；通过事件快照测试验证

## 2. Integration

- [x] 2.1 让 AgentTeamService 使用 CodexRuntime 完成本地 Agent 执行；运行现有 Agent 集成测试
- [x] 2.2 让 RemoteAgentHost 使用 CodexRuntime 执行远程分配；运行 Host 协议测试

## 3. Compatibility

- [x] 3.1 验证模型列表、默认模型、旧模型失败和原始错误展示；运行错误格式化测试
- [x] 3.2 运行 \`npm run typecheck\`、\`npm run lint\`、\`npm run build\` 并记录 Codex CLI 版本兼容结论
