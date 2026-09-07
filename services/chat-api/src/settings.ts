import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";

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
const workspaceBody = z.object({
  deviceId: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  path: z.string().trim().min(1).max(4_096),
  repositoryUrl: z.string().url().nullable().default(null),
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
    const device = await pool.query("SELECT 1 FROM devices WHERE id = $1 AND user_id = $2", [
      input.deviceId,
      request.user.sub,
    ]);
    if (!device.rowCount) throw new ApiError(404, "DEVICE_NOT_FOUND", "设备不存在。");
    const encryptedPath = await cipher.encrypt({ path: input.path });
    const result = await pool.query(
      `INSERT INTO workspace_bindings(user_id, device_id, label, path_config, repository_url)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id, label, repository_url AS "repositoryUrl", created_at AS "createdAt"`,
      [
        request.user.sub,
        input.deviceId,
        input.label,
        JSON.stringify(encryptedPath),
        input.repositoryUrl,
      ],
    );
    return reply.status(201).send(result.rows[0]);
  });

  app.get("/v1/workspace-bindings", { preHandler: [app.authenticate] }, async (request) => {
    const result = await pool.query<{
      id: string;
      device_id: string;
      label: string;
      repository_url: string | null;
      path_config: EncryptedEnvelope;
      updated_at: Date;
    }>(
      `SELECT id, device_id, label, repository_url, path_config, updated_at
       FROM workspace_bindings WHERE user_id = $1 ORDER BY updated_at DESC`,
      [request.user.sub],
    );
    return {
      data: await Promise.all(
        result.rows.map(async (row) => ({
          id: row.id,
          deviceId: row.device_id,
          label: row.label,
          repositoryUrl: row.repository_url,
          path: (await cipher.decrypt<{ path: string }>(row.path_config)).path,
          updatedAt: row.updated_at,
        })),
      ),
    };
  });
};
