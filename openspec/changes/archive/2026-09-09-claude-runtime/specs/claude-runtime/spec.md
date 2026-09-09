## Purpose

在统一 Runtime 契约下接入 Claude，并准确声明其可用的会话、上下文、工具和审批能力。

## ADDED Requirements

### Requirement: Claude runtime declares verified capabilities

Claude Runtime SHALL 只声明经过当前版本验证的能力，并对不支持的能力返回明确的 unsupported 状态。

#### Scenario: Claude lacks workspace write support

- **WHEN** Agent 请求 Claude 执行工作区写入
- **THEN** Runtime 拒绝该操作并说明缺少写入能力，不伪造成功结果

### Requirement: Claude runtime preserves session semantics

Claude Runtime SHALL 能创建、继续和结束已支持的 Session，并将 Provider 会话标识关联到产品 Session。

#### Scenario: Continue a Claude session

- **WHEN** 编排层向已有 Session 发送下一轮输入
- **THEN** Runtime 使用同一 Provider Session 或明确报告无法恢复

### Requirement: Claude errors remain diagnosable

Claude Runtime SHALL 保留 Provider、Model、状态码或退出状态以及原始错误内容。

#### Scenario: Authentication fails

- **WHEN** Claude 认证失败
- **THEN** 用户看到明确认证错误，诊断记录包含原始 Provider 错误
