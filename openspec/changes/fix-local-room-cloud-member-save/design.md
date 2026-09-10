## Context

`RoomDialog` 同时负责创建群和编辑群。当前逻辑用 `cloudMode && remoteSelection` 判断是否走云端分支，但该条件对已有本地群同样生效。本地房间 ID 使用 `local-agent-team` 或 `group_<uuid>`，而 `/v1/rooms/:id/members` 的 `:id` 必须是后端 UUID。

## Decisions

- 提取纯函数 `resolveRoomSaveTarget`，显式接收已有房间、云端模式和是否选择远端成员。
- 已有房间优先按其 `syncSource` 决策：仅 `backend` 使用云端更新，`local` 或缺省来源均使用本地更新。
- 只有没有已有房间时，才使用 `cloudMode && hasRemoteSelection` 决定创建云端群。
- 不更改 Agent 发布状态、群数据迁移或 UI 表现，避免把本次路径路由缺陷扩大成房间迁移功能。

## Validation

- BDD 单元测试覆盖已有本地群含云端 Agent、已有云端群、新建云端群和新建本地群。
- 源码回归检查确保 `RoomDialog` 使用共享决策函数。
- 运行桌面测试、Bug 门禁、lint、typecheck、build 和 `.githooks/pre-commit`。
