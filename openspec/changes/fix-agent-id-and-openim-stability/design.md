## Context

后台 Agent 路由在 `:id` 参数处执行 UUID 校验。桌面端的 `AgentDefinition.id` 在本地模式下可以是 `agent_coder`，而云端记录的业务 ID 才是 UUID；`cloudAgentId` 可能来自历史本地数据，不能仅凭字段存在判断其有效性。

## Decisions

- 用严格的 RFC 4122 UUID 格式判断云端 ID，所有 UI 请求在构造路径或请求体前使用同一个解析函数。
- 无效的历史映射按本地 Agent 处理；在需要加入云端群或建立云端私聊时先通过 `POST /v1/agents` 创建有效云端记录。
- OpenIM 的断开逻辑集中在 transport，任何重新连接、空配置和 renderer 卸载都按 `logout -> unInitSDK` 顺序执行，并通过 Promise 串行化，避免并发操作 native SDK。
- 不在 JavaScript 层捕获 `SIGSEGV`；自动化测试只验证生命周期调用顺序，真实 native 崩溃仍需 macOS arm64 手动回归和上游 SDK 修复。

## Validation

- BDD 覆盖本地 ID 不生成 Agent 路径、无效映射自动晋级和有效 UUID 保留。
- 生命周期测试覆盖重复断开幂等、账号切换顺序和卸载清理。
- 运行桌面测试、Bug 门禁、Lint、typecheck 和 build。
