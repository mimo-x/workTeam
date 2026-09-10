## Context

应用根节点已经通过 CSS 变量切换亮色和暗色，但 TeamChat 消息页直接声明固定 zinc、black、white 和 cyan 色阶，导致主题变量无法生效。

## Goals / Non-Goals

目标：消息页所有主要表面、文字、边框、状态和交互控件跟随全局主题。范围外：重做消息模型、OpenIM 协议、Agent 设置页和 Task 工作流。

## Decisions

使用现有 `background`、`card`、`secondary`、`muted`、`border`、`foreground`、`primary`、`success`、`warning`、`destructive` token。输入和操作按钮复用项目已安装的 shadcn Textarea、Button 与 Badge；不增加依赖或单独维护暗色覆盖。

## Risks / Trade-offs

状态颜色迁移为语义 token 后会比旧暗色霓虹色更克制，但能保证对比度和主题一致性。回归测试仅约束消息页渲染区，避免阻塞后续独立迁移其他页面。
