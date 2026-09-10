## Context

当前界面包含消息、通讯录、Task、Codex 模型选择、OpenIM 设置和审批卡片，但 Agent/Runtime/Session 状态没有统一入口。前端必须依赖后端 Manifest 和 Runtime 状态，而不是猜测 Provider 能力。

## Goals / Non-Goals

**Goals:**

- 以项目工作区和执行结果为主线组织 Agent 工作台。
- 让 Agent 发现、配置、执行、审批和诊断形成闭环。
- 对旧模型和 Provider 能力不足提供准确提示。

**Non-Goals:**

- 不把产品改造成普通 IM；
- 不隐藏 Provider 原始错误；
- 不自动降级用户选择的 Runtime 或 Model；
- 不在前端直接保存 Provider 私密凭证。

## Decisions

- 保留现有消息/Task 主导航，在通讯录或设置中增加 Agent 目录与 Runtime 详情。
- 用 Manifest 能力控制操作可见性，用实时 Session 状态更新执行卡片。
- 错误 UI 分为摘要和诊断详情；摘要可读，详情保持原始 Provider 信息。
- 统一所有 Runtime 的加载、空状态、离线、unsupported、认证失败和重试状态。

## Risks / Trade-offs

- [信息量增加导致界面复杂] -> 默认展示摘要，详情按需展开。
- [能力状态短暂过期] -> 显示最近更新时间，并在执行前由 Runtime 再次校验。
