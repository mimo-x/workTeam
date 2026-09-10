# openim-local-storage Specification

## Purpose
确保桌面端在云端账号和手动 OpenIM 配置两种模式下，都能在 SDK 登录前准备可用的本地数据库目录，保留已有数据库并明确报告无法创建目录的错误。

## Requirements

### Requirement: Prepare storage before SDK login

桌面主进程 SHALL 在返回 OpenIM 登录配置前创建缺失的数据库目录，重复调用 SHALL 保留已有文件，创建失败 SHALL 拒绝返回可用配置。

#### Scenario: Fresh installation

- **WHEN** 云端或手动登录目录不存在
- **THEN** 返回配置时目录已存在

#### Scenario: Existing database

- **WHEN** 登录目录已有数据库
- **THEN** 再次获取配置不会覆盖或删除数据库

#### Scenario: Invalid storage path

- **WHEN** 路径被普通文件占用
- **THEN** 返回明确的文件系统错误
