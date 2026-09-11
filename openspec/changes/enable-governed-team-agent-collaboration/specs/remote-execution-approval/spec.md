## Purpose

将远程 TaskRun 产生的 Runtime 审批可靠地送达项目主机所有者，并把明确决定返回原执行会话，同时保留可追踪且不泄密的审计记录。

## ADDED Requirements

### Requirement: Runtime approval suspends the exact run

系统 SHALL 为 Runtime 审批创建持久化请求，并关联 Task、revision、Run、Session、Turn、Agent、绑定设备和 Runtime request ID。

#### Scenario: Remote command needs approval
- **WHEN** 绑定主机上的 Runtime 在远程 TaskRun 中请求命令审批
- **THEN** Run 进入 `waiting_for_approval`，审批只发送给绑定设备所有者，并保持 Runtime 会话可恢复

#### Scenario: Another run receives a decision
- **WHEN** 审批决定的 Run、Turn 或 Runtime request ID 与当前等待项不匹配
- **THEN** Agent Host 拒绝该决定且不恢复任何执行

### Requirement: Only the host owner resolves execution approvals

系统 SHALL 只接受当前绑定设备所有者对待处理执行审批的决定。

#### Scenario: Room administrator is not host owner
- **WHEN** 非主机所有者的房间管理员尝试批准本机敏感操作
- **THEN** 系统拒绝请求并保留待审批状态

### Requirement: Approval scope is explicit

系统 SHALL 支持 `deny`、`allow_once` 和 `allow_for_task` 决定；`allow_for_task` 只能签发与当前请求相同或更窄的约束。

#### Scenario: Approve once
- **WHEN** 主机所有者选择仅本次允许
- **THEN** 系统只恢复对应 Runtime request，不为后续操作创建可复用授权

#### Scenario: Approve for task
- **WHEN** 主机所有者选择当前 Task 内允许
- **THEN** 系统创建匹配当前 Task revision 和约束的授权，并恢复对应请求

### Requirement: Approval failures are safe and visible

系统 SHALL 在拒绝、超时、授权撤销、客户端断线或 Host 重启时保持安全默认，并向群内暴露可读阻塞状态。

#### Scenario: Approval times out
- **WHEN** 待审批请求超过有效期仍未处理
- **THEN** 请求变为 `expired`，Runtime 收到拒绝或 Run 安全失败，不得自动批准

#### Scenario: Host reconnects
- **WHEN** 绑定设备在审批等待期间重连
- **THEN** 系统重新下发仍有效的请求，但不得创建重复审批或重复执行

### Requirement: Approval audit is redacted

系统 SHALL 记录请求、决定和结果，同时对 Token、环境变量值、私有指令及其他已识别秘密进行脱敏。

#### Scenario: Room member views audit
- **WHEN** 群成员查看一个已完成审批的审计事件
- **THEN** 可以看到动作类别、目标摘要、请求者、批准者和结果，但看不到秘密值或主机绝对路径

