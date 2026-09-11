## Context

后台以 `room_agents` 为业务成员真相，并通过 Outbox 修改 OpenIM 群成员；桌面同步后从 `room.agents` 生成 `room.agentIds`，再与全局 `state.agents` 求交集生成 `@` 候选。群 `67aa59ad-e315-4f2f-b3f6-63f3216a863f` 的 OpenIM 缓存已确认存在 Agent `架构师`，但 UI 没有一致展示。

## Decisions

- 后台 `room_agents` 继续作为授权和调度的权威来源，OpenIM 成员作为投递状态与一致性诊断来源。
- 房间响应中携带的 Agent 定义必须合并到桌面 Agent 索引，不能要求它同时出现在独立目录请求的有限结果中。
- 成员替换成功后，客户端核对目标 Agent ID 与重新同步结果；缺失时保留弹窗并显示诊断信息。
- UI 明确说明保存会替换现有成员，并同时展示将加入和将移出的 Agent。

## Validation

- 服务端集成测试验证自有 Agent 替换在事务提交后同时出现在房间查询与 OpenIM Outbox。
- 桌面测试验证仅由房间 DTO 提供的 Agent 也能进入管理页和 `@` 候选。
- 两个真实用户核对同一群保存后的成员与候选一致性。

