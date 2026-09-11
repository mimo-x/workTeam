## Context

桌面端从 `/v1/agents?scope=available` 同步当前用户拥有的 Agent 与所有公开 Agent。云端 Agent 带有 `runtimeStatus` 和 `runtimeLastSeenAt`，本地内置或旧数据可能没有状态。当前 `ContactsView` 按可见性分组，并把缺失状态显示为“状态未知”；Registry Agent 只要不为 `online` 就禁用私聊。这把身份可发现性、当前设备能力和远程 Host 在线状态混成了一个概念。

## Goals / Non-Goals

目标：让用户能从列表直接判断 Agent 在哪里可执行、状态最近何时确认，并清楚区分好友关系与公开 Agent 发现。范围外：新增 Agent Presence 协议、修改心跳 TTL、自动唤醒其他用户设备、为 hosted Runtime 建设新的托管服务。

## Decisions

- 增加纯函数派生 `AgentAvailability`，以当前桌面视角按以下优先级计算：当前用户拥有且 `executionLocation=local` 的 Agent 为 `local_available`；其余 `runtimeStatus=online` 的 Agent 为 `remote_online`；其他情况为 `no_host`。
- `unknown` 与 `offline` 不再直接作为主文案，而作为 `no_host` 的诊断原因。存在 `runtimeLastSeenAt` 时显示相对时间；不存在时显示“尚无心跳”。相对时间函数显式接收 `now`，保证测试稳定。
- `local_available` 和 `remote_online` 允许进入私聊；`no_host` 禁用执行入口并显示原因。是否公开、是否属于当前用户继续作为独立 Badge 呈现。
- `ContactsView` 使用仓库已有的 Base UI `Tabs`、`Card`、`Badge`、`Button` 和语义 token。好友 Tab 只呈现 Human；Agent 目录 Tab 呈现“我的 Agent”和“公开 Agent”，搜索仅作用于 Agent 目录。
- 设计系统增加三态 Agent 卡片与目录分组示例，`docs/agent-workbench.md` 同步术语。无需新增或覆盖 shadcn 组件。

## Risks / Trade-offs

“本机可用”表示当前桌面具备本地执行路径，不等于 Provider 凭据、模型额度或具体操作权限一定成功；这些失败仍由 Session/Run 层反馈。“远程在线”沿用后台现有心跳状态，可能受网络和刷新时机影响，因此同时展示最后心跳而不声称绝对实时。

## Validation

- 纯函数测试覆盖三态优先级、未知/离线归并、最后心跳和执行入口。
- UI BDD 覆盖 Tabs 分离、我的 Agent/公开目录分组、三态文案及语义组件。
- 运行桌面全量测试、Lint、typecheck、build 和 OpenSpec/仓库门禁。
