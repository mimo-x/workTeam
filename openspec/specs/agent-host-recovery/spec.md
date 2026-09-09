# agent-host-recovery Specification

## Purpose
保证桌面端 Agent Host 的设备记录失效或注册异常时可以安全恢复，且任何 WebSocket 注册错误都不会让业务 API 进程退出。

## Requirements

### Requirement: Stale device registration recovers

服务端 SHALL 在客户端提供的设备 ID 不存在或已失效时创建新的 Host 设备记录，并完成本次连接注册。

#### Scenario: Device record was removed

- **WHEN** Host 使用数据库中不存在的旧 deviceId 注册
- **THEN** 服务端创建新设备、返回新的 deviceId，并继续处理连接

### Requirement: Realtime errors stay inside the connection

WebSocket 消息处理 SHALL 等待异步处理结果；注册或租约错误 SHALL 通过协议错误事件返回，不得使 API 进程退出。

#### Scenario: Device registration fails

- **WHEN** 新设备记录创建也失败
- **THEN** 客户端收到 `DEVICE_REGISTRATION_FAILED`，API 进程保持运行
