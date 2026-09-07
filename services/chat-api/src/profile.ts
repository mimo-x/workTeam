import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";

import type { EventPublisher } from "./events.js";
import { ApiError, parseBody, parseParams, requireRevision } from "./http.js";

const updateProfileSchema = z
  .object({
    handle: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_][a-z0-9_-]{2,31}$/)
      .optional(),
    displayName: z.string().trim().min(1).max(64).optional(),
    avatarUrl: z.string().url().max(2_048).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
const idParams = z.object({ id: z.string().uuid() });

export const registerProfileRoutes = (
  app: FastifyInstance,
  pool: pg.Pool,
  events: EventPublisher,
) => {
  app.patch("/v1/me", { preHandler: [app.authenticate] }, async (request) => {
    const input = parseBody(updateProfileSchema, request);
    const revision = requireRevision(request);
    const current = await pool.query<{
      handle: string;
      display_name: string;
      avatar_url: string | null;
    }>("SELECT handle, display_name, avatar_url FROM users WHERE id = $1", [request.user.sub]);
    if (!current.rows[0]) throw new ApiError(404, "USER_NOT_FOUND", "用户不存在。");
    const result = await pool.query(
      `UPDATE users SET handle = $1, display_name = $2, avatar_url = $3,
              revision = revision + 1, updated_at = now()
       WHERE id = $4 AND revision = $5
       RETURNING id, email, handle, display_name AS "displayName", avatar_url AS "avatarUrl",
                 openim_user_id AS "openimUserId", revision, updated_at AS "updatedAt"`,
      [
        input.handle ?? current.rows[0].handle,
        input.displayName ?? current.rows[0].display_name,
        input.avatarUrl === undefined ? current.rows[0].avatar_url : input.avatarUrl,
        request.user.sub,
        revision,
      ],
    );
    if (!result.rows[0]) throw new ApiError(409, "REVISION_CONFLICT", "用户资料已在其他设备修改。");
    events.publishToUser(request.user.sub, {
      type: "profile.updated",
      revision: result.rows[0].revision,
    });
    return { user: result.rows[0] };
  });

  app.get("/v1/devices", { preHandler: [app.authenticate] }, async (request) => {
    const result = await pool.query(
      `SELECT id, name, platform, is_agent_host AS "isAgentHost", last_seen_at AS "lastSeenAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC`,
      [request.user.sub],
    );
    return { data: result.rows };
  });

  app.delete("/v1/devices/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = parseParams(idParams, request);
    const result = await pool.query("DELETE FROM devices WHERE id = $1 AND user_id = $2", [
      id,
      request.user.sub,
    ]);
    if (!result.rowCount) throw new ApiError(404, "DEVICE_NOT_FOUND", "设备不存在。");
    return reply.status(204).send();
  });
};
