## MODIFIED Requirements

### Requirement: Availability is separate from discoverability

注册中心 SHALL 分别表示 Agent 是否可被发现、是否属于当前用户、执行位置以及 Runtime 最近一次在线状态；桌面端 SHALL 基于这些字段解释当前设备可用性，而不是把目录存在等同于可执行。

#### Scenario: Owned local Agent has no registry heartbeat

- **WHEN** 当前用户拥有的本机 Agent 没有 Runtime 心跳状态
- **THEN** Agent 仍显示为“本机可用”，且状态详情说明执行位置在当前设备

#### Scenario: Public Agent has an online Runtime

- **WHEN** 其他用户的公开 Agent 报告 Runtime 在线
- **THEN** 目录显示“远程在线”并允许发起私聊

#### Scenario: Discoverable Agent has no execution host

- **WHEN** 公开 Agent 状态为 offline、unknown 或缺失
- **THEN** Agent 仍可被发现，但显示“暂无执行主机”，执行入口禁用且不伪造在线

#### Scenario: Runtime heartbeat metadata is available

- **WHEN** Agent 带有最近心跳时间
- **THEN** 目录以用户可读方式显示最后确认时间；从未收到心跳时显示“尚无心跳”
