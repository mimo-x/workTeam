# Bug 管理

每个需要修复的 Bug 使用 `BUG-YYYYMMDD-NNN.md` 命名，并复制下面模板。`openspec_change`、`tests` 和 `commit` 必须填写；暂未提交时使用 `TBD`。

```yaml
bug_id: BUG-20260909-001
status: fixed
openspec_change: bug-governance-workflow
tests:
  - tests/example.test.ts
commit: TBD
```

正文至少记录现象、复现步骤、预期结果、实际结果、环境、原始日志、根因、修复说明和验证结果。跨模块或用户可见流程使用 Given/When/Then。

运行门禁：`npm run validate:bugs`
