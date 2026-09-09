import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRuntime, AgentRuntimeEvent, RuntimeSession } from "../src/main/agent-runtime";
import { RemoteAgentHost } from "../src/main/remote-agent-host";

class FakeRuntime implements AgentRuntime {
  readonly provider = "fake";
  readonly capabilities = ["chat"] as const;
  sessionStarts = 0;
  turnStarts = 0;
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

  async resolveApproval() {}

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
  const host = new RemoteAgentHost(undefined as never, runtime);
  const execute = (
    host as unknown as { execute(value: ReturnType<typeof assignment>): Promise<void> }
  ).execute;

  await execute.call(host, assignment("run_1"));
  runtime.complete("turn_1");
  await Promise.resolve();
  await execute.call(host, assignment("run_2"));

  assert.equal(runtime.sessionStarts, 1);
  assert.equal(runtime.turnStarts, 2);
  host.stop();
});
