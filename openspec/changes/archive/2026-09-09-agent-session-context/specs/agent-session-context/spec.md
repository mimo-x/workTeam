## Purpose

为 Agent 的一次具体工作提供可恢复、可追踪且与 Provider Thread 解耦的上下文生命周期。

## ADDED Requirements

### Requirement: Sessions isolate execution context

系统 SHALL 将 Agent、Workspace、Task 或 Room、Runtime 和 Model 关联到明确 Session，禁止无关联复用其他工作的上下文。

#### Scenario: Two tasks use the same Agent

- **WHEN** 同一 Agent 同时处理两个 Task
- **THEN** 两个 Task 使用隔离的 Session 和上下文游标

### Requirement: Shared task context is versioned

系统 SHALL 为共享 Task Context 提供递增版本或等价游标，并记录 Agent 已消费的位置。

#### Scenario: New context arrives during a run

- **WHEN** 来源群产生新的 Task 上下文
- **THEN** 新内容进入下一次或明确允许 steer 的 Session，并且不会被重复消费

### Requirement: Session lifecycle is observable

系统 SHALL 区分 pending、running、completed、failed、cancelled 和 waiting 等 Session 状态，并记录失败原因。

#### Scenario: Provider failure

- **WHEN** Provider 返回不可恢复错误
- **THEN** Session 进入 failed，关联 Run 和消息可追踪到结构化错误
