## Why

开发模式下点击关闭窗口或按 `Ctrl+C` 时，Electron、OpenIM 原生 SDK、Agent Runtime 和 Codex 进程的退出顺序不一致，终端容易出现未处理错误或原生清理日志。需要统一退出流程，保证资源按顺序释放且重复退出安全。

## What Changes

- 增加幂等的退出协调器。
- 统一处理窗口关闭、`Ctrl+C`、`SIGTERM` 等退出入口。
- 按顺序清理后台 Host、Agent Runtime、OpenIM 和 Codex。
- 等清理完成后再结束 Electron 进程，并继续执行后续清理。

## Capabilities

### New Capabilities

- `graceful-desktop-shutdown`: 桌面应用有序、幂等地释放运行资源。

### Modified Capabilities

无。

## Impact

影响 `src/main/index.ts`、退出协调器、OpenIM 传输层、Runtime 注册表和 Codex App Server。
