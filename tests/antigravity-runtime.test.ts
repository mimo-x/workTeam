import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { AntigravityRuntime } from "../src/main/antigravity-runtime";
import { AgentRuntimeRegistry } from "../src/main/runtime-registry";

test("AntigravityRuntime maps headless NDJSON events and keeps a Session", async () => {
  const runtime = new AntigravityRuntime({
    command: process.execPath,
    argsPrefix: [join(process.cwd(), "tests/fixtures/fake-antigravity.mjs")],
  });
  const events: Array<{ method: string; params: Record<string, unknown> }> = [];
  runtime.onEvent((event) => events.push({ method: event.method, params: event.params }));
  const session = await runtime.startSession({ workspace: process.cwd(), access: "read-only" });
  const turn = await runtime.startTurn(session.sessionId, process.cwd(), "测试");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.match(session.sessionId, /^[0-9a-f-]{36}$/);
  assert.match(turn.turnId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    events.map((event) => event.method),
    ["runtime/status", "message/delta", "message/completed", "turn/completed"],
  );
  assert.equal(events[1].params.delta, "AGY 完成");
  assert.equal(events[2].params.text, "AGY 完成");
  runtime.dispose();
});

test("AntigravityRuntime exposes read-only support and registers as built-in", async () => {
  const runtime = new AntigravityRuntime();
  const registry = new AgentRuntimeRegistry();
  registry.register("antigravity", runtime);
  assert.equal(runtime.capabilities.includes("read_workspace"), true);
  await assert.rejects(
    runtime.startSession({ workspace: process.cwd(), access: "workspace-write" }),
    /只支持只读/,
  );
});
