## Context

当前 \`AgentDefinition\` 已包含名称、指令、权限、可见性、运行位置和 OpenIM 映射，但没有统一 Manifest，也没有区分 Provider 与 Runtime。后续 change 依赖稳定的领域边界。

## Goals / Non-Goals

**Goals:**

- 形成 provider-neutral 的 Agent 模型。
- 让内置和注册 Agent 使用同一套身份与能力描述。
- 保持现有本地 Agent 数据可迁移。

**Non-Goals:**

- 本 change 不实现任何新的 Provider。
- 本 change 不实现注册中心 API 或前端完整页面。
- 本 change 不引入长期 Agent 记忆。

## Decisions

- 将 Agent 定义为产品层协作者，将 Provider Runtime 定义为执行层绑定。
- 使用 Manifest 表达可发现信息和能力声明；能力声明不直接授予权限。
- 将 OpenIM ID、Codex thread ID 等作为外部映射或运行状态保存。
- 优先扩展现有共享类型和 JSON 持久化，避免新建独立服务。

## Risks / Trade-offs

- [旧数据字段不完整] -> 提供默认来源和 Runtime 值，并在加载时做版本化迁移。
- [能力声明被误认为权限] -> 在规范和实现中明确由本地/服务端策略再次授权。
