## Context

当前仓库没有 Antigravity 集成或协议资料。该 change 的首要产物是可行性证据，不是基于猜测创建一个看似可用的适配器。

## Goals / Non-Goals

**Goals:**

- 形成可重复的 Antigravity 探测流程和能力矩阵。
- 根据证据选择完整 Runtime、受限 Runtime 或 unsupported。
- 不影响其他 Runtime 的交付。

**Non-Goals:**

- 不为了满足名称清单而模拟 Provider。
- 不绕过 Provider 的认证、权限或审批机制。
- 不在缺少稳定接口时实现脆弱的屏幕/文本解析。

## Decisions

- 先做独立 Spike，再决定是否生成可执行适配器。
- 探测结果必须区分“未安装”“接口不可用”“能力不支持”和“认证失败”。
- 若只有文本能力，按聊天 Runtime 交付，不宣称代码执行支持。

## Risks / Trade-offs

- [Provider 接口为私有或频繁变化] -> 交付受限/unsupported 结论并记录版本边界。
- [名称存在歧义] -> 在任务中记录实际产品/命令版本和证据来源后再实现。
