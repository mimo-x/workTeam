## 1. Information Architecture

- [x] 1.1 设计 Agent 目录、详情、Runtime 能力和 Session 状态的页面状态矩阵；交付可评审交互稿
- [x] 1.2 明确内置/注册、在线/offline、unsupported、认证失败和空状态文案；通过产品验收清单验证

## 2. Desktop Integration

- [x] 2.1 接入 Agent Manifest、Runtime 能力和注册中心数据；通过类型检查和模拟数据渲染测试
- [x] 2.2 接入 Session/Run 事件、取消、重试和审批；运行消息/Task 回归测试
- [x] 2.3 展示模型错误摘要与原始诊断，并保留用户选择不自动切换；通过旧模型错误场景验证

## 3. UX and Release

- [x] 3.1 增加加载、离线、权限拒绝、超时和网络失败状态；通过交互状态测试验证
- [x] 3.2 更新 README 和桌面操作文档；运行 \`npm run lint\`、\`npm run typecheck\`、\`npm run build\`
- [x] 3.3 完成多 Runtime、多 Agent、多 Session 和审批流程的端到端验收
