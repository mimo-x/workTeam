## Purpose

确保桌面端消息页与应用全局主题保持一致，不因固定暗色样式破坏亮色模式。

## ADDED Requirements

### Requirement: Message surfaces inherit the application theme

消息页、通讯录和 Task 面板 SHALL 使用设计系统语义 token 渲染列表、卡片、编辑器、状态和信息栏，且 SHALL NOT 在这些主要表面中声明固定暗色背景、边框或正文颜色。

#### Scenario: Light appearance

- **WHEN** 用户选择亮色主题并打开任意消息会话
- **THEN** 会话列表、聊天区、编辑器和信息栏显示亮色主题表面及可读文字

#### Scenario: Dark appearance

- **WHEN** 用户选择暗色主题并打开任意消息会话
- **THEN** 相同组件通过语义 token 自动显示暗色主题，无需独立结构或手工覆盖

#### Scenario: Light contacts and task views

- **WHEN** 用户选择亮色主题并打开通讯录或 Task 面板
- **THEN** 页面顶栏、列表、卡片、状态和操作显示亮色主题表面及可读文字
