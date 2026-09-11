import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canRetryAgentReply } from "../src/renderer/src/agent-message-actions";

import type { TeamMessage } from "../src/shared/agent-team";

const message = (overrides: Partial<TeamMessage> = {}): TeamMessage => ({
  id: "message",
  workspace: "/tmp/workspace",
  roomId: "room",
  seq: 1,
  senderId: "agent_coder",
  senderName: "程序员",
  senderType: "agent",
  content: "回答",
  createdAt: 1,
  updatedAt: 1,
  status: "complete",
  replyTo: "prompt",
  transport: "local",
  ...overrides,
});

test("BDD: completed, failed, and stopped chat replies can be answered again", () => {
  const replyTarget = message({
    id: "prompt",
    senderId: "local_user",
    senderName: "我",
    senderType: "user",
    content: "请回答",
    replyTo: undefined,
  });

  for (const status of ["complete", "error", "cancelled"] as const) {
    assert.equal(
      canRetryAgentReply({
        reply: message({ status }),
        replyTarget,
        executionLocation: "local",
        belongsToLoop: false,
      }),
      true,
    );
  }
});

test("BDD: active, Task, Loop, and hosted Agent replies do not expose retry", () => {
  const replyTarget = message({
    id: "prompt",
    senderType: "user",
    agentAction: "chat",
  });
  const base = {
    replyTarget,
    executionLocation: "local" as const,
    belongsToLoop: false,
  };

  assert.equal(canRetryAgentReply({ ...base, reply: message({ status: "streaming" }) }), false);
  assert.equal(canRetryAgentReply({ ...base, reply: message({ taskId: "task" }) }), false);
  assert.equal(canRetryAgentReply({ ...base, reply: message({ loopId: "loop" }) }), false);
  assert.equal(canRetryAgentReply({ ...base, reply: message(), belongsToLoop: true }), false);
  assert.equal(
    canRetryAgentReply({ ...base, reply: message(), executionLocation: "hosted" }),
    false,
  );
});

test("BDD: Team Chat wires the retry action through the desktop bridge", async () => {
  const [renderer, preload, main] = await Promise.all([
    readFile(new URL("../src/renderer/src/team-chat.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(renderer, /重新回答/);
  assert.match(renderer, /canRetryAgentReply/);
  assert.match(renderer, /window\.agentTeam\s*\.retryMessage/);
  assert.match(preload, /agent-team:retry-message/);
  assert.match(main, /agent-team:retry-message/);
});
