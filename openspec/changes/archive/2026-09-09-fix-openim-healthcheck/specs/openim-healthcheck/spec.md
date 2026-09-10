## Purpose

让一键部署根据 OpenIM 实际 API 能力判断服务是否可用，避免运行镜像中缺少 Go 导致的 `mage check` 健康检查误报，并在失败时提供具体原因。

## ADDED Requirements

### Requirement: Health status reflects the real OpenIM API

部署流程 SHALL 使用 OpenIM 实际可调用的管理 API 进行有界探活，不得只依赖需要额外运行时依赖的镜像内健康检查命令。

#### Scenario: OpenIM image lacks Go

- **WHEN** OpenIM 容器内没有 `go` 命令但 API 正常响应
- **THEN** 部署流程将 OpenIM 判定为可用，不因 `mage check` 失败而误报服务故障

### Requirement: OpenIM failures are actionable

部署流程 SHALL 区分 OpenIM API 不可达、认证失败和服务返回错误，并输出目标地址和具体错误类别。

#### Scenario: OpenIM API is unreachable

- **WHEN** 部署流程无法连接 OpenIM 管理 API
- **THEN** 流程失败并显示连接目标、重试耗尽和服务状态，不报告部署成功

### Requirement: Health checks are bounded and secret safe

探活 SHALL 使用有限超时和重试，且日志不得输出管理员 Token 或共享密钥。

#### Scenario: Health check succeeds

- **WHEN** OpenIM 管理 API 在重试窗口内成功响应
- **THEN** 部署继续执行，输出脱敏的就绪状态和服务地址
