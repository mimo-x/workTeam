## Why

后台同步群的发送分支只把用户消息写入 OpenIM 和本地时间线，没有把已解析的 Agent 目标交给本机编排器，导致用户在群里 `@` 自己的 Agent 时没有任何回复。

## What Changes

- 后台同步群发送成功后，将当前用户拥有且运行在本机的被提及 Agent 作为精确触发目标交给本机编排器。
- 让显式 `targetAgentIds` 成为外部消息调度的权威目标，阻止消息正文中的其他 Agent 提及扩大本机执行范围。
- 增加基于用户登录态的 Agent 回复发布接口，校验 Agent 所有权、房间成员关系和执行位置，并通过幂等 Outbox 将回复送回原 OpenIM 群。
- 增加渲染层路由 BDD 和主进程精确目标回归测试。

## Capabilities

### New Capabilities

### Modified Capabilities

- `agent-runtime`: 后台同步群中的自有本机 Agent 可以响应普通聊天提及。
- `openim-messaging`: OpenIM 发送结果携带精确的本机 Agent 调度目标。

## Impact

修改桌面渲染端的后台群发送分支、主进程的外部消息目标解析与发布路由，并新增后台房间 Agent 消息接口和 Outbox 幂等索引；不修改 Task 权限或其他用户 Agent 的远程调度。
