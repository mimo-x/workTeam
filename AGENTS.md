<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Bug 修复约束

- 每个 Bug 必须有 `docs/bugs/BUG-YYYYMMDD-NNN.md` 记录、可执行复现或回归 Case，以及关联 OpenSpec change。
- 跨模块或用户可见 Bug 优先使用 Given/When/Then BDD；纯逻辑问题至少提供最小自动化回归测试。
- 修复完成前必须运行 `npm run validate:bugs`，并记录测试、Lint、类型检查和构建结果。
- 提交前使用仓库 `.githooks/pre-commit` 门禁；规则、流程和自动检查分别由本文件、Bug Skill 和脚本负责。
