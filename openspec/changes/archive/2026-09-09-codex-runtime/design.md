## Context

当前 CodexAppServer 已负责进程发现、JSONL RPC、模型列表、审批和事件，但 AgentTeam/RemoteHost 直接持有该类。Runtime 抽象完成后需要将其包装而不是重写。

## Goals / Non-Goals

**Goals:**

- 提供完整 CodexRuntime 参考实现。
- 保持已有本地 Codex 用户的行为和配置兼容。
- 保留结构化原始错误。

**Non-Goals:**

- 不实现 Codex CLI 安装器。
- 不自动降级或过滤用户选择的 Model。
- 不改变 Codex 的审批策略。

## Decisions

- CodexRuntime 组合现有 CodexAppServer，避免复制 JSONL RPC 实现。
- Runtime 层保存 Provider thread 映射，业务层只依赖 Session。
- 模型列表作为能力提示，不作为请求前硬阻断；最终以 Provider 响应为准。
- Provider 错误映射为统一错误后仍保留原始 JSON/文本诊断。

## Risks / Trade-offs

- [Codex CLI 版本事件字段变化] -> 对未知事件保留原始 payload，并增加兼容测试。
- [模型列表与实际账号能力不一致] -> 允许请求后由 Provider 返回明确错误。
