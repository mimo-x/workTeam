## Purpose

确保 Agent 创建和编辑界面与应用全局主题保持一致。

## ADDED Requirements

### Requirement: Agent settings inherit application theme

Agent 设置弹窗 SHALL 使用设计系统语义 token 和已安装的 shadcn 组件渲染弹窗、列表、表单和操作。

#### Scenario: Light appearance

- **WHEN** 用户在亮色主题打开 Agent 设置弹窗
- **THEN** 弹窗和所有表单区域显示亮色主题表面及可读文字

#### Scenario: Dark appearance

- **WHEN** 用户在暗色主题打开 Agent 设置弹窗
- **THEN** 同一组件通过语义 token 自动显示暗色主题
