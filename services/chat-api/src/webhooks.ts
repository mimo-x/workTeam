import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";

import type { AppConfig } from "./config.js";
import type { EventPublisher } from "./events.js";
import { ApiError } from "./http.js";
import { enqueueOutbox } from "./outbox.js";

type OpenImCallback = Record<string, unknown> & {
  sendID?: string;
  recvID?: string;
  groupID?: string;
  serverMsgID?: string;
  clientMsgID?: string;
  senderNickname?: string;
  content?: string;
  contentType?: number;
  sendTime?: number;
  createTime?: number;
  seq?: number;
  atUserList?: string[];
  ex?: string;
};

const callbackResponse = (allowed = true, message = "") => ({
  actionCode: 0,
  errCode: allowed ? 0 : 5001,
  errMsg: message,
  errDlt: message,
  nextCode: allowed ? 0 : 1,
});

const parseJson = (value: unknown) => {
  if (!value || typeof value !== "string") return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const extractText = (body: OpenImCallback) => {
  const content = parseJson(body.content);
  return typeof content.content === "string"
    ? content.content
    : typeof content.text === "string"
      ? content.text
      : String(body.content ?? "");
};

const authorizedCallback = (request: FastifyRequest, config: AppConfig) => {
  const header = request.headers["x-agent-team-callback-token"];
  const query = (request.query as { token?: unknown })?.token;
  return String(header ?? query ?? "") === config.OPENIM_CALLBACK_TOKEN;
};

type AgentForTask = {
  id: string;
  owner_id: string;
  openim_user_id: string;
  name: string;
  title: string;
  mention: string;
  description: string;
  visibility: string;
  workspace_access: string;
  execution_target: string;
  skill_policy: string;
  skill_refs: unknown;
  private_config: unknown;
  version: number;
};

export const registerOpenImWebhooks = (
  app: FastifyInstance,
  pool: pg.Pool,
  config: AppConfig,
  events: EventPublisher,
) => {
  app.post("/internal/openim/callbacks/message/before", async (request) => {
    if (!authorizedCallback(request, config))
      throw new ApiError(401, "INVALID_CALLBACK_TOKEN", "回调令牌无效。");
    const body = request.body as OpenImCallback;
    const sender = String(body.sendID ?? "");
    const receiver = String(body.recvID ?? "");
    const group = String(body.groupID ?? "");
    if (!sender) return callbackResponse(false, "缺少发送者。");
    const senderAgent = await pool.query(
      "SELECT id FROM agents WHERE openim_user_id = $1 AND archived_at IS NULL",
      [sender],
    );
    if (senderAgent.rowCount) return callbackResponse(true);
    const senderUser = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE openim_user_id = $1 AND disabled_at IS NULL",
      [sender],
    );
    if (!senderUser.rows[0]) return callbackResponse(false, "未知发送者。");
    if (group) {
      const member = await pool.query(
        `SELECT 1 FROM rooms r JOIN room_members rm ON rm.room_id = r.id
         WHERE r.openim_group_id = $1 AND rm.user_id = $2 AND r.archived_at IS NULL`,
        [group, senderUser.rows[0].id],
      );
      return callbackResponse(Boolean(member.rowCount), "无权向该群发送消息。");
    }
    const receiverUser = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE openim_user_id = $1",
      [receiver],
    );
    if (!receiverUser.rows[0]) return callbackResponse(false, "未知接收者。");
    const pair = [senderUser.rows[0].id, receiverUser.rows[0].id].sort();
    const friends = await pool.query(
      "SELECT 1 FROM friendships WHERE user_low_id = $1 AND user_high_id = $2",
      pair,
    );
    return callbackResponse(Boolean(friends.rowCount), "只有好友之间可以私聊。");
  });

  app.post("/internal/openim/callbacks/message/after", async (request) => {
    if (!authorizedCallback(request, config))
      throw new ApiError(401, "INVALID_CALLBACK_TOKEN", "回调令牌无效。");
    const body = request.body as OpenImCallback;
    const serverMsgId = String(body.serverMsgID ?? "");
    const clientMsgId = String(body.clientMsgID ?? serverMsgId);
    if (!serverMsgId || !clientMsgId) return callbackResponse(true);
    const senderOpenimId = String(body.sendID ?? "");
    const groupId = String(body.groupID ?? "");
    const receiverOpenimId = String(body.recvID ?? "");
    const room = groupId
      ? await pool.query<{ id: string; type: string; owner_id: string; openim_group_id: string }>(
          "SELECT id, type, owner_id, openim_group_id FROM rooms WHERE openim_group_id = $1 AND archived_at IS NULL",
          [groupId],
        )
      : await findDirectRoom(pool, senderOpenimId, receiverOpenimId);
    if (!room.rows[0]) return callbackResponse(true);
    const senderUser = await pool.query<{ id: string; openim_user_id: string }>(
      "SELECT id, openim_user_id FROM users WHERE openim_user_id = $1",
      [senderOpenimId],
    );
    const senderAgent = await pool.query<{ id: string }>(
      "SELECT id FROM agents WHERE openim_user_id = $1",
      [senderOpenimId],
    );
    const extension = parseJson(body.ex);
    const rawDeliveryKey = extension.deliveryKey ?? extension.deliveryId;
    const deliveryKey =
      typeof rawDeliveryKey === "string" && rawDeliveryKey.trim()
        ? rawDeliveryKey.trim().slice(0, 256)
        : null;
    const agentAction = extension.agentAction === "propose-task" ? "propose-task" : "chat";
    const mentionedOpenimIds = new Set([
      ...(Array.isArray(body.atUserList) ? body.atUserList.map(String) : []),
      ...(Array.isArray(extension.targetAgentIds) ? extension.targetAgentIds.map(String) : []),
    ]);
    const targetAgents = mentionedOpenimIds.size
      ? await pool.query<AgentForTask>(
          `SELECT a.* FROM agents a JOIN room_agents ra ON ra.agent_id = a.id
           WHERE ra.room_id = $1
             AND a.openim_user_id IN (${[...mentionedOpenimIds]
               .map((_, index) => `$${index + 2}`)
               .join(",")})
             AND a.archived_at IS NULL`,
          [room.rows[0].id, ...mentionedOpenimIds],
        )
      : { rows: [] as AgentForTask[] };
    const text = extractText(body).slice(0, 100_000);
    const sentAt = new Date(Number(body.sendTime ?? body.createTime ?? Date.now()));
    const sequence = Number(body.seq ?? 0);
    const client = await pool.connect();
    let createdTask: { id: string; taskRoomId: string } | null = null;
    const contextUpdates: Array<{ taskId: string; taskRoomId: string; contextVersion: number }> =
      [];
    try {
      await client.query("BEGIN");
      const duplicate = await client.query(
        `SELECT 1 FROM message_mirrors
         WHERE server_msg_id = $1 OR client_msg_id = $2
            OR ($3::text IS NOT NULL AND delivery_key = $3)`,
        [serverMsgId, clientMsgId, deliveryKey],
      );
      if (duplicate.rowCount) {
        await client.query("COMMIT");
        return callbackResponse(true);
      }
      const inserted = await client.query(
        `INSERT INTO message_mirrors(
           server_msg_id, client_msg_id, room_id, openim_conversation_id, sender_openim_id,
           sender_user_id, sender_agent_id, content, content_type, seq, target_agent_ids,
           delivery_key, raw, sent_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14)
         ON CONFLICT DO NOTHING RETURNING server_msg_id`,
        [
          serverMsgId,
          clientMsgId,
          room.rows[0].id,
          groupId || [senderOpenimId, receiverOpenimId].sort().join(":"),
          senderOpenimId,
          senderUser.rows[0]?.id ?? null,
          senderAgent.rows[0]?.id ?? null,
          text,
          Number(body.contentType ?? 101),
          sequence,
          JSON.stringify(targetAgents.rows.map((agent) => agent.id)),
          deliveryKey,
          JSON.stringify(body),
          sentAt,
        ],
      );
      if (!inserted.rowCount) {
        await client.query("COMMIT");
        return callbackResponse(true);
      }
      if (typeof extension.runId === "string") {
        await client.query(
          "UPDATE task_runs SET output_message_id = $1, updated_at = now() WHERE id::text = $2",
          [serverMsgId, extension.runId],
        );
      }
      await client.query("UPDATE rooms SET updated_at = now() WHERE id = $1", [room.rows[0].id]);

      if (room.rows[0].type === "group" || room.rows[0].type === "direct") {
        const activeTasks = await client.query<{
          id: string;
          context_version: number;
          task_room_id: string;
        }>(
          `UPDATE tasks SET context_version = context_version + 1,
                  latest_source_seq = GREATEST(latest_source_seq, $2), updated_at = now()
           WHERE source_room_id = $1 AND status NOT IN ('done', 'cancelled', 'failed')
           RETURNING id, context_version, task_room_id`,
          [room.rows[0].id, sequence],
        );
        for (const task of activeTasks.rows) {
          await client.query(
            `INSERT INTO task_context_events(task_id, message_id, context_version, source_seq)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [task.id, serverMsgId, task.context_version, sequence],
          );
          contextUpdates.push({
            taskId: task.id,
            taskRoomId: task.task_room_id,
            contextVersion: task.context_version,
          });
        }
        if (senderUser.rows[0] && targetAgents.rows.length && agentAction === "propose-task") {
          createdTask = await createTaskFromMessage(
            client,
            room.rows[0],
            senderUser.rows[0],
            targetAgents.rows,
            { serverMsgId, sequence, text },
          );
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await events.publishToRoom(room.rows[0].id, {
      type: "message.mirrored",
      roomId: room.rows[0].id,
      serverMsgId,
      seq: sequence,
    });
    for (const update of contextUpdates) {
      await events.publishToRoom(update.taskRoomId, {
        type: "task.context.appended",
        taskId: update.taskId,
        messageId: serverMsgId,
        contextVersion: update.contextVersion,
        sourceSeq: sequence,
        content: text,
        senderId: senderOpenimId,
        sentAt,
      });
    }
    if (createdTask) {
      await events.publishToRoom(room.rows[0].id, {
        type: "task.proposed",
        taskId: createdTask.id,
        taskRoomId: createdTask.taskRoomId,
        anchorMessageId: serverMsgId,
      });
    }
    return callbackResponse(true);
  });
};

const findDirectRoom = async (pool: pg.Pool, sender: string, receiver: string) => {
  const users = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE openim_user_id = ANY($1::text[]) ORDER BY id",
    [[sender, receiver]],
  );
  if (users.rows.length !== 2)
    return { rows: [] } as {
      rows: Array<{ id: string; type: string; owner_id: string; openim_group_id: string }>;
    };
  return pool.query<{ id: string; type: string; owner_id: string; openim_group_id: string }>(
    "SELECT id, type, owner_id, openim_group_id FROM rooms WHERE direct_key = $1 AND archived_at IS NULL",
    [
      users.rows
        .map((row) => row.id)
        .sort()
        .join(":"),
    ],
  );
};

const createTaskFromMessage = async (
  client: pg.PoolClient,
  sourceRoom: { id: string; owner_id: string; openim_group_id: string },
  creator: { id: string; openim_user_id: string },
  targetAgents: AgentForTask[],
  message: { serverMsgId: string; sequence: number; text: string },
) => {
  const taskId = randomUUID();
  const taskRoomId = randomUUID();
  const taskGroupId = `grp_task_${taskRoomId.replaceAll("-", "")}`;
  const title =
    message.text
      .replace(/@[\p{L}\p{N}_-]+/gu, "")
      .trim()
      .slice(0, 100) || "Agent Task";
  await client.query(
    `INSERT INTO rooms(id, owner_id, openim_group_id, type, name, source_room_id)
     VALUES ($1, $2, $3, 'task', $4, $5)`,
    [taskRoomId, creator.id, taskGroupId, title, sourceRoom.id],
  );
  await client.query("INSERT INTO room_members(room_id, user_id, role) VALUES ($1, $2, 'owner')", [
    taskRoomId,
    creator.id,
  ]);
  for (const agent of targetAgents) {
    await client.query("INSERT INTO room_agents(room_id, agent_id, added_by) VALUES ($1, $2, $3)", [
      taskRoomId,
      agent.id,
      creator.id,
    ]);
  }
  const activeBinding = await client.query<{
    workspace_binding_id: string;
    binding_revision: number;
  }>(
    `SELECT workspace_binding_id, binding_revision FROM room_workspace_bindings
     WHERE room_id = $1 AND status = 'active'`,
    [sourceRoom.id],
  );
  const requestedAccess = targetAgents.some((agent) => agent.workspace_access === "write")
    ? "write"
    : "read";
  const requestedScopes =
    requestedAccess === "write" ? ["workspace.read", "workspace.write"] : ["workspace.read"];
  await client.query(
    `INSERT INTO tasks(
       id, creator_id, requested_by_user_id, proposed_by_agent_id, source_room_id, task_room_id,
       anchor_message_id, title, objective, expected_result, plan, acceptance_criteria,
       requested_access, requested_scopes, status, revision, context_version, latest_source_seq,
       approval_required, workspace_binding_id, binding_revision, root_task_id
     ) VALUES (
       $1,$2,$2,$3,$4,$5,$6,$7,$8,$8,$9::jsonb,'[]'::jsonb,$10,$11::jsonb,
       'pending_review',1,1,$12,true,$13,$14,NULL
     )`,
    [
      taskId,
      creator.id,
      targetAgents[0]?.id ?? null,
      sourceRoom.id,
      taskRoomId,
      message.serverMsgId,
      title,
      message.text,
      JSON.stringify(["由 Agent 完善执行计划和验收条件"]),
      requestedAccess,
      JSON.stringify(requestedScopes),
      message.sequence,
      activeBinding.rows[0]?.workspace_binding_id ?? null,
      activeBinding.rows[0]?.binding_revision ?? null,
    ],
  );
  await client.query("UPDATE tasks SET root_task_id = id WHERE id = $1", [taskId]);
  await client.query(
    `INSERT INTO task_context_events(task_id, message_id, context_version, source_seq)
     VALUES ($1, $2, 1, $3)`,
    [taskId, message.serverMsgId, message.sequence],
  );
  for (const agent of targetAgents) {
    await client.query("INSERT INTO task_assignees(task_id, agent_id) VALUES ($1, $2)", [
      taskId,
      agent.id,
    ]);
  }
  await enqueueOutbox(client, "openim.group.create", "room", taskRoomId, {
    groupID: taskGroupId,
    name: title,
    ownerUserID: creator.openim_user_id,
    memberUserIDs: [creator.openim_user_id, ...targetAgents.map((agent) => agent.openim_user_id)],
  });
  return { id: taskId, taskRoomId };
};
