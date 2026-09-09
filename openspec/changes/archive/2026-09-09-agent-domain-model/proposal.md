## Why

当前 Agent 定义混合了角色、执行位置和 Provider 细节，难以同时承载内置 Runtime 与注册中心中的自定义 Agent。需要先固定产品领域模型，避免后续 Runtime、Session 和前端各自定义一套概念。

## What Changes

- 定义 Agent、Provider、Runtime、Model、Session、Thread、Task、Skill 的边界。
- 增加 provider-neutral 的 Agent Manifest。
- 区分 Agent 稳定身份、职责契约、能力权限和运行绑定。
- 明确 Agent 来源、可见性、归属和外部身份映射。

## Capabilities

### New Capabilities

- \`agent-domain\`: 提供统一的 Agent 身份、能力和运行绑定模型。

### Modified Capabilities

## Impact

- 影响 \`src/shared/agent-team.ts\` 的 Agent 类型和本地持久化。
- 为 Runtime 抽象、注册中心和桌面端 Agent 发现提供基础契约。
- 需要补充领域模型迁移和兼容旧本地 Agent 数据的策略。
