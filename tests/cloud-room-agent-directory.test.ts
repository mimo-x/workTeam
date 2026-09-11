import assert from "node:assert/strict";
import test from "node:test";

import { mergeRoomAgentsIntoDirectory } from "../src/shared/cloud-room-agent-directory";
import type { AgentDefinition } from "../src/shared/agent-team";

const existingAgent: AgentDefinition = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "程序员",
  title: "Coder",
  mention: "@程序员",
  initials: "程序",
  theme: "cyan",
  description: "已有完整目录定义",
  instructions: "保留完整私有指令。",
  workspaceAccess: "write",
  visibility: "private",
  ownerId: "local_user",
  executionLocation: "local",
  syncSource: "backend",
};

test("BDD: 群内私有 Agent 即使不在全局可用目录中也能成为提及候选", () => {
  // Given: Bob 的全局 Agent 目录不包含 Alice 的私有 Agent，但共享房间 DTO 包含安全摘要。
  const roomAgentId = "22222222-2222-4222-8222-222222222222";

  // When: 桌面合并全局目录和房间 Agent 摘要。
  const agents = mergeRoomAgentsIntoDirectory(
    [existingAgent],
    [
      {
        id: roomAgentId,
        ownerId: "alice-user",
        openimUserId: "agt_22222222222242228222222222222222",
        name: "架构师",
        title: "Architect",
        mention: "@架构师",
        description: "群内可见的 Agent 摘要",
        visibility: "private",
        executionTarget: "local",
        provider: "codex",
        protocol: "app-server",
        capabilities: ["chat", "read_workspace"],
        runtimeStatus: "online",
        runtimeLastSeenAt: "2026-09-11T09:19:07.000Z",
        version: 2,
      },
    ],
    "bob-user",
  );

  // Then: 房间 Agent 被补入索引，可由 room.agentIds 找到，但不会被误认为 Bob 自己的 Agent。
  const roomAgent = agents.find((agent) => agent.id === roomAgentId);
  assert.equal(roomAgent?.mention, "@架构师");
  assert.equal(roomAgent?.ownerId, "alice-user");
  assert.equal(roomAgent?.openimUserId, "agt_22222222222242228222222222222222");
  assert.equal(roomAgent?.runtimeStatus, "online");
});

test("BDD: 房间摘要不能覆盖当前用户已有的完整 Agent 定义", () => {
  const agents = mergeRoomAgentsIntoDirectory(
    [existingAgent],
    [
      {
        id: existingAgent.id,
        ownerId: "owner-id",
        openimUserId: "agt_existing",
        name: existingAgent.name,
        title: existingAgent.title,
        mention: existingAgent.mention,
        description: "安全摘要",
        visibility: "private",
        executionTarget: "local",
        provider: "codex",
        protocol: "app-server",
        version: 2,
      },
    ],
    "owner-id",
  );

  assert.equal(agents[0].instructions, "保留完整私有指令。");
  assert.equal(agents[0].workspaceAccess, "write");
  assert.equal(agents.length, 1);
});
