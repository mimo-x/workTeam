# Antigravity Runtime

当前探测环境：macOS arm64，Antigravity CLI `agy 1.1.27`（2026-09-09）。本机探测命令为 `agy --version` 和 `agy --help`。

官方资料：

- <https://antigravity.google/docs/cli/headless/>
- <https://github.com/google-antigravity/antigravity-cli>

官方 Headless 文档确认 `--input-format stream-json` 使用 NDJSON 输入，`--output-format stream-json` 输出 `init`、`step_update` 和 `result` 事件；持续 Session 的输入格式为 `{ "event": "user", "message": { "content": "..." } }`。CLI 文档说明 `--mode plan` 用于受控执行，未知 Model 会以 ERROR 状态退出，不会静默降级。

本项目当前 Runtime 支持：

- 多轮 Headless Session；
- 用户输入和 `step_update.agent_response.text_delta` 流式文本；
- 结果、错误、退出码和 stderr 诊断；
- 只读工作区和明确的 Model 错误。

暂不声明支持工作区写入、命令执行、Skills 映射和桌面审批桥接。Headless 模式无法把交互式权限确认可靠转发到桌面端，因此写入 Session 会返回 `unsupported`，不会使用 `--dangerously-skip-permissions`。
