## Why

消息页面已经支持亮色和暗色主题，但新建及管理群组弹窗仍使用固定暗色样式，导致亮色主题下弹窗与应用外壳割裂且部分文字对比度不正确。

## What Changes

- 将群组编辑弹窗迁移到已安装的 shadcn/Base UI Dialog、Input 和 Button 组件。
- 将弹窗容器、成员选项、状态和文字迁移到设计系统语义 token。
- 增加亮色与暗色主题回归 Case，防止弹窗重新引入固定暗色。

## Capabilities

### New Capabilities

### Modified Capabilities

- `message-theme`: 群组创建与管理弹窗跟随应用当前主题。

## Impact

仅修改桌面渲染端的群组弹窗样式和相关测试，不改变群组创建、成员选择、云端同步或 OpenIM 协议。
