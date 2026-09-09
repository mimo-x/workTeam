## Why

桌面端启动时多个初始化流程会并发刷新同一个一次性 refresh token，导致一个请求成功、另一个请求误报 `INVALID_REFRESH_TOKEN`，并持续触发重试。

## What Changes

- 合并并发 refresh 请求。
- 刷新令牌确认失效后清理本地凭证。
- 增加并发刷新回归 Case。

## Capabilities

### New Capabilities
- `auth-refresh`: 桌面端刷新令牌并发控制。

### Modified Capabilities

## Impact

影响桌面端 BackendClient 登录状态和启动初始化流程，不改变服务端认证协议。
