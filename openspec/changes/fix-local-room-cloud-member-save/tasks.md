## 1. 回归 Case

- [x] 1.1 添加群组保存目标的 Given/When/Then 单元测试并确认旧逻辑失败。

## 2. 实现

- [x] 2.1 提取房间保存目标纯函数，区分已有本地房间、已有云端房间和新建房间。
- [x] 2.2 让 `RoomDialog` 使用共享决策函数，保留其他保存行为。

## 3. 验收

- [x] 3.1 运行目标回归、桌面测试、Bug 门禁、lint、typecheck 和 build。
- [x] 3.2 运行 `.githooks/pre-commit` 并回填 Bug 验证结果。
