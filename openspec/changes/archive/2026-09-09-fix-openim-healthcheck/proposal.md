## Why

OpenIM v3.8 运行镜像的默认 `mage check` 健康检查依赖 Go，但镜像内没有 `go` 命令，导致 `openim-server` 和 `openim-chat` 被标记为 `unhealthy`。这会让一键部署和桌面端误判服务状态，并掩盖真正的 OpenIM API 错误。

## What Changes

- 在 `deploy.sh` 中识别并修复 OpenIM v3.8 的错误健康检查配置。
- 使用真实 OpenIM API 管理认证接口进行有界探活。
- 区分容器健康检查状态和 OpenIM API 实际可用状态。
- 增加健康检查失败、服务不可达和成功部署的回归 Case。

## Capabilities

### New Capabilities

- `openim-healthcheck`: OpenIM 真实 API 健康检查和一键部署状态判断。

### Modified Capabilities

## Impact

- 影响 `deploy.sh` 和 OpenIM 部署目录中的健康检查配置。
- 不修改桌面端业务逻辑，不改变 OpenIM 上游服务协议。
