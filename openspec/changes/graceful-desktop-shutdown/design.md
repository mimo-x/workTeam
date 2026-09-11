## 设计

在主进程增加 `ShutdownCoordinator`，内部保存唯一的清理 Promise。Electron `before-quit` 首次触发时阻止默认退出，启动清理队列；清理完成后再次调用 `app.quit()`，第二次事件直接放行。每个清理动作独立捕获错误，避免 OpenIM 或运行时异常阻断其余动作。

渲染层继续在 `beforeunload` 断开 OpenIM，主进程负责最终原生 SDK 销毁，两个入口通过现有生命周期队列保持安全。
