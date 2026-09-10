import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DataType, newDb } from "pg-mem";
import type pg from "pg";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

test("two users can become friends, create an Agent room, and sync settings", async () => {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: randomUUID,
    impure: true,
  });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool() as unknown as pg.Pool;
  const migration = (await readFile(join(migrationsDir, "0001_initial.sql"), "utf8"))
    .replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", "")
    .replace(
      "status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting', 'review', 'blocked', 'done', 'failed', 'cancelled')),",
      "status text NOT NULL DEFAULT 'queued' CONSTRAINT tasks_status_check CHECK (status IN ('queued', 'running', 'waiting', 'review', 'blocked', 'done', 'failed', 'cancelled')),",
    );
  await pool.query(migration);
  await pool.query(await readFile(join(migrationsDir, "0002_task_review.sql"), "utf8"));
  await pool.query(await readFile(join(migrationsDir, "0003_agent_registry.sql"), "utf8"));
  await pool.query(await readFile(join(migrationsDir, "0004_agent_runtime_config.sql"), "utf8"));
  const config = loadConfig({
    NODE_ENV: "test",
    JWT_SECRET: "test-jwt-secret-with-at-least-32-characters",
    ENCRYPTION_MASTER_KEY: randomBytes(32).toString("base64"),
    OPENIM_API_URL: "http://openim-internal:10002",
    OPENIM_PUBLIC_API_URL: "http://openim-public.example:10002",
    OPENIM_ADMIN_TOKEN: "test-openim-admin-token",
    OPENIM_CALLBACK_TOKEN: "test-callback-token-long-enough",
  });
  const { app } = await createApp(config, { pool, enableRealtime: false });

  const register = async (email: string, handle: string, displayName: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email,
        handle,
        displayName,
        password: "correct-horse-battery-staple",
        deviceName: "Test",
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json() as {
      accessToken: string;
      user: { id: string; emailVerified: boolean };
    };
  };

  try {
    const unauthenticated = await app.inject({ method: "GET", url: "/v1/friends" });
    assert.equal(unauthenticated.statusCode, 401);

    const alice = await register("alice@example.com", "alice", "Alice");
    const bob = await register("bob@example.com", "bob", "Bob");
    assert.equal(alice.user.emailVerified, true);
    assert.equal(
      Number((await pool.query("SELECT count(*) FROM account_tokens")).rows[0].count),
      0,
      "registration must not create verification tokens",
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: { token: "user-token", expireTimeSeconds: 3600 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const imSession = await app.inject({
      method: "POST",
      url: "/v1/im/session",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: {},
    });
    globalThis.fetch = originalFetch;
    assert.equal(imSession.statusCode, 200, imSession.body);
    assert.equal(imSession.json().apiAddr, "http://openim-public.example:10002");

    const friendRequest = await app.inject({
      method: "POST",
      url: "/v1/friend-requests",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { receiverId: bob.user.id, message: "一起协作" },
    });
    assert.equal(friendRequest.statusCode, 201, friendRequest.body);
    const requestId = friendRequest.json().id as string;

    const accepted = await app.inject({
      method: "POST",
      url: `/v1/friend-requests/${requestId}/accept`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    assert.equal(accepted.statusCode, 204, accepted.body);

    const friends = await app.inject({
      method: "GET",
      url: "/v1/friends",
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    assert.equal(friends.statusCode, 200, friends.body);
    assert.equal(friends.json().data[0].id, bob.user.id);
    assert.ok(friends.json().data[0].openimUserId);

    const createdAgent = await app.inject({
      method: "POST",
      url: "/v1/agents",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: {
        name: "程序员",
        title: "Coder",
        mention: "@coder",
        description: "实现任务",
        instructions: "只处理被分配的编码任务。",
        secrets: { token: "encrypted-value" },
        visibility: "public",
        workspaceAccess: "write",
        executionTarget: "local",
        provider: "codex",
        protocol: "app-server",
        runtimeModel: "gpt-5.5",
        runtimeEndpoint: "https://agent.example.com",
        runtimeAuth: "bearer",
        capabilities: ["chat", "read_workspace", "write_workspace"],
        skillPolicy: "allowlist",
        skillRefs: [{ name: "test-skill", path: "/private/SKILL.md" }],
      },
    });
    assert.equal(createdAgent.statusCode, 201, createdAgent.body);
    const agent = createdAgent.json();
    assert.equal(agent.secrets.token, "encrypted-value");
    assert.equal(agent.provider, "codex");
    assert.equal(agent.protocol, "app-server");
    assert.equal(agent.runtimeModel, "gpt-5.5");
    assert.equal(agent.runtimeEndpoint, "https://agent.example.com");
    assert.equal(agent.runtimeAuth, "bearer");
    assert.deepEqual(agent.capabilities, ["chat", "read_workspace", "write_workspace"]);
    assert.equal(agent.runtime.status, "offline");

    const publicAgent = await app.inject({
      method: "GET",
      url: `/v1/agents/${agent.id}`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    assert.equal(publicAgent.statusCode, 200, publicAgent.body);
    assert.equal(publicAgent.json().provider, "codex");
    assert.equal(publicAgent.json().runtime.status, "offline");
    assert.equal("instructions" in publicAgent.json(), false);
    assert.equal("secrets" in publicAgent.json(), false);

    const searchedAgents = await app.inject({
      method: "GET",
      url: "/v1/agents?scope=available&q=程序",
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    assert.equal(searchedAgents.statusCode, 200, searchedAgents.body);
    assert.equal(searchedAgents.json().data.length, 1);
    assert.equal(searchedAgents.json().data[0].id, agent.id);

    const room = await app.inject({
      method: "POST",
      url: "/v1/rooms",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { name: "项目群", userIds: [bob.user.id], agentIds: [agent.id] },
    });
    assert.equal(room.statusCode, 201, room.body);
    assert.equal(room.json().pendingAgentIds.length, 0);

    const chatMention = await app.inject({
      method: "POST",
      url: "/internal/openim/callbacks/message/after?token=test-callback-token-long-enough",
      payload: {
        sendID: (alice.user as { openimUserId?: string }).openimUserId,
        groupID: room.json().openimGroupId,
        serverMsgID: "server-chat-1",
        clientMsgID: "client-chat-1",
        content: JSON.stringify({ content: "@coder 你觉得登录页面应该怎么设计？" }),
        contentType: 101,
        seq: 1,
        sendTime: Date.now(),
        atUserList: [agent.openimUserId],
      },
    });
    assert.equal(chatMention.statusCode, 200, chatMention.body);

    const noAutomaticTask = await app.inject({
      method: "GET",
      url: "/v1/tasks",
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    assert.equal(
      noAutomaticTask.json().data.length,
      0,
      "a normal Agent mention must stay chat-only",
    );

    const taskMessage = await app.inject({
      method: "POST",
      url: "/internal/openim/callbacks/message/after?token=test-callback-token-long-enough",
      payload: {
        sendID: (alice.user as { openimUserId?: string }).openimUserId,
        groupID: room.json().openimGroupId,
        serverMsgID: "server-task-2",
        clientMsgID: "client-task-2",
        content: JSON.stringify({ content: "@coder 请实现登录页面" }),
        contentType: 101,
        seq: 2,
        sendTime: Date.now(),
        atUserList: [agent.openimUserId],
        ex: JSON.stringify({ agentAction: "propose-task" }),
      },
    });
    assert.equal(taskMessage.statusCode, 200, taskMessage.body);

    const tasks = await app.inject({
      method: "GET",
      url: "/v1/tasks",
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    assert.equal(tasks.statusCode, 200, tasks.body);
    assert.equal(tasks.json().data.length, 1);
    assert.equal(tasks.json().data[0].status, "pending_review");
    const taskId = tasks.json().data[0].id as string;

    const contextMessage = {
      sendID: (bob.user as { openimUserId?: string }).openimUserId,
      groupID: room.json().openimGroupId,
      serverMsgID: "server-context-3",
      clientMsgID: "client-context-3",
      content: JSON.stringify({ content: "补充：登录后进入好友列表" }),
      contentType: 101,
      seq: 3,
      sendTime: Date.now(),
    };
    for (let index = 0; index < 2; index += 1) {
      const mirrored = await app.inject({
        method: "POST",
        url: "/internal/openim/callbacks/message/after?token=test-callback-token-long-enough",
        payload: contextMessage,
      });
      assert.equal(mirrored.statusCode, 200, mirrored.body);
    }
    const taskDetail = await app.inject({
      method: "GET",
      url: `/v1/tasks/${taskId}`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    assert.equal(taskDetail.statusCode, 200, taskDetail.body);
    assert.equal(
      taskDetail.json().contextVersion,
      2,
      "duplicate callbacks must not advance context twice",
    );
    assert.equal(taskDetail.json().runs.length, 0, "a proposal must not execute before review");

    const reviewed = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/reviews`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "1" },
      payload: { decision: "changes_requested", comment: "请补充测试计划" },
    });
    assert.equal(reviewed.statusCode, 200, reviewed.body);
    assert.equal(reviewed.json().reviewerUserId, alice.user.id);
    assert.equal(reviewed.json().reviewerName, "Alice");

    const revised = await app.inject({
      method: "PATCH",
      url: `/v1/tasks/${taskId}/proposal`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "1" },
      payload: {
        title: "实现并测试登录页面",
        objective: "实现登录页面并覆盖主要状态",
        expectedResult: "可通过验收的登录页面",
        plan: ["实现表单", "接入接口", "运行测试"],
        acceptanceCriteria: ["登录成功进入首页", "错误状态有提示"],
        requestedAccess: "read",
        proposedByAgentId: agent.id,
      },
    });
    assert.equal(revised.statusCode, 200, revised.body);
    assert.equal(revised.json().revision, 2);

    const approved = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/reviews`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "2" },
      payload: { decision: "approved", comment: "补充后方案可执行" },
    });
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(approved.json().taskRevision, 2);

    const started = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/start`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "2" },
    });
    assert.equal(started.statusCode, 200, started.body);
    assert.equal(started.json().runIds.length, 1);
    const persistedRun = await pool.query(
      `SELECT agent_snapshot, approval_id, started_by_user_id
       FROM task_runs WHERE id = $1`,
      [started.json().runIds[0]],
    );
    assert.equal(
      persistedRun.rows[0].agent_snapshot.workspaceAccess,
      "read",
      "the human-reviewed Task permission must cap the Agent's workspace access",
    );
    assert.equal(persistedRun.rows[0].approval_id, approved.json().id);
    assert.equal(persistedRun.rows[0].started_by_user_id, alice.user.id);

    const agentDirect = await app.inject({
      method: "POST",
      url: "/v1/rooms/agent-direct",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { agentId: agent.id },
    });
    assert.equal(agentDirect.statusCode, 201, agentDirect.body);
    assert.equal(agentDirect.json().directAgentId, agent.id);
    assert.ok(agentDirect.json().openimGroupId);

    const replacedMembers = await app.inject({
      method: "PUT",
      url: `/v1/rooms/${room.json().id}/members`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "1" },
      payload: { userIds: [], agentIds: [agent.id] },
    });
    assert.equal(replacedMembers.statusCode, 200, replacedMembers.body);
    assert.equal(replacedMembers.json().revision, 2);

    const rooms = await app.inject({
      method: "GET",
      url: "/v1/rooms",
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    assert.equal(rooms.statusCode, 200, rooms.body);
    const updatedRoom = rooms
      .json()
      .data.find((item: { id: string }) => item.id === room.json().id);
    assert.deepEqual(
      updatedRoom.members.map((member: { id: string }) => member.id),
      [alice.user.id],
    );

    const settings = await app.inject({
      method: "PUT",
      url: "/v1/settings",
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "1" },
      payload: { theme: "dark", locale: "zh-CN" },
    });
    assert.equal(settings.statusCode, 200, settings.body);
    assert.equal(settings.json().revision, 2);

    const staleSettings = await app.inject({
      method: "PUT",
      url: "/v1/settings",
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "1" },
      payload: { theme: "light" },
    });
    assert.equal(staleSettings.statusCode, 409, staleSettings.body);
  } finally {
    await app.close();
    await pool.end();
  }
});
