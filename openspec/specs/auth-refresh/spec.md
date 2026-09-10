# auth-refresh Specification

## Purpose
保证桌面端在多个初始化请求同时发生时只刷新一次认证凭证，并在凭证失效后清理旧状态、恢复到可重新登录状态，避免并发竞态反复污染启动流程。

## Requirements

### Requirement: Refresh requests are single flight

桌面端 SHALL 合并同时发生的 refresh 请求，并让并发调用共享同一个结果。

#### Scenario: Multiple startup requests refresh together

- **WHEN** 多个后台请求同时发现 access token 缺失
- **THEN** 客户端只向服务端发起一次 refresh 请求，所有调用获得同一认证结果

### Requirement: Invalid refresh tokens are cleared

客户端 SHALL 在服务端明确返回 refresh token 无效后清理本地凭证并允许重新登录。

#### Scenario: Refresh token is revoked

- **WHEN** 服务端返回 `INVALID_REFRESH_TOKEN`
- **THEN** 客户端删除本地 refresh token，不再无限重复使用该 token
