import assert from "node:assert/strict";
import test from "node:test";

import type { AgentDefinition } from "../src/shared/agent-team";
import {
  agentAvailability,
  formatAgentHeartbeat,
  splitAgentDirectory,
} from "../src/renderer/src/agent-availability";

const agent = (overrides: Partial<AgentDefinition> = {}): AgentDefinition => ({
  id: "agent_test",
  name: "测试 Agent",
  title: "测试员",
  mention: "@测试员",
  initials: "测",
  theme: "cyan",
  description: "用于验证 Agent 可用性。",
  instructions: "完成测试。",
  workspaceAccess: "read",
  visibility: "private",
  ownerId: "local_user",
  executionLocation: "local",
  ...overrides,
});

test("BDD: 当前用户的本机 Agent 没有注册中心心跳时仍然可用", () => {
  // Given: Agent 由当前用户拥有并在当前设备执行，但旧数据没有 Runtime 状态。
  const localAgent = agent({ runtimeStatus: "unknown", runtimeLastSeenAt: undefined });

  // When: 通讯录派生用户可见的可用性。
  const availability = agentAvailability(localAgent, 1_800_000);

  // Then: 当前设备执行路径优先于注册中心心跳，私聊入口保持可用。
  assert.equal(availability.kind, "local_available");
  assert.equal(availability.label, "本机可用");
  assert.equal(availability.executionLabel, "当前设备");
  assert.equal(availability.canMessage, true);
  assert.equal(availability.heartbeatLabel, "尚无心跳");
});

test("BDD: 其他用户的公开 Agent 有在线心跳时显示远程在线", () => {
  // Given: 可发现 Agent 的远程 Runtime 在两分钟前确认在线。
  const remoteAgent = agent({
    ownerId: "colleague",
    visibility: "public",
    executionLocation: "hosted",
    runtimeStatus: "online",
    runtimeLastSeenAt: 1_680_000,
  });

  // When: 通讯录派生用户可见的可用性。
  const availability = agentAvailability(remoteAgent, 1_800_000);

  // Then: 用户能看到执行位置、最近确认时间，并可发起私聊。
  assert.equal(availability.kind, "remote_online");
  assert.equal(availability.label, "远程在线");
  assert.equal(availability.executionLabel, "远程主机");
  assert.equal(availability.canMessage, true);
  assert.equal(availability.heartbeatLabel, "最后心跳 2 分钟前");
});

test("BDD: 离线或未知的可发现 Agent 保留在目录但不开放执行入口", () => {
  for (const runtimeStatus of ["offline", "unknown", undefined] as const) {
    const unavailableAgent = agent({
      ownerId: "colleague",
      visibility: "public",
      executionLocation: "hosted",
      runtimeStatus,
    });

    const availability = agentAvailability(unavailableAgent, 1_800_000);

    assert.equal(availability.kind, "no_host");
    assert.equal(availability.label, "暂无执行主机");
    assert.equal(availability.canMessage, false);
  }
});

test("相对心跳格式化显式使用 now，避免测试依赖系统时钟", () => {
  assert.equal(formatAgentHeartbeat(undefined, 3_600_000), "尚无心跳");
  assert.equal(formatAgentHeartbeat(3_575_000, 3_600_000), "最后心跳 刚刚");
  assert.equal(formatAgentHeartbeat(3_300_000, 3_600_000), "最后心跳 5 分钟前");
  assert.equal(formatAgentHeartbeat(0, 3_600_000), "尚无心跳");
});

test("Agent 目录将自己的全部 Agent 与他人的公开 Agent 分组", () => {
  const ownedPrivate = agent({ id: "owned-private" });
  const ownedPublic = agent({ id: "owned-public", visibility: "public" });
  const publicAgent = agent({ id: "public", ownerId: "colleague", visibility: "public" });
  const hiddenAgent = agent({ id: "hidden", ownerId: "colleague", visibility: "private" });

  const directory = splitAgentDirectory([ownedPrivate, ownedPublic, publicAgent, hiddenAgent]);

  assert.deepEqual(
    directory.ownedAgents.map(({ id }) => id),
    ["owned-private", "owned-public"],
  );
  assert.deepEqual(
    directory.publicAgents.map(({ id }) => id),
    ["public"],
  );
});
