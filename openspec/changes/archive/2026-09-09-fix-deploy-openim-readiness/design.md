## Context

`deploy.sh` 在 `docker compose up -d` 后立即循环调用 `/auth/get_admin_token`，curl 失败或返回空内容时管道中的 Python 会打印 traceback。

## Goals / Non-Goals

**Goals:** 统一就绪等待、抑制启动期噪音、保留最终可诊断错误。

**Non-Goals:** 不修改 OpenIM 镜像、不增加部署依赖、不延长无界等待。

## Decisions

- 先使用 curl 的静默连接探测，再请求 Token。
- JSON 解析器对空响应和非法响应返回空值，不输出异常栈。
- 所有等待均有最大次数和单次超时。

## Risks / Trade-offs

- [风险] OpenIM 慢启动造成部署等待 → [缓解] 仅增加有限重试并明确显示进度。
