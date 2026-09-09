# opencode-runtime Specification

## Purpose
在统一 Runtime 契约下接入 OpenCode，并以能力声明隔离其本地 Server 或 CLI 协议差异。

## Requirements

### Requirement: OpenCode runtime exposes a verified connection mode

OpenCode Runtime SHALL 声明当前使用的连接模式、版本和已验证能力，并在探测失败时返回可诊断错误。

#### Scenario: OpenCode is not installed

- **WHEN** 客户端尝试使用未安装或不可执行的 OpenCode Runtime
- **THEN** Runtime 返回安装/路径错误，不创建成功 Session

### Requirement: OpenCode events map to normalized events

OpenCode Runtime SHALL 将已支持的 Provider 事件映射为统一消息、进度、完成、失败和取消事件。

#### Scenario: OpenCode returns a streamed response

- **WHEN** OpenCode 持续返回输出增量
- **THEN** 客户端看到关联 Session 和 Turn 的增量事件，并在结束时收到唯一完成事件

### Requirement: Workspace access is explicit

OpenCode Runtime SHALL 在创建 Session 时明确工作区和读写能力，不得默认获得未授权目录访问。

#### Scenario: Read-only session

- **WHEN** Agent 以只读权限创建 OpenCode Session
- **THEN** Runtime 不得将其升级为可写或绕过桌面审批
