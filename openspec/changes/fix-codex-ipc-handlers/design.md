# 设计

在 Electron 主进程统一校验工作目录、会话 ID、名称和 Worktree 参数，再调用现有 `CodexAppServer` 与 `WorktreeManager`。不改变 Codex 协议层行为。
