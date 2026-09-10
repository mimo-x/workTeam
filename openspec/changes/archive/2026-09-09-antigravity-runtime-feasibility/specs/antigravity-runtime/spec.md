## Purpose

以可重复的兼容性验证确定 Antigravity 能否安全接入统一 Agent Runtime，而不是提前承诺未知能力。

## ADDED Requirements

### Requirement: Antigravity support level is explicit

系统 SHALL 为 Antigravity 声明经过验证的支持等级、版本、平台和能力，不得把未验证能力展示为可用。

#### Scenario: Capability probe fails

- **WHEN** Antigravity 无法提供稳定的 Session 或执行接口
- **THEN** 系统展示明确的 unsupported 状态和探测失败原因

### Requirement: Feasibility evidence is reproducible

兼容性验证 SHALL 记录安装方式、启动命令或 endpoint、协议样例、版本和关键事件结果。

#### Scenario: Another developer repeats the probe

- **WHEN** 另一位开发者在支持平台运行探测步骤
- **THEN** 可以得到可比较的能力矩阵和结论

### Requirement: Verified capabilities use the common Runtime contract

当 Antigravity 可接入时，Runtime SHALL 只通过统一 Session、事件、错误和权限契约向业务层暴露能力。

#### Scenario: Antigravity returns an execution error

- **WHEN** Antigravity 报告模型或权限错误
- **THEN** 业务层收到带 Provider、Model 和原始详情的统一 RuntimeError
