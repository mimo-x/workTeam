## Context

当前仓库已有 OpenSpec、TypeScript 测试和项目级 `AGENTS.md`，但没有统一 Bug 目录、Bug ID、记录模板或提交门禁。目标是补齐流程基础设施，不改变业务运行时行为。

## Goals / Non-Goals

**Goals:**

- 建立 `docs/bugs/BUG-*.md` 记录格式和状态生命周期。
- 提供 Bug 管理 Skill，明确何时使用 BDD、单元测试和 OpenSpec。
- 提供轻量脚本，在提交或 CI 中校验关联完整性。

**Non-Goals:**

- 不建设在线 Issue 管理系统。
- 不强制所有非 Bug 改动创建 Bug。
- 不引入新的测试框架。

## Decisions

- 使用 Markdown 记录 Bug，使用 `BUG-YYYYMMDD-NNN` 作为唯一 ID。
- 使用固定 front matter 保存 `openspec_change`、`tests`、`status` 和 `commit`，检查器只解析固定字段。
- 使用 Node 脚本供 pre-commit 和 CI 调用；不增加依赖。
- 跨边界问题要求 Given/When/Then，纯逻辑问题允许最小回归测试。

## Risks / Trade-offs

- [风险] 规则可能误伤非 Bug 改动 → [缓解] 检查器只扫描 `docs/bugs/BUG-*.md`，非 Bug 提交不受影响。
- [风险] BDD 执行成本高 → [缓解] 只对跨模块或用户可见流程要求 BDD。

## Migration Plan

先以报告命令验证现有记录，再启用版本化 Hook；删除 Hook 和脚本即可回滚，不影响业务数据。
