## Context

仓库当前没有 Claude 适配器。Claude 的接入方式、事件格式和工具控制必须先通过实际环境和官方接口验证，不能复制 Codex 的假设。

## Goals / Non-Goals

**Goals:**

- 交付一个有能力声明和明确支持边界的 Claude Runtime。
- 优先支持稳定、可测试的本地执行路径。
- 将认证和 Provider 错误纳入统一诊断。

**Non-Goals:**

- 不在没有验证接口的情况下承诺完整代码执行能力。
- 不把 Claude 私有提示词或凭证上传到注册中心。
- 不改变统一 Agent/Session 模型。

## Decisions

- 先做环境探测和最小文本 Session，再按验证结果扩展工具能力。
- Provider-specific 事件在适配器内归一化，业务层不解析 Claude 原始协议。
- 能力不足时返回结构化 unsupported，而不是降级成无提示成功。

## Risks / Trade-offs

- [接口和 CLI 输出随版本变化] -> 固定支持版本并保留原始事件，升级前跑兼容矩阵。
- [认证方式依赖用户环境] -> 只保存凭证引用/状态，不在 Agent 消息中暴露凭证。
