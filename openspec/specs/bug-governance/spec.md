# bug-governance Specification

## Purpose

为项目建立可复现、可验证、可追踪的 Bug 修复流程，确保每个问题都有记录、测试和 OpenSpec 变更关联，并在提交前自动发现遗漏。

## Requirements

### Requirement: Every bug has a traceable record

项目 SHALL 为每个需要修复的 Bug 创建唯一 Bug ID，并记录复现步骤、实际结果、预期结果、环境、原始日志、影响范围、根因、修复、验证结果和关联 OpenSpec change。

#### Scenario: A new bug is reported

- **WHEN** 用户或开发者报告一个需要修复的问题
- **THEN** 项目记录包含唯一 Bug ID、可复现信息和待关联的 OpenSpec change 状态

### Requirement: Bug fixes have executable regression cases

每个 Bug 修复 SHALL 至少关联一个能在自动化检查中执行的复现或回归 Case；跨服务、跨进程或用户可见流程 SHOULD 使用 BDD 场景表达。

#### Scenario: A regression case proves the fix

- **WHEN** 修复提交运行项目测试
- **THEN** 关联 Case 在修复前能够复现问题或在修复后能够阻止问题再次出现

### Requirement: Bug fixes are tracked by OpenSpec changes

每个 Bug 修复 SHALL 创建或关联一个 OpenSpec change，并在 change 中说明问题、验收场景、设计、实施任务和验证命令。

#### Scenario: A developer starts a bug fix

- **WHEN** 开发者开始修改 Bug 涉及的代码
- **THEN** 对应 OpenSpec change 已存在，且任务清单包含测试和验收步骤

### Requirement: Repository gates reject incomplete fixes

提交或持续集成门禁 SHALL 检查 Bug 记录、OpenSpec change、回归 Case 和必要验证是否齐全；缺少任一项时 SHALL 阻止提交或报告失败原因。

#### Scenario: A fix has no regression case

- **WHEN** 提交包含 Bug 修复标记但没有关联可执行 Case
- **THEN** 门禁失败并指出缺少 Bug ID、测试或 OpenSpec 关联信息

### Requirement: Workflow guidance matches enforcement

项目 SHALL 分别提供长期规则、流程指导和自动检查：Markdown 说明规则，Skill 指导步骤，Hook 或 CI 执行门禁。

#### Scenario: An agent follows the bug workflow

- **WHEN** Agent 接收到 Bug 修复请求
- **THEN** 它可以按统一流程创建记录、OpenSpec change、测试 Case 并运行门禁，而无需依赖隐含约定
