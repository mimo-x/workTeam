# OpenIM Lifecycle Specification

## Requirement: OpenIM lifecycle is serialized

桌面端 SHALL 串行执行 OpenIM 的登录、退出和反初始化；退出或 renderer 卸载时 SHALL 先执行 `logout`，再执行 `unInitSDK`，且重复断开 SHALL 幂等。

### Scenario: Account changes while OpenIM is connected

- **GIVEN** OpenIM 已连接账号 A
- **WHEN** 桌面端切换到账号 B 或空配置
- **THEN** 账号 A 的 `logout` 完成后才执行 `unInitSDK`
- **AND** 才允许账号 B 重新初始化和登录

### Scenario: Renderer unloads

- **GIVEN** OpenIM 已初始化或连接
- **WHEN** renderer 即将卸载
- **THEN** 桌面端执行一次幂等断开
- **AND** 不再保留旧 renderer 的连接状态
