## MODIFIED Requirements

### Requirement: Cloud group mentions preserve owner Agent routing

后台同步群的 OpenIM 消息流程 SHALL 将 Human 明确提及的已入群 Agent 路由到该 Agent 所有者当前托管它的一个在线 Host；Agent 完成回复后 SHALL 通过鉴权且幂等的发布通道回到同一群。

#### Scenario: Group member mentions another member's Agent

- **WHEN** Bob 在共享群中发送普通聊天并明确提及 Alice 已获准入群的本机 Agent
- **THEN** 后台只向 Alice 当前托管该 Agent 的一个 Host 发送精确聊天请求
- **AND** Agent 回复以自己的群身份持久发布，使 Alice 和 Bob 都能看到

#### Scenario: Target Agent has no online Host

- **WHEN** 被提及 Agent 没有已注册的在线 Host
- **THEN** 用户消息仍保留在群里，但后台不伪造执行或把请求发送给其他成员设备

#### Scenario: Agent reply or Task proposal is mirrored

- **WHEN** 镜像消息来自 Agent，或 Human 选择规划 Task
- **THEN** 后台不把它当作普通跨用户聊天再次触发 Agent
