---
name: bug-management
description: 管理 Bug 记录、复现 Case、OpenSpec 追踪和修复验证。
---

# Bug 管理流程

1. 创建 `docs/bugs/BUG-YYYYMMDD-NNN.md`，先记录实际日志和复现步骤，不猜测根因。
2. 创建对应 OpenSpec change，并在 Bug 记录的 `openspec_change` 字段关联它。
3. 跨模块或用户可见问题写 Given/When/Then BDD；纯逻辑问题写最小自动化回归测试。
4. 先确认 Case 在修复前能复现，再实施最小修复。
5. 运行 `npm run validate:bugs`、相关测试、Lint、typecheck 和 build，并回填验证结果与 commit。
6. 只有记录、Case、OpenSpec 和验证都齐全，才能标记 fixed。

保留请求、Session、Run、Provider、Model 和原始错误标识。
