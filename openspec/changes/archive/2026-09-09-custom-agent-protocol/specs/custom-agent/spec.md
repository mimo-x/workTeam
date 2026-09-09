## Purpose

为注册中心中的外部 Agent 提供最小、可认证、可观测且能力明确的接入协议。

## ADDED Requirements

### Requirement: Custom Agent publishes a versioned manifest

自定义 Agent SHALL 提供包含协议版本、身份、能力、运行模式、认证要求和版本的 Manifest。

#### Scenario: Client discovers a custom HTTP Agent

- **WHEN** 客户端读取自定义 Agent Manifest
- **THEN** 客户端可以校验协议版本和能力后决定是否允许连接

### Requirement: HTTP custom Agent supports controlled sessions

HTTP Agent SHALL 支持认证的 Session 创建、输入、取消、健康检查和事件或结果读取，并为每次请求返回可关联 ID。

#### Scenario: HTTP Agent times out

- **WHEN** Agent 在规定时间内没有完成请求
- **THEN** 客户端结束或标记 Session 超时，并保留 request/session ID 和诊断原因

### Requirement: CLI custom Agent uses structured IO

CLI Agent SHALL 使用版本化 JSONL 输入输出事件，非结构化 stdout 不得被当作成功结果。

#### Scenario: CLI exits with an error

- **WHEN** CLI 以非零状态退出
- **THEN** Runtime 产生失败事件并包含退出码、stderr 摘要和 Session ID

### Requirement: Custom Agent cannot exceed declared and granted capabilities

系统 SHALL 同时校验 Manifest 能力和本地授权策略，拒绝未声明或未获授权的工作区、命令和敏感操作。

#### Scenario: Remote Agent requests local file access

- **WHEN** 远程 Agent 未获本地工作区授权却请求读取文件
- **THEN** 请求被拒绝且不向远程 Agent 泄露文件内容
