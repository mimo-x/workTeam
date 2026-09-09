# agent-workbench Specification

## Purpose
让用户在一个以项目工作区为核心的桌面工作台中发现 Agent、选择执行能力、跟踪 Session 并处理权限和错误。

## Requirements

### Requirement: User can discover and compare Agents

桌面端 SHALL 展示 Agent 来源、Runtime、能力、权限要求、在线状态和版本，并区分内置与注册 Agent。

#### Scenario: Agent lacks write capability

- **WHEN** 用户查看只读 Agent
- **THEN** 界面明确显示其不能执行工作区写入，不把写入操作显示为可用

### Requirement: User controls model and Runtime selection

桌面端 SHALL 允许用户选择可用 Runtime 和 Model，并在 Provider 拒绝旧 Model 时保留用户选择且显示具体原因，不自动替换。

#### Scenario: Legacy model is rejected

- **WHEN** Provider 返回旧 Model 不受支持
- **THEN** 消息中显示模型名、Provider 原因和原始错误，并提供主动切换入口

### Requirement: User can inspect Session execution

桌面端 SHALL 展示 Session/Run 的进行中、完成、失败、取消和等待状态，并允许执行适用的取消或重试操作。

#### Scenario: Session fails

- **WHEN** Runtime 返回结构化失败
- **THEN** 界面显示用户可读错误，同时保留可展开或复制的诊断详情

### Requirement: Approval remains human controlled

桌面端 SHALL 在命令或文件修改需要审批时阻止继续执行，直到用户明确批准、拒绝或取消。

#### Scenario: Agent requests a command

- **WHEN** Runtime 发出命令审批事件
- **THEN** 用户看到目标、命令和工作区，并可明确选择审批结果
