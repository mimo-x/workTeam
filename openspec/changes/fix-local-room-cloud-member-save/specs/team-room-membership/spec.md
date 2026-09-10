## Purpose

确保桌面端按照房间真实同步来源选择成员保存通道，不把本地房间标识发送给云端 API。

## ADDED Requirements

### Requirement: Existing room save target follows room source

系统 SHALL 以已有房间的同步来源决定成员保存目标，成员自身的云端身份不得改变已有房间的保存通道。

#### Scenario: Save an existing local room containing a cloud-bound Agent

- **WHEN** 用户保存已有本地群，且已选 Agent 带有云端身份
- **THEN** 系统使用本地房间更新接口
- **AND** 系统不得请求 `/v1/rooms/:id/members`

#### Scenario: Save an existing backend room

- **WHEN** 用户保存已有云端群
- **THEN** 系统使用后端房间更新接口

### Requirement: New room save target follows cloud selection

系统 SHALL 仅在新建群时，根据云端模式与远端成员选择决定创建通道。

#### Scenario: Create a cloud room with a remote member

- **WHEN** 用户在云端模式新建群并选择远端成员
- **THEN** 系统通过后端创建云端群

#### Scenario: Create a local room without a remote member

- **WHEN** 用户新建群但未同时满足云端模式与远端成员选择
- **THEN** 系统创建本地群
