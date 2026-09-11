## MODIFIED Requirements

### Requirement: Runtime supports session execution

Runtime SHALL 支持创建或恢复 Session、发送一轮输入、取消执行，并返回稳定的 Session 和 Turn 标识；后台同步群中的普通聊天提及 SHALL 能在发送者桌面为其拥有的本机 Agent 创建聊天 Run。

#### Scenario: Owner mentions a local Agent in a cloud group

- **WHEN** 用户在后台同步群中发送包含自己本机 Agent 的普通提及消息
- **THEN** 当前桌面只为显式目标集合中的自有本机 Agent 创建一次聊天 Run
- **AND** 完成回复通过与房间来源匹配的 OpenIM Agent 发布通道返回原群

#### Scenario: Message also mentions another user's Agent

- **WHEN** 同一消息正文还包含其他用户拥有的 Agent 提及
- **THEN** 当前桌面不得把正文解析结果用于扩大显式的本机执行目标
