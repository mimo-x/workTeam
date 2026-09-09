import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";

import type { EventPublisher } from "./events.js";
import { ApiError, parseBody, parseParams, parseQuery, requireRevision } from "./http.js";
import { enqueueOutbox } from "./outbox.js";
import type { EnvelopeCipher } from "./security.js";
import type { EncryptedEnvelope } from "./schema.js";

const skillRefSchema = z.object({
  name: z.string().trim().min(1).max(80),
  path: z.string().max(1_024).optional(),
});
const capabilitySchema = z.string().trim().min(1).max(80);
const runtimeEndpointSchema = z
  .string()
  .trim()
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  }, "远程 Runtime endpoint 必须使用 HTTPS。");
const agentBody = z.object({
  name: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(64).default("Agent"),
  mention: z
    .string()
    .trim()
    .regex(/^@[\p{L}\p{N}_-]{2,40}$/u),
  description: z.string().trim().max(500).default(""),
  instructions: z.string().trim().min(1).max(20_000),
  secrets: z.record(z.string(), z.string().max(20_000)).default({}),
  visibility: z.enum(["private", "public"]).default("private"),
  workspaceAccess: z.enum(["read", "write"]).default("read"),
  executionTarget: z.enum(["local", "hosted"]).default("local"),
  provider: z.string().trim().min(1).max(64).default("codex"),
  protocol: z.string().trim().min(1).max(64).default("app-server"),
  runtimeModel: z.string().trim().max(256).optional(),
  runtimeEndpoint: runtimeEndpointSchema.optional(),
  runtimeCommand: z.string().trim().max(1_024).optional(),
  runtimeArgs: z.array(z.string().max(256)).max(32).default([]),
  runtimeAuth: z.enum(["bearer", "none"]).default("none"),
  capabilities: z
    .array(capabilitySchema)
    .max(64)
    .default(["chat", "stream_progress", "read_workspace"]),
  skillPolicy: z.enum(["none", "allowlist", "all"]).default("none"),
  skillRefs: z.array(skillRefSchema).max(64).default([]),
});
const updateAgentBody = agentBody.partial().refine((value) => Object.keys(value).length > 0);
const listSchema = z.object({
  scope: z.enum(["owned", "public", "available"]).default("available"),
  q: z.string().trim().max(80).default(""),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const idParams = z.object({ id: z.string().uuid() });

type AgentRow = {
  id: string;
  owner_id: string;
  owner_name?: string;
  openim_user_id: string;
  name: string;
  title: string;
  mention: string;
  description: string;
  visibility: "private" | "public";
  workspace_access: "read" | "write";
  execution_target: "local" | "hosted";
  provider: string;
  protocol: string;
  runtime_model: string | null;
  runtime_endpoint: string | null;
  runtime_command: string | null;
  runtime_args: string[];
  runtime_auth: "bearer" | "none";
  capabilities: string[];
  runtime_status: "online" | "offline" | "unknown";
  runtime_last_seen_at: Date | null;
  skill_policy: "none" | "allowlist" | "all";
  skill_refs: Array<{ name: string; path?: string }>;
  private_config: EncryptedEnvelope;
  version: number;
  created_at: Date;
  updated_at: Date;
};

const baseDto = (row: AgentRow) => ({
  id: row.id,
  ownerId: row.owner_id,
  ownerName: row.owner_name,
  openimUserId: row.openim_user_id,
  name: row.name,
  title: row.title,
  mention: row.mention,
  description: row.description,
  visibility: row.visibility,
  executionTarget: row.execution_target,
  provider: row.provider,
  protocol: row.protocol,
  runtimeModel: row.runtime_model,
  runtimeEndpoint: row.runtime_endpoint,
  runtimeAuth: row.runtime_auth,
  capabilities: row.capabilities,
  runtimeStatus: row.runtime_status,
  runtimeLastSeenAt: row.runtime_last_seen_at,
  runtime: {
    provider: row.provider,
    protocol: row.protocol,
    target: row.execution_target,
    endpoint: row.runtime_endpoint,
    auth: row.runtime_auth,
    status: row.runtime_status,
    lastSeenAt: row.runtime_last_seen_at,
  },
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const ownerDto = async (row: AgentRow, cipher: EnvelopeCipher) => ({
  ...baseDto(row),
  runtimeCommand: row.runtime_command,
  runtimeArgs: row.runtime_args,
  workspaceAccess: row.workspace_access,
  skillPolicy: row.skill_policy,
  skillRefs: row.skill_refs,
  ...(await cipher.decrypt<{ instructions: string; secrets: Record<string, string> }>(
    row.private_config,
  )),
});

export const registerAgentRoutes = (
  app: FastifyInstance,
  pool: pg.Pool,
  cipher: EnvelopeCipher,
  events: EventPublisher,
) => {
  app.get("/v1/agents", { preHandler: [app.authenticate] }, async (request) => {
    const { scope, q, cursor, limit } = parseQuery(listSchema, request);
    const visibility =
      scope === "owned"
        ? "a.owner_id = $1"
        : scope === "public"
          ? "a.visibility = 'public'"
          : "(a.owner_id = $1 OR a.visibility = 'public')";
    const result = await pool.query<AgentRow>(
      `SELECT a.*, u.display_name AS owner_name
       FROM agents a JOIN users u ON u.id = a.owner_id
       WHERE ${visibility} AND a.archived_at IS NULL AND ($2::uuid IS NULL OR a.id > $2)
         AND ($4 = '' OR a.name ILIKE '%' || $4 || '%' OR a.description ILIKE '%' || $4 || '%')
       ORDER BY a.id LIMIT $3`,
      [request.user.sub, cursor ?? null, limit, q],
    );
    const data = await Promise.all(
      result.rows.map((row) =>
        row.owner_id === request.user.sub ? ownerDto(row, cipher) : Promise.resolve(baseDto(row)),
      ),
    );
    return { data, nextCursor: result.rows.length === limit ? result.rows.at(-1)?.id : null };
  });

  app.get("/v1/agents/:id", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = parseParams(idParams, request);
    const result = await pool.query<AgentRow>(
      `SELECT a.*, u.display_name AS owner_name
       FROM agents a JOIN users u ON u.id = a.owner_id
       WHERE a.id = $1 AND a.archived_at IS NULL`,
      [id],
    );
    const agent = result.rows[0];
    if (!agent || (agent.owner_id !== request.user.sub && agent.visibility !== "public")) {
      throw new ApiError(404, "AGENT_NOT_FOUND", "Agent 不存在。");
    }
    return agent.owner_id === request.user.sub ? ownerDto(agent, cipher) : baseDto(agent);
  });

  app.post("/v1/agents", { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = parseBody(agentBody, request);
    const id = randomUUID();
    const openimUserId = `agt_${id.replaceAll("-", "")}`;
    const privateConfig = await cipher.encrypt({
      instructions: input.instructions,
      secrets: input.secrets,
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<AgentRow>(
        `INSERT INTO agents(
           id, owner_id, openim_user_id, name, title, mention, description, visibility,
           workspace_access, execution_target, provider, protocol, runtime_model, runtime_endpoint,
           runtime_command, runtime_args, runtime_auth, capabilities,
           skill_policy, skill_refs, private_config
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19,$20::jsonb,$21::jsonb)
         RETURNING *`,
        [
          id,
          request.user.sub,
          openimUserId,
          input.name,
          input.title,
          input.mention,
          input.description,
          input.visibility,
          input.workspaceAccess,
          input.executionTarget,
          input.provider,
          input.protocol,
          input.runtimeModel ?? null,
          input.runtimeEndpoint ?? null,
          input.runtimeCommand ?? null,
          JSON.stringify(input.runtimeArgs),
          input.runtimeAuth,
          JSON.stringify(input.capabilities),
          input.skillPolicy,
          JSON.stringify(input.skillRefs),
          JSON.stringify(privateConfig),
        ],
      );
      await enqueueOutbox(client, "openim.user.register", "agent", id, {
        userID: openimUserId,
        nickname: input.name,
        faceURL: "",
      });
      await client.query("COMMIT");
      return reply.status(201).send(await ownerDto(result.rows[0], cipher));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch("/v1/agents/:id", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = parseParams(idParams, request);
    const input = parseBody(updateAgentBody, request);
    const revision = requireRevision(request);
    const found = await pool.query<AgentRow>(
      "SELECT * FROM agents WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL",
      [id, request.user.sub],
    );
    const current = found.rows[0];
    if (!current) throw new ApiError(404, "AGENT_NOT_FOUND", "Agent 不存在或不属于当前用户。");
    const previousPrivate = await cipher.decrypt<{
      instructions: string;
      secrets: Record<string, string>;
    }>(current.private_config);
    const privateConfig = await cipher.encrypt({
      instructions: input.instructions ?? previousPrivate.instructions,
      secrets: input.secrets ?? previousPrivate.secrets,
    });
    const result = await pool.query<AgentRow>(
      `UPDATE agents SET
         name = $1, title = $2, mention = $3, description = $4, visibility = $5,
         workspace_access = $6, execution_target = $7, provider = $8, protocol = $9,
         runtime_model = $10, runtime_endpoint = $11, runtime_command = $12,
         runtime_args = $13::jsonb, runtime_auth = $14, capabilities = $15::jsonb,
         skill_policy = $16, skill_refs = $17::jsonb, private_config = $18::jsonb,
         version = version + 1, updated_at = now()
       WHERE id = $19 AND owner_id = $20 AND version = $21
       RETURNING *`,
      [
        input.name ?? current.name,
        input.title ?? current.title,
        input.mention ?? current.mention,
        input.description ?? current.description,
        input.visibility ?? current.visibility,
        input.workspaceAccess ?? current.workspace_access,
        input.executionTarget ?? current.execution_target,
        input.provider ?? current.provider,
        input.protocol ?? current.protocol,
        input.runtimeModel ?? current.runtime_model,
        input.runtimeEndpoint ?? current.runtime_endpoint,
        input.runtimeCommand ?? current.runtime_command,
        JSON.stringify(input.runtimeArgs ?? current.runtime_args),
        input.runtimeAuth ?? current.runtime_auth,
        JSON.stringify(input.capabilities ?? current.capabilities),
        input.skillPolicy ?? current.skill_policy,
        JSON.stringify(input.skillRefs ?? current.skill_refs),
        JSON.stringify(privateConfig),
        id,
        request.user.sub,
        revision,
      ],
    );
    if (!result.rows[0])
      throw new ApiError(409, "REVISION_CONFLICT", "Agent 已在其他设备被修改，请刷新后重试。");
    events.publishToUser(request.user.sub, {
      type: "agent.updated",
      agentId: id,
      version: result.rows[0].version,
    });
    return ownerDto(result.rows[0], cipher);
  });

  app.delete("/v1/agents/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = parseParams(idParams, request);
    const result = await pool.query(
      "UPDATE agents SET archived_at = now(), updated_at = now() WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL",
      [id, request.user.sub],
    );
    if (!result.rowCount)
      throw new ApiError(404, "AGENT_NOT_FOUND", "Agent 不存在或不属于当前用户。");
    return reply.status(204).send();
  });
};
