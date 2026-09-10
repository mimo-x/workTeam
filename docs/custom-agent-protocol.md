# Custom Agent Protocol

自定义 Agent 使用版本化 Manifest 声明身份、传输方式和能力。当前协议版本为 `1`，支持远程 HTTP 和本地 CLI JSONL 两种 Runtime。

## Manifest

```json
{
  "protocolVersion": 1,
  "agentId": "review-agent",
  "name": "代码审查员",
  "version": "1.0.0",
  "capabilities": ["chat", "stream_progress", "read_workspace"],
  "transport": "http",
  "endpoint": "https://agent.example.com",
  "auth": "bearer"
}
```

远程 endpoint 必须使用 HTTPS；`localhost`、`127.0.0.1` 和 `::1` 可用于开发。Manifest 的能力声明不等于本机授权，桌面端仍会根据用户、工作区和审批策略二次校验。

## HTTP Runtime

- `POST /sessions` 创建 Session，body 包含 `model` 和 `access`；恢复已有上下文时可带 `sessionId`，返回 `{ "sessionId": "..." }`。
- `POST /sessions/:sessionId/turns` 发送输入，body 包含 `text`、`model` 和 `skills`，返回 `{ "turnId": "..." }`。
- `GET /sessions/:sessionId/events?turnId=...` 使用 SSE 返回事件。
- `POST /sessions/:sessionId/turns/:turnId/steer` 追加上下文。
- `POST /sessions/:sessionId/turns/:turnId/cancel` 取消 Turn。
- `POST /approvals/:requestId` 提交审批结果。

每个请求使用 Bearer Token（若 Manifest 声明需要认证），响应必须是 JSON，错误使用 `{ "error": { "message": "..." } }` 并保留 request/session/turn 标识。

桌面端在 Agent 设置中录入 Bearer Token。Token 使用系统安全存储保存在本机；云端 Agent 的 Token 以服务端密文保存，只会在该 Agent 所有者的受控执行租约中下发，不进入工作区快照或公开 Manifest。

SSE `data` 是 JSON 事件：

```json
{
  "type": "message.completed",
  "sessionId": "session-1",
  "turnId": "turn-1",
  "data": { "text": "完成" }
}
```

支持的事件类型包括 `message.delta`、`message.completed`、`activity`、`approval.requested`、`turn.completed` 和 `turn.failed`。

## CLI JSONL Runtime

Runtime 启动 Manifest 中的 `command` 和 `args`，通过 stdin 发送 JSONL，通过 stdout 接收 JSONL；stderr 只作为诊断日志。

客户端发送：

- `session.start`
- `turn.start`
- `turn.steer`
- `turn.cancel`
- `approval.resolve`

Agent 必须先返回 `session.started`，客户端才认为 Session 创建成功。Turn 使用 `message.delta`、`message.completed`、`activity`、`turn.completed` 或 `turn.failed` 回报。非 JSON stdout 不会被当作成功结果；CLI 非零退出会让活动 Turn 失败并包含退出码和 stderr 摘要。

远程自定义 Agent 默认不会收到本机工作区路径，只有显式启用工作区引用时才会发送 `workspaceRef`。不要通过普通消息传输凭证或私有提示词。
