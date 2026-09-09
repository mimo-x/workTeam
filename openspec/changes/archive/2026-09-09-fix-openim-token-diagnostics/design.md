## Context

OpenImClient 当前抛出原始 Error，通用 errorHandler 会将非 ApiError 转成 `INTERNAL_ERROR`。

## Goals / Non-Goals

**Goals:** 在 `/v1/im/session` 边界转换为带具体消息的业务错误。

**Non-Goals:** 不把管理员 Token 返回给客户端，不改变 Token 存储方式。

## Decisions

在 API 路由捕获 OpenIM 错误并转换为 ApiError，日志继续保留完整服务端错误。

## Risks / Trade-offs

- [风险] 下游错误消息可能包含实现细节 → [缓解] 不返回凭证，仅返回 Provider 错误文本和 requestId。
