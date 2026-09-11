## Purpose

为 Agent 任务提供按风险分级、绑定具体版本且不可隐式扩大的权限包络，使自动协作保持顺畅，同时让电脑所有者掌握真实操作边界。

## ADDED Requirements

### Requirement: Machine work requires a valid permission grant

系统 SHALL 在开始或恢复机器侧执行前校验一个未过期、未撤销且匹配 Task revision、绑定设备与工作区的权限授权。

#### Scenario: Read-only task uses room baseline
- **WHEN** Task 只请求已由主机所有者授予该群的工作区只读能力
- **THEN** 系统允许执行而不产生重复审批

#### Scenario: Write task has only business approval
- **WHEN** Task 计划已由群管理员审核，但没有主机所有者签发的工作区写授权
- **THEN** 系统不得创建可写 Runtime Session

### Requirement: Grants use explicit risk scopes

系统 SHALL 使用明确的 `workspace.read`、`workspace.write`、`command.run` 和 `network.read` 权限范围，并为命令、路径和域名保留约束；未声明能力一律视为禁止。

#### Scenario: Command matches task constraint
- **WHEN** Agent 请求的命令、cwd 和参数满足当前 Task 授权的命令约束
- **THEN** 系统允许操作并写入审计记录

#### Scenario: Action exceeds constraint
- **WHEN** Agent 请求工作区外路径、未知命令、未批准域名或凭据使用
- **THEN** 系统暂停 Run 并生成一次执行审批，不得把 Agent 文本视为授权

### Requirement: Grant lifetime follows task revision and binding

系统 SHALL 在 Task 计划、requested scopes、执行绑定或 Task revision 变化时使旧授权失效。

#### Scenario: Approved plan is edited
- **WHEN** 已授权 Task 的目标、计划、执行 Agent、权限或工作区发生变化
- **THEN** 系统递增 revision、撤销活动授权并要求重新审核和授权

#### Scenario: Grant expires or is revoked
- **WHEN** 授权到期或主机所有者主动撤销授权
- **THEN** 后续机器操作被暂停，已经完成的审计记录保持可查

### Requirement: Delegation cannot expand authority

系统 SHALL 令子 Task 的有效权限为父 Task 授权与子 Task 请求权限的交集。

#### Scenario: Child asks for broader access
- **WHEN** Agent 创建的子 Task 请求父任务未包含的写、命令或网络范围
- **THEN** 子 Task 进入 `waiting_for_permission`，父任务授权不得自动扩大

### Requirement: Local-only mode follows the same rules

系统 SHALL 在本地模式下使用同一授权状态机，并将本地用户同时视为房间管理员和主机所有者。

#### Scenario: Local user approves a write task
- **WHEN** 本地用户审核并授权一个可写 Task
- **THEN** 系统创建与该 Task revision 绑定的授权，而不是全局开启自动批准

