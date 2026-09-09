## Why

OpenCode 可能以本地 Server 或 CLI 提供执行能力，与 Codex 的 JSONL App Server 语义不同。需要单独验证其协议并接入统一 Runtime，避免在通用层泄漏 OpenCode 特性。

## What Changes

- 调研 OpenCode 的本地服务、CLI、Session 和事件协议。
- 实现 OpenCodeRuntime 及能力声明。
- 支持可验证的消息、流式事件、取消、工作区和错误映射。
- 对不支持的审批、Skills 或权限返回明确边界。

## Capabilities

### New Capabilities

- \`opencode-runtime\`: 提供 OpenCode 内置 Runtime 的可验证接入能力。

### Modified Capabilities

## Impact

- 新增 OpenCode Provider 适配和环境检测。
- 影响 Runtime 注册、Session 恢复、模型配置和诊断日志。
- 需要针对 OpenCode 版本固定兼容性测试。
