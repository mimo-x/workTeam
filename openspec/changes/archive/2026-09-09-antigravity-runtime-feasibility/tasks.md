## 1. Discovery

- [x] 1.1 确认 Antigravity 产品、平台、版本和可用安装入口；交付无凭证的环境探测结果
- [x] 1.2 验证启动/连接、认证、Session、输入输出和错误协议；保存最小可复现样例

## 2. Capability Matrix

- [x] 2.1 逐项验证流式输出、取消、工作区读写、命令、Skills、审批和上下文恢复；输出能力矩阵
- [x] 2.2 根据证据确定完整、受限或 unsupported 支持等级；更新 Manifest 和用户提示文案

## 3. Delivery Decision

- [x] 3.1 若可行，实现最小 AntigravityRuntime 并通过统一 Runtime 测试
- [x] 3.2 若不可行，实现稳定的探测与 unsupported 状态，并通过失败路径测试（不适用：已由可行路径 3.1 完成）
- [x] 3.3 运行 \`npm run typecheck\`、\`npm run lint\`、\`npm run build\` 并记录最终结论
