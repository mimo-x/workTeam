## 1. Protocol Contract

- [x] 1.1 定义 Manifest、Session、Event、Error 和 capability schema；通过 JSON schema fixture 验证
- [x] 1.2 定义 HTTP/SSE 和 CLI JSONL 的握手、幂等、取消、超时和退出语义；交付协议文档

## 2. Runtime Implementations

- [x] 2.1 实现 CustomHttpRuntime 和健康/认证/事件处理；使用本地测试 Agent 验证成功和失败路径
- [x] 2.2 实现 CustomCliRuntime 的 JSONL 进程管理；验证非零退出、stderr、超时和取消

## 3. Security and Registry Integration

- [x] 3.1 将自定义 Runtime 与 Registry Manifest 和授权绑定；验证未授权能力被拒绝
- [x] 3.2 增加 endpoint、消息大小、并发和超时限制；运行安全集成测试
- [x] 3.3 运行 \`npm run typecheck\`、\`npm run lint\`、\`npm run build\` 并更新接入文档
