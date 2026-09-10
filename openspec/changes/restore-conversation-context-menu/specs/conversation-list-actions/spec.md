## Purpose

恢复消息列表会话管理操作，并在本地与云端房间之间保持一致的安全行为。

## ADDED Requirements

### Requirement: Conversation context actions

消息列表中的每个会话 SHALL 在右键或长按时显示置顶和删除操作。

#### Scenario: Pin a conversation

- **WHEN** 用户选择“置顶会话”
- **THEN** 会话显示在未置顶会话之前，并可通过“取消置顶”恢复

#### Scenario: Remove a conversation from the list

- **WHEN** 用户确认“删除会话”
- **THEN** 会话从当前工作区的消息列表隐藏，但其群组、Task 和历史数据保持不变

#### Scenario: Receive a new message after removal

- **WHEN** 已隐藏会话收到时间更新的新消息
- **THEN** 会话自动重新出现在消息列表中
