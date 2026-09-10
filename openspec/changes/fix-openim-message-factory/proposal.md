## Why

桌面端通过 OpenIM 原生 SDK 发送好友私聊时，消息工厂在部分运行环境返回空字符串，现有代码因此抛出 `Cannot create property 'ex' on string ''`，消息无法发送。群聊成员管理支持好友入群，但消息编辑器只提供 Agent 提及，无法完成对好友的 @ 消息流程。

## What Changes

- 对 OpenIM 消息工厂返回的空值或非对象结果使用符合 SDK 协议的文本消息回退对象。
- 保留消息元数据并正常发送好友私聊和群聊文本消息。
- 群聊提及候选同时包含当前群内好友和 Agent，并将好友 OpenIM ID 作为 @ 目标。
- 增加私聊发送和群聊邀请好友后 @ 消息的 BDD 回归 Case。

## Capabilities

### New Capabilities

- `openim-messaging`: 覆盖桌面端 OpenIM 文本消息构造、发送和群聊成员提及。

### Modified Capabilities

- 无

## Impact

- 修改 `src/renderer/src/openim-transport.ts` 及群聊编辑器。
- 增加纯函数回归测试，不修改服务端 API 或部署脚本。
