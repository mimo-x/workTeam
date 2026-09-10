import { createHash, randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";

import { ApiError, parseBody } from "./http.js";
import { enqueueOutbox } from "./outbox.js";
import type { EnvelopeCipher } from "./security.js";

const agentSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().default("Agent"),
    title: z.string().default("Agent"),
    mention: z.string().default("@agent"),
    description: z.string().default(""),
    instructions: z.string().default("Imported Agent"),
    workspaceAccess: z.enum(["read", "write"]).default("read"),
    visibility: z.enum(["private", "public"]).default("private"),
    executionLocation: z.enum(["local", "hosted"]).default("local"),
    runtime: z
      .object({
        provider: z.string().trim().min(1).max(64).default("codex"),
        protocol: z.string().trim().min(1).max(64).default("app-server"),
        target: z.enum(["local", "hosted"]).default("local"),
        model: z.string().trim().max(256).optional(),
        endpoint: z
          .string()
          .trim()
          .url()
          .max(2_048)
          .refine((value) => {
            const url = new URL(value);
            return (
              url.protocol === "https:" ||
              ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
            );
          }, "远程 Runtime endpoint 必须使用 HTTPS。")
          .optional(),
        command: z.string().trim().max(1_024).optional(),
        args: z.array(z.string().max(256)).max(32).default([]),
        auth: z.enum(["bearer", "none"]).default("none"),
      })
      .optional(),
    capabilities: z.array(z.string().trim().min(1).max(80)).max(64).default([]),
  })
  .passthrough();

const messageSchema = z
  .object({
    id: z.string().min(1).max(256),
    externalId: z.string().max(256).optional(),
    senderId: z.string().default("local_user"),
    content: z.string().max(100_000).default(""),
    seq: z.number().int().nonnegative().default(0),
    createdAt: z.number().default(() => Date.now()),
    targetAgentIds: z.array(z.string()).default([]),
  })
  .passthrough();

const roomSchema = z
  .object({
    roomId: z.string().min(1).max(256),
    name: z.string().default("Imported room"),
    type: z.enum(["direct", "group", "task"]).default("group"),
    sourceRoomId: z.string().optional(),
    agentIds: z.array(z.string()).default([]),
    humanIds: z.array(z.string()).default(["local_user"]),
    messages: z.array(messageSchema).max(5_000).default([]),
    createdAt: z.number().default(() => Date.now()),
  })
  .passthrough();

const taskSchema = z
  .object({
    id: z.string().min(1).max(256),
    title: z.string().default("Imported Task"),
    sourceRoomId: z.string(),
    taskRoomId: z.string(),
    anchorMessageId: z.string(),
    assigneeIds: z.array(z.string()).default([]),
    status: z
      .enum(["queued", "running", "waiting", "review", "blocked", "done", "failed", "cancelled"])
      .default("waiting"),
    contextVersion: z.number().int().positive().default(1),
    latestSourceSeq: z.number().int().nonnegative().default(0),
    contextEvents: z
      .array(
        z.object({
          messageId: z.string(),
          sourceSeq: z.number().int().nonnegative(),
          createdAt: z.number().optional(),
        }),
      )
      .default([]),
    createdAt: z.number().default(() => Date.now()),
    updatedAt: z.number().default(() => Date.now()),
  })
  .passthrough();

const importSchema = z.object({
  workspace: z.string().min(1).max(4_096),
  agents: z.array(agentSchema).max(100).default([]),
  humans: z
    .array(z.object({ id: z.string(), name: z.string().optional() }).passthrough())
    .max(500)
    .default([]),
  rooms: z.array(roomSchema).max(500).default([]),
  tasks: z.array(taskSchema).max(2_000).default([]),
});

const mapping = async (client: pg.PoolClient, userId: string, kind: string, legacyId: string) => {
  const existing = await client.query<{ entity_id: string }>(
    "SELECT entity_id FROM legacy_mappings WHERE user_id = $1 AND kind = $2 AND legacy_id = $3",
    [userId, kind, legacyId],
  );
  if (existing.rows[0]) return { id: existing.rows[0].entity_id, fresh: false };
  const id = randomUUID();
  await client.query(
    "INSERT INTO legacy_mappings(user_id, kind, legacy_id, entity_id) VALUES ($1, $2, $3, $4)",
    [userId, kind, legacyId, id],
  );
  return { id, fresh: true };
};

export const registerImportRoutes = (
  app: FastifyInstance,
  pool: pg.Pool,
  cipher: EnvelopeCipher,
) => {
  app.post(
    "/v1/imports/local-workspace",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const keyHeader = request.headers["idempotency-key"];
      const key = String(Array.isArray(keyHeader) ? keyHeader[0] : (keyHeader ?? ""));
      if (!/^[a-zA-Z0-9_.:-]{8,128}$/.test(key)) {
        throw new ApiError(
          400,
          "IDEMPOTENCY_KEY_REQUIRED",
          "导入操作需要 8 到 128 位 Idempotency-Key。",
        );
      }
      const input = parseBody(importSchema, request);
      const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const existing = await pool.query<{
        request_hash: string;
        response: Record<string, unknown>;
      }>(
        "SELECT request_hash, response FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND expires_at > now()",
        [request.user.sub, key],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== requestHash) {
          throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "相同幂等键不能用于不同的导入内容。");
        }
        return existing.rows[0].response;
      }

      const client = await pool.connect();
      const warnings: string[] = [];
      const counts = { agents: 0, rooms: 0, messages: 0, tasks: 0 };
      try {
        await client.query("BEGIN");
        const currentUser = await client.query<{ openim_user_id: string }>(
          "SELECT openim_user_id FROM users WHERE id = $1",
          [request.user.sub],
        );
        if (!currentUser.rows[0]) throw new ApiError(404, "USER_NOT_FOUND", "用户不存在。");
        const agentIds = new Map<string, string>();
        const agentOpenimIds = new Map<string, string>();
        for (const agent of input.agents) {
          const mapped = await mapping(client, request.user.sub, "agent", agent.id);
          agentIds.set(agent.id, mapped.id);
          const openimUserId = `agt_${mapped.id.replaceAll("-", "")}`;
          agentOpenimIds.set(agent.id, openimUserId);
          if (!mapped.fresh) continue;
          const privateConfig = await cipher.encrypt({
            instructions: agent.instructions,
            secrets: {},
          });
          const runtime = agent.runtime ?? {
            provider: "codex",
            protocol: "app-server",
            target: agent.executionLocation,
            args: [],
            auth: "none",
          };
          await client.query(
            `INSERT INTO agents(
             id, owner_id, openim_user_id, name, title, mention, description, visibility,
             workspace_access, execution_target, provider, protocol, runtime_model,
             runtime_endpoint, runtime_command, runtime_args, runtime_auth, capabilities,
             private_config
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19::jsonb)`,
            [
              mapped.id,
              request.user.sub,
              openimUserId,
              agent.name.slice(0, 64),
              agent.title.slice(0, 64),
              agent.mention.slice(0, 42),
              agent.description.slice(0, 500),
              agent.visibility,
              agent.workspaceAccess,
              agent.executionLocation,
              runtime.provider,
              runtime.protocol,
              runtime.model ?? null,
              runtime.endpoint ?? null,
              runtime.command ?? null,
              JSON.stringify(runtime.args ?? []),
              runtime.auth ?? "none",
              JSON.stringify(agent.capabilities),
              JSON.stringify(privateConfig),
            ],
          );
          await enqueueOutbox(client, "openim.user.register", "agent", mapped.id, {
            userID: openimUserId,
            nickname: agent.name,
            faceURL: "",
          });
          counts.agents += 1;
        }

        const roomIds = new Map<string, string>();
        const roomOpenimIds = new Map<string, string>();
        for (const room of input.rooms) {
          const mapped = await mapping(client, request.user.sub, "room", room.roomId);
          roomIds.set(room.roomId, mapped.id);
          const openimGroupId =
            room.type === "direct" ? null : `grp_${mapped.id.replaceAll("-", "")}`;
          if (openimGroupId) roomOpenimIds.set(room.roomId, openimGroupId);
          if (!mapped.fresh) continue;
          await client.query(
            `INSERT INTO rooms(id, owner_id, openim_group_id, type, name, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$6)`,
            [
              mapped.id,
              request.user.sub,
              openimGroupId,
              room.type,
              room.name.slice(0, 80),
              new Date(room.createdAt),
            ],
          );
          await client.query(
            "INSERT INTO room_members(room_id, user_id, role) VALUES ($1, $2, 'owner')",
            [mapped.id, request.user.sub],
          );
          const importedAgentOpenimIds: string[] = [];
          for (const legacyAgentId of room.agentIds) {
            const agentId = agentIds.get(legacyAgentId);
            if (!agentId) continue;
            await client.query(
              "INSERT INTO room_agents(room_id, agent_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
              [mapped.id, agentId, request.user.sub],
            );
            const openimId = agentOpenimIds.get(legacyAgentId);
            if (openimId) importedAgentOpenimIds.push(openimId);
          }
          if (openimGroupId) {
            await enqueueOutbox(client, "openim.group.create", "room", mapped.id, {
              groupID: openimGroupId,
              name: room.name,
              ownerUserID: currentUser.rows[0].openim_user_id,
              memberUserIDs: [currentUser.rows[0].openim_user_id, ...importedAgentOpenimIds],
            });
          }
          if (room.humanIds.some((id) => id !== "local_user")) {
            warnings.push(`房间“${room.name}”中的旧好友没有全局账号，未自动建立远程成员关系。`);
          }
          counts.rooms += 1;
        }

        for (const room of input.rooms) {
          const roomId = roomIds.get(room.roomId);
          if (!roomId) continue;
          if (room.sourceRoomId && roomIds.get(room.sourceRoomId)) {
            await client.query("UPDATE rooms SET source_room_id = $1 WHERE id = $2", [
              roomIds.get(room.sourceRoomId),
              roomId,
            ]);
          }
          for (const message of room.messages) {
            const syntheticId = `legacy:${request.user.sub}:${message.externalId ?? message.id}`;
            const senderAgentId = agentIds.get(message.senderId) ?? null;
            const senderOpenimId = senderAgentId
              ? agentOpenimIds.get(message.senderId)!
              : message.senderId === "local_user"
                ? currentUser.rows[0].openim_user_id
                : `legacy_human:${message.senderId}`;
            const result = await client.query(
              `INSERT INTO message_mirrors(
               server_msg_id, client_msg_id, room_id, openim_conversation_id, sender_openim_id,
               sender_user_id, sender_agent_id, content, seq, target_agent_ids, raw, sent_at
             ) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
             ON CONFLICT DO NOTHING RETURNING server_msg_id`,
              [
                syntheticId,
                roomId,
                roomOpenimIds.get(room.roomId) ?? roomId,
                senderOpenimId,
                message.senderId === "local_user" ? request.user.sub : null,
                senderAgentId,
                message.content,
                message.seq,
                JSON.stringify(
                  message.targetAgentIds.map((id) => agentIds.get(id)).filter(Boolean),
                ),
                JSON.stringify({ legacy: true, legacyId: message.id }),
                new Date(message.createdAt),
              ],
            );
            if (result.rowCount) counts.messages += 1;
          }
        }

        for (const task of input.tasks) {
          const sourceRoomId = roomIds.get(task.sourceRoomId);
          const taskRoomId = roomIds.get(task.taskRoomId);
          if (!sourceRoomId || !taskRoomId) {
            warnings.push(`Task“${task.title}”缺少对应房间，已跳过。`);
            continue;
          }
          const mapped = await mapping(client, request.user.sub, "task", task.id);
          if (!mapped.fresh) continue;
          const anchorId = `legacy:${request.user.sub}:${task.anchorMessageId}`;
          await client.query(
            `INSERT INTO tasks(
             id, creator_id, source_room_id, task_room_id, anchor_message_id, title, status,
             context_version, latest_source_seq, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              mapped.id,
              request.user.sub,
              sourceRoomId,
              taskRoomId,
              anchorId,
              task.title.slice(0, 100),
              task.status === "running" || task.status === "queued" ? "waiting" : task.status,
              task.contextVersion,
              task.latestSourceSeq,
              new Date(task.createdAt),
              new Date(task.updatedAt),
            ],
          );
          for (const legacyAgentId of task.assigneeIds) {
            const agentId = agentIds.get(legacyAgentId);
            if (agentId)
              await client.query(
                "INSERT INTO task_assignees(task_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                [mapped.id, agentId],
              );
          }
          for (const context of task.contextEvents) {
            await client.query(
              `INSERT INTO task_context_events(task_id, message_id, context_version, source_seq, created_at)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
              [
                mapped.id,
                `legacy:${request.user.sub}:${context.messageId}`,
                Math.max(1, Math.min(task.contextVersion, context.sourceSeq || 1)),
                context.sourceSeq,
                new Date(context.createdAt ?? task.createdAt),
              ],
            );
          }
          counts.tasks += 1;
        }

        const encryptedWorkspace = await cipher.encrypt({ path: input.workspace });
        await client.query(
          `INSERT INTO encrypted_configs(owner_id, scope_type, scope_id, name, value)
         VALUES ($1, 'workspace', NULL, $2, $3::jsonb)
         ON CONFLICT (owner_id, scope_type, name) WHERE scope_id IS NULL
         DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [
            request.user.sub,
            `legacy.${requestHash.slice(0, 16)}`,
            JSON.stringify(encryptedWorkspace),
          ],
        );
        const response = { imported: counts, warnings: [...new Set(warnings)] };
        await client.query(
          `INSERT INTO idempotency_keys(user_id, key, request_hash, response, expires_at)
         VALUES ($1,$2,$3,$4::jsonb,now() + interval '7 days')`,
          [request.user.sub, key, requestHash, JSON.stringify(response)],
        );
        await client.query("COMMIT");
        return reply.status(201).send(response);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );
};
