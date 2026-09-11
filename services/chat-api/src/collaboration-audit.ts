import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";

import { ApiError, parseParams, parseQuery } from "./http.js";

type AuditAudience = "room" | "host_owner" | "system";

type AuditInput = {
  actorUserId?: string;
  actorAgentId?: string;
  roomId: string;
  taskId?: string;
  taskRevision?: number;
  runId?: string;
  hostDeviceId?: string;
  eventType: string;
  audience?: AuditAudience;
  summary: string;
  outcome: string;
  metadata?: Record<string, unknown>;
};

const SENSITIVE_KEY = /(path|token|secret|password|credential|private|encrypted|command|args)/i;

export const redactAuditText = (value: string, maxLength = 1_000) =>
  value
    .replace(/(?:^|\s)(?:\/[\w.@+-]+){2,}/g, " [redacted-path]")
    .replace(/[A-Za-z]:\\(?:[^\s\\]+\\)+[^\s]*/g, "[redacted-path]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(token|secret|password|credential)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .trim()
    .slice(0, maxLength);

export const redactAuditMetadata = (value: Record<string, unknown>) => {
  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (typeof item === "string") redacted[key] = redactAuditText(item);
    else if (typeof item === "number" || typeof item === "boolean" || item === null) {
      redacted[key] = item;
    } else if (Array.isArray(item)) {
      redacted[key] = item
        .filter((entry) => ["string", "number", "boolean"].includes(typeof entry))
        .map((entry) => (typeof entry === "string" ? redactAuditText(entry) : entry))
        .slice(0, 64);
    }
  }
  return redacted;
};

export const appendCollaborationAudit = async (
  client: pg.Pool | pg.PoolClient,
  input: AuditInput,
) => {
  await client.query(
    `INSERT INTO collaboration_audit_events(
       actor_user_id, actor_agent_id, room_id, task_id, task_revision, run_id,
       host_device_id, event_type, audience, redacted_summary, outcome, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [
      input.actorUserId ?? null,
      input.actorAgentId ?? null,
      input.roomId,
      input.taskId ?? null,
      input.taskRevision ?? null,
      input.runId ?? null,
      input.hostDeviceId ?? null,
      input.eventType,
      input.audience ?? "room",
      redactAuditText(input.summary),
      input.outcome.slice(0, 80),
      JSON.stringify(redactAuditMetadata(input.metadata ?? {})),
    ],
  );
};

const roomParams = z.object({ roomId: z.string().uuid() });
const auditQuery = z.object({
  taskId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const registerCollaborationAuditRoutes = (app: FastifyInstance, pool: pg.Pool) => {
  app.get("/v1/rooms/:roomId/audit", { preHandler: [app.authenticate] }, async (request) => {
    const { roomId } = parseParams(roomParams, request);
    const { taskId, limit } = parseQuery(auditQuery, request);
    const membership = await pool.query(
      "SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2",
      [roomId, request.user.sub],
    );
    if (!membership.rowCount) {
      throw new ApiError(403, "ROOM_MEMBERSHIP_REQUIRED", "当前用户不是群成员。");
    }
    const parameters: unknown[] = [roomId, request.user.sub];
    const taskFilter = taskId ? `AND cae.task_id = $${parameters.push(taskId)}` : "";
    const result = await pool.query(
      `SELECT cae.id, cae.actor_user_id AS "actorUserId",
                cae.actor_agent_id AS "actorAgentId", cae.room_id AS "roomId",
                cae.task_id AS "taskId", cae.task_revision AS "taskRevision",
                cae.run_id AS "runId", cae.event_type AS "eventType",
                cae.audience, cae.redacted_summary AS summary, cae.outcome,
                cae.metadata, cae.created_at AS "createdAt"
         FROM collaboration_audit_events cae
         LEFT JOIN devices host_device ON host_device.id = cae.host_device_id
           AND host_device.user_id = $2
         WHERE cae.room_id = $1 ${taskFilter}
           AND (
             cae.audience = 'room'
             OR (cae.audience = 'host_owner' AND host_device.id IS NOT NULL)
           )
         ORDER BY cae.created_at DESC LIMIT ${limit}`,
      parameters,
    );
    return { data: result.rows };
  });
};
