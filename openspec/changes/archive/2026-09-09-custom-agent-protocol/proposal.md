## Why

注册中心只能解决 Agent 被发现，不能保证不同外部 Agent 能被执行。需要定义最小的自定义 Agent 接入协议，优先支持远程 HTTP 和本地 CLI JSONL，并与内置 Runtime 使用同一事件语义。

## What Changes

- 定义自定义 Agent Manifest 和协议版本。
- 定义 HTTP Session/消息/取消/事件/健康接口。
- 定义本地 CLI JSONL 的启动、输入、输出和退出约定。
- 定义认证、能力协商、幂等、超时和错误格式。

## Capabilities

### New Capabilities

- \`custom-agent\`: 支持注册中心自定义 Agent 的安全发现和 Runtime 接入。

### Modified Capabilities

## Impact

- 影响 Registry、Runtime Adapter、桌面配置和服务端安全策略。
- 需要新增协议文档、测试 Agent 和兼容性版本。
- 自定义 Agent 默认不获得本机工作区访问。
