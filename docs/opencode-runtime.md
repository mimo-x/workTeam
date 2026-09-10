# OpenCode Runtime

当前探测环境：macOS arm64，OpenCode `1.3.15`（2026-09-09）。`opencode --help` 和 `opencode acp --help` 确认 ACP 入口通过 stdio 使用 JSON-RPC；`opencode serve` 是另一种 HTTP Server 形态，本项目选择 ACP 作为本地 Runtime。

官方资料：

- <https://opencode.ai/docs/acp/>
- <https://agentclientprotocol.com/protocol/v1/overview>
- <https://agentclientprotocol.com/protocol/v1/schema>

ACP 生命周期为 `initialize`、`session/new` 或 `session/load`、`session/prompt`、`session/update` 和 `session/cancel`。本项目向 ACP Agent 声明只读文件能力，不声明终端和写文件能力；`fs/read_text_file` 会校验真实路径必须位于当前工作区内。

当前 Runtime 支持：

- ACP v1 初始化和能力协商；
- 多轮 Session；
- `session/update` 中的文本增量和工具活动；
- 只读工作区文件读取；
- 取消、超时、进程退出和结构化错误；
- `session/request_permission` 到统一审批事件的映射。

暂不声明支持工作区写入、终端命令和 steer。相关能力必须等桌面审批桥接完成后再开放，不能通过 Runtime 自动批准。
