## Why

一键部署重新启动 OpenIM 后立即请求管理 API，启动窗口内会出现 `connection reset`；curl 空响应又被 Python 当作 JSON 解析，产生误导性的 `JSONDecodeError`。

## What Changes

- 增加 OpenIM API 就绪等待。
- 空响应和连接失败只作为静默重试，不打印解析栈。
- 重试耗尽时输出具体阶段和诊断命令。
- 增加部署脚本回归 Case。

## Capabilities

### New Capabilities
- `deploy-readiness`: 一键部署的 OpenIM 就绪等待。

### Modified Capabilities

## Impact

只影响 `deploy.sh` 和部署脚本测试，不改变服务端业务代码。
