# deploy-readiness Specification

## Purpose
让一键部署在 OpenIM 重启后的启动窗口内进行有界、安静且可诊断的就绪等待，避免空响应解析错误掩盖真实服务状态。

## Requirements

### Requirement: Deployment waits for OpenIM readiness

部署脚本 SHALL 在请求管理凭证前等待 OpenIM API 可建立连接，并使用有限重试处理启动窗口。

#### Scenario: OpenIM is restarting

- **WHEN** OpenIM API 暂时重置或拒绝连接
- **THEN** 脚本继续有限重试，不输出 JSON 解析栈，并在就绪后继续部署

### Requirement: Readiness failures are actionable

重试耗尽时脚本 SHALL 输出 OpenIM 阶段、目标地址和可执行的日志检查命令，并以非零状态退出。

#### Scenario: OpenIM never becomes ready

- **WHEN** 有界重试窗口结束仍无法建立 API 连接
- **THEN** 脚本停止部署并显示具体失败阶段和诊断入口
