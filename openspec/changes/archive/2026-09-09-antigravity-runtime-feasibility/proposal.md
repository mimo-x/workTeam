## Why

Antigravity 的可用接口、部署形态和能力尚未在本项目中验证。它必须先经过独立的兼容性验证，才能决定是完整内置 Runtime、受限聊天 Runtime，还是暂不支持。

## What Changes

- 探测 Antigravity 的安装方式、协议、认证和执行能力。
- 验证 Session、上下文、流式输出、取消、错误、工作区和审批。
- 输出支持等级、平台/版本矩阵和明确的 Go/No-Go 结论。
- 若具备稳定接口，实现最小 Runtime Adapter；否则交付明确 unsupported 能力。

## Capabilities

### New Capabilities

- \`antigravity-runtime\`: 提供 Antigravity Runtime 的兼容性结论和可行接入边界。

### Modified Capabilities

## Impact

- 影响内置 Runtime 清单和桌面端能力展示。
- 可能新增 Antigravity 适配器或仅新增不支持状态。
- 需要保留探测证据，避免后续基于未经验证的假设开发。
