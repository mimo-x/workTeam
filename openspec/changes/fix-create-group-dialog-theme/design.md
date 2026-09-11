## Context

应用根节点通过 CSS 变量切换主题，消息主界面也已迁移到语义色；`RoomDialog` 仍以自定义 `Modal` 包裹固定 `#11151e`、black、white、zinc 与 cyan 色阶，因而绕过主题变量。

## Goals / Non-Goals

目标：新建和管理群组使用同一套主题感知的弹窗结构，复用现有设计系统组件，同时保持所有保存与成员选择逻辑不变。范围外：改造其他遗留设置弹窗、修改群组数据模型或重做通讯录交互。

## Decisions

使用项目现有 Base Nova `Dialog`、`Input` 与 `Button` 组合弹窗；表面、边框、文字和选中状态分别使用 `popover`、`border`、`foreground`、`muted-foreground`、`primary`、`success`、`destructive` 等语义 token。Agent 头像继续使用已有 `themeClasses` 语义映射。

## Risks / Trade-offs

Base UI Dialog 通过 Portal 渲染且接管焦点与 Esc 关闭行为，与旧的绝对定位遮罩实现不同；使用受控 `open` 状态并将关闭事件映射到 `onClose`，确保行为一致且提升可访问性。
