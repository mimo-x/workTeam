## Context

RealtimeHub 的 `onMessage` 对异步方法直接 return，Promise rejection 会逃出 try/catch。旧 deviceId 更新无结果时也直接抛出错误。

## Goals / Non-Goals

**Goals:** 恢复旧设备注册、隔离异步错误、保留协议错误码。

**Non-Goals:** 不删除设备数据，不改变租约和认证规则。

## Decisions

对已知旧 deviceId 的更新失败转为插入新设备；对所有异步 handler 使用 await，统一由现有 catch 发送错误事件。

## Risks / Trade-offs

- [风险] 重复失效设备可能产生多条设备记录 → [缓解] 仅在客户端明确提供的 ID 无法更新时创建，后续由设备管理清理。
