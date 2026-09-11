## Context

本地编排在 Agent Run 完成时只更新 Task 小群消息和 Task 状态；仅当来源消息来自 OpenIM 时才尝试转发原始 Agent 输出，而且不会写回本地来源群。云端编排始终把最终输出发送到 Task 小群；`task.children-aggregated` 是瞬时事件，不会进入来源群历史。

`AgentActionV1.complete` 已包含受验证的 `summary` 和 `artifactRefs`，但服务端只保存产物，丢弃了摘要。这些已有结果足以构建最终群总结，无需新增模型调用。

## Decisions

- 根 Task 从非 `done` 状态首次进入 `done` 时发布；进入 `review` 时不发布，子 Task 永不直接发布。
- Task 保存 `completionSummary`；结构化 complete 摘要优先，缺失时使用最终 Agent 输出，仍缺失时使用明确的无文本摘要提示。
- 所有子 Task 完成时，将子 Task 标题和摘要按创建顺序汇总到父 Task，并合并去重的产物引用。
- 结果消息优先使用完成 Task 的首位执行 Agent 作为发送身份；若身份不可用，云端回退到验收用户，本地回退到首位可用 Agent。
- 结果文本由共享纯函数构造并限制长度；凭据和绝对主机路径在进入来源群前脱敏。
- Task 的 `sourceSummaryPublishedAt` 与本地消息或云端 Outbox 记录在同一持久化边界内写入。重复 `done` 请求不再次发布；历史已为 `done` 的 Task 不自动补发。
- 云端结果消息扩展包含稳定 `kind=task-summary`、`taskId`、脱敏后的 `artifactRefs` 和 delivery key；房间消息 API 对这些字段做白名单解析，不透传任意 OpenIM `ex`。Outbox 重试复用 operation ID，消息镜像按 delivery key 去重。

## Compatibility

- 新数据库列允许为空，旧记录和旧客户端可以继续读取。
- `PATCH /v1/tasks/:id/status` 的请求和基础响应保持不变。
- 普通聊天消息缺少结果元数据时继续使用现有渲染。
- 截图中的后台 HTTP 404 独立处理，不在本 change 内修改。

## Validation

- 用失败 BDD Case 分别证明本地和云端来源群当前不会产生持久总结。
- 覆盖根/子 Task、重复验收、无摘要、产物去重、消息 DTO 白名单和迁移升级。
- 运行项目全量门禁并回填 Bug 与任务清单。
