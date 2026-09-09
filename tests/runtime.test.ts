import assert from "node:assert/strict";
import test from "node:test";

import type { CodexEvent } from "../src/shared/codex";
import { CodexRuntime } from "../src/main/codex-runtime";

class FakeCodexServer {
  startThreadError?: unknown;
  private listeners = new Set<(event: CodexEvent) => void>();

  onEvent(listener: (event: CodexEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async startThread() {
    if (this.startThreadError) throw this.startThreadError;
    return { threadId: "thread_1" };
  }

  async startTurn() {
    return { turnId: "turn_1" };
  }

  async steerTurn() {}

  async interruptTurn() {}

  async listSkills() {
    return [];
  }

  async resolveApproval() {}

  emit(event: CodexEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

test("CodexRuntime normalizes provider events and preserves session identity", async () => {
  const codex = new FakeCodexServer();
  const runtime = new CodexRuntime(codex as never);
  const events: Array<{ method: string; sessionId?: string; params: Record<string, unknown> }> = [];
  runtime.onEvent((event) => events.push(event));

  const session = await runtime.startSession({
    workspace: "/tmp/runtime-test",
    access: "read-only",
    model: "gpt-5.5",
  });
  const turn = await runtime.startTurn(session.sessionId, "/tmp/runtime-test", "测试");
  codex.emit({ method: "item/agentMessage/delta", params: { turnId: turn.turnId, delta: "你好" } });
  codex.emit({
    method: "item/completed",
    params: { turnId: turn.turnId, item: { type: "agentMessage", text: "你好" } },
  });
  codex.emit({
    method: "turn/completed",
    params: { turn: { id: turn.turnId, status: "completed" } },
  });

  assert.equal(session.sessionId, "thread_1");
  assert.deepEqual(
    events.map(({ method, sessionId }) => ({ method, sessionId })),
    [
      { method: "message/delta", sessionId: "thread_1" },
      { method: "message/completed", sessionId: "thread_1" },
      { method: "turn/completed", sessionId: "thread_1" },
    ],
  );
  assert.equal(events[0].params.delta, "你好");
  assert.equal(events[1].params.text, "你好");
});

test("CodexRuntime exposes provider and raw details on failures", async () => {
  const codex = new FakeCodexServer();
  codex.startThreadError = {
    message: 'Model "gpt-6-astra" is not supported by any configured account in this group',
    status: 404,
  };
  const runtime = new CodexRuntime(codex as never);

  await assert.rejects(
    runtime.startSession({ workspace: "/tmp/runtime-test", access: "read-only" }),
    (error: unknown) => {
      const value = error as { provider?: string; kind?: string; raw?: unknown; message?: string };
      return (
        value.provider === "codex" &&
        value.kind === "provider" &&
        value.raw === codex.startThreadError &&
        value.message?.includes("gpt-6-astra") === true
      );
    },
  );
});
