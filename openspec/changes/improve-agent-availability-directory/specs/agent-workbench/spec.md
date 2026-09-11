## MODIFIED Requirements

### Requirement: User can discover and compare Agents

桌面端 SHALL 将好友通讯录与 Agent 目录作为独立视图呈现；Agent 目录 SHALL 区分当前用户拥有的 Agent 与其他用户公开的 Agent，并展示来源、Runtime、能力、权限、可执行位置、最后心跳和版本。

#### Scenario: User opens contacts

- **WHEN** 用户进入通讯录
- **THEN** 用户可在“好友”和“Agent 目录”之间切换，好友视图不混入公开 Agent

#### Scenario: User opens the Agent directory

- **WHEN** 用户进入 Agent 目录
- **THEN** 页面分别展示“我的 Agent”和“公开 Agent”，搜索只过滤 Agent 条目

#### Scenario: Agent availability differs by execution location

- **WHEN** 页面同时包含本机 Agent、在线远程 Agent 和没有 Host 的 Agent
- **THEN** 卡片分别显示“本机可用”“远程在线”“暂无执行主机”，并只为前两者开放执行入口
