## Purpose

为每个协作群及其任务确定唯一、私密且可恢复的项目执行环境，确保所有 Agent 对同一份工作区操作，并避免向其他群成员泄露本机路径。

## ADDED Requirements

### Requirement: Group work uses one active project host binding

系统 SHALL 允许房间 owner 或 admin 选择一个在线设备提供的工作区绑定，并保证任一时刻每个普通群只有一个活动绑定。

#### Scenario: Bind a project host
- **WHEN** 房间 owner 或 admin 选择一个由设备所有者公开给该房间的工作区绑定
- **THEN** 系统保存设备、工作区标识、展示标签和版本，并向群成员显示绑定已就绪

#### Scenario: Bind another user's private path
- **WHEN** 非设备所有者尝试提交或修改该设备的本机绝对路径
- **THEN** 系统拒绝请求且不返回真实路径

### Requirement: Tasks inherit an immutable binding revision

系统 SHALL 在 Task 创建时记录来源群当前的工作区绑定及其 revision，并使用该快照路由全部 TaskRun。

#### Scenario: Room is rebound during a task
- **WHEN** 群在已有 Task 存续期间切换项目主机或工作区
- **THEN** 旧 Task 不得静默迁移，并进入需要重新确认绑定与权限的等待状态

#### Scenario: Child task is delegated
- **WHEN** Agent 在已批准 Task 内创建子 Task
- **THEN** 子 Task 继承相同的主机、工作区和绑定 revision

### Requirement: Execution routes to the bound device

系统 SHALL 将需要工作区访问的 TaskRun 只租赁给绑定设备，而不是按 Agent 所有者的任意在线设备分发。

#### Scenario: Agent owner uses another device
- **WHEN** Agent 所有者的非绑定设备在线并注册了该 Agent
- **THEN** 该设备不得获得此 TaskRun

#### Scenario: Bound host is offline
- **WHEN** Task 已获批准但绑定设备离线
- **THEN** Task 进入 `waiting_for_host`，设备恢复后从未完成的幂等 Run 继续

### Requirement: Binding metadata protects local secrets

系统 SHALL 只向群成员公开工作区标签、仓库标识、主机所有者和在线状态，本机路径与本地凭据仅在绑定设备上保存。

#### Scenario: Member reads room snapshot
- **WHEN** 普通成员获取含工作区绑定的房间快照
- **THEN** 响应不包含绝对路径、环境变量、凭据或主机私有配置

