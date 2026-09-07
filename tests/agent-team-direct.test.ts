import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CodexEvent } from "../src/shared/codex";
import { AgentTeamService } from "../src/main/agent-team";
import type { CodexAppServer } from "../src/main/codex-app-server";

class FakeCodex {
  private listeners = new Set<(event: CodexEvent) => void>();
  threadStarts = 0;
  prompts: string[] = [];

  onEvent(listener: (event: CodexEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async startThread() {
    this.threadStarts += 1;
    return { threadId: `thread_${this.threadStarts}` };
  }

  async startTurn(_threadId: string, _workspace: string, prompt: string) {
    this.prompts.push(prompt);
    const turnId = `turn_${this.prompts.length}`;
    queueMicrotask(() => {
      this.emit({
        method: "item/completed",
        params: { turnId, item: { type: "agentMessage", text: `reply_${this.prompts.length}` } },
      });
      this.emit({
        method: "turn/completed",
        params: { turn: { id: turnId, status: "completed" } },
      });
    });
    return { turnId };
  }

  async interruptTurn() {}

  private emit(event: CodexEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

const waitFor = async (condition: () => Promise<boolean>) => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for Agent response");
};

test("Agent and friend direct messages reuse rooms and do not create Tasks", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-team-direct-"));
  const workspace = "/tmp/direct-message-workspace";
  const codex = new FakeCodex();
  const service = new AgentTeamService(codex as unknown as CodexAppServer, storeDir);

  try {
    const before = await service.getWorkspace(workspace);
    const firstRoom = await service.openDirectRoom(workspace, "agent_coordinator");
    const reusedRoom = await service.openDirectRoom(workspace, "agent_coordinator");
    assert.equal(firstRoom.roomId, reusedRoom.roomId);
    assert.equal(firstRoom.type, "direct");

    const firstSend = await service.sendMessage({
      workspace,
      roomId: firstRoom.roomId,
      text: "记住暗号：青鸟",
    });
    assert.equal(firstSend.taskId, undefined);
    assert.equal(firstSend.runIds.length, 1);
    await waitFor(async () => {
      const current = await service.getWorkspace(workspace);
      return Boolean(
        current.rooms
          .find((room) => room.roomId === firstRoom.roomId)
          ?.messages.some(
            (message) => message.senderType === "agent" && message.status === "complete",
          ),
      );
    });

    await service.sendMessage({
      workspace,
      roomId: firstRoom.roomId,
      text: "我刚才的暗号是什么？",
    });
    await waitFor(
      async () =>
        (await service.getWorkspace(workspace)).rooms
          .find((room) => room.roomId === firstRoom.roomId)!
          .messages.filter(
            (message) => message.senderType === "agent" && message.status === "complete",
          ).length === 2,
    );

    const friendRoom = await service.openDirectRoom(workspace, "friend_demo");
    const friendSend = await service.sendMessage({
      workspace,
      roomId: friendRoom.roomId,
      text: "你好",
    });
    const after = await service.getWorkspace(workspace);

    assert.deepEqual(friendSend.runIds, []);
    assert.equal(after.tasks.length, before.tasks.length);
    assert.equal(codex.threadStarts, 1, "the Agent DM should keep one continuous Codex thread");
    assert.match(codex.prompts[1], /青鸟/);
    assert.equal(after.rooms.find((room) => room.roomId === friendRoom.roomId)?.messages.length, 1);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await rm(storeDir, { recursive: true, force: true });
  }
});
