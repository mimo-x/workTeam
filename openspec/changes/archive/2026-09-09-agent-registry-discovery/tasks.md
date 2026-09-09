## 1. Data Model

- [x] 1.1 设计 Agent Manifest、来源、可见性、版本和 Runtime 状态字段；通过 schema/migration 检查验证
- [x] 1.2 增加注册、更新、撤销和状态迁移约束；通过越权和重复注册测试验证

## 2. API

- [x] 2.1 实现 Agent 注册、查询、搜索和 Manifest 接口；运行 API 集成测试验证字段过滤
- [x] 2.2 实现授权、邀请和撤销流程；验证私有 Agent 和非所有者访问被拒绝

## 3. Desktop Sync

- [x] 3.1 将 Registry Agent 映射到本地 AgentDefinition；运行云端快照同步测试
- [x] 3.2 展示 offline/online/unauthorized 状态并阻止不可执行操作；运行桌面端类型检查和构建
- [x] 3.3 更新 API、部署和安全文档，并运行后端测试
