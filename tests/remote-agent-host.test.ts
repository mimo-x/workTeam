import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRuntime, AgentRuntimeEvent, RuntimeSession } from "../src/main/agent-runtime";
import { RemoteAgentHost } from "../src/main/remote-agent-host";
import type { ApprovalDecision, RpcRequestId } from "../src/shared/codex";

class FakeRuntime implements AgentRuntime {
  readonly provider = "fake";
  readonly capabilities = ["chat"] as const;
  sessionStarts = 0;
  turnStarts = 0;
  approvals: Array<{ requestId: RpcRequestId; decision: ApprovalDecision }> = [];
  failApprovals = false;
  private listener: ((event: AgentRuntimeEvent) => void) | undefined;

  onEvent(listener: (event: AgentRuntimeEvent) => void) {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = undefined;
    };
  }

  async startSession(): Promise<RuntimeSession> {
    this.sessionStarts += 1;
    return {
      sessionId: `session_${this.sessionStarts}`,
      providerSessionId: `provider_session_${this.sessionStarts}`,
    };
  }

  async startTurn() {
    this.turnStarts += 1;
    return { turnId: `turn_${this.turnStarts}` };
  }

  async steerTurn() {}

  async interruptTurn() {}

  async listSkills() {
    return [];
  }

  async resolveApproval(requestId: RpcRequestId, decision: ApprovalDecision) {
    if (this.failApprovals) throw new Error("provider request no longer exists");
    this.approvals.push({ requestId, decision });
  }

  requestApproval(requestId: string | number, turnId = "turn_1") {
    this.listener?.({
      method: "approval/requested",
      sessionId: "session_1",
      params: {
        requestId,
        turnId,
        method: "item/commandExecution/requestApproval",
        command: "npm test",
        cwd: "/tmp/project",
      },
    });
  }

  complete(turnId: string) {
    this.listener?.({
      method: "turn/completed",
      params: { turnId, turn: { id: turnId, status: "completed" } },
    });
  }
}

const assignment = (id: string) => ({
  id,
  taskId: "task_1",
  agentId: "agent_coder",
  title: "实现功能",
  sourceRoomId: "source_room",
  taskRoomId: "task_room",
  contextVersion: 1,
  taskRevision: 3,
  workspaceBindingId: "binding_1",
  workspaceBindingRevision: 1,
  targetDeviceId: "device_1",
  requestedScopes: ["workspace.read", "workspace.write"],
  leaseToken: "lease",
  agent: {
    name: "程序员",
    title: "Coder",
    mention: "@程序员",
    workspaceAccess: "write" as const,
    skillPolicy: "none" as const,
  },
  context: [],
});

test("RemoteAgentHost reuses one Runtime session for one Task and Agent", async () => {
  const runtime = new FakeRuntime();
  const resolved: Array<Record<string, unknown>> = [];
  const host = new RemoteAgentHost(undefined as never, runtime, {
    async resolve(input) {
      resolved.push(input);
      return "/tmp/project";
    },
  });
  (host as unknown as { deviceId: string }).deviceId = "device_1";
  const execute = (
    host as unknown as { execute(value: ReturnType<typeof assignment>): Promise<void> }
  ).execute;

  await execute.call(host, assignment("run_1"));
  runtime.complete("turn_1");
  await Promise.resolve();
  await execute.call(host, assignment("run_2"));

  assert.equal(runtime.sessionStarts, 1);
  assert.equal(runtime.turnStarts, 2);
  assert.equal(resolved.length, 2);
  host.stop();
});

test("RemoteAgentHost resolves the governed binding before launching a Runtime", async () => {
  const runtime = new FakeRuntime();
  const host = new RemoteAgentHost(undefined as never, runtime, {
    async resolve() {
      throw new Error("binding mismatch");
    },
  });
  (host as unknown as { deviceId: string }).deviceId = "device_1";

  await (
    host as unknown as { execute(value: ReturnType<typeof assignment>): Promise<void> }
  ).execute(assignment("run_rejected"));

  assert.equal(runtime.sessionStarts, 0);
  assert.equal(runtime.turnStarts, 0);
  host.stop();
});

test("RemoteAgentHost correlates approval requests and only resumes the exact Runtime request", async () => {
  const runtime = new FakeRuntime();
  const sent: Array<Record<string, unknown>> = [];
  const host = new RemoteAgentHost(undefined as never, runtime, {
    async resolve() {
      return "/tmp/project";
    },
  });
  (host as unknown as { deviceId: string }).deviceId = "device_1";
  (
    host as unknown as {
      socket: { readyState: number; send(value: string): void; close(): void };
    }
  ).socket = {
    readyState: WebSocket.OPEN,
    send(value) {
      sent.push(JSON.parse(value) as Record<string, unknown>);
    },
    close() {},
  };
  await (
    host as unknown as { execute(value: ReturnType<typeof assignment>): Promise<void> }
  ).execute(assignment("run_approval"));

  runtime.requestApproval(42);
  await new Promise((resolve) => setImmediate(resolve));
  const requested = sent.find((event) => event.type === "approval.requested");
  assert.ok(requested);
  assert.equal(requested.runId, "run_approval");
  assert.equal(requested.taskId, "task_1");
  assert.equal(requested.taskRevision, 3);
  assert.equal(requested.sessionId, "session_1");
  assert.equal(requested.turnId, "turn_1");
  assert.equal(requested.agentId, "agent_coder");
  assert.equal(requested.workspaceBindingId, "binding_1");
  assert.equal(requested.providerRequestId, "42");
  assert.equal(requested.requestedScope, "command.run");
  assert.deepEqual(requested.requestedConstraints, { commandExecutables: ["npm"] });

  const approvalId = String(requested.approvalId);
  const onServerEvent = (
    host as unknown as { onServerEvent(value: string): Promise<void> }
  ).onServerEvent.bind(host);
  await onServerEvent(
    JSON.stringify({
      type: "approval.resolved",
      approvalId,
      runId: "another_run",
      sessionId: "session_1",
      turnId: "turn_1",
      providerRequestId: "42",
      decision: "allow_once",
    }),
  );
  assert.equal(runtime.approvals.length, 0);
  await onServerEvent(
    JSON.stringify({
      type: "approval.resolved",
      approvalId,
      runId: "run_approval",
      sessionId: "session_1",
      turnId: "turn_1",
      providerRequestId: "42",
      decision: "allow_once",
    }),
  );
  assert.deepEqual(runtime.approvals, [{ requestId: 42, decision: "accept" }]);
  await onServerEvent(
    JSON.stringify({
      type: "approval.resolved",
      approvalId,
      runId: "run_approval",
      sessionId: "session_1",
      turnId: "turn_1",
      providerRequestId: "42",
      decision: "deny",
    }),
  );
  assert.equal(runtime.approvals.length, 1);

  runtime.requestApproval(43);
  await new Promise((resolve) => setImmediate(resolve));
  const deniedRequest = [...sent].reverse().find((event) => event.type === "approval.requested");
  await onServerEvent(
    JSON.stringify({
      type: "approval.resolved",
      approvalId: deniedRequest?.approvalId,
      runId: "run_approval",
      sessionId: "session_1",
      turnId: "turn_1",
      providerRequestId: "43",
      decision: "deny",
    }),
  );
  assert.deepEqual(runtime.approvals.at(-1), { requestId: 43, decision: "decline" });

  runtime.requestApproval(44);
  await new Promise((resolve) => setImmediate(resolve));
  const nonResumableRequest = [...sent]
    .reverse()
    .find((event) => event.type === "approval.requested");
  runtime.failApprovals = true;
  await onServerEvent(
    JSON.stringify({
      type: "approval.resolved",
      approvalId: nonResumableRequest?.approvalId,
      runId: "run_approval",
      sessionId: "session_1",
      turnId: "turn_1",
      providerRequestId: "44",
      decision: "allow_once",
    }),
  );
  assert.equal(
    sent.some(
      (event) =>
        event.type === "run.fail" && String(event.error).includes("APPROVAL_NON_RESUMABLE"),
    ),
    true,
  );
  host.stop();
});
