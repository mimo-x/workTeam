import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";

import type { EventPublisher } from "./events.js";
import { ApiError, parseBody, parseParams, parseQuery, requireRevision } from "./http.js";
import { enqueueOutbox } from "./outbox.js";
import { normalizeCompletionArtifactRefs } from "./task-completion-summary.js";

const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(80),
  userIds: z.array(z.string().uuid()).max(100).default([]),
  agentIds: z.array(z.string().uuid()).max(24).default([]),
});
const directSchema = z.object({ userId: z.string().uuid() });
const agentDirectSchema = z.object({ agentId: z.string().uuid() });
const updateRoomSchema = z.object({ name: z.string().trim().min(1).max(80) });
const replaceMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).max(100).default([]),
  agentIds: z.array(z.string().uuid()).max(24).default([]),
});
const idParams = z.object({ id: z.string().uuid() });
const messageQuery = z.object({
  beforeSeq: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const agentMessageSchema = z.object({
  agentId: z.string().uuid(),
  content: z.string().trim().min(1).max(100_000),
  deliveryId: z.string().trim().min(1).max(256),
  runId: z.string().uuid().optional(),
  parentMessageId: z.string().trim().min(1).max(256).optional(),
  agentHop: z.number().int().min(1).max(1_000).default(1),
  relayRootId: z.string().trim().min(1).max(256).optional(),
  loopId: z.string().trim().min(1).max(256).optional(),
  loopTurn: z.number().int().min(1).max(1_000).optional(),
});

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const jsonRecord = (value: unknown) => {
  if (typeof value !== "string") return recordValue(value);
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return undefined;
  }
};

export const taskSummaryMessageMetadata = (raw: unknown) => {
  const extension = jsonRecord(recordValue(raw)?.ex);
  if (extension?.kind !== "task-summary") return {};
  const taskId = z.string().uuid().safeParse(extension.taskId);
  if (!taskId.success) return {};
  const artifactRefs = z
    .array(z.string().trim().min(1).max(2_048))
    .max(64)
    .safeParse(extension.artifactRefs);
  return {
    kind: "task-summary" as const,
    taskId: taskId.data,
    artifactRefs: artifactRefs.success ? normalizeCompletionArtifactRefs(artifactRefs.data) : [],
  };
};

type RoomRow = {
  id: string;
  owner_id: string;
  openim_group_id: string | null;
  type: "direct" | "group" | "task";
  name: string;
  source_room_id: string | null;
  direct_key: string | null;
  revision: number;
  created_at: Date;
  updated_at: Date;
  current_user_role?: "owner" | "admin" | "member";
};

const roomDto = (row: RoomRow) => ({
  id: row.id,
  ownerId: row.owner_id,
  openimGroupId: row.openim_group_id,
  type: row.type,
  name: row.name,
  sourceRoomId: row.source_room_id,
  directAgentId: row.direct_key?.startsWith("agent:")
    ? row.direct_key.split(":").at(-1)
    : undefined,
  revision: row.revision,
  memberRole: row.current_user_role,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const isRoomMember = async (pool: pg.Pool, roomId: string, userId: string) => {
  const found = await pool.query("SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2", [
    roomId,
    userId,
  ]);
  return Boolean(found.rowCount);
};

export const registerRoomRoutes = (app: FastifyInstance, pool: pg.Pool, events: EventPublisher) => {
  app.get("/v1/rooms", { preHandler: [app.authenticate] }, async (request) => {
    const result = await pool.query<RoomRow>(
      `SELECT r.*, rm.role AS current_user_role FROM rooms r
       JOIN room_members rm ON rm.room_id = r.id
       WHERE rm.user_id = $1 AND r.archived_at IS NULL
       ORDER BY r.updated_at DESC`,
      [request.user.sub],
    );
    if (!result.rows.length) return { data: [] };
    const roomIds = result.rows.map((row) => row.id);
    const [members, bindingRows, agentRows] = await Promise.all([
      pool.query(
        `SELECT rm.room_id AS "roomId", u.id, u.handle, u.display_name AS "displayName",
                u.openim_user_id AS "openimUserId", rm.role
         FROM room_members rm JOIN users u ON u.id = rm.user_id
         WHERE rm.room_id IN (${roomIds.map((_, index) => `$${index + 1}`).join(",")})`,
        roomIds,
      ),
      pool.query(
        `SELECT rwb.room_id AS "roomId", wb.id, wb.user_id AS "hostUserId",
                wb.device_id AS "hostDeviceId", wb.label,
                wb.repository_url AS "repositoryUrl", wb.revision,
                wb.baseline_scopes AS "baselineScopes", wb.status,
                wb.last_seen_at AS "lastSeenAt"
         FROM room_workspace_bindings rwb
         JOIN workspace_bindings wb ON wb.id = rwb.workspace_binding_id
         WHERE rwb.room_id IN (${roomIds.map((_, index) => `$${index + 1}`).join(",")})
           AND rwb.status = 'active' AND wb.revoked_at IS NULL`,
        roomIds,
      ),
      pool.query(
        `SELECT ra.room_id AS "roomId", a.id, a.owner_id AS "ownerId",
                u.display_name AS "ownerName", a.openim_user_id AS "openimUserId",
                a.name, a.title, a.mention, a.description, a.visibility,
                a.execution_target AS "executionTarget", a.provider, a.protocol,
                a.capabilities, a.runtime_status AS "runtimeStatus",
                a.runtime_last_seen_at AS "runtimeLastSeenAt", a.version
         FROM room_agents ra JOIN agents a ON a.id = ra.agent_id
         JOIN users u ON u.id = a.owner_id
         WHERE ra.room_id IN (${roomIds.map((_, index) => `$${index + 1}`).join(",")})
           AND a.archived_at IS NULL`,
        roomIds,
      ),
    ]);
    return {
      data: result.rows.map((row) => ({
        ...roomDto(row),
        members: members.rows.filter((item) => item.roomId === row.id),
        agents: agentRows.rows.filter((item) => item.roomId === row.id),
        workspaceBinding: bindingRows.rows.find((item) => item.roomId === row.id),
      })),
    };
  });

  app.post("/v1/rooms/direct", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { userId } = parseBody(directSchema, request);
    if (userId === request.user.sub)
      throw new ApiError(400, "INVALID_DIRECT_PEER", "不能与自己创建私聊。");
    const pair = [request.user.sub, userId].sort();
    const friendship = await pool.query(
      "SELECT 1 FROM friendships WHERE user_low_id = $1 AND user_high_id = $2",
      pair,
    );
    if (!friendship.rowCount)
      throw new ApiError(403, "FRIENDSHIP_REQUIRED", "只有好友之间可以私聊。");
    const directKey = pair.join(":");
    const existing = await pool.query<RoomRow>(
      "SELECT * FROM rooms WHERE direct_key = $1 AND archived_at IS NULL",
      [directKey],
    );
    if (existing.rows[0]) return roomDto(existing.rows[0]);
    const peers = await pool.query<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])",
      [pair],
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query<RoomRow>(
        `INSERT INTO rooms(owner_id, type, name, direct_key)
         VALUES ($1, 'direct', $2, $3) RETURNING *`,
        [request.user.sub, peers.rows.map((item) => item.display_name).join("、"), directKey],
      );
      for (const id of pair) {
        await client.query("INSERT INTO room_members(room_id, user_id, role) VALUES ($1, $2, $3)", [
          created.rows[0].id,
          id,
          id === request.user.sub ? "owner" : "member",
        ]);
      }
      await client.query("COMMIT");
      events.publishToUser(userId, { type: "room.created", room: roomDto(created.rows[0]) });
      return reply.status(201).send(roomDto(created.rows[0]));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/v1/rooms/agent-direct", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { agentId } = parseBody(agentDirectSchema, request);
    const agentResult = await pool.query<{
      id: string;
      owner_id: string;
      openim_user_id: string;
      name: string;
      visibility: string;
    }>(
      "SELECT id, owner_id, openim_user_id, name, visibility FROM agents WHERE id = $1 AND archived_at IS NULL",
      [agentId],
    );
    const agent = agentResult.rows[0];
    if (!agent || (agent.owner_id !== request.user.sub && agent.visibility !== "public")) {
      throw new ApiError(404, "AGENT_NOT_FOUND", "Agent 不存在或不可见。");
    }
    const directKey = `agent:${request.user.sub}:${agent.id}`;
    const existing = await pool.query<RoomRow>(
      "SELECT * FROM rooms WHERE direct_key = $1 AND archived_at IS NULL",
      [directKey],
    );
    if (existing.rows[0]) return roomDto(existing.rows[0]);
    const owner = await pool.query<{ openim_user_id: string }>(
      "SELECT openim_user_id FROM users WHERE id = $1",
      [request.user.sub],
    );
    const roomId = randomUUID();
    const openimGroupId = `grp_direct_${roomId.replaceAll("-", "")}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query<RoomRow>(
        `INSERT INTO rooms(id, owner_id, openim_group_id, type, name, direct_key)
         VALUES ($1, $2, $3, 'direct', $4, $5) RETURNING *`,
        [roomId, request.user.sub, openimGroupId, agent.name, directKey],
      );
      await client.query(
        "INSERT INTO room_members(room_id, user_id, role) VALUES ($1, $2, 'owner')",
        [roomId, request.user.sub],
      );
      const owned = agent.owner_id === request.user.sub;
      if (owned) {
        await client.query(
          "INSERT INTO room_agents(room_id, agent_id, added_by) VALUES ($1, $2, $3)",
          [roomId, agent.id, request.user.sub],
        );
      } else {
        const invitation = await client.query<{ id: string }>(
          `INSERT INTO agent_invitations(room_id, agent_id, requester_id)
           VALUES ($1, $2, $3) RETURNING id`,
          [roomId, agent.id, request.user.sub],
        );
        events.publishToUser(agent.owner_id, {
          type: "agent.invitation.created",
          invitationId: invitation.rows[0].id,
          roomId,
          agentId: agent.id,
        });
      }
      await enqueueOutbox(client, "openim.group.create", "room", roomId, {
        groupID: openimGroupId,
        name: agent.name,
        ownerUserID: owner.rows[0].openim_user_id,
        memberUserIDs: [owner.rows[0].openim_user_id, ...(owned ? [agent.openim_user_id] : [])],
      });
      await client.query("COMMIT");
      return reply.status(201).send({
        ...roomDto(created.rows[0]),
        directAgentId: agent.id,
        pendingApproval: !owned,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/v1/rooms", { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = parseBody(createRoomSchema, request);
    const userIds = [...new Set([request.user.sub, ...input.userIds])];
    const friends = await pool.query<{ friend_id: string }>(
      `SELECT CASE WHEN user_low_id = $1 THEN user_high_id ELSE user_low_id END AS friend_id
       FROM friendships WHERE user_low_id = $1 OR user_high_id = $1`,
      [request.user.sub],
    );
    const allowedFriends = new Set(friends.rows.map((row) => row.friend_id));
    if (userIds.some((id) => id !== request.user.sub && !allowedFriends.has(id))) {
      throw new ApiError(403, "ROOM_MEMBER_NOT_FRIEND", "只能邀请好友加入群聊。");
    }
    const users = await pool.query<{ id: string; openim_user_id: string }>(
      `SELECT id, openim_user_id FROM users
       WHERE id IN (${userIds.map((_, index) => `$${index + 1}`).join(",")}) AND disabled_at IS NULL`,
      userIds,
    );
    if (users.rows.length !== userIds.length)
      throw new ApiError(404, "USER_NOT_FOUND", "部分群成员不存在。");
    const agentRows = input.agentIds.length
      ? await pool.query<{
          id: string;
          owner_id: string;
          visibility: string;
          openim_user_id: string;
        }>(
          `SELECT id, owner_id, visibility, openim_user_id FROM agents
           WHERE id IN (${input.agentIds.map((_, index) => `$${index + 1}`).join(",")}) AND archived_at IS NULL`,
          input.agentIds,
        )
      : { rows: [] };
    if (agentRows.rows.length !== new Set(input.agentIds).size)
      throw new ApiError(404, "AGENT_NOT_FOUND", "部分 Agent 不存在。");
    if (userIds.length + agentRows.rows.length < 2) {
      throw new ApiError(400, "ROOM_MEMBERS_REQUIRED", "群聊至少需要一名好友或 Agent。");
    }
    if (
      agentRows.rows.some(
        (agent) => agent.owner_id !== request.user.sub && agent.visibility !== "public",
      )
    ) {
      throw new ApiError(403, "PRIVATE_AGENT", "不能邀请其他用户的私有 Agent。");
    }
    const roomId = randomUUID();
    const openimGroupId = `grp_${roomId.replaceAll("-", "")}`;
    const ownedAgents = agentRows.rows.filter((agent) => agent.owner_id === request.user.sub);
    const externalAgents = agentRows.rows.filter((agent) => agent.owner_id !== request.user.sub);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query<RoomRow>(
        `INSERT INTO rooms(id, owner_id, openim_group_id, type, name)
         VALUES ($1, $2, $3, 'group', $4) RETURNING *`,
        [roomId, request.user.sub, openimGroupId, input.name],
      );
      for (const id of userIds) {
        await client.query("INSERT INTO room_members(room_id, user_id, role) VALUES ($1, $2, $3)", [
          roomId,
          id,
          id === request.user.sub ? "owner" : "member",
        ]);
      }
      for (const agent of ownedAgents) {
        await client.query(
          "INSERT INTO room_agents(room_id, agent_id, added_by) VALUES ($1, $2, $3)",
          [roomId, agent.id, request.user.sub],
        );
      }
      for (const agent of externalAgents) {
        const invitation = await client.query<{ id: string }>(
          `INSERT INTO agent_invitations(room_id, agent_id, requester_id)
           VALUES ($1, $2, $3) RETURNING id`,
          [roomId, agent.id, request.user.sub],
        );
        events.publishToUser(agent.owner_id, {
          type: "agent.invitation.created",
          invitationId: invitation.rows[0].id,
          roomId,
          agentId: agent.id,
        });
      }
      const ownerOpenim = users.rows.find((user) => user.id === request.user.sub)!.openim_user_id;
      await enqueueOutbox(client, "openim.group.create", "room", roomId, {
        groupID: openimGroupId,
        name: input.name,
        ownerUserID: ownerOpenim,
        memberUserIDs: [
          ...users.rows.map((user) => user.openim_user_id),
          ...ownedAgents.map((agent) => agent.openim_user_id),
        ],
      });
      await client.query("COMMIT");
      for (const id of userIds)
        events.publishToUser(id, { type: "room.created", room: roomDto(created.rows[0]) });
      return reply.status(201).send({
        ...roomDto(created.rows[0]),
        pendingAgentIds: externalAgents.map((agent) => agent.id),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch("/v1/rooms/:id", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = parseParams(idParams, request);
    const { name } = parseBody(updateRoomSchema, request);
    const revision = requireRevision(request);
    const result = await pool.query<RoomRow>(
      `UPDATE rooms SET name = $1, revision = revision + 1, updated_at = now()
       WHERE id = $2 AND owner_id = $3 AND revision = $4 AND archived_at IS NULL
       RETURNING *`,
      [name, id, request.user.sub, revision],
    );
    if (!result.rows[0])
      throw new ApiError(409, "REVISION_CONFLICT", "群组已被修改，或当前用户不是群主。");
    await events.publishToRoom(id, { type: "room.updated", room: roomDto(result.rows[0]) });
    return roomDto(result.rows[0]);
  });

  app.put("/v1/rooms/:id/members", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = parseParams(idParams, request);
    const input = parseBody(replaceMembersSchema, request);
    const revision = requireRevision(request);
    const requestedUserIds = [...new Set([request.user.sub, ...input.userIds])];
    const requestedAgentIds = [...new Set(input.agentIds)];
    const friends = await pool.query<{ friend_id: string }>(
      `SELECT CASE WHEN user_low_id = $1 THEN user_high_id ELSE user_low_id END AS friend_id
       FROM friendships WHERE user_low_id = $1 OR user_high_id = $1`,
      [request.user.sub],
    );
    const allowedFriends = new Set(friends.rows.map((row) => row.friend_id));
    if (
      requestedUserIds.some((userId) => userId !== request.user.sub && !allowedFriends.has(userId))
    ) {
      throw new ApiError(403, "ROOM_MEMBER_NOT_FRIEND", "只能邀请好友加入群聊。");
    }
    const [users, agents] = await Promise.all([
      pool.query<{ id: string; openim_user_id: string }>(
        `SELECT id, openim_user_id FROM users
         WHERE id IN (${requestedUserIds.map((_, index) => `$${index + 1}`).join(",")})
           AND disabled_at IS NULL`,
        requestedUserIds,
      ),
      requestedAgentIds.length
        ? pool.query<{ id: string; owner_id: string; visibility: string; openim_user_id: string }>(
            `SELECT id, owner_id, visibility, openim_user_id FROM agents
             WHERE id IN (${requestedAgentIds.map((_, index) => `$${index + 1}`).join(",")})
               AND archived_at IS NULL`,
            requestedAgentIds,
          )
        : Promise.resolve({ rows: [] }),
    ]);
    if (users.rows.length !== requestedUserIds.length)
      throw new ApiError(404, "USER_NOT_FOUND", "部分群成员不存在。");
    if (agents.rows.length !== requestedAgentIds.length)
      throw new ApiError(404, "AGENT_NOT_FOUND", "部分 Agent 不存在。");
    if (
      agents.rows.some(
        (agent) => agent.owner_id !== request.user.sub && agent.visibility !== "public",
      )
    ) {
      throw new ApiError(403, "PRIVATE_AGENT", "不能邀请其他用户的私有 Agent。");
    }
    if (requestedUserIds.length + requestedAgentIds.length < 2) {
      throw new ApiError(400, "ROOM_MEMBERS_REQUIRED", "群聊至少需要一名好友或 Agent。");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const roomResult = await client.query<RoomRow>(
        `SELECT * FROM rooms WHERE id = $1 AND owner_id = $2 AND type = 'group'
         AND revision = $3 AND archived_at IS NULL FOR UPDATE`,
        [id, request.user.sub, revision],
      );
      const room = roomResult.rows[0];
      if (!room) throw new ApiError(409, "REVISION_CONFLICT", "群组已被修改，或当前用户不是群主。");
      const [currentUsers, currentAgents] = await Promise.all([
        client.query<{ id: string; openim_user_id: string }>(
          `SELECT u.id, u.openim_user_id FROM room_members rm JOIN users u ON u.id = rm.user_id
           WHERE rm.room_id = $1`,
          [id],
        ),
        client.query<{ id: string; owner_id: string; openim_user_id: string }>(
          `SELECT a.id, a.owner_id, a.openim_user_id FROM room_agents ra JOIN agents a ON a.id = ra.agent_id
           WHERE ra.room_id = $1`,
          [id],
        ),
      ]);
      const desiredUsers = new Set(requestedUserIds);
      const desiredAgents = new Set(requestedAgentIds);
      const removedUsers = currentUsers.rows.filter((user) => !desiredUsers.has(user.id));
      const removedAgents = currentAgents.rows.filter((agent) => !desiredAgents.has(agent.id));
      const existingUserIds = new Set(currentUsers.rows.map((user) => user.id));
      const existingAgentIds = new Set(currentAgents.rows.map((agent) => agent.id));
      for (const user of removedUsers) {
        await client.query("DELETE FROM room_members WHERE room_id = $1 AND user_id = $2", [
          id,
          user.id,
        ]);
      }
      for (const agent of removedAgents) {
        await client.query("DELETE FROM room_agents WHERE room_id = $1 AND agent_id = $2", [
          id,
          agent.id,
        ]);
      }
      const addedUsers = users.rows.filter((user) => !existingUserIds.has(user.id));
      for (const user of addedUsers) {
        await client.query(
          "INSERT INTO room_members(room_id, user_id, role) VALUES ($1, $2, 'member')",
          [id, user.id],
        );
      }
      const ownedAgentAdds = agents.rows.filter(
        (agent) => agent.owner_id === request.user.sub && !existingAgentIds.has(agent.id),
      );
      for (const agent of ownedAgentAdds) {
        await client.query(
          "INSERT INTO room_agents(room_id, agent_id, added_by) VALUES ($1, $2, $3)",
          [id, agent.id, request.user.sub],
        );
      }
      const externalAgentInvites = agents.rows.filter(
        (agent) => agent.owner_id !== request.user.sub && !existingAgentIds.has(agent.id),
      );
      for (const agent of externalAgentInvites) {
        const invitation = await client.query<{ id: string }>(
          `INSERT INTO agent_invitations(room_id, agent_id, requester_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (room_id, agent_id) WHERE status = 'pending' DO NOTHING
           RETURNING id`,
          [id, agent.id, request.user.sub],
        );
        if (invitation.rows[0]) {
          events.publishToUser(agent.owner_id, {
            type: "agent.invitation.created",
            invitationId: invitation.rows[0].id,
            roomId: id,
            agentId: agent.id,
          });
        }
      }
      await client.query(
        `UPDATE agent_invitations SET status = 'rejected', responded_at = now(), updated_at = now()
         WHERE room_id = $1 AND status = 'pending' AND NOT (agent_id = ANY($2::uuid[]))`,
        [id, requestedAgentIds],
      );
      const inviteOpenimIds = [
        ...addedUsers.map((user) => user.openim_user_id),
        ...ownedAgentAdds.map((agent) => agent.openim_user_id),
      ];
      const kickOpenimIds = [
        ...removedUsers.map((user) => user.openim_user_id),
        ...removedAgents.map((agent) => agent.openim_user_id),
      ];
      if (room.openim_group_id && inviteOpenimIds.length) {
        await enqueueOutbox(client, "openim.group.invite", "room", id, {
          groupID: room.openim_group_id,
          userIDs: inviteOpenimIds,
        });
      }
      if (room.openim_group_id && kickOpenimIds.length) {
        await enqueueOutbox(client, "openim.group.kick", "room", id, {
          groupID: room.openim_group_id,
          userIDs: kickOpenimIds,
        });
      }
      const updated = await client.query<RoomRow>(
        "UPDATE rooms SET revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *",
        [id],
      );
      await client.query("COMMIT");
      await events.publishToRoom(id, { type: "room.members.updated", roomId: id });
      return {
        ...roomDto(updated.rows[0]),
        pendingAgentIds: externalAgentInvites.map((agent) => agent.id),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/v1/rooms/:id/messages", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = parseParams(idParams, request);
    const { beforeSeq, limit } = parseQuery(messageQuery, request);
    if (!(await isRoomMember(pool, id, request.user.sub)))
      throw new ApiError(404, "ROOM_NOT_FOUND", "房间不存在。");
    const result = await pool.query(
      `SELECT server_msg_id AS "serverMsgId", client_msg_id AS "clientMsgId", room_id AS "roomId",
              sender_openim_id AS "senderOpenimId", sender_user_id AS "senderUserId",
              sender_agent_id AS "senderAgentId", content, content_type AS "contentType", seq,
              target_agent_ids AS "targetAgentIds", raw, sent_at AS "sentAt"
       FROM message_mirrors
       WHERE room_id = $1 AND ($2::bigint IS NULL OR seq < $2)
       ORDER BY seq DESC LIMIT $3`,
      [id, beforeSeq ?? null, limit],
    );
    return {
      data: result.rows.reverse().map(({ raw, ...message }) => ({
        ...message,
        ...taskSummaryMessageMetadata(raw),
      })),
      nextCursor: result.rows.length === limit ? result.rows.at(-1)?.seq : null,
    };
  });

  app.post(
    "/v1/rooms/:id/agent-messages",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = parseParams(idParams, request);
      const input = parseBody(agentMessageSchema, request);
      const allowed = await pool.query<{
        openim_group_id: string;
        openim_user_id: string;
        name: string;
      }>(
        `SELECT r.openim_group_id, a.openim_user_id, a.name
         FROM rooms r
         JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = $2
         JOIN room_agents ra ON ra.room_id = r.id
         JOIN agents a ON a.id = ra.agent_id
         WHERE r.id = $1 AND r.archived_at IS NULL AND r.openim_group_id IS NOT NULL
           AND a.id = $3 AND a.owner_id = $2 AND a.execution_target = 'local'
           AND a.archived_at IS NULL`,
        [id, request.user.sub, input.agentId],
      );
      const target = allowed.rows[0];
      if (!target) {
        throw new ApiError(
          403,
          "AGENT_MESSAGE_NOT_ALLOWED",
          "只能发布当前用户拥有且属于该群的本机 Agent 回复。",
        );
      }
      const deliveryKey = `agent-chat:${input.deliveryId}`;
      const existing = await pool.query("SELECT 1 FROM outbox_events WHERE delivery_key = $1", [
        deliveryKey,
      ]);
      if (existing.rowCount) {
        return reply.status(202).send({ accepted: true, duplicate: true });
      }
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO outbox_events(topic, aggregate_type, aggregate_id, payload, delivery_key)
         VALUES ('openim.message.send', 'agent_chat', $1, $2::jsonb, $3)
         ON CONFLICT (delivery_key) DO NOTHING RETURNING id`,
        [
          input.deliveryId,
          JSON.stringify({
            sendID: target.openim_user_id,
            senderNickname: target.name,
            groupID: target.openim_group_id,
            content: input.content,
            ex: {
              kind: "agent-message",
              agentId: input.agentId,
              runId: input.runId,
              parentMessageId: input.parentMessageId,
              agentHop: input.agentHop,
              relayRootId: input.relayRootId,
              loopId: input.loopId,
              loopTurn: input.loopTurn,
              final: true,
            },
          }),
          deliveryKey,
        ],
      );
      return reply.status(202).send({ accepted: true, duplicate: inserted.rows.length === 0 });
    },
  );

  app.get("/v1/agent-invitations", { preHandler: [app.authenticate] }, async (request) => {
    const result = await pool.query(
      `SELECT ai.id, ai.room_id AS "roomId", ai.agent_id AS "agentId", ai.requester_id AS "requesterId",
              ai.status, ai.created_at AS "createdAt", r.name AS "roomName", a.name AS "agentName"
       FROM agent_invitations ai
       JOIN agents a ON a.id = ai.agent_id JOIN rooms r ON r.id = ai.room_id
       WHERE a.owner_id = $1 ORDER BY ai.created_at DESC LIMIT 200`,
      [request.user.sub],
    );
    return { data: result.rows };
  });

  const respondInvitation = (accepted: boolean) => async (request: any, reply: any) => {
    const { id } = parseParams(idParams, request);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{
        room_id: string;
        agent_id: string;
        requester_id: string;
        openim_group_id: string;
        openim_user_id: string;
      }>(
        `SELECT ai.room_id, ai.agent_id, ai.requester_id, r.openim_group_id, a.openim_user_id
         FROM agent_invitations ai JOIN agents a ON a.id = ai.agent_id JOIN rooms r ON r.id = ai.room_id
         WHERE ai.id = $1 AND a.owner_id = $2 AND ai.status = 'pending' FOR UPDATE`,
        [id, request.user.sub],
      );
      const invitation = found.rows[0];
      if (!invitation)
        throw new ApiError(404, "INVITATION_NOT_FOUND", "Agent 邀请不存在或已处理。");
      await client.query(
        "UPDATE agent_invitations SET status = $1, responded_at = now(), updated_at = now() WHERE id = $2",
        [accepted ? "accepted" : "rejected", id],
      );
      if (accepted) {
        await client.query(
          "INSERT INTO room_agents(room_id, agent_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [invitation.room_id, invitation.agent_id, invitation.requester_id],
        );
        if (invitation.openim_group_id) {
          await enqueueOutbox(client, "openim.group.invite", "room", invitation.room_id, {
            groupID: invitation.openim_group_id,
            userIDs: [invitation.openim_user_id],
          });
        }
      }
      await client.query("COMMIT");
      await events.publishToRoom(invitation.room_id, {
        type: accepted ? "agent.invitation.accepted" : "agent.invitation.rejected",
        invitationId: id,
        agentId: invitation.agent_id,
      });
      return reply.status(204).send();
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  app.post(
    "/v1/agent-invitations/:id/accept",
    { preHandler: [app.authenticate] },
    respondInvitation(true),
  );
  app.post(
    "/v1/agent-invitations/:id/reject",
    { preHandler: [app.authenticate] },
    respondInvitation(false),
  );
};
