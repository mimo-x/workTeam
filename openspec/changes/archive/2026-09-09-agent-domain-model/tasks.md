## 1. Domain Types

- [x] 1.1 定义 Agent Manifest、Provider、Runtime binding 和 capability 类型，并通过 TypeScript 类型检查验证
- [x] 1.2 将现有 AgentDefinition 映射到新模型，并为旧持久化数据添加兼容默认值；通过现有 Agent 加载测试验证

## 2. Persistence

- [x] 2.1 增加本地 Agent 数据版本和迁移路径；使用旧格式样本验证加载后身份与权限不变
- [x] 2.2 保证 OpenIM ID、Provider session ID 不覆盖稳定 Agent ID；增加回归测试验证身份稳定

## 3. Contract Verification

- [x] 3.1 为内置 Agent 和自定义 Agent 构造有效 Manifest 样例，并通过 OpenSpec 场景测试验证字段完整性
- [x] 3.2 运行 \`npm run typecheck\`、\`npm run lint\` 和 Agent 集成测试确认领域模型无回归
