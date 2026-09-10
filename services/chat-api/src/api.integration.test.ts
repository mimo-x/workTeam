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
import { RealtimeHub } from "./realtime.js";

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
  await pool.query(await readFile(join(migrationsDir, "0005_governed_collaboration.sql"), "utf8"));
  const config = loadConfig({
    NODE_ENV: "test",
    JWT_SECRET: "test-jwt-secret-with-at-least-32-characters",
    ENCRYPTION_MASTER_KEY: randomBytes(32).toString("base64"),
    OPENIM_API_URL: "http://openim-internal:10002",
    OPENIM_PUBLIC_API_URL: "http://openim-public.example:10002",
    OPENIM_ADMIN_TOKEN: "test-openim-admin-token",
    OPENIM_CALLBACK_TOKEN: "test-callback-token-long-enough",
  });
  const { app, cipher } = await createApp(config, { pool, enableRealtime: false });

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

    const bobDeviceId = randomUUID();
    await pool.query(
      `INSERT INTO devices(id, user_id, name, platform, is_agent_host)
       VALUES ($1, $2, 'Bob host', 'test', true)`,
      [bobDeviceId, bob.user.id],
    );
    const registeredBinding = await app.inject({
      method: "POST",
      url: "/v1/workspace-bindings",
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: {
        deviceId: bobDeviceId,
        label: "Project Alpha",
        repositoryUrl: "https://example.test/project-alpha.git",
        baselineScopes: ["workspace.read"],
        path: "/Users/bob/private/project-alpha",
      },
    });
    assert.equal(registeredBinding.statusCode, 201, registeredBinding.body);
    const bindingId = registeredBinding.json().id as string;
    assert.equal("path" in registeredBinding.json(), false);
    const storedBinding = await pool.query(
      "SELECT path_config FROM workspace_bindings WHERE id = $1",
      [bindingId],
    );
    assert.equal(storedBinding.rows[0].path_config, null);
    const ownedBindings = await app.inject({
      method: "GET",
      url: "/v1/workspace-bindings",
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    assert.equal(ownedBindings.statusCode, 200, ownedBindings.body);
    assert.equal("path" in ownedBindings.json().data[0], false);
    assert.equal("pathConfig" in ownedBindings.json().data[0], false);

    const sharedBinding = await app.inject({
      method: "POST",
      url: `/v1/workspace-bindings/${bindingId}/share`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { roomId: room.json().id },
    });
    assert.equal(sharedBinding.statusCode, 201, sharedBinding.body);
    assert.equal("path" in sharedBinding.json(), false);

    const visibleBindings = await app.inject({
      method: "GET",
      url: `/v1/rooms/${room.json().id}/workspace-bindings`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    assert.equal(visibleBindings.statusCode, 200, visibleBindings.body);
    assert.equal(visibleBindings.json().data[0].hostUserId, bob.user.id);
    assert.equal("pathConfig" in visibleBindings.json().data[0], false);

    const memberCannotActivate = await app.inject({
      method: "PUT",
      url: `/v1/rooms/${room.json().id}/workspace-binding`,
      headers: { authorization: `Bearer ${bob.accessToken}`, "if-match": "1" },
      payload: { bindingId },
    });
    assert.equal(memberCannotActivate.statusCode, 403, memberCannotActivate.body);

    const staleActivation = await app.inject({
      method: "PUT",
      url: `/v1/rooms/${room.json().id}/workspace-binding`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "99" },
      payload: { bindingId },
    });
    assert.equal(staleActivation.statusCode, 409, staleActivation.body);

    const unsharedActivation = await app.inject({
      method: "PUT",
      url: `/v1/rooms/${room.json().id}/workspace-binding`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "1" },
      payload: { bindingId: randomUUID() },
    });
    assert.equal(unsharedActivation.statusCode, 409, unsharedActivation.body);

    const activatedBinding = await app.inject({
      method: "PUT",
      url: `/v1/rooms/${room.json().id}/workspace-binding`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "1" },
      payload: { bindingId },
    });
    assert.equal(activatedBinding.statusCode, 200, activatedBinding.body);
    assert.equal(activatedBinding.json().roomRevision, 2);

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
    assert.equal(tasks.json().data[0].workspaceBindingId, bindingId);
    const taskId = tasks.json().data[0].id as string;

    const secondBinding = await app.inject({
      method: "POST",
      url: "/v1/workspace-bindings",
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: {
        deviceId: bobDeviceId,
        label: "Project Alpha checkout 2",
        repositoryUrl: "https://example.test/project-alpha.git",
        baselineScopes: ["workspace.read", "workspace.write", "command.run", "network.read"],
      },
    });
    assert.equal(secondBinding.statusCode, 201, secondBinding.body);
    const secondBindingId = secondBinding.json().id as string;
    const sharedSecondBinding = await app.inject({
      method: "POST",
      url: `/v1/workspace-bindings/${secondBindingId}/share`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { roomId: room.json().id },
    });
    assert.equal(sharedSecondBinding.statusCode, 201, sharedSecondBinding.body);
    const rebound = await app.inject({
      method: "PUT",
      url: `/v1/rooms/${room.json().id}/workspace-binding`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "2" },
      payload: { bindingId: secondBindingId },
    });
    assert.equal(rebound.statusCode, 200, rebound.body);
    assert.deepEqual(rebound.json().tasksRequiringReconfirmation, [taskId]);

    for (const attempt of [
      app.inject({
        method: "POST",
        url: `/v1/tasks/${taskId}/reviews`,
        headers: { authorization: `Bearer ${bob.accessToken}`, "if-match": "2" },
        payload: { decision: "approved" },
      }),
      app.inject({
        method: "POST",
        url: `/v1/tasks/${taskId}/start`,
        headers: { authorization: `Bearer ${bob.accessToken}`, "if-match": "2" },
      }),
      app.inject({
        method: "PATCH",
        url: `/v1/tasks/${taskId}/status`,
        headers: { authorization: `Bearer ${bob.accessToken}` },
        payload: { status: "waiting" },
      }),
      app.inject({
        method: "PATCH",
        url: `/v1/tasks/${taskId}/budget`,
        headers: { authorization: `Bearer ${bob.accessToken}`, "if-match": "2" },
        payload: {
          maxDepth: 4,
          maxDescendants: 20,
          maxRuns: 30,
          maxWallTimeMs: 3_600_000,
        },
      }),
    ]) {
      const response = await attempt;
      assert.equal(response.statusCode, 403, response.body);
      assert.equal(response.json().error.code, "ROOM_ADMIN_REQUIRED");
    }

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
    const childTask = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: {
        sourceRoomId: room.json().id,
        anchorMessageId: "server-context-3",
        title: "验证登录流程",
        objective: "验证父 Task 的登录流程",
        expectedResult: "测试报告",
        plan: ["运行只读检查"],
        acceptanceCriteria: ["给出测试结论"],
        requestedAccess: "read",
        assigneeIds: [agent.id],
        parentTaskId: taskId,
      },
    });
    assert.equal(childTask.statusCode, 201, childTask.body);
    const childTaskDetail = await app.inject({
      method: "GET",
      url: `/v1/tasks/${childTask.json().id}`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    assert.equal(childTaskDetail.statusCode, 200, childTaskDetail.body);
    assert.equal(childTaskDetail.json().parentTaskId, taskId);
    assert.equal(childTaskDetail.json().rootTaskId, taskId);
    assert.equal(childTaskDetail.json().depth, 1);
    assert.equal(childTaskDetail.json().workspaceBindingId, secondBindingId);
    await pool.query("UPDATE room_members SET role = 'admin' WHERE room_id = $1 AND user_id = $2", [
      room.json().id,
      bob.user.id,
    ]);
    const adminReview = await app.inject({
      method: "POST",
      url: `/v1/tasks/${childTask.json().id}/reviews`,
      headers: { authorization: `Bearer ${bob.accessToken}`, "if-match": "1" },
      payload: { decision: "approved", comment: "管理员审核通过" },
    });
    assert.equal(adminReview.statusCode, 200, adminReview.body);
    const persistedAdminReview = await pool.query(
      "SELECT reviewer_role FROM task_reviews WHERE id = $1",
      [adminReview.json().id],
    );
    assert.equal(persistedAdminReview.rows[0].reviewer_role, "admin");
    await pool.query(
      "UPDATE room_members SET role = 'member' WHERE room_id = $1 AND user_id = $2",
      [room.json().id, bob.user.id],
    );
    const demotedAdminStart = await app.inject({
      method: "POST",
      url: `/v1/tasks/${childTask.json().id}/start`,
      headers: { authorization: `Bearer ${bob.accessToken}`, "if-match": "1" },
    });
    assert.equal(demotedAdminStart.statusCode, 403, demotedAdminStart.body);
    const taskDetail = await app.inject({
      method: "GET",
      url: `/v1/tasks/${taskId}`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    assert.equal(taskDetail.statusCode, 200, taskDetail.body);
    assert.equal(taskDetail.json().workspaceBindingId, secondBindingId);
    assert.equal(taskDetail.json().revision, 2);
    assert.match(taskDetail.json().waitReason, /重新审核/);
    assert.equal(
      taskDetail.json().contextVersion,
      2,
      "duplicate callbacks must not advance context twice",
    );
    assert.equal(taskDetail.json().runs.length, 0, "a proposal must not execute before review");

    const reviewed = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/reviews`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "2" },
      payload: { decision: "changes_requested", comment: "请补充测试计划" },
    });
    assert.equal(reviewed.statusCode, 200, reviewed.body);
    assert.equal(reviewed.json().reviewerUserId, alice.user.id);
    assert.equal(reviewed.json().reviewerName, "Alice");

    const revised = await app.inject({
      method: "PATCH",
      url: `/v1/tasks/${taskId}/proposal`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "2" },
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
    assert.equal(revised.json().revision, 3);

    const approved = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/reviews`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "3" },
      payload: { decision: "approved", comment: "补充后方案可执行" },
    });
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(approved.json().taskRevision, 3);

    const started = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/start`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "3" },
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

    const permissionAnchor = await app.inject({
      method: "POST",
      url: "/internal/openim/callbacks/message/after?token=test-callback-token-long-enough",
      payload: {
        sendID: (alice.user as { openimUserId?: string }).openimUserId,
        groupID: room.json().openimGroupId,
        serverMsgID: "server-permission-4",
        clientMsgID: "client-permission-4",
        content: JSON.stringify({ content: "请执行一个需要写权限的独立检查" }),
        contentType: 101,
        seq: 4,
        sendTime: Date.now(),
      },
    });
    assert.equal(permissionAnchor.statusCode, 200, permissionAnchor.body);
    const permissionTask = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: {
        sourceRoomId: room.json().id,
        anchorMessageId: "server-permission-4",
        title: "写权限检查",
        objective: "写入并验证测试文件",
        expectedResult: "检查通过",
        plan: ["写入测试文件", "验证结果"],
        acceptanceCriteria: ["结果可复核"],
        requestedAccess: "write",
        requestedScopes: ["workspace.read", "workspace.write", "command.run"],
        assigneeIds: [agent.id],
      },
    });
    assert.equal(permissionTask.statusCode, 201, permissionTask.body);
    const permissionTaskId = permissionTask.json().id as string;
    const permissionReview = await app.inject({
      method: "POST",
      url: `/v1/tasks/${permissionTaskId}/reviews`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "1" },
      payload: { decision: "approved" },
    });
    assert.equal(permissionReview.statusCode, 200, permissionReview.body);
    const missingGrantStart = await app.inject({
      method: "POST",
      url: `/v1/tasks/${permissionTaskId}/start`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "1" },
    });
    assert.equal(missingGrantStart.statusCode, 409, missingGrantStart.body);
    assert.equal(missingGrantStart.json().error.code, "HOST_GRANT_REQUIRED");
    assert.equal(missingGrantStart.json().status, "waiting_for_permission");
    assert.equal(
      Number(
        (await pool.query("SELECT count(*) FROM task_runs WHERE task_id = $1", [permissionTaskId]))
          .rows[0].count,
      ),
      0,
    );

    const nonHostGrant = await app.inject({
      method: "POST",
      url: `/v1/tasks/${permissionTaskId}/permission-grants`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { scopes: ["workspace.write"], constraints: { pathPrefixes: ["src"] } },
    });
    assert.equal(nonHostGrant.statusCode, 403, nonHostGrant.body);
    const scopeExpansion = await app.inject({
      method: "POST",
      url: `/v1/tasks/${permissionTaskId}/permission-grants`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { scopes: ["network.read"], constraints: { networkDomains: ["example.test"] } },
    });
    assert.equal(scopeExpansion.statusCode, 400, scopeExpansion.body);
    assert.equal(scopeExpansion.json().error.code, "TASK_SCOPE_EXCEEDED");
    await pool.query(
      `UPDATE workspace_bindings SET baseline_scopes = '["workspace.read"]'::jsonb
       WHERE id = $1`,
      [secondBindingId],
    );
    const roomScopeExpansion = await app.inject({
      method: "POST",
      url: `/v1/tasks/${permissionTaskId}/permission-grants`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { scopes: ["workspace.write"], constraints: { pathPrefixes: ["src"] } },
    });
    assert.equal(roomScopeExpansion.statusCode, 400, roomScopeExpansion.body);
    assert.equal(roomScopeExpansion.json().error.code, "ROOM_SCOPE_EXCEEDED");
    await pool.query(
      `UPDATE workspace_bindings
       SET baseline_scopes = '["workspace.read","workspace.write","command.run","network.read"]'::jsonb
       WHERE id = $1`,
      [secondBindingId],
    );
    const missingCapability = await app.inject({
      method: "POST",
      url: `/v1/tasks/${permissionTaskId}/permission-grants`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { scopes: ["command.run"], constraints: { commandExecutables: ["npm"] } },
    });
    assert.equal(missingCapability.statusCode, 400, missingCapability.body);
    assert.equal(missingCapability.json().error.code, "AGENT_CAPABILITY_MISSING");
    await pool.query("UPDATE workspace_bindings SET revision = revision + 1 WHERE id = $1", [
      secondBindingId,
    ]);
    const staleBindingGrant = await app.inject({
      method: "POST",
      url: `/v1/tasks/${permissionTaskId}/permission-grants`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { scopes: ["workspace.write"], constraints: { pathPrefixes: ["src"] } },
    });
    assert.equal(staleBindingGrant.statusCode, 409, staleBindingGrant.body);
    assert.equal(staleBindingGrant.json().error.code, "WORKSPACE_BINDING_STALE");
    await pool.query("UPDATE workspace_bindings SET revision = revision - 1 WHERE id = $1", [
      secondBindingId,
    ]);
    await pool.query(
      `UPDATE agents
       SET capabilities = '["chat","read_workspace","write_workspace","run_command"]'::jsonb
       WHERE id = $1`,
      [agent.id],
    );
    const taskGrant = await app.inject({
      method: "POST",
      url: `/v1/tasks/${permissionTaskId}/permission-grants`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: {
        scopes: ["workspace.write", "command.run"],
        constraints: { pathPrefixes: ["src"], commandExecutables: ["npm"] },
        expiresInSeconds: 3_600,
      },
    });
    assert.equal(taskGrant.statusCode, 201, taskGrant.body);
    const grantId = taskGrant.json().id as string;
    const redactedGrants = await app.inject({
      method: "GET",
      url: `/v1/tasks/${permissionTaskId}/permission-grants`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    assert.equal(redactedGrants.statusCode, 200, redactedGrants.body);
    assert.equal("constraints" in redactedGrants.json().data[0], false);
    assert.equal(redactedGrants.json().data[0].constraintSummary.pathPrefixes, 1);

    const delegatedAnchor = await app.inject({
      method: "POST",
      url: "/internal/openim/callbacks/message/after?token=test-callback-token-long-enough",
      payload: {
        sendID: (alice.user as { openimUserId?: string }).openimUserId,
        groupID: room.json().openimGroupId,
        serverMsgID: "server-delegated-5",
        clientMsgID: "client-delegated-5",
        content: JSON.stringify({ content: "检查父任务以外的目录" }),
        contentType: 101,
        seq: 5,
        sendTime: Date.now(),
      },
    });
    assert.equal(delegatedAnchor.statusCode, 200, delegatedAnchor.body);
    const delegatedTask = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: {
        sourceRoomId: room.json().id,
        anchorMessageId: "server-delegated-5",
        title: "父任务约束检查",
        objective: "验证子 Task 不能扩大目录权限",
        expectedResult: "越权授权被拒绝",
        plan: ["检查 other 目录"],
        acceptanceCriteria: ["不扩大父 Task 权限"],
        requestedAccess: "write",
        requestedScopes: ["workspace.read", "workspace.write"],
        assigneeIds: [agent.id],
        parentTaskId: permissionTaskId,
      },
    });
    assert.equal(delegatedTask.statusCode, 201, delegatedTask.body);
    const parentScopeExpansion = await app.inject({
      method: "POST",
      url: `/v1/tasks/${delegatedTask.json().id}/permission-grants`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { scopes: ["workspace.write"], constraints: { pathPrefixes: ["other"] } },
    });
    assert.equal(parentScopeExpansion.statusCode, 400, parentScopeExpansion.body);
    assert.equal(parentScopeExpansion.json().error.code, "PARENT_SCOPE_EXCEEDED");

    const grantedStart = await app.inject({
      method: "POST",
      url: `/v1/tasks/${permissionTaskId}/start`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "1" },
    });
    assert.equal(grantedStart.statusCode, 200, grantedStart.body);
    const repeatedStart = await app.inject({
      method: "POST",
      url: `/v1/tasks/${permissionTaskId}/start`,
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "1" },
    });
    assert.equal(repeatedStart.statusCode, 200, repeatedStart.body);
    assert.equal(repeatedStart.json().reused, true);
    assert.deepEqual(repeatedStart.json().runIds, grantedStart.json().runIds);
    const governedRun = await pool.query(
      `SELECT target_device_id, permission_grant_id, requested_scopes, write_intent
       FROM task_runs WHERE id = $1`,
      [grantedStart.json().runIds[0]],
    );
    assert.equal(governedRun.rows[0].target_device_id, bobDeviceId);
    assert.equal(governedRun.rows[0].permission_grant_id, grantId);
    assert.deepEqual(governedRun.rows[0].requested_scopes, [
      "workspace.read",
      "workspace.write",
      "command.run",
    ]);
    assert.equal(governedRun.rows[0].write_intent, true);

    const assignment = async (runId: string) =>
      (
        await pool.query(
          `SELECT tr.id AS run_id, tr.task_id, tr.agent_id, tr.agent_snapshot,
                  tr.context_version, t.title AS task_title, t.source_room_id,
                  t.task_room_id, t.anchor_message_id, a.owner_id,
                  tr.target_device_id, t.workspace_binding_id,
                  tr.requested_scopes, tr.write_intent
           FROM task_runs tr JOIN tasks t ON t.id = tr.task_id
           JOIN agents a ON a.id = tr.agent_id WHERE tr.id = $1`,
          [runId],
        )
      ).rows[0];
    const realtimeHub = new RealtimeHub(pool, undefined as never, config, cipher);
    const sentToWrongDevice: string[] = [];
    const wrongConnection = {
      socket: {
        readyState: 1,
        send: (value: string) => sentToWrongDevice.push(value),
        close() {},
      },
      userId: alice.user.id,
      deviceId: randomUUID(),
      agentIds: new Set<string>(),
    };
    await (
      realtimeHub as unknown as {
        leaseAndSend(connection: typeof wrongConnection, candidate: unknown): Promise<void>;
      }
    ).leaseAndSend(wrongConnection, await assignment(grantedStart.json().runIds[0]));
    assert.equal(sentToWrongDevice.length, 0);
    assert.equal(
      (
        await pool.query("SELECT status FROM task_runs WHERE id = $1", [
          grantedStart.json().runIds[0],
        ])
      ).rows[0].status,
      "queued",
    );

    const sentToBoundDevice: string[] = [];
    const boundConnection = {
      socket: {
        readyState: 1,
        send: (value: string) => sentToBoundDevice.push(value),
        close() {},
      },
      userId: bob.user.id,
      deviceId: bobDeviceId,
      agentIds: new Set<string>(),
    };
    await (
      realtimeHub as unknown as {
        leaseAndSend(connection: typeof boundConnection, candidate: unknown): Promise<void>;
      }
    ).leaseAndSend(boundConnection, await assignment(grantedStart.json().runIds[0]));
    assert.equal(sentToBoundDevice.length, 1);
    assert.equal(
      (
        await pool.query(
          "SELECT run_id FROM workspace_write_leases WHERE workspace_binding_id = $1",
          [secondBindingId],
        )
      ).rows[0]?.run_id,
      grantedStart.json().runIds[0],
    );

    const secondWriteRunId = randomUUID();
    await pool.query(
      `INSERT INTO task_runs(
         id, task_id, agent_id, status, execution_target, context_version, agent_snapshot,
         approval_id, started_by_user_id, target_device_id, permission_grant_id,
         idempotency_key, requested_scopes, write_intent
       ) SELECT $1, task_id, agent_id, 'queued', execution_target, context_version,
                agent_snapshot, approval_id, started_by_user_id, target_device_id,
                permission_grant_id, $2, requested_scopes, write_intent
         FROM task_runs WHERE id = $3`,
      [secondWriteRunId, `test:second-write:${secondWriteRunId}`, grantedStart.json().runIds[0]],
    );
    const secondWriteAssignment = await assignment(secondWriteRunId);
    assert.equal(secondWriteAssignment.write_intent, true);
    await (
      realtimeHub as unknown as {
        leaseAndSend(connection: typeof boundConnection, candidate: unknown): Promise<void>;
      }
    ).leaseAndSend(boundConnection, secondWriteAssignment);
    assert.equal(
      (
        await pool.query(
          "SELECT run_id FROM workspace_write_leases WHERE workspace_binding_id = $1",
          [secondBindingId],
        )
      ).rows[0]?.run_id,
      grantedStart.json().runIds[0],
    );
    assert.equal(
      (await pool.query("SELECT status FROM task_runs WHERE id = $1", [secondWriteRunId])).rows[0]
        .status,
      "queued",
    );

    const secondReadRunId = randomUUID();
    await pool.query(
      `INSERT INTO task_runs(
         id, task_id, agent_id, status, execution_target, context_version, agent_snapshot,
         approval_id, started_by_user_id, target_device_id, permission_grant_id,
         idempotency_key, requested_scopes, write_intent
       ) SELECT $1, task_id, agent_id, 'queued', execution_target, context_version,
                agent_snapshot, approval_id, started_by_user_id, target_device_id,
                permission_grant_id, $2, requested_scopes, false
         FROM task_runs WHERE id = $3`,
      [secondReadRunId, `test:second-read:${secondReadRunId}`, started.json().runIds[0]],
    );
    await (
      realtimeHub as unknown as {
        leaseAndSend(connection: typeof boundConnection, candidate: unknown): Promise<void>;
      }
    ).leaseAndSend(boundConnection, await assignment(started.json().runIds[0]));
    await (
      realtimeHub as unknown as {
        leaseAndSend(connection: typeof boundConnection, candidate: unknown): Promise<void>;
      }
    ).leaseAndSend(boundConnection, await assignment(secondReadRunId));
    const readStatuses = await pool.query(
      "SELECT status FROM task_runs WHERE id IN ($1, $2) ORDER BY id",
      [started.json().runIds[0], secondReadRunId],
    );
    assert.deepEqual(
      readStatuses.rows.map((row) => row.status),
      ["leased", "leased"],
    );

    await (
      realtimeHub as unknown as {
        markAgentsOffline(connection: typeof boundConnection): Promise<void>;
      }
    ).markAgentsOffline(boundConnection);
    assert.equal(
      (await pool.query("SELECT status FROM workspace_bindings WHERE id = $1", [secondBindingId]))
        .rows[0].status,
      "offline",
    );
    assert.equal(
      (await pool.query("SELECT status FROM tasks WHERE id = $1", [permissionTaskId])).rows[0]
        .status,
      "waiting_for_host",
    );

    await (
      realtimeHub as unknown as {
        registerHost(
          connection: typeof boundConnection,
          message: {
            type: "host.register";
            deviceId: string;
            name: string;
            platform: string;
            agentIds: string[];
          },
        ): Promise<void>;
      }
    ).registerHost(boundConnection, {
      type: "host.register",
      deviceId: bobDeviceId,
      name: "Bob's Mac",
      platform: "darwin",
      agentIds: [],
    });
    assert.equal(
      (await pool.query("SELECT status FROM workspace_bindings WHERE id = $1", [secondBindingId]))
        .rows[0].status,
      "online",
    );
    assert.equal(
      (await pool.query("SELECT status FROM tasks WHERE id = $1", [permissionTaskId])).rows[0]
        .status,
      "approved",
    );

    await pool.query(
      `UPDATE task_runs SET lease_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [grantedStart.json().runIds[0]],
    );
    await pool.query(
      `UPDATE workspace_write_leases
       SET acquired_at = now() - interval '2 seconds',
           expires_at = now() - interval '1 second'
       WHERE run_id = $1`,
      [grantedStart.json().runIds[0]],
    );
    await (realtimeHub as unknown as { sweepExpiredLeases(): Promise<void> }).sweepExpiredLeases();
    await (realtimeHub as unknown as { sweepExpiredLeases(): Promise<void> }).sweepExpiredLeases();
    const expiredRun = await pool.query("SELECT status, attempts FROM task_runs WHERE id = $1", [
      grantedStart.json().runIds[0],
    ]);
    assert.equal(expiredRun.rows[0].status, "queued");
    assert.equal(expiredRun.rows[0].attempts, 1);
    assert.equal(
      (
        await pool.query("SELECT count(*)::int AS count FROM task_runs WHERE id = $1", [
          grantedStart.json().runIds[0],
        ])
      ).rows[0].count,
      1,
    );
    await (
      realtimeHub as unknown as {
        leaseAndSend(connection: typeof boundConnection, candidate: unknown): Promise<void>;
      }
    ).leaseAndSend(boundConnection, await assignment(grantedStart.json().runIds[0]));
    const redeliveredRun = await pool.query(
      "SELECT status, attempts FROM task_runs WHERE id = $1",
      [grantedStart.json().runIds[0]],
    );
    assert.equal(redeliveredRun.rows[0].status, "leased");
    assert.equal(redeliveredRun.rows[0].attempts, 2);

    const revokedGrant = await app.inject({
      method: "DELETE",
      url: `/v1/tasks/${permissionTaskId}/permission-grants/${grantId}`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    assert.equal(revokedGrant.statusCode, 204, revokedGrant.body);
    const revokedState = await pool.query(
      `SELECT t.status, tr.status AS run_status FROM tasks t
       JOIN task_runs tr ON tr.task_id = t.id WHERE t.id = $1`,
      [permissionTaskId],
    );
    assert.equal(revokedState.rows[0].status, "waiting_for_permission");
    assert.equal(revokedState.rows[0].run_status, "cancelled");

    const memberAnchor = await app.inject({
      method: "POST",
      url: "/internal/openim/callbacks/message/after?token=test-callback-token-long-enough",
      payload: {
        sendID: (bob.user as { openimUserId?: string }).openimUserId,
        groupID: room.json().openimGroupId,
        serverMsgID: "server-member-6",
        clientMsgID: "client-member-6",
        content: JSON.stringify({ content: "普通成员请求一个只读分析" }),
        contentType: 101,
        seq: 6,
        sendTime: Date.now(),
      },
    });
    assert.equal(memberAnchor.statusCode, 200, memberAnchor.body);
    const memberProposal = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: {
        sourceRoomId: room.json().id,
        anchorMessageId: "server-member-6",
        title: "成员只读分析",
        objective: "分析当前实现",
        expectedResult: "分析报告",
        plan: ["读取代码", "整理结论"],
        requestedAccess: "read",
        assigneeIds: [agent.id],
      },
    });
    assert.equal(memberProposal.statusCode, 201, memberProposal.body);

    await pool.query(
      `INSERT INTO collaboration_audit_events(
         room_id, host_device_id, event_type, audience, redacted_summary, outcome
       ) VALUES ($1, $2, 'runtime.approval_requested', 'host_owner',
                 '需要确认一项 Runtime 操作。', 'pending')`,
      [room.json().id, bobDeviceId],
    );
    const memberAudit = await app.inject({
      method: "GET",
      url: `/v1/rooms/${room.json().id}/audit`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    assert.equal(memberAudit.statusCode, 200, memberAudit.body);
    assert.equal(
      memberAudit
        .json()
        .data.some((item: { eventType: string }) => item.eventType === "task.reviewed"),
      true,
    );
    assert.equal(
      memberAudit
        .json()
        .data.some(
          (item: { eventType: string }) => item.eventType === "runtime.approval_requested",
        ),
      false,
    );
    assert.equal(JSON.stringify(memberAudit.json()).includes("/Users/bob"), false);
    const hostAudit = await app.inject({
      method: "GET",
      url: `/v1/rooms/${room.json().id}/audit`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    assert.equal(hostAudit.statusCode, 200, hostAudit.body);
    assert.equal(
      hostAudit
        .json()
        .data.some(
          (item: { eventType: string }) => item.eventType === "runtime.approval_requested",
        ),
      true,
    );

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
      headers: { authorization: `Bearer ${alice.accessToken}`, "if-match": "3" },
      payload: { userIds: [], agentIds: [agent.id] },
    });
    assert.equal(replacedMembers.statusCode, 200, replacedMembers.body);
    assert.equal(replacedMembers.json().revision, 4);

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
