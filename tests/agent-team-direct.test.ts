import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentTeamService, DEFAULT_AGENTS } from "../src/main/agent-team";
import { agentManifestFromDefinition } from "../src/shared/agent-team";
import type { AgentRuntime, AgentRuntimeEvent } from "../src/main/agent-runtime";

class FakeCodex {
  readonly provider = "fake";
  readonly capabilities = ["chat", "stream_progress"] as const;
  private listeners = new Set<(event: AgentRuntimeEvent) => void>();
  threadStarts = 0;
  prompts: string[] = [];
  responses: string[] = [];
  nextTurnError?: unknown;
  private readonly sessions = new Set<string>();
  sessionInputs: Array<string | undefined> = [];

  onEvent(listener: (event: AgentRuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async startThread() {
    this.threadStarts += 1;
    return { threadId: `thread_${this.threadStarts}` };
  }

  hasSession(sessionId: string) {
    return this.sessions.has(sessionId);
  }

  async startSession(input?: { providerSessionId?: string }) {
    this.sessionInputs.push(input?.providerSessionId);
    const threadId = input?.providerSessionId ?? (await this.startThread()).threadId;
    this.sessions.add(threadId);
    return { sessionId: threadId, providerSessionId: threadId };
  }

  async startTurn(_threadId: string, _workspace: string, prompt: string) {
    this.prompts.push(prompt);
    const turnId = `turn_${this.prompts.length}`;
    const response = this.responses.shift() ?? `reply_${this.prompts.length}`;
    queueMicrotask(() => {
      if (this.nextTurnError !== undefined) {
        const err = this.nextTurnError;
        this.nextTurnError = undefined;
        this.emit({
          method: "turn/completed",
          params: { turn: { id: turnId, status: "failed", error: err } },
        });
        return;
      }
      this.emit({
        method: "message/completed",
        params: { turnId, text: response },
      });
      this.emit({
        method: "turn/completed",
        params: { turn: { id: turnId, status: "completed" } },
      });
    });
    return { turnId };
  }

  async interruptTurn() {}

  async steerTurn() {}

  async listSkills() {
    return [];
  }

  async resolveApproval() {}

  private emit(event: AgentRuntimeEvent) {
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
  const service = new AgentTeamService(codex as unknown as AgentRuntime, storeDir);

  try {
    const before = await service.getWorkspace(workspace);
    const manifest = agentManifestFromDefinition(DEFAULT_AGENTS[2]);
    assert.equal(manifest.agentId, "agent_coder");
    assert.equal(manifest.source, "builtin");
    assert.equal(manifest.runtime.provider, "codex");
    assert.ok(manifest.capabilities.includes("write_workspace"));
    assert.equal(manifest.permissions.requiresApproval, true);
    const customManifest = agentManifestFromDefinition({
      ...DEFAULT_AGENTS[2],
      id: "custom_agent",
      name: "外部 Agent",
      ownerId: "user_123",
      source: "registry",
      runtime: { provider: "custom", protocol: "http", target: "hosted" },
      capabilities: ["chat"],
    });
    assert.equal(customManifest.source, "registry");
    assert.equal(customManifest.runtime.protocol, "http");
    assert.deepEqual(customManifest.capabilities, ["chat"]);
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
    const firstSnapshot = await service.getWorkspace(workspace);
    const firstSession = firstSnapshot.sessions.find(
      (session) => session.agentId === "agent_coordinator",
    )!;
    assert.equal(firstSession.state, "waiting");
    assert.equal(firstSession.provider, "fake");
    assert.ok(firstSession.providerThread?.providerSessionId);
    assert.ok(
      firstSnapshot.rooms
        .find((room) => room.roomId === firstRoom.roomId)
        ?.messages.some((message) => message.sessionId === firstSession.id),
    );

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
    const secondSnapshot = await service.getWorkspace(workspace);
    assert.equal(
      secondSnapshot.sessions.filter((session) => session.agentId === "agent_coordinator").length,
      1,
      "the Agent direct room should reuse one product Session",
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
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("legacy workspace data is upgraded without changing Agent identity or permissions", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-domain-migration-"));
  const workspace = "/tmp/agent-domain-migration-workspace";
  const seed = new AgentTeamService(new FakeCodex() as unknown as AgentRuntime, storeDir);

  try {
    const snapshot = await seed.getWorkspace(workspace);
    const legacy = {
      ...snapshot,
      version: 3,
      agents: snapshot.agents.map(
        ({ source: _source, runtime: _runtime, capabilities: _capabilities, ...agent }) => agent,
      ),
      sessions: [
        {
          id: "session_running",
          agentId: "agent_coder",
          workspace,
          roomId: snapshot.rooms[0].roomId,
          provider: "codex",
          state: "running",
          contextVersion: 2,
          consumedContextVersion: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          providerThread: { provider: "codex", providerSessionId: "thread_old" },
        },
      ],
    };
    const key = createHash("sha256").update(workspace).digest("hex").slice(0, 24);
    await writeFile(join(storeDir, `workspace-${key}.json`), JSON.stringify(legacy), "utf8");

    const restoredService = new AgentTeamService(
      new FakeCodex() as unknown as AgentRuntime,
      storeDir,
    );
    const restored = await restoredService.getWorkspace(workspace);
    const coder = restored.agents.find((agent) => agent.id === "agent_coder")!;
    assert.equal(coder.id, "agent_coder");
    assert.equal(coder.workspaceAccess, "write");
    assert.equal(coder.runtime?.provider, "codex");
    assert.ok(coder.capabilities?.includes("write_workspace"));
    const interrupted = restored.sessions.find((session) => session.id === "session_running")!;
    assert.equal(interrupted.state, "failed");
    assert.equal(interrupted.error, "应用上次退出时 Session 仍在运行。");
    assert.throws(
      () =>
        (
          restoredService as unknown as {
            transitionSession(session: typeof interrupted, next: "running"): void;
          }
        ).transitionSession(interrupted, "running"),
      /不能从 failed 转换为 running/,
    );

    await restoredService.flush();
    const upgraded = JSON.parse(await readFile(join(storeDir, `workspace-${key}.json`), "utf8"));
    assert.equal(upgraded.version, 5);
  } finally {
    await seed.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("Given 本地协作群 When 加入云端成员 Then 房间和已有消息迁移到云端 UUID", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-team-room-promotion-"));
  const workspace = "/tmp/room-promotion-workspace";
  const service = new AgentTeamService(new FakeCodex() as unknown as AgentRuntime, storeDir);
  const cloudRoomId = "11111111-1111-4111-8111-111111111111";
  try {
    const localRoom = await service.createRoom(
      workspace,
      "协作群",
      ["agent_coder"],
      ["local_user"],
    );
    await service.sendMessage({ workspace, roomId: localRoom.roomId, text: "保留这条上下文" });
    const promoted = await service.promoteRoom(
      workspace,
      localRoom.roomId,
      cloudRoomId,
      "openim-group-1",
      1,
      ["local_user"],
      ["agent_coder"],
    );
    const snapshot = await service.getWorkspace(workspace);
    assert.equal(promoted.roomId, cloudRoomId);
    assert.equal(
      snapshot.rooms.some((room) => room.roomId === localRoom.roomId),
      false,
    );
    assert.equal(
      snapshot.rooms.find((room) => room.roomId === cloudRoomId)?.messages[0]?.roomId,
      cloudRoomId,
    );
    assert.equal(snapshot.rooms.find((room) => room.roomId === cloudRoomId)?.syncSource, "backend");
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("custom Runtime binding survives workspace normalization", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-runtime-binding-"));
  const workspace = "/tmp/agent-runtime-binding-workspace";
  const service = new AgentTeamService(new FakeCodex() as unknown as AgentRuntime, storeDir);
  try {
    const initial = await service.getWorkspace(workspace);
    const custom = {
      ...initial.agents[0],
      id: "custom_http_agent",
      runtime: {
        provider: "custom-http",
        protocol: "http",
        target: "local" as const,
        endpoint: "https://agent.example.com",
        auth: "bearer" as const,
        args: ["--strict"],
      },
    };
    await service.saveAgents(workspace, [...initial.agents.slice(1), custom]);
    const restored = await service.getWorkspace(workspace);
    const runtime = restored.agents.find((agent) => agent.id === custom.id)?.runtime;
    assert.equal(runtime?.provider, custom.runtime.provider);
    assert.equal(runtime?.endpoint, custom.runtime.endpoint);
    assert.equal(runtime?.auth, custom.runtime.auth);
    assert.deepEqual(runtime?.args, custom.runtime.args);
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("BDD: 用户添加有效 Agent 后重新打开工作区仍能看到该 Agent", async () => {
  // Given: 用户打开一个已有默认 Agent 的工作区，并填写新的本地 Agent。
  const storeDir = await mkdtemp(join(tmpdir(), "agent-add-bdd-"));
  const workspace = "/tmp/agent-add-bdd-workspace";
  const service = new AgentTeamService(new FakeCodex() as unknown as AgentRuntime, storeDir);

  try {
    const initial = await service.getWorkspace(workspace);
    const custom = {
      ...initial.agents[0],
      id: "custom_reviewer",
      name: "审查员",
      title: "代码审查",
      mention: "@审查员",
      initials: "审",
      description: "检查实现质量和回归风险",
      instructions: "你负责审查代码、指出风险并给出可执行的修复建议。",
      source: "local" as const,
      runtime: { provider: "codex", protocol: "app-server", target: "local" as const },
    };

    // When: 用户保存 Agent，并重新读取工作区快照。
    const saved = await service.saveAgents(workspace, [...initial.agents, custom]);
    const restored = await service.getWorkspace(workspace);
    const persisted = restored.agents.find((agent) => agent.id === custom.id);

    // Then: 新 Agent 已保存，关键配置在重新打开后仍然保持。
    assert.ok(saved.agents.some((agent) => agent.id === custom.id));
    assert.equal(persisted?.name, "审查员");
    assert.equal(persisted?.mention, "@审查员");
    assert.equal(persisted?.instructions, custom.instructions);
    assert.equal(persisted?.runtime?.provider, "codex");
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("BDD: 添加 Agent 使用非法 ID 时保存失败且不覆盖已有配置", async () => {
  // Given: 工作区中已有一组有效 Agent，用户填写了包含空格的非法 ID。
  const storeDir = await mkdtemp(join(tmpdir(), "agent-add-invalid-bdd-"));
  const workspace = "/tmp/agent-add-invalid-bdd-workspace";
  const service = new AgentTeamService(new FakeCodex() as unknown as AgentRuntime, storeDir);

  try {
    const initial = await service.getWorkspace(workspace);
    const invalid = {
      ...initial.agents[0],
      id: "invalid agent id",
      name: "无效 Agent",
      mention: "@无效Agent",
      instructions: "这是一条足够长的角色指令，用于触发 ID 校验。",
    };

    // When: 用户尝试保存包含非法 ID 的 Agent 列表。
    await assert.rejects(
      service.saveAgents(workspace, [...initial.agents, invalid]),
      /Agent ID 无效/,
    );
    const restored = await service.getWorkspace(workspace);

    // Then: 保存被拒绝，原有 Agent 列表保持不变。
    assert.deepEqual(
      restored.agents.map((agent) => agent.id),
      initial.agents.map((agent) => agent.id),
    );
    assert.equal(
      restored.agents.some((agent) => agent.id === invalid.id),
      false,
    );
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("BDD: 默认 Agent 类型保留角色、权限和可见性差异", () => {
  // Given: 应用提供协调员、架构师、程序员和审查员四种默认 Agent。
  const profiles = DEFAULT_AGENTS.map((agent) => ({
    id: agent.id,
    workspaceAccess: agent.workspaceAccess,
    visibility: agent.visibility,
    executionLocation: agent.executionLocation,
    source: agent.source,
  }));

  // When: 用户查看默认 Agent 配置。
  // Then: 只读/可写、公开/私有和内置来源等差异都被保留。
  assert.deepEqual(profiles, [
    {
      id: "agent_coordinator",
      workspaceAccess: "read",
      visibility: "private",
      executionLocation: "local",
      source: "builtin",
    },
    {
      id: "agent_architect",
      workspaceAccess: "read",
      visibility: "public",
      executionLocation: "local",
      source: "builtin",
    },
    {
      id: "agent_coder",
      workspaceAccess: "write",
      visibility: "private",
      executionLocation: "local",
      source: "builtin",
    },
    {
      id: "agent_reviewer",
      workspaceAccess: "read",
      visibility: "public",
      executionLocation: "local",
      source: "builtin",
    },
  ]);
});

test("BDD: 不同 Runtime 类型保存后保留对应协议和连接配置", async () => {
  // Given: 用户为 Agent 选择内置 Runtime 和自定义 HTTP/CLI Runtime。
  const storeDir = await mkdtemp(join(tmpdir(), "agent-runtime-types-bdd-"));
  const workspace = "/tmp/agent-runtime-types-bdd-workspace";
  const service = new AgentTeamService(new FakeCodex() as unknown as AgentRuntime, storeDir);

  try {
    const initial = await service.getWorkspace(workspace);
    const runtimeAgents = [
      {
        ...initial.agents[0],
        id: "agent_claude",
        name: "Claude Agent",
        mention: "@ClaudeAgent",
        runtime: { provider: "claude", protocol: "cli-stream-json", target: "local" as const },
      },
      {
        ...initial.agents[0],
        id: "agent_opencode",
        name: "OpenCode Agent",
        mention: "@OpenCodeAgent",
        runtime: { provider: "opencode", protocol: "acp", target: "local" as const },
      },
      {
        ...initial.agents[0],
        id: "agent_antigravity",
        name: "Antigravity Agent",
        mention: "@AntigravityAgent",
        runtime: {
          provider: "antigravity",
          protocol: "cli-stream-json",
          target: "local" as const,
        },
      },
      {
        ...initial.agents[0],
        id: "agent_http",
        name: "HTTP Agent",
        mention: "@HTTPAgent",
        runtime: {
          provider: "custom-http",
          protocol: "http",
          target: "hosted" as const,
          endpoint: "https://agent.example.com",
          auth: "bearer" as const,
        },
        executionLocation: "hosted" as const,
      },
      {
        ...initial.agents[0],
        id: "agent_cli",
        name: "CLI Agent",
        mention: "@CLIAgent",
        runtime: {
          provider: "custom-cli",
          protocol: "cli-jsonl",
          target: "local" as const,
          command: "my-agent",
          args: ["--protocol", "jsonl"],
        },
      },
    ];

    // When: 用户保存这些不同 Runtime 类型的 Agent，并重新读取工作区。
    await service.saveAgents(workspace, [...initial.agents, ...runtimeAgents]);
    const restored = await service.getWorkspace(workspace);

    // Then: 每个 Agent 的 Provider、协议、运行位置和连接参数保持不变。
    const actual = runtimeAgents.map((expected) => {
      const agent = restored.agents.find((candidate) => candidate.id === expected.id)!;
      return {
        provider: agent.runtime?.provider,
        protocol: agent.runtime?.protocol,
        target: agent.runtime?.target,
        endpoint: agent.runtime?.endpoint,
        auth: agent.runtime?.auth,
        command: agent.runtime?.command,
        args: agent.runtime?.args,
      };
    });
    assert.deepEqual(actual, [
      {
        provider: "claude",
        protocol: "cli-stream-json",
        target: "local",
        endpoint: undefined,
        auth: "none",
        command: undefined,
        args: undefined,
      },
      {
        provider: "opencode",
        protocol: "acp",
        target: "local",
        endpoint: undefined,
        auth: "none",
        command: undefined,
        args: undefined,
      },
      {
        provider: "antigravity",
        protocol: "cli-stream-json",
        target: "local",
        endpoint: undefined,
        auth: "none",
        command: undefined,
        args: undefined,
      },
      {
        provider: "custom-http",
        protocol: "http",
        target: "hosted",
        endpoint: "https://agent.example.com",
        auth: "bearer",
        command: undefined,
        args: undefined,
      },
      {
        provider: "custom-cli",
        protocol: "cli-jsonl",
        target: "local",
        endpoint: undefined,
        auth: "none",
        command: "my-agent",
        args: ["--protocol", "jsonl"],
      },
    ]);
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("a persisted Session is reattached after Runtime restart", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-session-restart-"));
  const workspace = "/tmp/agent-session-restart-workspace";
  const firstRuntime = new FakeCodex();
  const firstService = new AgentTeamService(firstRuntime as unknown as AgentRuntime, storeDir);
  try {
    const first = await firstService.getWorkspace(workspace);
    const room = await firstService.openDirectRoom(workspace, first.agents[0].id);
    await firstService.sendMessage({ workspace, roomId: room.roomId, text: "第一轮" });
    await waitFor(async () =>
      Boolean(
        (await firstService.getWorkspace(workspace)).sessions.find(
          (session) => session.agentId === first.agents[0].id,
        ),
      ),
    );
    await firstService.flush();

    const secondRuntime = new FakeCodex();
    const secondService = new AgentTeamService(secondRuntime as unknown as AgentRuntime, storeDir);
    const restored = await secondService.getWorkspace(workspace);
    const restoredRoom = restored.rooms.find((candidate) => candidate.type === "direct")!;
    await secondService.sendMessage({ workspace, roomId: restoredRoom.roomId, text: "第二轮" });
    await waitFor(async () => {
      const current = await secondService.getWorkspace(workspace);
      const messages =
        current.rooms.find((candidate) => candidate.roomId === restoredRoom.roomId)?.messages ?? [];
      return messages.some(
        (message) => message.senderType === "agent" && message.status === "complete",
      );
    });
    assert.equal(secondRuntime.threadStarts, 0);
    assert.equal(secondRuntime.sessionInputs[0], "thread_1");
    await secondService.flush();
  } finally {
    await firstService.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("hosted Agents are reported as unavailable instead of running locally", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-hosted-boundary-"));
  const workspace = "/tmp/agent-hosted-boundary-workspace";
  const service = new AgentTeamService(new FakeCodex() as unknown as AgentRuntime, storeDir);
  try {
    const initial = await service.getWorkspace(workspace);
    const hosted = {
      ...initial.agents[0],
      executionLocation: "hosted" as const,
      runtime: { ...initial.agents[0].runtime!, target: "hosted" as const },
    };
    await service.saveAgents(workspace, [hosted, ...initial.agents.slice(1)]);
    const room = await service.openDirectRoom(workspace, hosted.id);
    const result = await service.sendMessage({ workspace, roomId: room.roomId, text: "执行任务" });
    assert.deepEqual(result.runIds, []);
    const snapshot = await service.getWorkspace(workspace);
    assert.match(
      snapshot.rooms.find((candidate) => candidate.roomId === room.roomId)?.messages.at(-1)
        ?.error ?? "",
      /云端 Worker 尚未接入/,
    );
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("group mentions stay in chat and an approved Task proposal starts explicitly", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-team-task-review-"));
  const workspace = "/tmp/task-review-workspace";
  const codex = new FakeCodex();
  const service = new AgentTeamService(codex as unknown as AgentRuntime, storeDir);

  try {
    const initial = await service.getWorkspace(workspace);
    const room = initial.rooms.find((candidate) => candidate.type === "group")!;
    const agent = initial.agents.find((candidate) => candidate.id === "agent_coder")!;

    await service.sendMessage({
      workspace,
      roomId: room.roomId,
      text: `${agent.mention} 登录页应该怎么设计？`,
      agentAction: "chat",
    });
    await waitFor(async () => {
      const current = await service.getWorkspace(workspace);
      return current.rooms
        .find((candidate) => candidate.roomId === room.roomId)!
        .messages.some(
          (message) => message.senderType === "agent" && message.status === "complete",
        );
    });
    assert.equal((await service.getWorkspace(workspace)).tasks.length, 0);

    codex.responses.push(
      '我先整理成执行草案。\n<agent-team-task-proposal>{"title":"实现登录页","objective":"实现账号密码登录页并处理错误状态","expectedResult":"可用的登录页面","plan":["搭建表单","接入登录接口","补充错误状态测试"],"acceptanceCriteria":["登录成功进入首页","错误信息可见"],"requestedAccess":"write"}</agent-team-task-proposal>',
    );
    await service.sendMessage({
      workspace,
      roomId: room.roomId,
      text: `${agent.mention} 请实现登录页面`,
      agentAction: "propose-task",
    });
    await waitFor(async () => (await service.getWorkspace(workspace)).tasks.length === 1);

    let task = (await service.getWorkspace(workspace)).tasks[0];
    assert.equal(task.status, "pending_review");
    assert.deepEqual(task.plan, ["搭建表单", "接入登录接口", "补充错误状态测试"]);
    assert.equal(task.runs.length, 0, "a proposal must not execute before human review");

    task = await service.reviewTask(workspace, task.id, "approved", "计划可以执行");
    assert.equal(task.status, "approved");
    assert.equal(task.reviews.at(-1)?.reviewerUserId, "local_user");
    assert.equal(task.reviews.at(-1)?.reviewerName, "本机用户");

    task = await service.startTask(workspace, task.id);
    assert.equal(task.status, "queued");
    assert.equal(task.startedByUserId, "local_user");
    assert.ok(task.startedAt);
    assert.equal(task.runs.length, 1);
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("an approved local Task can delegate a governed child while chat markers stay non-authoritative", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-team-local-delegation-"));
  const workspace = "/tmp/local-delegation-workspace";
  const codex = new FakeCodex();
  const service = new AgentTeamService(codex as unknown as AgentRuntime, storeDir);

  try {
    const initial = await service.getWorkspace(workspace);
    const room = initial.rooms.find((candidate) => candidate.type === "group")!;
    const coder = initial.agents.find((candidate) => candidate.id === "agent_coder")!;
    const architect = initial.agents.find((candidate) => candidate.id === "agent_architect")!;

    codex.responses.push(
      `仅讨论，不执行。\n<!-- agent-action-v1 {"protocolVersion":1,"actionId":"chat-action","taskId":"not-a-task","taskRevision":1,"action":"create_subtask","title":"不应创建","objective":"不应执行","expectedResult":"无","assigneeIds":["${architect.id}"],"requestedScopes":["workspace.read"],"acceptanceCriteria":[]} -->`,
    );
    await service.sendMessage({
      workspace,
      roomId: room.roomId,
      text: `${coder.mention} 这里只讨论方案`,
    });
    await waitFor(async () => codex.prompts.length === 1);
    let snapshot = await service.getWorkspace(workspace);
    assert.equal(snapshot.tasks.length, 0);
    assert.ok(
      snapshot.rooms
        .find((candidate) => candidate.roomId === room.roomId)!
        .messages.every((message) => !message.content.includes("agent-action-v1")),
    );

    codex.responses.push(
      '已生成草案。\n<agent-team-task-proposal>{"title":"检查登录实现","objective":"检查登录流程并给出修复","expectedResult":"可复核结果","plan":["检查实现"],"acceptanceCriteria":["结论可复核"],"requestedAccess":"write"}</agent-team-task-proposal>',
    );
    await service.sendMessage({
      workspace,
      roomId: room.roomId,
      text: `${coder.mention} 请创建并执行登录检查任务`,
      agentAction: "propose-task",
    });
    await waitFor(async () => (await service.getWorkspace(workspace)).tasks.length === 1);
    let root = (await service.getWorkspace(workspace)).tasks[0];
    assert.deepEqual(root.budget, {
      maxDepth: 3,
      maxDescendants: 12,
      maxRuns: 24,
      maxWallTimeMs: 30 * 60 * 1_000,
    });
    await service.reviewTask(workspace, root.id, "approved");
    codex.responses.push(
      `我会交给架构师复核。\n<!-- agent-action-v1 ${JSON.stringify({
        protocolVersion: 1,
        actionId: "delegate-review",
        taskId: root.id,
        taskRevision: root.revision,
        action: "create_subtask",
        title: "复核登录实现",
        objective: "只读复核登录实现",
        expectedResult: "复核报告",
        assigneeIds: [architect.id],
        requestedScopes: ["workspace.read"],
        acceptanceCriteria: ["报告可复核"],
      })} -->`,
      "复核完成，没有发现阻塞问题。",
    );
    await service.startTask(workspace, root.id);
    await waitFor(async () => {
      const current = await service.getWorkspace(workspace);
      return (
        current.tasks.length === 2 && current.tasks.some((task) => task.parentTaskId === root.id)
      );
    });
    await waitFor(async () => {
      const current = await service.getWorkspace(workspace);
      return current.tasks.find((task) => task.parentTaskId === root.id)?.status === "review";
    });

    snapshot = await service.getWorkspace(workspace);
    root = snapshot.tasks.find((task) => task.id === root.id)!;
    const child = snapshot.tasks.find((task) => task.parentTaskId === root.id)!;
    assert.equal(root.status, "waiting");
    assert.equal(root.budgetUsage?.descendants, 1);
    assert.equal(root.budgetUsage?.runs, 2);
    assert.equal(child.rootTaskId, root.id);
    assert.equal(child.depth, 1);
    assert.equal(child.assigneeIds[0], architect.id);
    assert.equal(child.reviews[0]?.decision, "approved");
    assert.equal(child.runs[0]?.parentRunId, root.runs[0]?.id);
    assert.ok(
      snapshot.rooms
        .find((candidate) => candidate.roomId === root.taskRoomId)!
        .messages.every((message) => !message.content.includes("agent-action-v1")),
    );
    await assert.rejects(() => service.updateTaskStatus(workspace, root.id, "done"), /子 Task/);
    await service.updateTaskStatus(workspace, child.id, "blocked");
    assert.equal(
      (await service.getWorkspace(workspace)).tasks.find((task) => task.id === root.id)?.status,
      "blocked",
    );
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("Agents receive the room roster and can bring another Agent into the conversation", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-team-collaboration-"));
  const workspace = "/tmp/agent-collaboration-workspace";
  const codex = new FakeCodex();
  const service = new AgentTeamService(codex as unknown as AgentRuntime, storeDir);

  try {
    const initial = await service.getWorkspace(workspace);
    const room = initial.rooms.find((candidate) => candidate.type === "group")!;
    const coder = initial.agents.find((candidate) => candidate.id === "agent_coder")!;
    const architect = initial.agents.find((candidate) => candidate.id === "agent_architect")!;
    const expectedMemberCount = room.humanIds.length + room.agentIds.length;
    codex.responses.push(`${architect.mention} 请补充一下模块边界。`, "模块边界建议如下。");

    await service.sendMessage({
      workspace,
      roomId: room.roomId,
      text: `${coder.mention} 先看看这个群的协作方式`,
      agentAction: "chat",
    });
    await waitFor(async () => {
      const current = await service.getWorkspace(workspace);
      return (
        current.rooms
          .find((candidate) => candidate.roomId === room.roomId)!
          .messages.filter(
            (message) => message.senderType === "agent" && message.status === "complete",
          ).length === 2
      );
    });

    assert.match(codex.prompts[0], new RegExp(`会话名称：${room.name}`));
    assert.match(codex.prompts[0], new RegExp(`成员总数：${expectedMemberCount}`));
    assert.match(codex.prompts[0], /人类成员：本机用户｜可用提及：@本机用户/);
    assert.match(
      codex.prompts[0],
      /Agent 成员：架构师｜Agent ID：agent_architect｜可用提及：@架构师/,
    );
    assert.match(codex.prompts[1], /程序员（@程序员）的新消息/);

    const messages = (await service.getWorkspace(workspace)).rooms.find(
      (candidate) => candidate.roomId === room.roomId,
    )!.messages;
    const coderReply = messages.find(
      (message) => message.senderId === coder.id && message.content.includes(architect.mention),
    )!;
    const architectReply = messages.find((message) => message.senderId === architect.id)!;
    assert.deepEqual(coderReply.targetAgentIds, [architect.id]);
    assert.deepEqual(coderReply.atUserIds, [architect.id]);
    assert.equal(coderReply.agentHop, 1);
    assert.equal(architectReply.agentHop, 2);
    assert.equal((await service.getWorkspace(workspace)).tasks.length, 0);
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("an explicit 15-turn Agent Loop completes exactly 15 replies", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-team-loop-"));
  const workspace = "/tmp/agent-loop-workspace";
  const codex = new FakeCodex();
  const service = new AgentTeamService(codex as unknown as AgentRuntime, storeDir);

  try {
    const initial = await service.getWorkspace(workspace);
    const room = initial.rooms.find((candidate) => candidate.type === "group")!;
    const coder = initial.agents.find((candidate) => candidate.id === "agent_coder")!;
    const architect = initial.agents.find((candidate) => candidate.id === "agent_architect")!;
    codex.responses.push(
      `第1轮。一马当先，${architect.mention}\n<agent-team-loop-action>{"action":"start","title":"成语接龙","objective":"两位 Agent 完成 15 次成语接龙","mode":"handoff","completionPolicy":"turn-target","targetTurns":15,"participantAgentIds":["${coder.id}","${architect.id}"],"nextAgentId":"${architect.id}"}</agent-team-loop-action>`,
      ...Array.from({ length: 14 }, (_, index) => {
        const turn = index + 2;
        const nextMention = turn % 2 === 0 ? coder.mention : architect.mention;
        return `第${turn}轮。成语-${turn}，${nextMention}`;
      }),
    );

    await service.sendMessage({
      workspace,
      roomId: room.roomId,
      text: `${coder.mention} 你和${architect.name}玩成语接龙，限制15次，你先开始说完后 @ 他`,
      agentAction: "chat",
    });
    await waitFor(async () => {
      const snapshot = await service.getWorkspace(workspace);
      return snapshot.loops[0]?.status === "completed";
    });

    const snapshot = await service.getWorkspace(workspace);
    const loop = snapshot.loops[0];
    const messages = snapshot.rooms.find((candidate) => candidate.roomId === room.roomId)!.messages;
    const agentReplies = messages.filter(
      (message) => message.senderType === "agent" && message.status === "complete",
    );
    assert.equal(loop.title, "成语接龙");
    assert.equal(loop.targetTurns, 15);
    assert.equal(loop.completedTurns, 15);
    assert.equal(loop.status, "completed");
    assert.deepEqual(loop.participantAgentIds, [architect.id, coder.id]);
    assert.equal(agentReplies.length, 15);
    assert.equal(codex.prompts.length, 15);
    assert.match(codex.prompts[1], /第 2\/15 次 Agent 回复/);
    assert.ok(agentReplies.every((message) => !message.content.includes("agent-team-loop-action")));
    assert.equal(agentReplies.at(-1)?.loopTurn, 15);
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("ad-hoc Agent relays stop on a repeated directed edge instead of a fixed hop count", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-team-relay-breaker-"));
  const workspace = "/tmp/agent-relay-breaker-workspace";
  const codex = new FakeCodex();
  const service = new AgentTeamService(codex as unknown as AgentRuntime, storeDir);

  try {
    const initial = await service.getWorkspace(workspace);
    const room = initial.rooms.find((candidate) => candidate.type === "group")!;
    const coder = initial.agents.find((candidate) => candidate.id === "agent_coder")!;
    const architect = initial.agents.find((candidate) => candidate.id === "agent_architect")!;
    codex.responses.push(
      `请看一下，${architect.mention}`,
      `我看过了，${coder.mention}`,
      `再确认一次，${architect.mention}`,
      `不应该执行到这里，${coder.mention}`,
    );

    await service.sendMessage({
      workspace,
      roomId: room.roomId,
      text: `${coder.mention} 请临时和架构师确认一下`,
    });
    await waitFor(async () => codex.prompts.length === 3);
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(codex.prompts.length, 3);
    assert.equal((await service.getWorkspace(workspace)).loops.length, 0);
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("a numeric multi-Agent request starts a Loop even when the first Agent omits the marker", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-team-loop-fallback-"));
  const workspace = "/tmp/agent-loop-fallback-workspace";
  const codex = new FakeCodex();
  const service = new AgentTeamService(codex as unknown as AgentRuntime, storeDir);

  try {
    const initial = await service.getWorkspace(workspace);
    const room = initial.rooms.find((candidate) => candidate.type === "group")!;
    const coder = initial.agents.find((candidate) => candidate.id === "agent_coder")!;
    const architect = initial.agents.find((candidate) => candidate.id === "agent_architect")!;
    codex.responses.push(
      `第1次，${architect.mention}`,
      `第2次，${coder.mention}`,
      `第3次，${architect.mention}`,
    );

    await service.sendMessage({
      workspace,
      roomId: room.roomId,
      text: `${coder.mention} 和架构师轮流回答，限制3次`,
    });
    await waitFor(
      async () => (await service.getWorkspace(workspace)).loops[0]?.status === "completed",
    );

    const loop = (await service.getWorkspace(workspace)).loops[0];
    assert.equal(loop.targetTurns, 3);
    assert.equal(loop.completedTurns, 3);
    assert.equal(codex.prompts.length, 3);
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("promoting a local Agent to cloud identity preserves local conversations", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-team-promote-"));
  const workspace = "/tmp/agent-promote-workspace";
  const codex = new FakeCodex();
  const service = new AgentTeamService(codex as unknown as AgentRuntime, storeDir);
  const cloudAgentId = "123e4567-e89b-12d3-a456-426614174000";

  try {
    const initial = await service.getWorkspace(workspace);
    const coder = initial.agents.find((candidate) => candidate.id === "agent_coder")!;
    const directRoom = await service.openDirectRoom(workspace, coder.id);
    await service.sendMessage({
      workspace,
      roomId: directRoom.roomId,
      text: "保留这段本地会话",
    });
    await waitFor(async () => {
      const room = (await service.getWorkspace(workspace)).rooms.find(
        (candidate) => candidate.roomId === directRoom.roomId,
      );
      return Boolean(
        room?.messages.some(
          (message) => message.senderType === "agent" && message.status === "complete",
        ),
      );
    });

    const promoted = await service.promoteAgents(workspace, [
      {
        localAgentId: coder.id,
        cloudAgentId,
        openimUserId: "agt_123e4567e89b12d3a456426614174000",
        version: 1,
      },
    ]);
    const promotedAgent = promoted.agents.find((agent) => agent.id === cloudAgentId);
    const promotedRoom = promoted.rooms.find((room) => room.roomId === directRoom.roomId)!;
    assert.equal(
      promoted.agents.some((agent) => agent.id === coder.id),
      false,
    );
    assert.equal(promotedAgent?.cloudAgentId, cloudAgentId);
    assert.equal(promotedAgent?.syncSource, "local");
    assert.equal(promotedRoom.directPrincipalId, cloudAgentId);
    assert.deepEqual(promotedRoom.agentIds, [cloudAgentId]);
    assert.ok(
      promotedRoom.messages.some(
        (message) =>
          message.senderId === cloudAgentId || message.targetAgentIds?.includes(cloudAgentId),
      ),
    );

    await service.flush();
    const reloaded = new AgentTeamService(new FakeCodex() as unknown as AgentRuntime, storeDir);
    const restored = await reloaded.getWorkspace(workspace);
    assert.equal(
      restored.agents.find((agent) => agent.id === cloudAgentId)?.cloudAgentId,
      cloudAgentId,
    );
    await reloaded.flush();
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("Agent execution failure with error object produces humanized error instead of [object Object]", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-team-error-"));
  const workspace = "/tmp/error-message-workspace";
  const codex = new FakeCodex();
  codex.nextTurnError = {
    message:
      'unexpected status 404 Not Found: Model "gpt-6-astra" is not supported by any configured account in this group',
    codex_error_info: "other",
  };
  const service = new AgentTeamService(codex as unknown as AgentRuntime, storeDir);

  try {
    const room = await service.openDirectRoom(workspace, "agent_coordinator");
    await service.sendMessage({
      workspace,
      roomId: room.roomId,
      text: "测试调用",
    });

    await waitFor(async () => {
      const current = await service.getWorkspace(workspace);
      const targetRoom = current.rooms.find((candidate) => candidate.roomId === room.roomId);
      const agentMessage = targetRoom?.messages.find((message) => message.senderType === "agent");
      return agentMessage?.status === "error";
    });

    const current = await service.getWorkspace(workspace);
    const targetRoom = current.rooms.find((candidate) => candidate.roomId === room.roomId)!;
    const agentMessage = targetRoom.messages.find((message) => message.senderType === "agent")!;

    assert.equal(agentMessage.status, "error");
    assert.notEqual(agentMessage.error, "[object Object]");
    assert.ok(agentMessage.error?.includes('模型 "gpt-6-astra" 不受支持'));
    assert.ok(agentMessage.error?.includes("当前群组没有任何已配置账号支持该模型"));
    assert.ok(agentMessage.error?.includes("原始报错："));
  } finally {
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});
