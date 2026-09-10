## Context

真实 Electron 页面返回 10006、unable to open database file；文件系统检查确认 openim-cloud-data 不存在。两个主进程配置入口仅返回路径。

## Goals / Non-Goals

目标：登录前创建目录，保留数据。范围外：服务端网络、认证与数据库迁移。

## Decisions

复用两个类已经导入的 mkdir，使用 recursive，在返回 SDK 配置前 await。无需新抽象或依赖。回归测试执行两个真实类，仅替换 Electron 平台模块和远端请求。

## Risks / Trade-offs

文件系统权限不足 → 保留真实错误并拒绝返回配置，不使用临时目录掩盖故障。
