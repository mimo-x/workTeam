## Context

现有 AgentSettings 在自定义 Modal 内写死暗色表面和原生表单样式，无法跟随根节点主题变量。

## Decisions

- 使用已有 shadcn Dialog，获得一致的遮罩、关闭行为与可访问标题。
- 使用 Input、Textarea、Select、Button、Badge 取代手工控件外观。
- 保留双栏信息架构和全部业务事件，仅调整表现层。

## Validation

- 源码回归测试确保 AgentSettings 不含固定暗色类。
- 运行桌面测试、lint、typecheck、build 与 Bug 门禁。
