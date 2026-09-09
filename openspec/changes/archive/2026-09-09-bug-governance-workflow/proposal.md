## Why

当前 Bug 处理依赖口头约定，容易出现没有复现用例、没有根因记录或修复未被回归验证的情况。需要把 Bug、测试、OpenSpec change 和提交关联起来，让每次修复都可复现、可审查、可追踪。

## What Changes

- 增加统一 Bug 记录模板和 Bug ID 规则。
- 要求每个 Bug 至少有一个可执行复现/回归 Case，跨模块问题优先使用 BDD。
- 要求 Bug 记录关联 OpenSpec change、测试文件和 Git 提交。
- 增加 Bug 管理 Skill，指导记录、复现、设计、实施和验证流程。
- 增加提交/CI 门禁，检查 Bug 记录、OpenSpec、测试和验证结果。
- 将长期规则写入项目协作说明，避免只依赖 Agent 临时记忆。

## Capabilities

### New Capabilities

- `bug-governance`: 管理 Bug 记录、测试 Case、OpenSpec 追踪和自动门禁。

### Modified Capabilities

## Impact

- 新增 `docs/bugs/` 记录、Bug 管理 Skill 和项目 Hook/CI 检查。
- 更新 `AGENTS.md` 与开发文档。
- 不改变桌面端、服务端和 Runtime 的产品行为。
