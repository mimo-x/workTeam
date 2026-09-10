## Context

会话可能来自本地或云端，直接删除房间会破坏群组、Task 引用或造成下一次云同步重新出现。

## Decisions

- 使用现有 shadcn ContextMenu 作为条目右键入口。
- 按工作区把 `pinnedAt` 与 `hiddenThrough` 偏好保存在本机 localStorage。
- “删除会话”只隐藏到当前最后一条消息的时间点；出现更新消息后自动恢复。
- 删除前使用 shadcn Dialog 明确说明范围并要求确认。

## Validation

- 纯逻辑测试验证置顶排序和新消息恢复。
- 源码回归测试验证 ContextMenu 操作与删除确认框存在。
- 运行桌面测试、Bug 门禁、lint、typecheck 和 build。
