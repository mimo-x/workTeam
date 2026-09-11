## Why

群成员编辑器保存后，Agent 已被 OpenIM 正式拉入群，但桌面管理页和 `@` 候选仍可能缺失该 Agent。系统同时维护后台 `room_agents`、OpenIM 群成员和桌面合并快照，当前 UI 只依赖后两者之外的后台快照交集，缺少一致性校验和恢复路径。

## What Changes

- 为群 Agent 成员替换补充端到端一致性验证，覆盖后台关系、OpenIM Outbox 和房间查询 DTO。
- 云端工作区同步保证房间引用的 Agent 总能进入桌面 Agent 状态模型，不依赖目录首屏或其他独立查询。
- 群保存后核对服务器返回/重新查询的正式 Agent 成员，并在不一致时显示可诊断错误而不是静默关闭。
- 明确成员编辑器是整体替换语义，避免用户在邀请新 Agent 时无意移除已有 Agent。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-workbench`: 群管理页与 `@` 候选应一致显示已经正式入群的 Agent。
- `openim-messaging`: 后台房间成员与 OpenIM 群成员变更应可验证并可诊断。

## Impact

涉及房间成员更新响应、云端工作区合并、群成员编辑器、提及候选及双用户回归测试；不改变 Agent 所有权或邀请审批权限。

