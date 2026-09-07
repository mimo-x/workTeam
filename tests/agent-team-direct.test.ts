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
  responses: string[] = [];

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
    const response = this.responses.shift() ?? `reply_${this.prompts.length}`;
    queueMicrotask(() => {
      this.emit({
        method: "item/completed",
        params: { turnId, item: { type: "agentMessage", text: response } },
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
    await service.flush();
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("group mentions stay in chat and an approved Task proposal starts explicitly", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-team-task-review-"));
  const workspace = "/tmp/task-review-workspace";
  const codex = new FakeCodex();
  const service = new AgentTeamService(codex as unknown as CodexAppServer, storeDir);

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

test("Agents receive the room roster and can bring another Agent into the conversation", async () => {
  const storeDir = await mkdtemp(join(tmpdir(), "agent-team-collaboration-"));
  const workspace = "/tmp/agent-collaboration-workspace";
  const codex = new FakeCodex();
  const service = new AgentTeamService(codex as unknown as CodexAppServer, storeDir);

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
  const service = new AgentTeamService(codex as unknown as CodexAppServer, storeDir);

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
  const service = new AgentTeamService(codex as unknown as CodexAppServer, storeDir);

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
  const service = new AgentTeamService(codex as unknown as CodexAppServer, storeDir);

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
  const service = new AgentTeamService(codex as unknown as CodexAppServer, storeDir);
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
    const reloaded = new AgentTeamService(new FakeCodex() as unknown as CodexAppServer, storeDir);
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
