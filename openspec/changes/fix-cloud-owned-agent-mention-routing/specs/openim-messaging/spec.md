## ADDED Requirements

### Requirement: Cloud group mentions preserve local Agent routing

后台同步群的 OpenIM 发送流程 SHALL 在消息投递成功后，将当前用户拥有且运行在本机的被提及 Agent ID、当前模型和触发意图传递给本机编排器，同时保持消息的 OpenIM 外部 ID 与原群映射。

#### Scenario: Mention targets an owned local Agent

- **WHEN** 用户在后台同步群中发送普通 `@Agent` 消息且目标属于当前用户并运行在本机
- **THEN** OpenIM 消息正常发送，本机编排器收到同一条消息和精确 Agent ID，并启动聊天回复

#### Scenario: Mention targets no locally runnable Agent

- **WHEN** 消息只提及其他用户 Agent 或 hosted Agent
- **THEN** 消息仍正常进入群聊，但当前桌面不启动本机 Runtime

### Requirement: Cloud Agent replies are authorized and idempotent

后台同步群的 Agent 回复 SHALL 通过当前用户登录态提交给后台；后台 SHALL 仅允许房间成员以其自有、已入群且执行位置为本机的 Agent 身份发布，并 SHALL 以桌面生成的 delivery ID 保证重试幂等。

#### Scenario: Owned local Agent publishes a reply

- **WHEN** 房间成员提交其自有本机 Agent 的完成回复
- **THEN** 后台接受请求并向原群创建一次 OpenIM Outbox 消息

#### Scenario: Another user attempts Agent impersonation

- **WHEN** 房间成员尝试以其他用户拥有的 Agent 身份发布消息
- **THEN** 后台拒绝请求且不创建 Outbox 消息

#### Scenario: Desktop retries the same reply

- **WHEN** 同一 Agent 回复使用相同 delivery ID 重试
- **THEN** 后台返回已接受但只保留一条待投递消息
