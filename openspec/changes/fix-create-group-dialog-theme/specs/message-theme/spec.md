## MODIFIED Requirements

### Requirement: Message surfaces inherit the application theme

消息页、通讯录、Task 面板以及群组创建与管理弹窗 SHALL 使用设计系统语义 token 渲染列表、卡片、编辑器、表单、成员选择、状态和信息栏，且 SHALL NOT 在这些表面中声明固定暗色背景、边框或正文颜色。

#### Scenario: Light group dialog

- **WHEN** 用户在亮色主题的消息页面打开新建或管理群组弹窗
- **THEN** 弹窗、输入框、Agent 成员和好友成员使用亮色主题表面及可读文字

#### Scenario: Dark group dialog

- **WHEN** 用户在暗色主题的消息页面打开新建或管理群组弹窗
- **THEN** 相同弹窗结构通过语义 token 自动显示暗色主题

#### Scenario: Preserve group editing behavior

- **WHEN** 用户编辑群名称和成员并保存
- **THEN** 现有本地或云端群组保存规则保持不变
