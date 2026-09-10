## Purpose

让 Agent 在人工批准的任务边界内自主拆分、分派和复核工作，同时通过持久化父子任务、能力校验和资源预算防止无限循环与越权执行。

## ADDED Requirements

### Requirement: Delegation uses structured persisted actions

系统 SHALL 将 Agent 的委派意图解析为版本化结构化动作，并在校验成功后创建可追踪的父子 Task；聊天中的普通 `@Agent` 文本不得直接赋予执行权限。

#### Scenario: Agent delegates analysis
- **WHEN** 运行中的 Agent 提交有效的子任务动作并指定群内 Agent
- **THEN** 系统创建带 `parentTaskId`、`delegatedByAgentId` 和继承绑定的子 Task，并在任务树和群事件中展示

#### Scenario: Malformed delegation action
- **WHEN** Agent 输出无法验证的动作、未知 Agent ID 或不受支持的动作版本
- **THEN** 系统不创建 Task，并将当前 Run 标记为需要 Agent 修正或人工处理

### Requirement: Assignment respects membership and capabilities

系统 SHALL 只把子 Task 分派给当前群内、可用且声明所需能力的 Agent。

#### Scenario: Agent lacks write capability
- **WHEN** 子 Task 需要 `workspace.write` 但目标 Agent 未声明写能力
- **THEN** 调度器拒绝分派并给出能力不匹配原因

#### Scenario: Agent leaves the room
- **WHEN** 已指定 Agent 在子 Task 开始前被移出群聊
- **THEN** 子 Task 进入 `waiting_for_assignee`，不得继续使用陈旧成员快照执行

### Requirement: Delegation is bounded

系统 SHALL 为根 Task 维护最大委派深度、子任务数、Agent Run 数和运行时长预算，并让所有后代共同消费该预算。

#### Scenario: Budget remains available
- **WHEN** 委派动作在深度、数量、Run 和时间预算内
- **THEN** 系统允许调度并原子地记录预算消耗

#### Scenario: Budget is exhausted
- **WHEN** 新的委派将超过任一预算
- **THEN** 根 Task 及相关子 Task 进入 `waiting_for_budget`，等待管理员扩充预算或结束任务

### Requirement: Concurrent execution protects one workspace

系统 SHALL 允许只读子任务并行，并按工作区绑定串行执行所有可能写入的 Run。

#### Scenario: Two write agents are ready
- **WHEN** 同一绑定工作区的两个可写子任务同时就绪
- **THEN** 系统只租赁一个写 Run，另一个保持排队，直到前者释放写锁

### Requirement: Delegated work produces a reviewable result

系统 SHALL 将子任务状态和产物汇总到父任务，并在包含写入的工作完成后安排具备审查能力的只读 Agent 或进入人工验收。

#### Scenario: Child tasks complete
- **WHEN** 所有必需子 Task 完成且复核通过
- **THEN** 父 Task 进入 `review` 并向来源群发布结果摘要与产物链接

#### Scenario: Child task is blocked
- **WHEN** 必需子 Task 因权限、主机、负责人或执行错误阻塞
- **THEN** 父 Task 不得被标记完成，并显示可操作的阻塞原因

### Requirement: Discussion loops remain non-authoritative

系统 SHALL 保留 Agent Loop 用于轮流讨论，但 Loop 不能创建机器权限或替代正式 Task 审核。

#### Scenario: Loop suggests a code change
- **WHEN** 讨论 Loop 中的 Agent 建议修改代码
- **THEN** 系统只显示建议；必须生成并审核正式 Task 后才能执行写入

