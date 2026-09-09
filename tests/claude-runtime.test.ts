import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { ClaudeRuntime } from "../src/main/claude-runtime";
import { AgentRuntimeRegistry } from "../src/main/runtime-registry";

test("ClaudeRuntime maps stream-json output and keeps a multi-turn session", async () => {
  const runtime = new ClaudeRuntime({
    command: process.execPath,
    argsPrefix: [join(process.cwd(), "tests/fixtures/fake-claude.mjs")],
  });
  const events: string[] = [];
  runtime.onEvent((event) => events.push(event.method));
  const session = await runtime.startSession({ workspace: process.cwd(), access: "read-only" });
  const turn = await runtime.startTurn(session.sessionId, process.cwd(), "测试");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.match(session.sessionId, /^[0-9a-f-]{36}$/);
  assert.match(turn.turnId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(events, [
    "runtime/status",
    "message/delta",
    "message/completed",
    "turn/completed",
  ]);
  runtime.dispose();
});

test("ClaudeRuntime rejects write sessions until desktop approval is integrated", async () => {
  const runtime = new ClaudeRuntime();
  await assert.rejects(
    runtime.startSession({ workspace: "/tmp/project", access: "workspace-write" }),
    (error: unknown) =>
      (error as { kind?: string; provider?: string; message?: string }).kind === "unsupported" &&
      (error as { provider?: string }).provider === "claude" &&
      (error as { message?: string }).message?.includes("只支持只读") === true,
  );
});

test("ClaudeRuntime can be registered as a built-in provider", () => {
  const registry = new AgentRuntimeRegistry();
  const runtime = new ClaudeRuntime();
  registry.register("claude", runtime);
  assert.equal(
    registry.resolve({
      id: "agent_claude",
      name: "Claude",
      title: "Claude",
      mention: "@Claude",
      initials: "C",
      theme: "violet",
      description: "",
      instructions: "",
      workspaceAccess: "read",
      visibility: "private",
      ownerId: "local_user",
      executionLocation: "local",
      runtime: { provider: "claude", protocol: "cli-stream-json", target: "local" },
    }),
    runtime,
  );
});
