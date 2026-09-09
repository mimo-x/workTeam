import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { OpenCodeRuntime } from "../src/main/opencode-runtime";

test("OpenCodeRuntime maps ACP session updates and prompt completion", async () => {
  const runtime = new OpenCodeRuntime({
    command: process.execPath,
    argsPrefix: [join(process.cwd(), "tests/fixtures/fake-opencode-acp.mjs")],
  });
  const events: Array<{ method: string; params: Record<string, unknown> }> = [];
  runtime.onEvent((event) => events.push({ method: event.method, params: event.params }));
  const session = await runtime.startSession({ workspace: process.cwd(), access: "read-only" });
  const turn = await runtime.startTurn(session.sessionId, process.cwd(), "测试");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(session.sessionId, "acp-session");
  assert.deepEqual(
    events.map((event) => event.method),
    ["runtime/status", "message/delta", "turn/completed"],
  );
  assert.equal(events[1].params.delta, "ACP 完成");
  assert.equal((events[2].params.turn as { id?: string }).id, turn.turnId);
  runtime.dispose();
});

test("OpenCodeRuntime rejects write sessions until ACP permission bridge is enabled", async () => {
  const runtime = new OpenCodeRuntime();
  await assert.rejects(
    runtime.startSession({ workspace: process.cwd(), access: "workspace-write" }),
    (error: unknown) =>
      (error as { kind?: string; provider?: string }).kind === "unsupported" &&
      (error as { provider?: string }).provider === "opencode",
  );
});

test("OpenCodeRuntime includes stderr in process exit failures", async () => {
  const runtime = new OpenCodeRuntime({
    command: process.execPath,
    argsPrefix: ["-e", "console.error('模拟 ACP 错误'); process.exit(1)"],
    timeoutMs: 100,
  });
  const errors: string[] = [];
  runtime.onEvent((event) => {
    if (event.method === "runtime/status" && event.params.error)
      errors.push(String(event.params.error));
  });
  await assert.rejects(
    runtime.startSession({ workspace: process.cwd(), access: "read-only" }),
    /模拟 ACP 错误/,
  );
  assert.match(errors.join("\n"), /模拟 ACP 错误/);
  runtime.dispose();
});
