# agent-task-delegation Delta Specification

## MODIFIED Requirements

### Requirement: Delegated work produces a reviewable result

系统 SHALL 将子 Task 的完成摘要、状态和产物汇总到父 Task。仅当根 Task 由管理员首次人工验收为 `done` 后，系统 SHALL 向来源群发布一条持久、可关联原 Task 的脱敏结果摘要；进入 `review`、完成子 Task 或重复验收均不得重复发布。

#### Scenario: Child tasks complete

- **GIVEN** 根 Task 含一个或多个子 Task
- **WHEN** 所有必需子 Task 完成
- **THEN** 父 Task 进入 `review` 并聚合子 Task 摘要与产物，但来源群不新增结果消息

#### Scenario: Root Task is accepted

- **GIVEN** 根 Task 已进入 `review` 且包含已有 Agent 结果
- **WHEN** 群主或管理员首次将其验收为 `done`
- **THEN** 本地或云端来源群新增一条包含 Task 标题、完成摘要、产物引用和 Task ID 的持久结果消息

#### Scenario: Acceptance is repeated

- **GIVEN** 根 Task 的结果摘要已经发布
- **WHEN** 客户端重试相同的完成请求或消息投递被重试
- **THEN** 应用数据中仍只有一条该 Task 的来源群结果消息

#### Scenario: Child task is blocked

- **WHEN** 必需子 Task 因权限、主机、负责人或执行错误阻塞
- **THEN** 父 Task 不得被标记完成，并显示可操作的阻塞原因
