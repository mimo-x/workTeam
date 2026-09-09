## Why

当前 Agent 主要由桌面端本地创建和同步，用户无法从注册中心发现可用的自定义 Agent，也无法区分目录信息、在线状态和执行能力。需要建立注册中心作为 Agent 目录和授权来源。

## What Changes

- 增加 Agent Registry 数据和 API。
- 支持 Agent 注册、搜索、公开/私有、归属和版本。
- 提供 Manifest、能力声明、Runtime 信息和健康状态。
- 增加注册、审批、撤销和删除的权限边界。

## Capabilities

### New Capabilities

- \`agent-registry\`: 负责 Agent 的注册、发现、授权和状态目录。

### Modified Capabilities

## Impact

- 影响 \`services/chat-api\` 的数据库、认证和 Agent 路由。
- 影响桌面端通讯录、Agent 同步和 Runtime 选择。
- OpenIM 继续负责消息传输，不作为 Registry。
