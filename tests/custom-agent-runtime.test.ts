import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { CustomCliRuntime, CustomHttpRuntime } from "../src/main/custom-agent-runtime";
import { AgentRuntimeRegistry } from "../src/main/runtime-registry";
import {
  CUSTOM_AGENT_PROTOCOL_VERSION,
  parseCustomAgentManifest,
} from "../src/shared/agent-protocol";

const httpManifest = {
  protocolVersion: CUSTOM_AGENT_PROTOCOL_VERSION,
  agentId: "remote_agent",
  name: "远程 Agent",
  version: "1.0.0",
  capabilities: ["chat"],
  transport: "http" as const,
  endpoint: "http://127.0.0.1:39001",
  auth: "bearer" as const,
};

test("custom Agent manifest validates protocol and transport requirements", () => {
  assert.equal(parseCustomAgentManifest(httpManifest).agentId, "remote_agent");
  assert.throws(
    () => parseCustomAgentManifest({ ...httpManifest, protocolVersion: 2 }),
    /不支持的 Agent 协议版本/,
  );
  assert.throws(
    () => new CustomHttpRuntime({ ...httpManifest, endpoint: "http://example.com" }, "secret"),
    /HTTPS/,
  );
});

test("runtime registry binds a custom manifest and rejects missing capabilities", () => {
  const registry = new AgentRuntimeRegistry();
  const runtime = registry.registerCustom(httpManifest, "secret");
  assert.equal(
    registry.resolve({
      id: "remote_agent",
      name: "远程 Agent",
      title: "Agent",
      mention: "@远程Agent",
      initials: "远",
      theme: "cyan",
      description: "",
      instructions: "完成任务",
      workspaceAccess: "read",
      visibility: "public",
      ownerId: "user_1",
      executionLocation: "hosted",
      source: "registry",
      runtime: { provider: "remote_agent", protocol: "http", target: "hosted" },
    }),
    runtime,
  );
  registry.assertCapabilities(runtime, ["chat"]);
  assert.throws(() => registry.assertCapabilities(runtime, ["write_workspace"]), /不支持所需能力/);
});

test("runtime registry lazily creates a custom runtime from an Agent binding", () => {
  const registry = new AgentRuntimeRegistry();
  const runtime = registry.resolve({
    id: "custom-http-agent",
    name: "自定义 HTTP Agent",
    title: "Agent",
    mention: "@custom",
    initials: "自",
    theme: "cyan",
    description: "",
    instructions: "完成任务",
    workspaceAccess: "read",
    visibility: "private",
    ownerId: "local_user",
    executionLocation: "hosted",
    source: "registry",
    capabilities: ["chat"],
    runtime: {
      provider: "custom-http",
      protocol: "http",
      target: "hosted",
      endpoint: "http://127.0.0.1:39002",
      auth: "none",
    },
  });
  assert.equal(runtime.provider, "custom-http");
  assert.deepEqual(runtime.capabilities, ["chat"]);
});

test("runtime registry resolves a stored Bearer credential for custom HTTP Agents", async () => {
  const originalFetch = globalThis.fetch;
  const headers: Array<HeadersInit | undefined> = [];
  globalThis.fetch = (async (_input, init) => {
    headers.push(init?.headers);
    return new Response(JSON.stringify({ sessionId: "secured_session" }), { status: 200 });
  }) as typeof fetch;
  try {
    const registry = new AgentRuntimeRegistry();
    registry.setCredentialResolver(() => "secret-token");
    const runtime = registry.resolve({
      id: "secured-agent",
      name: "受保护 Agent",
      title: "Agent",
      mention: "@secured",
      initials: "保",
      theme: "cyan",
      description: "",
      instructions: "完成任务",
      workspaceAccess: "read",
      visibility: "private",
      ownerId: "local_user",
      executionLocation: "local",
      runtime: {
        provider: "custom-http",
        protocol: "http",
        target: "local",
        endpoint: "http://127.0.0.1:39003",
        auth: "bearer",
      },
      capabilities: ["chat"],
    });
    await runtime.startSession({ workspace: "/tmp/project", access: "read-only" });
    assert.equal(new Headers(headers[0]).get("authorization"), "Bearer secret-token");
    registry.dispose();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CustomHttpRuntime does not send local workspace by default and streams events", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const encoder = new TextEncoder();
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, body });
    if (url.endsWith("/sessions"))
      return new Response(JSON.stringify({ sessionId: "remote_session" }), { status: 200 });
    if (url.endsWith("/turns"))
      return new Response(JSON.stringify({ turnId: "remote_turn" }), { status: 200 });
    if (url.endsWith("/health")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "message.completed", turnId: "remote_turn", data: { text: "远程完成" } })}\n\n`,
          ),
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "turn.completed", turnId: "remote_turn", data: { status: "completed" } })}\n\n`,
          ),
        );
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;

  try {
    const runtime = new CustomHttpRuntime(httpManifest, "secret");
    const events: string[] = [];
    runtime.onEvent((event) => events.push(event.method));
    await runtime.startSession({ workspace: "/private/project", access: "read-only" });
    assert.equal(await runtime.checkHealth(), true);
    await runtime.startTurn("remote_session", "/private/project", "测试");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(requests[0].body?.workspace, undefined);
    assert.deepEqual(events, ["message/completed", "turn/completed"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CustomCliRuntime requires JSONL handshake and reports completed turns", async () => {
  const runtime = new CustomCliRuntime({
    protocolVersion: CUSTOM_AGENT_PROTOCOL_VERSION,
    agentId: "local_agent",
    name: "本地 Agent",
    version: "1.0.0",
    capabilities: ["chat"],
    transport: "cli-jsonl",
    command: process.execPath,
    args: [join(process.cwd(), "tests/fixtures/custom-agent-cli.mjs")],
  });
  const events: string[] = [];
  runtime.onEvent((event) => events.push(event.method));
  const session = await runtime.startSession({ workspace: "/tmp/project", access: "read-only" });
  await runtime.startTurn(session.sessionId, "/tmp/project", "测试");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(events, ["message/completed", "turn/completed"]);
  runtime.dispose();
});

test("CustomCliRuntime turns a non-zero process exit into a failed turn", async () => {
  const runtime = new CustomCliRuntime({
    protocolVersion: CUSTOM_AGENT_PROTOCOL_VERSION,
    agentId: "failing_agent",
    name: "失败 Agent",
    version: "1.0.0",
    capabilities: ["chat"],
    transport: "cli-jsonl",
    command: process.execPath,
    args: [join(process.cwd(), "tests/fixtures/custom-agent-cli.mjs")],
  });
  const failures: Array<Record<string, unknown>> = [];
  runtime.onEvent((event) => {
    if (event.method === "turn/completed") failures.push(event.params);
  });
  const session = await runtime.startSession({ workspace: "/tmp/project", access: "read-only" });
  const turn = await runtime.startTurn(session.sessionId, "/tmp/project", "fail");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(failures[0]?.turn?.status, "failed");
  assert.equal((failures[0]?.turn as { id?: string })?.id, turn.turnId);
  assert.match(String((failures[0]?.turn as { error?: string })?.error), /模拟 CLI 错误/);
  runtime.dispose();
});
