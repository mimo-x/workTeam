# codex-runtime Specification

## Purpose
将现有 Codex App Server 能力作为第一个符合统一 Runtime 协议的内置执行实现。

## Requirements

### Requirement: Codex runtime uses the selected workspace and model

Codex Runtime SHALL 使用 Session 指定的工作区、沙箱级别和 Model；Model 不可用时 SHALL 返回明确失败，不得静默替换。

#### Scenario: Selected legacy model is unavailable

- **WHEN** 用户选择的旧 Model 不被当前账号或群组支持
- **THEN** Session 失败并显示模型名、服务端原因和原始错误

### Requirement: Codex events map to runtime events

Codex Runtime SHALL 将 Codex 的消息增量、活动、审批、完成和失败事件映射为统一 Runtime 事件。

#### Scenario: Command approval is requested

- **WHEN** Codex 请求命令或文件变更审批
- **THEN** Runtime 发出可关联到 Session 和 Turn 的审批事件

### Requirement: Codex execution preserves safety controls

Codex Runtime SHALL 继续使用工作区沙箱和 on-request 审批策略，不能因适配层迁移绕过桌面端审批。

#### Scenario: Agent requests a file change

- **WHEN** Codex 产生需要审批的文件修改
- **THEN** 用户必须在桌面端明确批准或拒绝
