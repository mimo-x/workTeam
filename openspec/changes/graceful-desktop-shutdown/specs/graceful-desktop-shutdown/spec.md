## ADDED Requirements

### Requirement: 退出请求必须幂等

系统 SHALL 将重复的窗口关闭或进程退出请求合并为一次清理流程。

#### Scenario: 重复触发退出

- **WHEN** 首次清理尚未完成时再次触发退出
- **THEN** 系统 SHALL 复用首次清理 Promise，且每项资源只清理一次

### Requirement: 资源必须有序释放

系统 SHALL 在 Electron 进程结束前依次停止后台 Host、Agent Runtime、OpenIM 和 Codex 资源。

#### Scenario: 正常关闭窗口

- **WHEN** 用户点击窗口关闭按钮
- **THEN** 系统 SHALL 等待退出清理完成后再结束 Electron

### Requirement: 单项清理失败不能阻塞退出

系统 SHALL 记录清理错误并继续释放剩余资源，最终完成退出。

#### Scenario: 原生 SDK 清理失败

- **WHEN** 某一项资源释放抛出错误
- **THEN** 后续资源 SHALL 继续清理，Electron SHALL 最终退出
