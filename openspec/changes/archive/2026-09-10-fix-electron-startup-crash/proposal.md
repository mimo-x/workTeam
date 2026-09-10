## Why

在当前 macOS 26.6.1 环境中，Electron 44.2.0 启动后无窗口并触发 `SIGABRT`，崩溃栈位于 AppKit `RegisterApplication`，导致桌面端无法完成任何基础操作验收。

## What Changes

- 确认 Electron 运行时与 macOS 版本的兼容边界。
- 隔离并修复启动阶段原生 SDK 或运行参数导致的崩溃。
- 增加启动后窗口存在和主进程异常的回归验证。

## Capabilities

### New Capabilities
- `desktop-startup`: 桌面端启动和窗口可用性。

### Modified Capabilities

## Impact

影响 Electron 启动配置、依赖版本或原生 SDK 初始化顺序；不改变 Agent 业务协议。
