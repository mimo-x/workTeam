## Context

仓库尚未接入 OpenCode，不能假设它的协议、安装路径或事件字段。该 change 依赖 Runtime 抽象和 Session 模型。

## Goals / Non-Goals

**Goals:**

- 交付经过版本验证的 OpenCode Runtime。
- 支持其真实可用的本地 Server 或 CLI 模式。
- 保持工作区和权限边界。

**Non-Goals:**

- 不同时实现所有 OpenCode 运行模式。
- 不把 OpenCode 私有协议暴露给 AgentTeam。
- 不在能力未知时假设支持审批或 Skills。

## Decisions

- 先选择一个稳定、可自动化测试的连接模式作为 MVP。
- 将安装检测、版本检测和 Provider 事件处理封装在 OpenCodeRuntime。
- 以能力清单驱动桌面端操作可用性，失败时显示明确原因。

## Risks / Trade-offs

- [Server 与 CLI 模式差异大] -> MVP 固定一种模式，其他模式列为后续扩展。
- [本地端口或进程生命周期不稳定] -> Runtime 管理健康检查、超时和退出诊断。
