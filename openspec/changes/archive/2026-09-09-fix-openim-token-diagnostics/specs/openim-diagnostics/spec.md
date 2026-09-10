## Purpose

让桌面端和运维人员能够区分 OpenIM 配置错误、网络不可达和服务端拒绝，并直接看到可执行的诊断原因。

## ADDED Requirements

### Requirement: OpenIM errors retain provider details

业务 API SHALL 保留 OpenIM 下游错误的可读原因和明确错误类别。

#### Scenario: OpenIM rejects an admin token

- **WHEN** OpenIM 返回 `TokenMalformedError`
- **THEN** `/v1/im/session` 返回包含该原因的 OpenIM 错误，而不是无上下文的 `INTERNAL_ERROR`

### Requirement: OpenIM failures are distinguishable

业务 API SHALL 将 OpenIM 未配置、网络失败和 Provider 拒绝区分为可识别状态。

#### Scenario: OpenIM is unreachable

- **WHEN** API 连接 OpenIM 被拒绝
- **THEN** 响应包含 OpenIM 连接失败原因和请求关联信息
