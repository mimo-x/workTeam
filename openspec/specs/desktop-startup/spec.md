# desktop-startup Specification

## Purpose
确保桌面端在支持的 macOS 环境启动后创建可操作窗口，并在启动阶段错误时保留具体诊断，避免用户只能看到系统崩溃对话框。

## Requirements

### Requirement: Desktop startup creates a usable window

桌面端 SHALL 在 Electron 主进程启动后创建至少一个可见、可交互的窗口。

#### Scenario: Start the desktop app on macOS

- **WHEN** 用户执行开发启动或打开打包应用
- **THEN** Electron 进程保持运行并显示桌面工作台窗口

### Requirement: Startup failures are diagnosable

启动阶段发生异常时，应用 SHALL 记录具体模块、版本和错误原因，不得静默退出或只依赖系统通用崩溃提示。

#### Scenario: Native initialization fails

- **WHEN** 原生 SDK 或 Electron 运行时初始化失败
- **THEN** 主进程输出可关联的错误信息并安全退出，不产生无窗口僵尸进程
