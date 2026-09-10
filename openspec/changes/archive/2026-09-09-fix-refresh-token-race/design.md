## Context

服务端 refresh 会轮换并撤销旧 token；桌面端存在多个初始化路径并行调用认证请求。

## Goals / Non-Goals

**Goals:** 单飞刷新、失效凭证清理、保留现有登录协议。

**Non-Goals:** 不修改 JWT 或数据库会话模型。

## Decisions

在 BackendClient 内保存一个共享 refresh Promise；失效错误时清除加密和内存凭证。

## Risks / Trade-offs

- [风险] 刷新期间所有请求共同等待 → [缓解] 单次请求完成后立即释放锁。
