## Context

AgentSettings 目前把 `agents` 直接作为编辑草稿，并用 `initialAgentId` 选择已有 Agent。通讯录创建按钮没有表达“创建模式”，所以打开弹窗后不会新增草稿。

## Decisions

- 使用纯函数集中生成默认 Agent 草稿，统一 ID、提及名、权限、Runtime 和本地数量上限。
- AgentSettings 增加创建模式；创建模式初始化时追加并选中新草稿。
- 通讯录编辑入口仍然只选择已有 Agent，避免编辑行为产生额外草稿。
- 保存流程继续使用现有 `saveAgents`，不改变本地或云端持久化协议。

## Validation

- BDD 用例覆盖通讯录创建入口、默认 Agent 草稿、24 个本地 Agent 上限、保存恢复和 Runtime 类型。
- 运行桌面测试、lint、typecheck、build 与 Bug 门禁。
