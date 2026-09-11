## Why

后台同步群只会在消息发送者自己的桌面触发其自有本机 Agent。其他成员提及群内 Agent 时，Agent 所有者虽然在线并托管该 Agent，却收不到执行请求；此外运行中的旧后台缺少 Agent 回复发布路由，使已生成回复无法进入其他成员可见的群消息流。

## What Changes

- OpenIM 消息镜像成功后，后台向被提及 Agent 的所有者在线 Host 发送精确的跨用户聊天请求。
- 同一个 Agent 同一时刻只选择一个已注册 Host，避免多设备重复回复。
- 桌面端消费聊天请求时只调度当前用户拥有且在本机执行的精确 Agent，不从正文扩大范围。
- 普通跨用户聊天保持只读，不获得 Task 写入、命令或审批权限；需要操作电脑时仍走受治理 Task。
- 注册两个临时用户，建立好友和群聊，通过服务端回调与 Agent 回复接口验证完整链路，并重建当前后台服务以消除旧路由 404。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `openim-messaging`: 群成员对其他成员 Agent 的明确提及会被安全路由到该 Agent 的在线 Host，并将回复发布回原群。
- `agent-runtime`: 本机 Host 可以接收跨用户普通聊天请求，但只在非 Task 的只读权限边界内执行。

## Impact

修改后台 OpenIM 回调事件、实时 Host 定向投递、桌面端事件消费和双用户集成测试；复用现有 Agent 回复发布接口与 Outbox，不新增数据库字段，不改变 Task 审批协议。
