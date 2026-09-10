# openim-messaging Specification

## Purpose

保证桌面端在 OpenIM 原生消息工厂返回异常值时仍能构造并发送文本消息，并支持群聊中提及好友。

## ADDED Requirements

### Requirement: Text messages remain sendable when native factory data is empty

桌面端 SHALL validate the result of the OpenIM text-message factory before mutating it. If the result is not a message object, it SHALL construct a valid text message with a unique client ID, text content, session type, platform, and sending status, then send it through the normal OpenIM API.

#### Scenario: Native factory returns an empty string for a direct message

- **GIVEN** OpenIM is connected and the native `createTextMessage` result is an empty string
- **WHEN** the user sends a direct text message to a friend
- **THEN** the desktop client sends a valid OpenIM text message and does not display a JavaScript property-assignment error

### Requirement: Group composers can mention friends

群聊编辑器 SHALL expose current group friends as mention candidates, include their OpenIM IDs in an @ message, and continue to route Agent IDs separately for Agent execution.

#### Scenario: A friend is invited and mentioned in a group

- **GIVEN** a friend is a member of the current group
- **WHEN** the user selects the friend from the @ candidates and sends the message
- **THEN** the OpenIM message contains the friend's OpenIM ID as an at target and the message is sent without creating an Agent Task for that friend
