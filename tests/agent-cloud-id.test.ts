import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { AgentDefinition } from "../src/shared/agent-team";
import {
  cloudAgentIdFor,
  hasInvalidCloudAgentMapping,
  isCloudAgentId,
} from "../src/shared/agent-cloud-id";

const teamChatSource = new URL("../src/renderer/src/team-chat.tsx", import.meta.url);

const agent = (overrides: Partial<AgentDefinition> = {}): AgentDefinition => ({
  id: "agent_coder",
  name: "程序员",
  title: "Coder",
  mention: "@coder",
  initials: "程",
  theme: "cyan",
  description: "编码 Agent",
  instructions: "完成编码任务。",
  workspaceAccess: "write",
  visibility: "private",
  ownerId: "local_user",
  executionLocation: "local",
  ...overrides,
});

test("BDD: 本地 Agent ID 不被识别为云端路径 ID", () => {
  // Given: 本地 Agent 使用稳定的非 UUID ID。
  const local = agent();

  // When: 请求边界解析云端 Agent ID。
  // Then: 不产生 /v1/agents/agent_coder 这样的后台路径参数。
  assert.equal(isCloudAgentId(local.id), false);
  assert.equal(cloudAgentIdFor(local), undefined);
});

test("BDD: 无效历史映射不会被发送到后台", () => {
  // Given: 历史数据保存了一个本地字符串作为 cloudAgentId。
  const legacy = agent({ cloudAgentId: "agent_coder" });

  // When: 桌面端准备云端请求。
  // Then: 该映射被识别为无效，调用方可以按本地 Agent 晋级处理。
  assert.equal(hasInvalidCloudAgentMapping(legacy), true);
  assert.equal(cloudAgentIdFor(legacy), undefined);
});

test("BDD: 有效云端 UUID 可以用于后台路径和请求体", () => {
  // Given: Agent 已经有后台返回的 UUID。
  const cloudId = "123e4567-e89b-12d3-a456-426614174000";
  const remote = agent({ id: cloudId, cloudAgentId: cloudId, syncSource: "backend" });

  // When: 桌面端解析云端 Agent ID。
  // Then: 保留 UUID，并允许进入云端请求。
  assert.equal(isCloudAgentId(cloudId), true);
  assert.equal(cloudAgentIdFor(remote), cloudId);
  assert.equal(hasInvalidCloudAgentMapping(remote), false);
});

test("BDD: Agent 云端操作统一经过 UUID 边界", async () => {
  // Given: Agent 设置、云端群和私聊共用同一个桌面端组件。
  const source = await readFile(teamChatSource, "utf8");

  // When: 检查所有需要后台 Agent ID 的请求分支。
  // Then: 组件使用统一解析函数，且不再把本地 ID作为回退值发送。
  assert.match(source, /cloudAgentIdFor\(agent\)/);
  assert.doesNotMatch(source, /agent\.cloudAgentId \?\? principalId/);
  assert.doesNotMatch(source, /agent\?\.cloudAgentId \?\? id/);
});
