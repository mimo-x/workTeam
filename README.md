# Codex Desktop

一个基于 Electron、React、assistant-ui 和 OpenIM 的本地优先 Agent 开发工作台。应用通过内置 Runtime 连接 Codex、Claude、OpenCode 或 Antigravity，并支持从注册中心发现自定义 Agent，让多个具名 Agent 作为群成员协作。

## 当前能力

- 自动发现并启动本机 Codex CLI
- 内置 Codex、Claude、OpenCode 和 Antigravity Runtime；各 Runtime 按已验证能力声明读写、命令和审批边界
- 读取 Codex 登录状态和可用模型
- 选择项目目录，并以该目录作为会话工作区
- 流式展示回答、思考摘要、命令执行和文件修改
- 支持停止当前 turn
- 命令执行或越界文件写入时显示审批卡片
- 使用 `workspace-write` 沙箱和 `on-request` 审批策略
- Agent 协作群：协调员、架构师、程序员和审查员拥有独立 Codex thread
- 纵向通讯录：管理好友与自定义 Agent；Agent 支持公开/私有、运行位置与工作区权限
- 好友与 Agent 私聊：一对一房间自动创建并复用；Agent 私聊保持独立连续 Codex 上下文
- 统一消息列表：普通群、好友私聊、Agent 私聊与 Task 小群按最近活动时间排列
- 设置中心：左下角统一入口，可即时切换并持久化白天/黑夜两套 UI 主题
- 多群组：新建群组，并从通讯录邀请好友和 Agent
- 普通 `@Agent` 保持群聊语义；切换到“规划 Task”后才创建待人工审核的 Task 草案
- Task 小群持续订阅来源群的新消息；下一次 Agent 执行会消费最新上下文
- Task 看板：展示父子委派、执行者、权限范围、预算、项目主机与可解释等待状态
- 群主/管理员审核工作目标，项目主机所有者独立授权电脑范围，双重通过后才能执行
- Agent 可通过版本化结构化动作委派其他群内 Agent；默认限制深度 3、后代 12、Runs 24、30 分钟
- 电脑操作审批支持拒绝、仅这一次和当前 Task；授权绑定 Task revision 与指定主机
- 可在界面中添加、删除和修改 Agent 的名称、身份、角色指令及工作区权限
- 每个 Agent 可设置 `none`、`allowlist` 或 `all` Skills 策略；本地执行前会和本机 Codex Skills 清单再次校验
- 多 Agent 并行响应；同一工作区的写入 Agent 自动串行执行
- 本地房间消息持久化；未部署 IM 服务时也能完整验证 Agent 群聊
- 可选接入 OpenIM Electron FFI SDK，同步群消息与历史记录
- 独立 Agent Gateway 通过 OpenIM Platform API 以 Agent 用户身份发布最终消息
- 支持通过版本化 Manifest 接入自定义 HTTP 或 CLI JSONL Agent；协议说明见 [docs/custom-agent-protocol.md](docs/custom-agent-protocol.md)
- 自定义 HTTP Agent 可配置 Bearer Token；Token 不写入工作区快照，使用系统安全存储或云端密文保存
- 多用户业务后台：账号、好友申请、远程私聊/群聊、Agent 邀请审批、消息镜像、Task、设置和设备信息
- 登录后自动同步云端通讯录和会话；OpenIM/后台事件会实时刷新桌面端，远程 Task 由本机 Agent Host 执行

## 环境要求

- Node.js 22 或更新版本
- 已安装 Codex CLI，并且 `codex --version` 可正常运行
- 已通过 Codex CLI 登录；如果未登录，也可以在应用中启动 ChatGPT 登录

应用依次在 `CODEX_PATH`、`/opt/homebrew/bin/codex`、`/usr/local/bin/codex` 和系统 `PATH` 中查找 Codex。

## 开发

```bash
npm install
npm run dev
```

开发时直接使用 `npm run dev` 启动 Electron 即可，不需要反复构建或安装打包版本。

常用检查：

```bash
npm run typecheck
npm run lint
npm run build
```

生成安装包：

```bash
npm run dist
```

产物会输出到 `release/`。

## Agent 群聊

启动后默认进入“消息”。可以创建多个普通群，并从通讯录邀请好友与 Agent。在“群聊回复”模式可以直接输入：

```text
@架构师 设计消息和任务的数据模型
@所有Agent 分别评估当前方案
```

需要产生可执行工作时，切换到“规划 Task”再输入，例如 `@程序员 实现这个功能并运行测试`。

普通消息和普通 `@Agent` 只进入聊天记录，并实时推进该群内活跃 Task 的上下文。需要执行工作时，在输入框上方切换到“规划 Task”并 @ 负责规划的 Agent；Agent 只生成草案，群主或管理员审核后才可开始。Task 小群用于继续讨论和查看执行上下文，不把普通聊天解释为机器操作。

“通讯录”可以管理好友、创建 Agent，并设置 Agent 的公开或私有属性。公开表示可被其他用户发现和邀请，不会公开角色指令、凭据或本机工作区权限。群聊右上角可以管理当前群的好友与 Agent 成员。

通讯录按好友、私有 Agent、公开 Agent 纵向排列。点击联系人右侧的“私聊”会创建或复用同一个一对一房间：好友消息只保留为私聊记录；Agent 会在该私聊内自动回复，并复用独立 Codex thread 保持连续上下文，不会自动创建 Task。所有私聊与群聊都会出现在“消息”的统一会话列表中。

每个当前用户拥有的 Agent 卡片都有独立“编辑”入口，可以修改显示名称、角色、提及名称、简介、角色指令、可见性、工作区权限、运行位置和外观。Agent ID 创建后保持稳定。其他用户拥有的公开 Agent 只能查看和邀请，渲染层与主进程都会拒绝越权修改或删除。

“Task 面板”展示所有任务的状态、来源群、负责人、最后活动时间和未消费上下文。Task 运行期间到达的新主群消息会立即进入关联上下文；为了避免中断正在进行的命令或文件写入，Agent 会在下一次 TaskRun 开始时消费这些新增消息。

每个 Agent 的业务 `id` 是稳定 UUID；其 `openimUserId` 是独立的 OpenIM 身份。桌面同步层会完成映射，不能把两者混用。

架构师、审查员等只读角色使用 Codex `read-only` 沙箱。写入角色使用 `workspace-write`，同一项目主机上的写入任务通过后端租约串行执行。所有命令和文件越界审批仍在主机所有者的桌面端完成，群聊消息和 Prompt Injection 文本不能进入结构化 Agent 动作通道。

## 受治理的团队协作

每个普通群明确选择一个“项目主机”。主机所有者在自己的桌面端登记项目标签、仓库身份和基线能力；绝对路径只保存在本机安全存储中，群内与后台只看到不透明绑定 ID、标签、仓库身份、所有者、revision 和在线状态。任何群成员都可以分享自己的候选主机，只有群主或管理员能把它设为当前主机。

一次完整工作按以下顺序进行：

1. 成员在群里讨论并使用“规划 Task”提出工作请求。
2. 群主或管理员审核目标、计划、验收条件、Agent 和权限范围。
3. 涉及写文件、运行命令或有限网络读取时，当前项目主机所有者创建最小 Task 授权。
4. 后端把 Run 只派给 Task 快照绑定的设备；Agent 可以在相同或更小范围内创建子 Task 并委派群内其他 Agent。
5. Runtime 遇到具体电脑操作时暂停，主机所有者选择“拒绝”“仅这一次”或“本 Task”。
6. 子 Task 完成后，产物汇总到父 Task；管理员验收最终结果并结束工作。

角色边界：

| 角色           | 可以做                                                    | 不能做                                              |
| -------------- | --------------------------------------------------------- | --------------------------------------------------- |
| 群成员         | 聊天、@ Agent、提出 Task、查看脱敏进度                    | 审核、开始、扩大权限、选择当前主机                  |
| 群主 / 管理员  | 审核与退回计划、选择主机、开始和验收 Task                 | 查看其他人的本机路径、凭据或 Runtime 私密详情       |
| 项目主机所有者 | 登记主机、声明基线、创建/撤销 Task 授权、处理电脑操作审批 | 代替群管理员决定团队是否执行                        |
| Agent          | 回复群聊、在已审范围内执行和委派、提交产物或请求复核      | 自行扩大 scope/budget、切换主机、批准自己的电脑操作 |

首发开放 `workspace.read`、受路径约束的 `workspace.write`、受可执行文件约束的 `command.run` 和受域名约束的 `network.read`。浏览器/原生应用控制、外部发布、部署、账号或权限变更以及破坏性远端操作不在首发范围内。

主机离线时 Task 进入 `waiting_for_host`，恢复心跳后继续使用同一 Run；授权缺失、审批等待、执行者失效和预算耗尽分别使用独立等待状态。主机切换、Task revision 变化或授权撤销都会使旧授权失效并要求重新确认。群时间线与审计接口只返回脱敏摘要；复制诊断时再次移除本机路径和凭据。更完整的运行与部署约定见 [业务 API 文档](services/chat-api/README.md)。

## 接入 OpenIM

### 多用户后台（推荐）

业务数据由 `services/chat-api` 管理，PostgreSQL 保存持久数据，Redis 提供一次性实时连接票据，OpenIM 负责消息投递。先生成开发密钥并启动服务：

服务器部署统一使用一键脚本：

```bash
./deploy.sh
```

脚本会自动处理 OpenIM 启动、管理员凭证、后台配置、数据库迁移、网络连接、回调和真实 API 探活。无需手工执行 Docker Compose 或数据库迁移命令。

```bash
cp .env.backend.example .env.backend.local
openssl rand -base64 32
# 将输出填入 ENCRYPTION_MASTER_KEY，并修改 JWT_SECRET、OpenIM 管理 Token/回调 Token
docker compose -f deploy/docker-compose.yml up --build
```

OpenIMServer 需按官方方式单独部署。把 before/after 消息回调配置到：

```text
http://<chat-api>:8790/internal/openim/callbacks/message/before?token=<OPENIM_CALLBACK_TOKEN>
http://<chat-api>:8790/internal/openim/callbacks/message/after?token=<OPENIM_CALLBACK_TOKEN>
```

随后运行 `npm run dev`，在左下角“设置中心 → 账号与同步”填写后台地址并注册或登录。首次从纯本地版本迁移时点击“导入当前工作区”；以后好友、Agent、群聊、消息和 Task 会从云端自动同步。本机 Agent Host 会随已登录工作区自动连接。进入群聊后打开“项目主机”，登记当前项目并只启用确有需要的基线能力，再由群主或管理员选为当前主机。

只开发业务 API 时可运行：

```bash
npm run backend:migrate -- --env-file=.env.backend.local
npm run backend:dev -- --env-file=.env.backend.local
npm run backend:worker -- --env-file=.env.backend.local
```

生产环境必须使用 HTTPS、独立强 JWT/回调密钥和 `KEY_PROVIDER=vault-transit`；OpenIM 管理 Token 只放在服务端。项目绝对路径不得写入 PostgreSQL、OpenIM `ex` 或审计 metadata。当前首个可运行版本执行显式绑定的本机 Agent Host，`hosted` 字段仅为后续云 Worker 保留。

### 手动连接单个 OpenIM 群（兼容模式）

1. 按 [OpenIM 官方 Docker Compose 部署文档](https://docs.openim.io/zh/docs/guides/deployment/docker-compose) 部署 OpenIMServer。
2. 通过可信业务后端创建一个普通用户、群组及各 Agent 用户，并将它们加入群组。
3. 在群聊右上角打开 OpenIM 设置，填写 API 地址、WebSocket 地址、普通用户 Token 和群组 ID。
4. 部署下面的 Agent Gateway，并填写 Gateway 地址和密钥。

桌面端只保存普通用户 Token。系统支持安全存储时，Token 和 Gateway 密钥会加密落盘；OpenIM 管理员 Token 永远不进入 Electron。

如果希望其他群成员也能通过 `@Agent` 触发这台电脑上的 Codex，可以开启“作为这个群的 Agent Host”。同一群只能有一个 Agent Host，否则多台电脑会重复响应。

### Agent Gateway

复制示例配置并填入 OpenIM 管理员 Token：

```bash
cp .env.gateway.example .env.gateway.local
npm run gateway:dev
```

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

Gateway 只监听本机地址，使用 Bearer 密钥校验桌面端请求，并通过 `/msg/send_msg` 将最终结果以对应 Agent 的 `sendID` 发到群里。生产环境应放在 HTTPS 反向代理后，并使用网络访问控制。

### OpenIM 许可证

OpenIMServer 仓库使用 Apache-2.0；当前接入的 `@openim/electron-client-sdk` 和 `@openim/wasm-client-sdk` 包声明为 AGPL-3.0-only。若准备闭源或商业分发桌面客户端，应在发布前完成许可证评估，或向 OpenIM 获取适用的商业许可。

## 结构

- `src/main/codex-app-server.ts`：Codex App Server 子进程和 JSONL RPC 客户端
- `src/main/agent-team.ts`：通讯录、群组、Task/TaskRun、实时上下文、Agent 调度和工作区持久化
- `src/main/backend-client.ts`：后台认证、安全刷新令牌、云端快照与 OpenIM 会话
- `src/main/remote-agent-host.ts`：实时任务租约、本机 Codex 执行、进度回传和上下文 steer
- `src/main/im-config.ts`：OpenIM 配置与系统安全存储
- `src/main/runtime-credentials.ts`：自定义 Runtime 凭证的系统安全存储
- `src/main/agent-gateway.ts`：桌面端到 Agent Gateway 的受限发布客户端
- `src/main/index.ts`：Electron 窗口、目录选择和受限 IPC 接口
- `src/preload/index.ts`：渲染进程安全桥接
- `src/renderer/src/codex-runtime.ts`：Codex 事件到 assistant-ui 消息流的适配
- `src/renderer/src/openim-transport.ts`：OpenIM 登录、收发消息和历史同步适配
- `src/renderer/src/team-chat.tsx`：多 Agent 群聊和 Agent/OpenIM 设置界面
- `src/renderer/src/app.tsx`：桌面界面、项目和模型选择、审批卡片
- `gateway/server.mjs`：持有 OpenIM 管理员 Token 的最小 Gateway 服务
- `services/chat-api/`：Fastify 业务 API、PostgreSQL schema、OpenIM 回调和 outbox worker
- `deploy/docker-compose.yml`：PostgreSQL、Redis、迁移、API 和 worker 的单机编排
- `components/assistant-ui/`：聊天消息、输入框和 Markdown 组件

## 安全边界

渲染进程启用了 `contextIsolation` 和沙箱，并关闭 Node.js 集成；它只能调用 preload 中明确列出的 Codex 操作。主进程会校验工作目录、消息和审批参数。默认不会使用 `danger-full-access`，也不会自动批准命令。

## 原 DeepSeek 网页版

此前的 Next.js + DeepSeek 实现仍保留在 `app/` 中，作为可选示例：

```bash
npm run web:dev
```

它使用 `.env.local` 中的 `DEEPSEEK_API_KEY`。桌面版 Codex 链路不会读取这个密钥。
