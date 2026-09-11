# 桌面端 BDD Cases

桌面端目前使用 Node.js 内置 `node:test` 执行回归用例，不依赖 Cucumber。测试名使用 `BDD:` 前缀，测试体按 Given、When、Then 三段组织，便于从用户行为追踪到可执行断言。

当前的基础 smoke cases 位于 `tests/desktop-basic-bdd.test.ts`：

| Case           | Given                                    | When                          | Then                                             |
| -------------- | ---------------------------------------- | ----------------------------- | ------------------------------------------------ |
| 工作区历史恢复 | 历史中有旧目录、空值、非法类型和当前目录 | 恢复当前工作区                | 当前目录排在首位，非法项被过滤，重复项只保留一次 |
| 会话偏好恢复   | 持久化文本混合有效和非法时间戳           | 读取会话列表偏好              | 只有有限数值进入排序状态                         |
| 群聊提及路由   | 群里有多个 Agent、好友和本机用户         | 同时提及一个 Agent 和一个好友 | 只有被提及的成员成为路由目标                     |
| 私聊普通消息   | 私聊输入普通文本且没有提及目标           | 创建发送中的消息              | 使用 OpenIM 普通文本类型并保留内容               |

Agent 设置相关的 BDD cases 位于 `tests/agent-team-direct.test.ts` 和 `tests/agent-settings-bdd.test.ts`：

| Case           | Given                                       | When                     | Then                                       |
| -------------- | ------------------------------------------- | ------------------------ | ------------------------------------------ |
| 添加有效 Agent | 工作区已有默认 Agent，用户填写新 Agent 配置 | 保存并重新读取工作区     | 新 Agent 及其关键配置仍然存在              |
| 拒绝非法 Agent | 用户填写包含空格的非法 Agent ID             | 保存 Agent 列表          | 保存失败，原有 Agent 列表不被覆盖          |
| 创建入口连通   | 用户从通讯录创建 Agent                      | 打开设置、添加草稿并保存 | 创建入口、草稿创建和保存按钮连接到设置流程 |
| 默认角色类型   | 应用提供四种默认 Agent                      | 查看默认配置             | 角色权限、公开范围和内置来源保持差异       |
| Runtime 类型   | 用户选择内置或自定义 Runtime                | 保存并重新读取工作区     | Provider、协议、运行位置和连接参数被保留   |
| 类型选项完整性 | 用户打开 Agent 设置弹窗                     | 查看下拉选项             | Runtime、权限和可见性选项全部可用          |

云端 Agent 保存相关的 BDD cases 位于 `tests/agent-cloud-validation.test.ts` 和 `tests/backend-error.test.ts`：

| Case           | Given                          | When                          | Then                   |
| -------------- | ------------------------------ | ----------------------------- | ---------------------- |
| 默认云端请求体 | 用户使用默认 Agent 草稿        | 构造 `POST /v1/agents` 请求体 | 通过后台字段约束       |
| 非法提及名称   | 提及名称包含空格               | 保存前校验                    | 直接显示提及名称规则   |
| 非法远程地址   | Runtime endpoint 使用公网 HTTP | 保存前校验                    | 提示必须使用 HTTPS     |
| 后台错误详情   | 后台返回 Zod 字段级 details    | 主进程格式化错误              | 显示具体字段和校验原因 |

运行单个 Case 文件：

```bash
node --import tsx --test tests/desktop-basic-bdd.test.ts
```

运行桌面端全部测试：

```bash
npm run test:desktop
```

运行 Agent 设置相关 Case：

```bash
node --import tsx --test tests/agent-team-direct.test.ts tests/agent-settings-bdd.test.ts
```

运行云端保存相关 Case：

```bash
node --import tsx --test tests/agent-cloud-validation.test.ts tests/backend-error.test.ts
```
