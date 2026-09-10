## 1. Feasibility

- [x] 1.1 调研 OpenCode 安装、启动、认证和协议入口；交付版本/平台兼容矩阵
- [x] 1.2 验证最小 Session、流式事件、取消、工作区和错误响应；保存协议 fixture

## 2. Runtime Adapter

- [x] 2.1 实现 OpenCodeRuntime 的探测、连接和能力声明；通过未安装/版本错误测试验证
- [x] 2.2 映射 Session、Turn、增量、完成、失败和取消事件；运行事件适配器测试

## 3. Integration

- [x] 3.1 接入统一 Runtime 注册和桌面配置；通过 Agent 选择与启动测试验证
- [x] 3.2 验证只读/可写工作区边界和超时清理；运行安全回归测试
- [x] 3.3 运行 \`npm run typecheck\`、\`npm run lint\`、\`npm run build\` 并记录支持边界
