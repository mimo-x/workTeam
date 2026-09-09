## Why

桌面端复用已失效的设备 ID 时，服务端 Host 注册返回 `DEVICE_NOT_FOUND`；异步 WebSocket handler 没有等待该 Promise，异常逃出请求边界并让 API 进程退出，造成 8790 端口反复不可用。

## What Changes

- 旧设备 ID 注册时自动创建新设备。
- 等待所有 WebSocket 异步 handler，避免异常退出 API。
- 增加旧设备、注册失败和成功恢复的回归 Case。

## Capabilities

### New Capabilities
- `agent-host-recovery`: Agent Host 设备注册恢复和异常隔离。

### Modified Capabilities

## Impact

影响后端 RealtimeHub 设备注册和 Host 连接稳定性，不改变任务租约协议。
