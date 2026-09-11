## Why

桌面端 Agent 同时维护本地业务 ID、云端 Agent UUID 和 OpenIM 用户 ID。部分保存、私聊和群成员流程直接回退到 `agent.id`，会把 `agent_coder` 之类的本地 ID发送到只接受 UUID 的后台路径，用户只能看到 `Invalid UUID`。同时，OpenIM Electron SDK 的原生连接没有覆盖 renderer 卸载和账号切换场景，macOS arm64 在 `OnKickedOffline` 回调边界发生了进程级崩溃。

## What Changes

- 增加统一的云端 Agent UUID 识别和映射函数。
- Agent 保存、删除、私聊和云端群成员流程只使用有效云端 UUID；本地 Agent 先创建云端记录。
- 增加无效历史映射的 BDD 回归 Case。
- 串行化 OpenIM 连接切换和断开，补充 renderer 卸载时的清理。
- 增加 OpenIM 生命周期回归 Case，并记录 native SDK 仍需真实 arm64 环境复核。

## Impact

修改桌面端 Agent 云端同步、私聊和群成员请求，以及 OpenIM renderer 连接生命周期。后台 API 合同不变，OpenIM 消息协议不变。
