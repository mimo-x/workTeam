## MODIFIED Requirements

### Requirement: Group Agent membership is consistently represented

群成员保存成功后，管理页和聊天 `@` 候选 SHALL 一致显示后台已正式加入房间的 Agent；房间响应引用的 Agent SHALL NOT 因独立目录分页或合并遗漏而消失。

#### Scenario: Owner replaces group Agent members

- **WHEN** 群主在管理页选择自己的 Agent 并保存
- **THEN** 重新同步后的选中状态与服务器正式成员一致
- **AND** 已入群 Agent 出现在 `@` 候选中

#### Scenario: Saved membership cannot be reconciled

- **WHEN** 保存目标与重新同步结果不一致
- **THEN** 管理页保留当前操作并显示可诊断错误
- **AND** 不静默呈现为保存成功

