## 1. Feasibility

- [x] 1.1 调研并记录 Claude 可用的 CLI/HTTP 接口、版本和认证方式；交付可重复的探测命令与结果
- [x] 1.2 用最小文本请求验证 Session、流式输出、取消和结构化错误；保存兼容性测试样例

## 2. Runtime Adapter

- [x] 2.1 实现 ClaudeRuntime 的 Manifest、能力声明和 Session 映射；通过适配器单测验证
- [x] 2.2 映射消息增量、完成、失败和 unsupported 事件；通过事件 fixture 测试验证

## 3. Desktop Integration

- [x] 3.1 增加 Claude 配置/认证状态读取并接入 Runtime 注册；运行类型检查和配置测试
- [x] 3.2 按实际能力接入工作区、Skills、审批或明确禁用；运行端到端最小任务测试
- [x] 3.3 运行 \`npm run lint\`、\`npm run build\` 并记录已支持和未支持能力
