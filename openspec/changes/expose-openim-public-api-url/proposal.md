## Why

Docker 部署把 OpenIM API 配置为容器内 hostname，服务端调用正常但桌面端无法解析，导致群聊发送失败。需要明确区分服务端内部地址和客户端公开地址。

## What Changes

- 增加可选的 OpenIM 客户端公开 API 地址配置。
- `/v1/im/session` 返回公开地址，OpenIM 服务端调用继续使用内部地址。
- 一键部署脚本写入服务器公网 IP 对应的公开 OpenIM API 地址。
- 增加 API 和部署脚本回归 Case。

## Capabilities

### New Capabilities

- `openim-public-endpoint`: 覆盖桌面端可访问的 OpenIM API 会话地址。

### Modified Capabilities

- 无

## Impact

- 修改 `services/chat-api/src/config.ts`、`services/chat-api/src/app.ts` 和 `deploy.sh`。
- 服务端配置变更需要用户重新执行 `bash deploy.sh`；不修改数据库结构。
