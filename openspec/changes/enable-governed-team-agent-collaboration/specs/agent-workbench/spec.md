## ADDED Requirements

### Requirement: Workbench exposes project-host readiness

桌面端 SHALL 在群聊和 Task 中展示当前项目主机、工作区标签、绑定 revision 和在线状态，且不得展示其他设备的本机绝对路径。

#### Scenario: Host is offline
- **WHEN** 用户查看绑定主机离线的群或 Task
- **THEN** 界面显示等待主机状态、受影响的 Run 和恢复条件，并禁用无效的启动操作

### Requirement: Workbench presents task authority and delegation

桌面端 SHALL 根据最新房间角色显示可用的审核与状态操作，并以父子树展示 Agent 委派、预算消耗、负责人和阻塞原因。

#### Scenario: Member views a pending task
- **WHEN** 普通成员打开待审核 Task
- **THEN** 可以查看和评论计划，但看不到可用的批准或启动操作

#### Scenario: Agent delegates a subtask
- **WHEN** 后台确认结构化委派动作
- **THEN** 群聊出现轻量事件，Task 面板在父任务下新增子任务并显示继承权限

### Requirement: Workbench provides an execution approval inbox

桌面端 SHALL 为项目主机所有者提供待审批队列，并显示动作、原因、目标摘要、Agent、Task、约束和决定范围。

#### Scenario: Host owner reviews an approval
- **WHEN** 主机所有者打开待处理命令审批
- **THEN** 可以选择拒绝、仅本次允许或当前 Task 允许，并在确认前看到对应授权范围

#### Scenario: Unauthorized member views approval state
- **WHEN** 非主机所有者查看同一 Task
- **THEN** 只能看到“等待主机授权”的群内状态，不能看到敏感命令详情或审批控件

### Requirement: Workbench shows redacted audit outcomes

桌面端 SHALL 在 Task 时间线中展示调度、授权、执行、拒绝、失败和撤销事件，并默认折叠原始技术诊断。

#### Scenario: Task finishes after delegated work
- **WHEN** 父 Task 完成并进入验收
- **THEN** 用户可以从时间线追踪每个子任务、Agent Run、关键审批和最终产物，且敏感值已脱敏

