## Why

消息页、通讯录和 Task 面板仍使用上一版固定暗色样式，导致设置中心选择亮色后只有应用外壳切换主题，页面内部区域继续显示深色。

## What Changes

- 将消息页、通讯录和 Task 面板的列表、卡片、输入区与状态迁移到设计系统语义色。
- 使用现有 shadcn 控件承载页面交互，保留当前消息、好友、Agent 与 Task 逻辑。
- 增加亮色主题回归测试和真实 Electron 视觉验证。

## Capabilities

### New Capabilities

- `message-theme`: 消息、通讯录和 Task 页面跟随应用亮色和暗色主题。

### Modified Capabilities

## Impact

仅修改桌面渲染端页面样式与相关测试，不改变消息协议、OpenIM 数据、好友数据或 Agent 执行流程。
