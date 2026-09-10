## Context

Registry 和 Runtime 抽象分别解决发现和编排，外部 Agent 还需要可互操作的协议。项目当前已有 HTTP 后台客户端和本地 Codex 子进程，可复用认证、超时和事件诊断模式。

## Goals / Non-Goals

**Goals:**

- 以 HTTP 作为远程自定义 Agent 的 MVP 协议。
- 以 JSONL 作为本地 CLI 的 MVP 协议。
- 统一 Manifest、Session、事件和错误 envelope。
- 默认拒绝远程 Agent 访问本机文件和命令。

**Non-Goals:**

- 不在本 change 支持任意文本 CLI 输出解析。
- 不把 MCP 或 OpenIM 强行定义为完整 Agent 生命周期协议。
- 不允许注册中心保存第三方明文密钥。

## Decisions

- Manifest 与执行 endpoint 分离，公开发现信息不包含私密认证材料。
- HTTP 事件使用 SSE 或等价可重连通道；CLI 使用 stdin/stdout JSONL、stderr 日志。
- 所有请求携带 request/session/turn/delivery ID，并要求幂等处理。
- Runtime 在桌面端或服务端做能力和授权二次校验。

## Risks / Trade-offs

- [外部 Agent 协议版本分裂] -> Manifest 声明 protocolVersion，并维护兼容矩阵。
- [远程 endpoint 失控] -> HTTPS、域名/证书校验、超时、大小限制和显式用户授权。
