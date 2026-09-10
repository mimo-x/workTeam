# Claude Runtime

当前探测环境：macOS arm64，Claude Code `2.1.266`（2026-09-09）。本地探测命令为 `claude --version`、`claude --help` 和 `claude doctor`。

官方 Headless 文档（页面更新于 2026-08-28）：

<https://code.claude.com/docs/en/headless>

文档确认 Claude Code 支持 `--print`、`--input-format stream-json`、`--output-format stream-json`、`--include-partial-messages`、`--session-id`、`--resume`、`--add-dir` 和 `--permission-prompts`。流式输出以 JSONL 返回，常见事件包含 `system/init`、`stream_event`、`assistant` 和最终 `result`；文本增量位于 `stream_event.event.delta` 的 `text_delta`。

本项目当前 Runtime 支持：

- 只读工作区；
- 多轮 Session；
- 文本输入和流式文本输出；
- Provider/Model/原始错误保留；
- Session 初始化超时和 CLI 退出失败处理。

暂不声明支持：

- 工作区写入；
- 桌面审批桥接；
- Claude Skills 列表映射。

原因是 CLI 的权限提示与桌面审批事件尚未完成可靠的双向协议映射。Runtime 会对写入 Session 返回 `unsupported`，不会使用自动批准模式绕过桌面审批。
