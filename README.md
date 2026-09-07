# WorkTeam

WorkTeam 是一个面向人机协作的桌面工作空间。你可以像管理好友和同事一样创建 Agent，将它们加入私聊或群聊，并通过 Task、Skills 与本机 Codex 协同完成工作。

## 核心能力

- 好友、Agent、私聊和群聊统一管理
- 自定义 Agent，可编辑角色、指令、权限、Skills 和公开范围
- 在消息中通过 `@Agent` 发起对话或多 Agent 协作
- Task 草案、人工审核、执行、沟通和验收闭环
- Task 持续关联来源群消息，Agent 可获得最新上下文
- 直接连接本机 `codex app-server`，支持流式输出、工具调用和审批
- 支持明暗主题与本地数据持久化
- 可选接入业务后台与 OpenIM，实现多用户实时通信

## 技术栈

- Desktop：Electron、React、TypeScript、assistant-ui
- Agent Runtime：Codex App Server
- Backend：Fastify、PostgreSQL、Redis
- Realtime Messaging：OpenIM

## 环境要求

- Node.js 22+
- Codex CLI
- 已完成 Codex 登录
- Docker（仅在运行完整后台时需要）

确认 Codex 可用：

```bash
codex --version
```

## 快速开始

```bash
git clone https://github.com/mimo-x/workTeam.git
cd workTeam
npm install
npm run dev
```

开发模式会直接启动桌面应用，无需安装打包版本。

## 使用方式

在群聊或私聊中直接提及 Agent：

```text
@架构师 分析当前模块的边界
@程序员 检查这个问题并给出修改建议
@所有Agent 一起评审这个方案
```

普通 `@Agent` 只触发聊天。需要执行正式工作时，可以要求 Agent 创建 Task 草案；草案经人工审核后才能开始执行，审核人与执行记录会被完整保留。

## 完整后台

复制配置并填写必要的数据库、Redis、JWT 与加密密钥：

```bash
cp .env.backend.example .env.backend.local
docker compose -f deploy/docker-compose.yml up --build
```

启动桌面应用后，在“设置中心 → 账号与同步”中填写后台地址并注册或登录。OpenIMServer 需要独立部署；未配置后台和 OpenIM 时，本地 Agent 聊天仍可正常使用。

## 常用命令

| 命令                      | 用途                |
| ------------------------- | ------------------- |
| `npm run dev`             | 启动桌面开发环境    |
| `npm run build`           | 构建桌面应用        |
| `npm run dist`            | 生成安装包          |
| `npm run lint`            | 检查代码与格式      |
| `npm run typecheck`       | TypeScript 类型检查 |
| `npm run test:agent-team` | 运行 Agent 协作测试 |
| `npm run backend:test`    | 运行后台测试        |

## 项目结构

```text
src/                    Electron 桌面端
services/chat-api/      业务 API 与后台任务
gateway/                Agent 消息网关
deploy/                 Docker 部署配置
app/                    DeepSeek 网页聊天示例
tests/                  Agent 协作测试
```

## 安全说明

- 不要提交 `.env.local`、`.env.backend.local` 或任何真实 Token。
- Codex 的命令执行与越界文件操作仍需经过桌面端审批。
- OpenIM 管理员 Token 只能保存在可信服务端。
- OpenIM Electron/WASM SDK 声明为 AGPL-3.0-only；闭源或商业发布前请完成许可证评估。

## 项目状态

WorkTeam 当前处于基础版本阶段，核心桌面聊天、Agent 协作、Task 和远程消息链路已经可用。
