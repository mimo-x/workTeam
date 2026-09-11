import assert from "node:assert/strict";
import test from "node:test";

import type { AgentDefinition } from "../src/shared/agent-team";
import { cloudAgentBody, validateAgentForCloud } from "../src/renderer/src/agent-cloud-payload";

const agent = (overrides: Partial<AgentDefinition> = {}): AgentDefinition => ({
  id: "agent_cloud_test",
  name: "测试 Agent",
  title: "测试角色",
  mention: "@测试Agent",
  initials: "测",
  theme: "cyan",
  description: "云端保存测试",
  instructions: "负责完成云端保存回归测试。",
  workspaceAccess: "read",
  visibility: "private",
  ownerId: "local_user",
  executionLocation: "local",
  runtime: { provider: "codex", protocol: "app-server", target: "local" },
  ...overrides,
});

test("BDD: 保存云端 Agent 时默认草稿满足后台请求格式", () => {
  // Given: 用户使用桌面端默认 Agent 草稿。
  const draft = agent();

  // When: 桌面端构造后台 POST /v1/agents 请求体。
  const body = cloudAgentBody(draft);

  // Then: 请求体通过前置校验，并包含后台所需的默认字段。
  assert.equal(validateAgentForCloud(draft), undefined);
  assert.equal(body.executionTarget, "local");
  assert.equal(body.provider, "codex");
  assert.deepEqual(body.runtimeArgs, []);
  assert.deepEqual(body.secrets, {});
});

test("BDD: 非法提及名称在发起云端请求前给出明确错误", () => {
  // Given: 用户把提及名称填写成包含空格的值。
  const draft = agent({ mention: "@测试 Agent" });

  // When: 保存前执行云端字段校验。
  const error = validateAgentForCloud(draft);

  // Then: 不发送模糊的 400 请求，直接指出提及名称规则。
  assert.match(error ?? "", /提及名称/);
});

test("BDD: 非 HTTPS 的远程 Runtime endpoint 在发起请求前被拒绝", () => {
  // Given: 用户配置了公网 HTTP endpoint。
  const draft = agent({
    executionLocation: "hosted",
    runtime: {
      provider: "custom-http",
      protocol: "http",
      target: "hosted",
      endpoint: "http://agent.example.com",
      auth: "none",
    },
  });

  // When: 保存前执行云端字段校验。
  const error = validateAgentForCloud(draft);

  // Then: 明确提示必须使用 HTTPS 或允许的本地地址。
  assert.match(error ?? "", /HTTPS/);
});
