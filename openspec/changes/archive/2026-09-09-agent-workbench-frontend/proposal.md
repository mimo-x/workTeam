## Why

当前桌面端以消息和 Codex 模型选择为中心，无法清晰表达 Agent 来源、Runtime、能力、Session 状态和执行错误。随着内置与自定义 Agent 增加，需要把桌面端变成可发现、可配置、可审批和可诊断的 Agent 工作台。

## What Changes

- 增加 Agent Registry 浏览、搜索、详情和授权入口。
- 展示内置/注册 Agent、Runtime、能力、在线状态和支持边界。
- 增加 Session/Task 执行状态、错误详情、重试和取消入口。
- 保持项目工作区、人工审批和消息协作作为核心工作流。
- 明确旧模型失败提示，不自动切换模型。

## Capabilities

### New Capabilities

- \`agent-workbench\`: 提供 Agent 发现、配置、运行状态和诊断体验。

### Modified Capabilities

## Impact

- 影响 \`src/renderer/src/app.tsx\`、\`src/renderer/src/team-chat.tsx\` 及 preload API。
- 依赖 Agent Manifest、Runtime 能力和 Session 状态设计。
- 需要补充桌面端交互测试和错误可读性验证。
