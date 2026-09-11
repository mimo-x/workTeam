## 1. 可用性模型

- [x] 1.1 添加 Agent 三态可用性、最后心跳和执行入口的失败回归 Case。
- [x] 1.2 实现纯函数 `AgentAvailability` 派生与可测试的相对心跳格式化。

## 2. 通讯录与 Agent 目录

- [x] 2.1 使用现有 Base UI Tabs 将好友与 Agent 目录分离。
- [x] 2.2 将 Agent 目录分为“我的 Agent”和“公开 Agent”，并接入搜索、三态 Badge、最后心跳和执行提示。
- [x] 2.3 保持 Agent 编辑、创建、好友私聊和可用 Agent 私聊行为不回归。

## 3. 设计与文档

- [x] 3.1 在 design-system 中增加 Agent 三态和目录分组示例。
- [x] 3.2 更新 `docs/agent-workbench.md` 的可用性术语与交互边界。

## 4. 验收

- [x] 4.1 运行相关 BDD、桌面全量测试、Lint、typecheck 和 build。
- [x] 4.2 在 Electron 亮色与暗色主题中复核好友/Agent 切换及三类状态卡片。
