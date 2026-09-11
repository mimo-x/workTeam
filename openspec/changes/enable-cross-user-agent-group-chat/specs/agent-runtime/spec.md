## MODIFIED Requirements

### Requirement: Runtime supports governed cross-user chat

本机 Runtime SHALL 接受服务端为当前用户自有本机 Agent 定向的群聊请求，并 SHALL 将显式目标作为权威范围；普通聊天 SHALL 使用非 Task 的只读 Session，不能获得写入、命令执行或 Task 审批权限。

#### Scenario: Owner Host receives a member chat request

- **WHEN** 在线 Host 收到包含房间、消息、Human 发送者和单一自有 Agent ID 的 `agent.chat.requested`
- **THEN** 桌面端以服务端消息 ID 幂等写入上下文并只调度该 Agent 一次

#### Scenario: Event targets another user's Agent

- **WHEN** 事件目标不属于当前用户或不在本机执行
- **THEN** 当前桌面不启动 Runtime

#### Scenario: Member requests computer operations in ordinary chat

- **WHEN** 群成员通过普通聊天要求 Agent 写文件、运行命令或操作电脑
- **THEN** Runtime 不获得相应能力，操作必须转为受治理 Task 并等待所需授权
