## 1. Agent ID 边界

- [x] 1.1 增加严格 UUID 和云端 Agent ID 解析工具。
- [x] 1.2 修复 Agent 保存、删除、私聊和云端群成员流程。
- [x] 1.3 增加无效映射与请求路径 BDD。

## 2. OpenIM 生命周期

- [x] 2.1 抽出可测试的 logout/unInit 串行生命周期。
- [x] 2.2 在 renderer 卸载和账号切换时调用统一断开流程。
- [x] 2.3 增加生命周期回归 Case，并保留 native arm64 手动复核项。

## 3. 验收

- [x] 3.1 运行桌面测试、Bug 门禁、Lint、typecheck 和 build。
- [ ] 3.2 在 macOS arm64 真实 OpenIM 环境复核 `OnKickedOffline` 不再导致 Electron 退出。
