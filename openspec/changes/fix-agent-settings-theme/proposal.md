## Why

Agent 设置弹窗未继承应用亮色主题，导致创建和编辑 Agent 时出现突兀的整块深色界面。

## What Changes

- 使用 shadcn Dialog 承载 Agent 设置弹窗。
- 将 Agent 列表、表单、状态与操作迁移到语义主题和现有 shadcn 组件。
- 增加 Agent 设置主题回归测试。

## Impact

仅修改桌面渲染端 Agent 设置界面，不改变 Agent 数据、Runtime 凭证或保存流程。
