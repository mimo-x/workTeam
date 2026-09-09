## Context

OpenIM v3.8 `openim-server` 和 `openim-chat` 的 Docker healthcheck 执行 `mage check`，运行镜像没有 Go，因此 Docker 状态为 `unhealthy`。当前部署脚本同时依赖容器状态和 API 调用，诊断不够清晰。

## Goals / Non-Goals

**Goals:** 使用真实管理 API 探活、隐藏密钥、控制超时、让一键部署判断可用性。

**Non-Goals:** 不修改 OpenIM 源码、不安装 Go 到运行镜像、不改变桌面端协议。

## Decisions

- 部署脚本以 `/auth/get_admin_token` 和 `/auth/parse_token` 作为真实探活依据。
- 对上游 compose 的 `mage check` 使用可重复的部署侧修正或忽略其误报，避免修改持久数据。
- 所有 curl 输出只保留状态码/错误类别，Token 通过 stdin 或变量传递且不回显。

## Risks / Trade-offs

- [风险] 上游 compose 升级后健康检查结构变化 → [缓解] 脚本检测目标服务和 healthcheck 文本，无法识别时停止并给出提示。
- [风险] API 可达但内部依赖异常 → [缓解] 同时验证管理认证接口，不仅检查 TCP 端口。
