# Agent Workbench UI

桌面端以项目工作区、消息、Task 和执行结果为主线。Agent 目录展示身份与能力，Runtime 详情展示执行方式，Session/Run 展示一次工作的实时状态。

## 状态矩阵

| 层级    | 状态            | 行为                                                |
| ------- | --------------- | --------------------------------------------------- |
| Agent   | builtin         | 显示内置 Provider，可直接配置角色和权限             |
| Agent   | registry        | 显示来源、Provider、Protocol 和授权归属             |
| Runtime | online          | 允许发起适用能力的 Session                          |
| Runtime | offline         | 仍可发现，但禁用执行入口并显示离线原因              |
| Runtime | unknown         | 显示状态未知；本地内置 Runtime 不因未知状态被误禁用 |
| Session | pending/running | 显示活动状态，可在有 Turn 时取消                    |
| Session | waiting         | 表示本轮结束但会话可继续，不把 Session 当成终态     |
| Session | failed          | 显示可读错误和原始 Provider 诊断                    |
| Session | cancelled       | 显示已取消，不接受迟到事件覆盖                      |

## 交互边界

- 用户选择的 Runtime 和 Model 原样传给 Provider；Provider 拒绝时不自动切换。
- 能力不足在执行前显示 unsupported；能力声明不替代工作区权限和人工审批。
- Agent 的私有指令、密钥和本机路径不进入公开目录。
- 自定义 HTTP Agent 的 Bearer Token 只能在主进程安全存储或服务端密文中保存，界面不回显已有 Token。
- Task 卡片显示最近 Session 的 Provider、状态和错误；消息气泡保留 Run/Session 关联。
- 所有异步状态都需要 loading、offline、timeout、permission denied 和 retry 状态。

## 视觉约束

现有界面使用深色、紧凑、开发者工具风格和 Lucide 图标。新增信息使用固定尺寸的状态行和短标签，默认展示摘要，原始诊断按需展开；交互控件保持键盘焦点、可读对比度和 150-300ms 状态过渡。
