import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";

import { appendCollaborationAudit } from "./collaboration-audit.js";
import type { EventPublisher } from "./events.js";
import { ApiError, parseBody, parseParams, requireRevision } from "./http.js";
import type { EnvelopeCipher } from "./security.js";
import type { EncryptedEnvelope } from "./schema.js";

const settingsSchema = z
  .record(z.string().max(80), z.unknown())
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 64_000,
    "设置内容不能超过 64KB。",
  );
const configParams = z.object({
  scopeType: z.enum(["user", "agent", "device", "workspace"]),
  name: z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/),
});
const configBody = z.object({
  scopeId: z.string().uuid().nullable().default(null),
  value: z.unknown(),
});
const permissionScope = z.enum([
  "workspace.read",
  "workspace.write",
  "command.run",
  "network.read",
]);
const workspaceBody = z.object({
  deviceId: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  repositoryUrl: z.string().url().nullable().default(null),
  baselineScopes: z.array(permissionScope).max(4).default(["workspace.read"]),
});
const bindingParams = z.object({ id: z.string().uuid() });
const roomParams = z.object({ roomId: z.string().uuid() });
const shareBindingBody = z.object({ roomId: z.string().uuid() });
const activateBindingBody = z.object({ bindingId: z.string().uuid() });

type WorkspaceBindingRow = {
  id: string;
  user_id: string;
  device_id: string;
  label: string;
  repository_url: string | null;
  revision: number;
  baseline_scopes: string[];
  status: "online" | "offline" | "unknown" | "revoked";
  last_seen_at: Date | null;
  updated_at: Date;
};

const workspaceBindingDto = (row: WorkspaceBindingRow) => ({
  id: row.id,
  hostUserId: row.user_id,
  hostDeviceId: row.device_id,
  label: row.label,
  repositoryUrl: row.repository_url,
  revision: row.revision,
  baselineScopes: row.baseline_scopes,
  status: row.status,
  lastSeenAt: row.last_seen_at,
  updatedAt: row.updated_at,
});

export const registerSettingsRoutes = (
  app: FastifyInstance,
  pool: pg.Pool,
  cipher: EnvelopeCipher,
  events: EventPublisher,
) => {
  app.get("/v1/settings", { preHandler: [app.authenticate] }, async (request) => {
    const result = await pool.query<{
      revision: number;
      values: Record<string, unknown>;
      updated_at: Date;
    }>("SELECT revision, values, updated_at FROM user_settings WHERE user_id = $1", [
      request.user.sub,
    ]);
    return {
      revision: result.rows[0]?.revision ?? 1,
      values: result.rows[0]?.values ?? {},
      updatedAt: result.rows[0]?.updated_at ?? new Date(),
    };
  });

  app.put("/v1/settings", { preHandler: [app.authenticate] }, async (request) => {
    const values = parseBody(settingsSchema, request);
    const revision = requireRevision(request);
    const result = await pool.query<{
      revision: number;
      values: Record<string, unknown>;
      updated_at: Date;
    }>(
      `UPDATE user_settings SET values = $1::jsonb, revision = revision + 1, updated_at = now()
       WHERE user_id = $2 AND revision = $3
       RETURNING revision, values, updated_at`,
      [JSON.stringify(values), request.user.sub, revision],
    );
    if (!result.rows[0])
      throw new ApiError(409, "REVISION_CONFLICT", "设置已在其他设备更新，请刷新后重试。");
    events.publishToUser(request.user.sub, {
      type: "settings.updated",
      revision: result.rows[0].revision,
    });
    return {
      revision: result.rows[0].revision,
      values: result.rows[0].values,
      updatedAt: result.rows[0].updated_at,
    };
  });

  app.put("/v1/configs/:scopeType/:name", { preHandler: [app.authenticate] }, async (request) => {
    const params = parseParams(configParams, request);
    const input = parseBody(configBody, request);
    if (params.scopeType !== "user" && !input.scopeId) {
      throw new ApiError(400, "SCOPE_ID_REQUIRED", "该配置范围需要 scopeId。");
    }
    const encrypted = await cipher.encrypt(input.value);
    const result = await pool
      .query<{ id: string; updated_at: Date }>(
        `INSERT INTO encrypted_configs(owner_id, scope_type, scope_id, name, value)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (owner_id, scope_type, scope_id, name) WHERE scope_id IS NOT NULL
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING id, updated_at`,
        [request.user.sub, params.scopeType, input.scopeId, params.name, JSON.stringify(encrypted)],
      )
      .catch(async (error) => {
        if (input.scopeId !== null) throw error;
        return pool.query<{ id: string; updated_at: Date }>(
          `INSERT INTO encrypted_configs(owner_id, scope_type, scope_id, name, value)
         VALUES ($1, $2, NULL, $3, $4::jsonb)
         ON CONFLICT (owner_id, scope_type, name) WHERE scope_id IS NULL
         DO UPDATE SET value = EXCLUDED.value, updated_at = now()
         RETURNING id, updated_at`,
          [request.user.sub, params.scopeType, params.name, JSON.stringify(encrypted)],
        );
      });
    return { id: result.rows[0].id, updatedAt: result.rows[0].updated_at };
  });

  app.get("/v1/configs/:scopeType/:name", { preHandler: [app.authenticate] }, async (request) => {
    const params = parseParams(configParams, request);
    const scopeId =
      typeof (request.query as { scopeId?: unknown })?.scopeId === "string"
        ? String((request.query as { scopeId: string }).scopeId)
        : null;
    const result = await pool.query<{ id: string; value: EncryptedEnvelope; updated_at: Date }>(
      `SELECT id, value, updated_at FROM encrypted_configs
       WHERE owner_id = $1 AND scope_type = $2 AND name = $3 AND scope_id IS NOT DISTINCT FROM $4::uuid`,
      [request.user.sub, params.scopeType, params.name, scopeId],
    );
    if (!result.rows[0]) throw new ApiError(404, "CONFIG_NOT_FOUND", "配置不存在。");
    return {
      id: result.rows[0].id,
      value: await cipher.decrypt(result.rows[0].value),
      updatedAt: result.rows[0].updated_at,
    };
  });

  app.post("/v1/workspace-bindings", { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = parseBody(workspaceBody, request);
    const baselineScopes = [...new Set(input.baselineScopes)];
    if (!baselineScopes.includes("workspace.read")) baselineScopes.unshift("workspace.read");
    const device = await pool.query<{ last_seen_at: Date }>(
      `SELECT last_seen_at FROM devices
       WHERE id = $1 AND user_id = $2 AND is_agent_host = true`,
      [input.deviceId, request.user.sub],
    );
    if (!device.rowCount) throw new ApiError(404, "DEVICE_NOT_FOUND", "设备不存在。");
    const online = Date.now() - device.rows[0].last_seen_at.getTime() < 90_000;
    const result = await pool.query<WorkspaceBindingRow>(
      `INSERT INTO workspace_bindings(
         user_id, device_id, label, path_config, repository_url, baseline_scopes, status,
         last_seen_at
       ) VALUES ($1, $2, $3, NULL, $4, $5::jsonb, $6, $7)
       ON CONFLICT (device_id, label) DO UPDATE SET
         repository_url = EXCLUDED.repository_url,
         baseline_scopes = EXCLUDED.baseline_scopes,
         status = EXCLUDED.status,
         last_seen_at = EXCLUDED.last_seen_at,
         revision = workspace_bindings.revision + 1,
         revoked_at = NULL,
         updated_at = now()
       RETURNING *`,
      [
        request.user.sub,
        input.deviceId,
        input.label,
        input.repositoryUrl,
        JSON.stringify(baselineScopes),
        online ? "online" : "offline",
        device.rows[0].last_seen_at,
      ],
    );
    return reply.status(201).send(workspaceBindingDto(result.rows[0]));
  });

  app.get("/v1/workspace-bindings", { preHandler: [app.authenticate] }, async (request) => {
    const result = await pool.query<WorkspaceBindingRow>(
      `SELECT id, user_id, device_id, label, repository_url, revision, baseline_scopes,
              status, last_seen_at, updated_at
       FROM workspace_bindings WHERE user_id = $1 ORDER BY updated_at DESC`,
      [request.user.sub],
    );
    return { data: result.rows.map(workspaceBindingDto) };
  });

  app.post(
    "/v1/workspace-bindings/:id/share",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = parseParams(bindingParams, request);
      const { roomId } = parseBody(shareBindingBody, request);
      const binding = await pool.query<WorkspaceBindingRow>(
        `SELECT * FROM workspace_bindings
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [id, request.user.sub],
      );
      if (!binding.rows[0]) {
        throw new ApiError(404, "WORKSPACE_BINDING_NOT_FOUND", "项目主机绑定不存在。");
      }
      const membership = await pool.query<{ role: string }>(
        `SELECT rm.role FROM room_members rm JOIN rooms r ON r.id = rm.room_id
         WHERE rm.room_id = $1 AND rm.user_id = $2 AND r.type = 'group'
           AND r.archived_at IS NULL`,
        [roomId, request.user.sub],
      );
      if (!membership.rows[0]) {
        throw new ApiError(403, "ROOM_MEMBERSHIP_REQUIRED", "只有群成员可以分享项目主机。");
      }
      await pool.query(
        `INSERT INTO room_workspace_bindings(
           room_id, workspace_binding_id, binding_revision, shared_by_user_id
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (room_id, workspace_binding_id) DO UPDATE SET
           binding_revision = EXCLUDED.binding_revision,
           shared_by_user_id = EXCLUDED.shared_by_user_id,
           status = CASE
             WHEN room_workspace_bindings.status = 'active' THEN 'active'
             ELSE 'shared'
           END,
           revision = room_workspace_bindings.revision + 1,
           ended_at = NULL`,
        [roomId, id, binding.rows[0].revision, request.user.sub],
      );
      await appendCollaborationAudit(pool, {
        actorUserId: request.user.sub,
        roomId,
        hostDeviceId: binding.rows[0].device_id,
        eventType: "workspace_binding.shared",
        summary: `项目主机“${binding.rows[0].label}”已分享到群组。`,
        outcome: "shared",
        metadata: { bindingId: id, bindingRevision: binding.rows[0].revision },
      });
      await events.publishToRoom(roomId, {
        type: "workspace-binding.shared",
        binding: workspaceBindingDto(binding.rows[0]),
      });
      return reply.status(201).send(workspaceBindingDto(binding.rows[0]));
    },
  );

  app.get(
    "/v1/rooms/:roomId/workspace-bindings",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { roomId } = parseParams(roomParams, request);
      const membership = await pool.query(
        "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
        [roomId, request.user.sub],
      );
      if (!membership.rowCount) {
        throw new ApiError(403, "ROOM_MEMBERSHIP_REQUIRED", "当前用户不是群成员。");
      }
      const result = await pool.query<WorkspaceBindingRow & { share_status: string }>(
        `SELECT wb.id, wb.user_id, wb.device_id, wb.label, wb.repository_url,
                wb.revision, wb.baseline_scopes, wb.status, wb.last_seen_at, wb.updated_at,
                rwb.status AS share_status
         FROM room_workspace_bindings rwb
         JOIN workspace_bindings wb ON wb.id = rwb.workspace_binding_id
         WHERE rwb.room_id = $1 AND rwb.status IN ('shared', 'active')
           AND wb.revoked_at IS NULL
         ORDER BY (rwb.status = 'active') DESC, rwb.created_at DESC`,
        [roomId],
      );
      return {
        data: result.rows.map((row) => ({
          ...workspaceBindingDto(row),
          active: row.share_status === "active",
        })),
      };
    },
  );

  app.put(
    "/v1/rooms/:roomId/workspace-binding",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { roomId } = parseParams(roomParams, request);
      const { bindingId } = parseBody(activateBindingBody, request);
      const revision = requireRevision(request);
      const client = await pool.connect();
      let binding: WorkspaceBindingRow;
      let nextRoomRevision = revision;
      let reconfirmedTaskIds: string[] = [];
      try {
        await client.query("BEGIN");
        const room = await client.query<{ revision: number; role: string }>(
          `SELECT r.revision, rm.role FROM rooms r
           JOIN room_members rm ON rm.room_id = r.id
           WHERE r.id = $1 AND rm.user_id = $2 AND r.type = 'group'
             AND r.archived_at IS NULL FOR UPDATE`,
          [roomId, request.user.sub],
        );
        if (!room.rows[0]) {
          throw new ApiError(404, "ROOM_NOT_FOUND", "群组不存在或当前用户不是成员。");
        }
        if (!["owner", "admin"].includes(room.rows[0].role)) {
          throw new ApiError(403, "ROOM_ADMIN_REQUIRED", "只有群主或管理员可以选择项目主机。");
        }
        if (room.rows[0].revision !== revision) {
          throw new ApiError(409, "REVISION_CONFLICT", "群组已被修改，请刷新后重试。");
        }
        const shared = await client.query<WorkspaceBindingRow>(
          `SELECT wb.* FROM room_workspace_bindings rwb
           JOIN workspace_bindings wb ON wb.id = rwb.workspace_binding_id
           WHERE rwb.room_id = $1 AND rwb.workspace_binding_id = $2
             AND rwb.status IN ('shared', 'active') AND wb.revoked_at IS NULL
           FOR UPDATE`,
          [roomId, bindingId],
        );
        if (!shared.rows[0]) {
          throw new ApiError(
            409,
            "WORKSPACE_BINDING_NOT_SHARED",
            "该项目主机尚未由所有者分享到群里。",
          );
        }
        binding = shared.rows[0];
        const active = await client.query<{ workspace_binding_id: string }>(
          `SELECT workspace_binding_id FROM room_workspace_bindings
           WHERE room_id = $1 AND status = 'active' FOR UPDATE`,
          [roomId],
        );
        if (active.rows[0]?.workspace_binding_id === bindingId) {
          await client.query("COMMIT");
          return {
            roomId,
            roomRevision: room.rows[0].revision,
            binding: workspaceBindingDto(binding),
            tasksRequiringReconfirmation: [],
          };
        }
        await client.query(
          `UPDATE room_workspace_bindings SET status = 'replaced', ended_at = now(),
                  revision = revision + 1
           WHERE room_id = $1 AND status = 'active'`,
          [roomId],
        );
        await client.query(
          `UPDATE room_workspace_bindings SET status = 'active', activated_by_user_id = $1,
                  activated_at = now(), ended_at = NULL, binding_revision = $2,
                  revision = revision + 1
           WHERE room_id = $3 AND workspace_binding_id = $4`,
          [request.user.sub, binding.revision, roomId, bindingId],
        );
        const affectedTasks = await client.query<{ id: string }>(
          `UPDATE tasks SET workspace_binding_id = $1, binding_revision = $2,
                  revision = revision + 1, status = 'pending_review',
                  approved_review_id = NULL, started_by_user_id = NULL, started_at = NULL,
                  wait_reason = '群组项目主机已变更，请重新审核任务范围并由新主机授权。',
                  updated_at = now()
           WHERE source_room_id = $3
             AND status NOT IN ('done', 'failed', 'cancelled')
           RETURNING id`,
          [bindingId, binding.revision, roomId],
        );
        reconfirmedTaskIds = affectedTasks.rows.map((row) => row.id);
        if (reconfirmedTaskIds.length) {
          await client.query(
            `UPDATE task_permission_grants SET revoked_at = now()
             WHERE task_id = ANY($1::uuid[]) AND revoked_at IS NULL`,
            [reconfirmedTaskIds],
          );
          await client.query(
            `UPDATE task_runs SET status = 'cancelled', completed_at = now(),
                    error = '群组项目主机已变更。', updated_at = now()
             WHERE task_id = ANY($1::uuid[])
               AND status IN ('queued', 'leased', 'running', 'waiting')`,
            [reconfirmedTaskIds],
          );
        }
        const updatedRoom = await client.query<{ revision: number }>(
          `UPDATE rooms SET revision = revision + 1, updated_at = now()
           WHERE id = $1 RETURNING revision`,
          [roomId],
        );
        nextRoomRevision = updatedRoom.rows[0].revision;
        await appendCollaborationAudit(client, {
          actorUserId: request.user.sub,
          roomId,
          hostDeviceId: binding.device_id,
          eventType: active.rows[0] ? "workspace_binding.replaced" : "workspace_binding.activated",
          summary: `群组项目主机已切换为“${binding.label}”，未完成 Task 需要重新确认。`,
          outcome: "activated",
          metadata: {
            bindingId,
            bindingRevision: binding.revision,
            roomRevision: nextRoomRevision,
            affectedTaskIds: reconfirmedTaskIds,
          },
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      await events.publishToRoom(roomId, {
        type: "workspace-binding.activated",
        binding: workspaceBindingDto(binding!),
        roomRevision: nextRoomRevision,
        tasksRequiringReconfirmation: reconfirmedTaskIds,
      });
      return {
        roomId,
        roomRevision: nextRoomRevision,
        binding: workspaceBindingDto(binding!),
        tasksRequiringReconfirmation: reconfirmedTaskIds,
      };
    },
  );
};
