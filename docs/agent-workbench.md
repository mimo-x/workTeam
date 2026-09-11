# Agent Workbench UI

桌面端以项目工作区、消息、Task 和执行结果为主线。通讯录将好友关系与 Agent 发现分开；Agent 目录展示身份、能力与面向当前设备的可用性，Runtime 详情展示执行方式，Session/Run 展示一次工作的实时状态。

## 状态矩阵

| 层级         | 状态                   | 行为                                                             |
| ------------ | ---------------------- | ---------------------------------------------------------------- |
| Agent        | builtin                | 显示内置 Provider，可直接配置角色和权限                          |
| Agent        | registry               | 显示来源、Provider、Protocol 和授权归属                          |
| 可用性       | 本机可用               | 当前用户拥有且在当前设备执行；不依赖远程心跳，允许发起私聊与执行 |
| 可用性       | 远程在线               | 远程 Runtime 最近确认在线，展示最后心跳并允许发起私聊与执行      |
| 可用性       | 暂无执行主机           | Agent 仍可发现，展示离线原因和最后心跳，但禁用执行入口           |
| Runtime 诊断 | online/offline/unknown | 作为可用性派生依据和诊断信息，不直接作为 Agent 卡片的用户主状态  |
| Session      | pending/running        | 显示活动状态，可在有 Turn 时取消                                 |
| Session      | waiting                | 表示本轮结束但会话可继续，不把 Session 当成终态                  |
| Session      | failed                 | 显示可读错误和原始 Provider 诊断                                 |
| Session      | cancelled              | 显示已取消，不接受迟到事件覆盖                                   |

## 通讯录信息架构

- “好友”只展示 Human 联系人及其在线状态，并承载好友管理与私聊入口。
- “Agent 目录”只展示 Agent，分为当前用户拥有的“我的 Agent”和其他用户可发现的“公开 Agent”。自己的公开 Agent 不会重复出现在公开分组。
- Agent 搜索仅过滤 Agent 目录，不影响好友列表。
- 每张 Agent 卡片同时展示所有权/可见性、执行位置、面向用户的可用性状态，以及“最后心跳”或“尚无心跳”。

## 交互边界

- 用户选择的 Runtime 和 Model 原样传给 Provider；Provider 拒绝时不自动切换。
- 能力不足在执行前显示 unsupported；能力声明不替代工作区权限和人工审批。
- Agent 的私有指令、密钥和本机路径不进入公开目录。
- “本机可用”只代表当前设备存在本地执行路径，不承诺 Provider 凭据、模型额度或具体操作权限一定可用；后续失败仍由 Session/Run 层反馈。
- “远程在线”来自注册中心最近心跳，可能受网络与刷新时机影响，因此必须和最后心跳时间一起展示。
- `offline`、`unknown` 或缺失状态不会让公开 Agent 从目录消失，而是统一呈现为“暂无执行主机”并禁用执行入口。
- 自定义 HTTP Agent 的 Bearer Token 只能在主进程安全存储或服务端密文中保存，界面不回显已有 Token。
- Task 卡片显示最近 Session 的 Provider、状态和错误；消息气泡保留 Run/Session 关联。
- 所有异步状态都需要 loading、offline、timeout、permission denied 和 retry 状态。

## 视觉约束

界面使用语义颜色、紧凑的导航密度和 Lucide 图标，同时支持亮色与暗色主题。可用性使用短 Badge 文案并辅以执行位置和心跳文字，不能只依赖颜色区分；原始诊断按需展开，交互控件保持键盘焦点、可读对比度和 150-300ms 状态过渡。
