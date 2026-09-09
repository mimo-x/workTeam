## Why

OpenIM 返回 `TokenMalformedError` 时，业务 API 将其隐藏为无上下文的 500，桌面端无法判断是 Token 配置错误还是网络故障。

## What Changes

- 保留 OpenIM 返回的具体错误信息。
- 将 OpenIM 下游失败映射为可识别的业务错误。
- 增加 Token 错误诊断回归 Case。

## Capabilities

### New Capabilities
- `openim-diagnostics`: OpenIM 下游错误诊断。

### Modified Capabilities

## Impact

影响 `/v1/im/session` 错误响应和桌面端提示，不改变 OpenIM 协议。
