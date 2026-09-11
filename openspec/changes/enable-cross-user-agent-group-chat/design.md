## Context

后台回调已经能从 OpenIM `atUserList` 和消息扩展字段解析出精确 Agent ID，并持久化 `message_mirrors.target_agent_ids`。但回调只广播不含内容和目标的 `message.mirrored` 刷新事件，Agent 所有者 Host 无法据此执行。渲染层 OpenIM 监听又刻意不在后台同步群触发 Agent，避免每台成员电脑错误执行他人 Agent。

## Goals / Non-Goals

目标：让群内 Human 能与已获准入群、由其他成员在线托管的 Agent 对话；保证单 Host、精确目标、一次执行和群内持久回复。范围外：在 Owner Host 离线时托管 Agent、让普通聊天获得写权限、绕过 Agent 入群邀请、自动批准 Task 或操作电脑。

## Decisions

- `EventPublisher` 增加 `publishToAgentHost(ownerId, agentId, event)`；`RealtimeHub` 只选择一个同时匹配用户、设备和 Agent 注册集合的连接。连接集合按最近注册优先，以避免同账号多设备重复执行。
- OpenIM after-message 回调完成镜像事务后，对每个精确目标发送 `agent.chat.requested`。事件包含房间 ID、服务端消息 ID、发送者身份、正文、时间和单一 Agent ID；只为 Human 的普通 `chat` 消息发送。
- 桌面端收到事件后再次用 `ownerId=local_user`、`executionLocation=local` 过滤目标，再以服务端消息 ID 调用 `ingestExternalMessage`。显式 ID 是权威范围，正文提及不能扩大调度。
- 跨用户普通聊天沿用现有非 Task `read-only` Session；需要写入、命令或更高权限的请求必须进入受治理 Task。Agent 回复复用 `POST /v1/rooms/:id/agent-messages` 的所有权、群成员、Agent 入群和幂等校验。
- 双用户验证使用唯一临时账号，真实调用注册、好友、建 Agent、建群、OpenIM 回调和 Agent 回复接口；在本机 OpenIM 未配置时验证到 Outbox 边界，不伪造外部 OpenIM 投递成功。

## Risks / Trade-offs

跨用户聊天会让群成员读取 Agent 被允许看到的工作区上下文，因此 Agent 入群本身代表所有者对该群开放该 Agent 的只读对话能力。多设备选择以最近注册的有效连接为准；后续如需显式设备绑定，应扩展 Agent Host 归属模型而不是广播执行。

## Validation

- BDD 覆盖 Bob 提及 Alice Agent、只有 Alice Host 收到、精确目标不扩大、Agent 回复进入同一房间 Outbox。
- 实际注册两个临时用户，创建好友关系、Agent 和群并模拟经过鉴权的 OpenIM 回调。
- 运行桌面与后台全量测试、Bug 门禁、Lint、类型检查、桌面与后台构建，并验证重建服务后的回复接口不再为 404。
