## Context

兼容 OpenIM 群发送后会调用 `ingestExternalMessage` 并传入 `model`、`targetAgentIds` 和 `triggerAgents=true`。后台同步群使用另一条发送分支，该分支省略了这些字段，导致消息只被持久化而不进入本机 Agent 编排。直接对所有文本提及启用调度会让当前电脑尝试执行其他用户的公开 Agent，因此需要同时收紧目标边界。

## Goals / Non-Goals

目标：当前用户在后台同步群中提及自己拥有的本机 Agent 时产生一次本地聊天 Run，并将完成回复安全发布回原群；显式目标不得被正文中的额外提及扩大。范围外：为其他用户 Agent 建立跨设备聊天 Run 协议、执行 hosted Agent、改变 Task 创建或审批行为。

## Decisions

渲染层从已解析的 `mentionedAgents` 中筛选 `ownerId=local_user` 且 `executionLocation=local` 的 Agent ID，只有普通聊天且集合非空时才设置 `triggerAgents`。主进程将已提供的 `targetAgentIds` 视为权威集合；只有调用方未提供该字段时，才从正文解析提及。

发布器接收房间上下文：兼容模式继续使用共享密钥 Agent Gateway；后台同步群使用当前用户的后台登录态调用 `POST /v1/rooms/:id/agent-messages`。后台只接受当前用户拥有、已加入目标群且 `execution_target=local` 的 Agent，并将回复写为 `openim.message.send` Outbox 事件。`deliveryId` 被命名空间化后写入可空的唯一 delivery key，使桌面重试不会产生重复群消息，也不改变其他 Outbox 事件的既有聚合语义。

## Risks / Trade-offs

其他成员提及该 Agent 时仍需要后续的跨设备聊天调度能力，本变更不扩张 Remote Agent Host 的 Task 权限模型。精确目标优先会改变“正文提及与显式目标不一致”时的行为，但这是必要的信任边界，也与渲染层已经完成的提及解析一致。后台 Outbox 投递仍遵循现有异步重试语义，因此接口返回接受不代表 OpenIM 已即时送达。
