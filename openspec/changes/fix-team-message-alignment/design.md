## Context

`senderType` 是角色分类，不是用户身份。OpenIM 好友消息会被规范化为 `senderType: "user"`，与本机用户相同。

## Decisions

- 新增纯函数，以 `senderId === "local_user"` 判断当前用户消息。
- 当前用户对齐到 `end`，好友和 Agent 对齐到 `start`，系统消息对齐到 `center`。
- 所有房间类型继续共用 `MessageRow`，确保规则一致。

## Validation

- 单元测试覆盖四种发送者身份。
- 源码回归测试阻止消息渲染器重新按 `senderType === "user"` 判断。
- 运行桌面测试、Bug 门禁、lint、typecheck 和 build。
