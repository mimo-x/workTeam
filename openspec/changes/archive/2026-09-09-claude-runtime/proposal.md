## Why

要支持 Claude 作为内置 Agent 能力，必须验证其实际可用的本地或远程接口，并将认证、Session、流式输出、工具权限和错误语义适配到统一 Runtime，而不是假设它与 Codex 兼容。

## What Changes

- 调研并确定 Claude 支持的本地 CLI 或 HTTP 执行入口。
- 实现 ClaudeRuntime 的 Manifest、Session、消息、事件和错误适配。
- 按能力等级支持文本、工作区读取、写入、命令和审批。
- 对未支持的能力返回明确状态。

## Capabilities

### New Capabilities

- \`claude-runtime\`: 提供 Claude 内置 Runtime 的可验证接入能力。

### Modified Capabilities

## Impact

- 新增 Claude Provider 适配和本地配置/认证处理。
- 影响 Runtime 注册、桌面配置和测试矩阵。
- 接入范围取决于官方或稳定接口验证结果。
