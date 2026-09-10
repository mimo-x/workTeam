## Why

实际 Electron 窗口显示 OpenIM 10006：本地数据库目录不存在。云端和手动配置入口均直接返回目录路径，没有创建目录。

## What Changes

- 主进程返回 OpenIM 配置前创建数据库目录，保留现有数据库。
- 为首次启动、再次启动和无效路径增加可执行回归测试。

## Capabilities

### New Capabilities

- `openim-local-storage`: OpenIM 登录前准备本地数据库目录。

### Modified Capabilities

## Impact

仅涉及桌面主进程 BackendClient、ImConfigStore 和回归测试，无服务端部署变更。
