## Why

通讯录目前把好友、自己的 Agent 和所有公开 Agent 放在同一条页面信息流中，并直接展示后台的 `online`、`offline`、`unknown`。用户难以判断一个 Agent 是“当前电脑可以直接执行”“需要远程 Host”还是“只有可发现身份但没有执行主机”，也看不到状态最近一次被确认的时间。

## What Changes

- 将通讯录拆成“好友”和“Agent 目录”两个明确入口；Agent 目录再区分“我的 Agent”和“公开 Agent”。
- 将原始 Runtime 状态映射为面向用户的三类可用性：“本机可用”“远程在线”“暂无执行主机”。
- 在 Agent 卡片中展示状态依据和最后心跳时间；从未收到心跳时明确显示“尚无心跳”。
- 让私聊按钮依据可执行性而不是原始 `unknown` 字段决定是否可用，并保留离线原因提示。
- 在设计系统和 Agent Workbench 文档中记录目录结构、状态文案和组件用法。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-registry`: 目录继续区分可发现性与可执行性，并向用户解释 Runtime 状态来源。
- `agent-workbench`: 通讯录与 Agent 目录分离，Agent 卡片展示可执行位置和最后心跳。

## Impact

主要修改桌面端 Agent 可用性派生逻辑、通讯录页面、相关回归测试、设计系统和工作台文档。不改变 Agent Host 心跳协议、后台数据库字段、任务权限或跨设备调度方式。
