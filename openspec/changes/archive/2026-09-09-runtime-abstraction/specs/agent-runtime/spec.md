## Purpose

让业务编排层通过统一 Runtime 能力调度不同 Provider，并以一致事件语义处理执行过程。

## ADDED Requirements

### Requirement: Runtime supports session execution

Runtime SHALL 支持创建或恢复 Session、发送一轮输入、取消执行，并返回稳定的 Session 和 Turn 标识。

#### Scenario: Start and continue a session

- **WHEN** 编排层为 Agent 创建 Session 并发送输入
- **THEN** Runtime 返回可继续使用的 Session ID 和 Turn ID

### Requirement: Runtime emits normalized events

Runtime SHALL 将 Provider 原始事件转换为统一的进度、消息增量、审批请求、完成、失败和取消事件。

#### Scenario: Provider emits a completion event

- **WHEN** Provider 报告一轮执行完成
- **THEN** 编排层收到包含 Session、Turn、状态和最终内容的统一完成事件

### Requirement: Runtime failures are structured

Runtime SHALL 返回包含错误类别、Provider、Model、可读消息和原始详情引用的结构化错误，不得将对象直接转换为 \`[object Object]\`。

#### Scenario: Provider rejects a model

- **WHEN** Provider 报告所选 Model 不受支持
- **THEN** 编排层可以同时获得模型名、状态码、原始原因和用户可读提示
