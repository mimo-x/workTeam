## Purpose

为多人协作房间提供可验证的角色与授权边界，使聊天、任务审核和项目主机操作由正确的人控制，并阻止普通成员借助 Agent 绕过这些边界。

## ADDED Requirements

### Requirement: Room roles control governed actions

系统 SHALL 对房间成员使用 `owner`、`admin` 和 `member` 角色，并在服务端校验所有受治理操作；客户端隐藏按钮不得作为授权依据。

#### Scenario: Member requests work
- **WHEN** 普通成员在群内提出需求或要求 Agent 生成 Task 草案
- **THEN** 系统保存请求和草案，但不允许该成员审核、启动或改变 Task 的受治理状态

#### Scenario: Administrator reviews work
- **WHEN** 房间 owner 或 admin 审核当前 Task revision
- **THEN** 系统接受该审核并记录审核人的身份、角色和时间

#### Scenario: Unauthorized lifecycle mutation
- **WHEN** 普通成员直接调用 Task 审核、启动或受治理状态变更接口
- **THEN** 系统返回权限错误且不改变 Task、Run 或授权记录

### Requirement: Task authority and host authority remain separate

系统 SHALL 将任务范围审核与项目主机权限批准视为两个独立授权，任何一方不得替代另一方。

#### Scenario: Approved task lacks host grant
- **WHEN** owner 或 admin 已批准一个需要电脑操作的 Task，但项目主机所有者尚未批准权限包络
- **THEN** Task 保持等待授权状态且不得开始机器侧执行

#### Scenario: Host owner cannot approve task scope
- **WHEN** 项目主机所有者不是房间 owner 或 admin，并尝试批准 Task 业务范围
- **THEN** 系统拒绝该操作，同时仍允许其处理发往自己设备的执行权限请求

### Requirement: Role changes invalidate stale authority

系统 SHALL 在成员被移除或失去管理角色后立即拒绝其新的受治理操作，不得依赖客户端刷新。

#### Scenario: Administrator is demoted
- **WHEN** 已打开客户端的 admin 被降级为 member 后提交审核请求
- **THEN** 服务端依据最新角色拒绝请求

