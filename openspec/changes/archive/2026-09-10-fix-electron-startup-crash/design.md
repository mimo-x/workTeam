## Context

崩溃报告显示 Electron 44.2.0 在 macOS 26.6.1 的 AppKit `RegisterApplication` 阶段触发 SIGABRT；同时原生 OpenIM SDK 在主模块顶层导入，尚未确认是否参与启动崩溃。

官方 Electron issue #52815（2026-08-14）确认同样的 `_RegisterApplication` / `launchservicesd` 不可达问题发生在 JS 执行前，Codex/cmux 受限启动环境会触发该系统级崩溃。

## Goals / Non-Goals

**Goals:** 定位最小复现、确认 Electron 版本/启动环境兼容性、保证错误可诊断。

**Non-Goals:** 不绕过 macOS 安全机制，不隐藏系统崩溃，不在证据不足时盲目升级全部依赖；不把受限沙箱中的系统故障伪装成应用可修复错误。

## Decisions

- 先分别验证裸 Electron、移除原生 SDK 初始化和完整应用三条启动路径；本次已确认裸 Electron 即复现。
- 对发生在 JS 之前的 `_RegisterApplication` 崩溃，交付兼容性结论和启动环境要求，不修改业务代码制造无效绕过。
- 启动验收要求窗口数量和主进程存活两个独立信号。

## Risks / Trade-offs

- [风险] Electron 与 macOS 兼容性问题需要升级运行时 → [缓解] 先用最小启动 Case 验证，限制版本变更范围。
