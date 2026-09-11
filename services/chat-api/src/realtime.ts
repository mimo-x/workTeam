import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type pg from "pg";
import { z } from "zod";

import { appendCollaborationAudit, redactAuditText } from "./collaboration-audit.js";
import { applyAgentActions } from "./agent-actions.js";
import type { AppConfig } from "./config.js";
import type { EventPublisher } from "./events.js";
import { ApiError, parseBody } from "./http.js";
import { enqueueOutbox } from "./outbox.js";
import { normalizeCompletionSummary } from "./task-completion-summary.js";
import type { EnvelopeCipher } from "./security.js";
import { randomToken, tokenHash } from "./security.js";
import type { EncryptedEnvelope } from "./schema.js";

type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (raw: Buffer | string) => void): void;
  on(event: "close", listener: () => void): void;
};

type Connection = {
  socket: SocketLike;
  userId: string;
  deviceId: string | null;
  agentIds: Set<string>;
};

const ticketBody = z.object({ deviceName: z.string().trim().min(1).max(80).default("Desktop") });
const permissionScope = z.enum([
  "workspace.read",
  "workspace.write",
  "command.run",
  "network.read",
]);
const approvalConstraints = z.object({
  pathPrefixes: z.array(z.string().trim().min(1).max(1_024)).max(64).optional(),
  commandExecutables: z.array(z.string().trim().min(1).max(128)).max(64).optional(),
  networkDomains: z.array(z.string().trim().min(1).max(253)).max(64).optional(),
});
const incomingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("host.register"),
    deviceId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    platform: z.string().trim().min(1).max(32),
    agentIds: z.array(z.string().uuid()).max(64),
    pendingApprovalIds: z.array(z.string().uuid()).max(64).default([]),
  }),
  z.object({
    type: z.literal("host.heartbeat"),
    pendingApprovalIds: z.array(z.string().uuid()).max(64).default([]),
  }),
  z.object({
    type: z.literal("run.accept"),
    runId: z.string().uuid(),
    leaseToken: z.string().min(16),
  }),
  z.object({
    type: z.literal("run.progress"),
    runId: z.string().uuid(),
    leaseToken: z.string().min(16),
    activity: z.string().trim().min(1).max(500),
    content: z.string().max(100_000).optional(),
  }),
  z.object({
    type: z.literal("run.complete"),
    runId: z.string().uuid(),
    leaseToken: z.string().min(16),
    content: z.string().trim().min(1).max(100_000),
    agentActions: z.array(z.unknown()).max(32).default([]),
    invalidActionCount: z.number().int().min(0).max(100).default(0),
  }),
  z.object({
    type: z.literal("run.fail"),
    runId: z.string().uuid(),
    leaseToken: z.string().min(16),
    error: z.string().trim().min(1).max(4_000),
  }),
  z.object({
    type: z.literal("approval.requested"),
    approvalId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(1).max(512),
    runId: z.string().uuid(),
    leaseToken: z.string().min(16),
    taskId: z.string().uuid(),
    taskRevision: z.number().int().positive(),
    sessionId: z.string().trim().min(1).max(512),
    turnId: z.string().trim().min(1).max(512),
    agentId: z.string().uuid(),
    workspaceBindingId: z.string().uuid(),
    providerRequestId: z.string().trim().min(1).max(512),
    requestedScope: permissionScope,
    requestedConstraints: approvalConstraints.default({}),
    summary: z.string().trim().min(1).max(500),
    details: z.unknown(),
  }),
]);

type AssignmentRow = {
  run_id: string;
  task_id: string;
  agent_id: string;
  agent_snapshot: Record<string, unknown>;
  context_version: number;
  task_title: string;
  source_room_id: string;
  task_room_id: string;
  anchor_message_id: string;
  owner_id: string;
  target_device_id: string;
  workspace_binding_id: string;
  workspace_binding_revision: number;
  task_revision: number;
  requested_scopes: string[];
  write_intent: boolean;
};

export class RealtimeHub implements EventPublisher {
  private readonly connections = new Set<Connection>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pool: pg.Pool,
    private readonly redis: Redis,
    private readonly config: AppConfig,
    private readonly cipher: EnvelopeCipher,
  ) {}

  register(app: FastifyInstance) {
    app.post("/v1/realtime/ticket", { preHandler: [app.authenticate] }, async (request) => {
      const input = parseBody(ticketBody, request);
      const ticket = randomToken();
      await this.redis.set(
        `realtime-ticket:${tokenHash(ticket)}`,
        JSON.stringify({ userId: request.user.sub, deviceName: input.deviceName }),
        "EX",
        60,
      );
      return { ticket, expiresIn: 60, url: "/v1/realtime" };
    });

    app.get(
      "/v1/realtime",
      { websocket: true },
      async (socket: SocketLike, request: FastifyRequest) => {
        const ticket = String((request.query as { ticket?: unknown })?.ticket ?? "");
        const raw = ticket
          ? await this.redis.call("GETDEL", `realtime-ticket:${tokenHash(ticket)}`)
          : null;
        if (!raw) {
          socket.close(4401, "Invalid or expired realtime ticket");
          return;
        }
        const auth = JSON.parse(String(raw)) as { userId: string };
        const connection: Connection = {
          socket,
          userId: auth.userId,
          deviceId: null,
          agentIds: new Set(),
        };
        this.connections.add(connection);
        this.send(connection, {
          type: "realtime.ready",
          heartbeatSeconds: this.config.HOST_HEARTBEAT_SECONDS,
        });
        socket.on("message", (value) => void this.onMessage(connection, value));
        socket.on("close", () => {
          this.connections.delete(connection);
          void this.markAgentsOffline(connection);
        });
      },
    );

    this.sweepTimer = setInterval(() => void this.sweepExpiredLeases(), 5_000);
    this.sweepTimer.unref();
  }

  close() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const connection of this.connections)
      connection.socket.close(1001, "Server shutting down");
    this.connections.clear();
  }

  publishToUser(userId: string, event: Record<string, unknown>) {
    for (const connection of this.connections) {
      if (connection.userId === userId) this.send(connection, event);
    }
  }

  publishToDevice(userId: string, deviceId: string, event: Record<string, unknown>) {
    let delivered = false;
    for (const connection of this.connections) {
      if (connection.userId === userId && connection.deviceId === deviceId) {
        this.send(connection, event);
        delivered = true;
      }
    }
    return delivered;
  }

  publishToAgentHost(userId: string, agentId: string, event: Record<string, unknown>) {
    const connection = [...this.connections]
      .reverse()
      .find(
        (candidate) =>
          candidate.userId === userId &&
          Boolean(candidate.deviceId) &&
          candidate.agentIds.has(agentId) &&
          candidate.socket.readyState === 1,
      );
    if (!connection) return false;
    this.send(connection, event);
    return true;
  }

  async publishToRoom(roomId: string, event: Record<string, unknown>) {
    const users = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM room_members WHERE room_id = $1
       UNION SELECT a.owner_id FROM room_agents ra JOIN agents a ON a.id = ra.agent_id WHERE ra.room_id = $1`,
      [roomId],
    );
    for (const row of users.rows) this.publishToUser(row.user_id, event);
  }

  async dispatchQueued(userId: string) {
    for (const connection of this.connections) {
      if (connection.userId !== userId || !connection.deviceId) continue;
      const candidates = await this.pool.query<AssignmentRow>(
        `SELECT tr.id AS run_id, tr.task_id, tr.agent_id, tr.agent_snapshot, tr.context_version,
                t.title AS task_title, t.source_room_id, t.task_room_id, t.anchor_message_id,
                a.owner_id, tr.target_device_id, t.workspace_binding_id,
                t.binding_revision AS workspace_binding_revision, t.revision AS task_revision,
                tr.requested_scopes, tr.write_intent
         FROM task_runs tr
         JOIN tasks t ON t.id = tr.task_id JOIN agents a ON a.id = tr.agent_id
         WHERE tr.status = 'queued' AND tr.execution_target = 'local'
           AND tr.target_device_id = $1
         ORDER BY tr.created_at LIMIT 10`,
        [connection.deviceId],
      );
      for (const candidate of candidates.rows) await this.leaseAndSend(connection, candidate);
    }
  }

  private async leaseAndSend(connection: Connection, candidate: AssignmentRow) {
    const leaseToken = randomToken();
    const leaseHash = tokenHash(leaseToken);
    const leaseExpiresAt = new Date(Date.now() + this.config.HOST_LEASE_SECONDS * 1_000);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (candidate.write_intent) {
        const existingWriteLease = await client.query<{ run_id: string; expires_at: Date }>(
          `SELECT run_id, expires_at FROM workspace_write_leases
           WHERE workspace_binding_id = $1 FOR UPDATE`,
          [candidate.workspace_binding_id],
        );
        const currentWriteLease = existingWriteLease.rows[0];
        if (
          currentWriteLease &&
          currentWriteLease.run_id !== candidate.run_id &&
          new Date(currentWriteLease.expires_at).getTime() > Date.now()
        ) {
          await client.query("ROLLBACK");
          return;
        }
        if (currentWriteLease) {
          await client.query(
            `UPDATE workspace_write_leases
             SET run_id = $2, lease_token_hash = $3, acquired_at = now(), expires_at = $4
             WHERE workspace_binding_id = $1`,
            [candidate.workspace_binding_id, candidate.run_id, leaseHash, leaseExpiresAt],
          );
        } else {
          const insertedWriteLease = await client.query(
            `INSERT INTO workspace_write_leases(
               workspace_binding_id, run_id, lease_token_hash, expires_at
             ) VALUES ($1, $2, $3, $4)
             ON CONFLICT (workspace_binding_id) DO NOTHING
             RETURNING run_id`,
            [candidate.workspace_binding_id, candidate.run_id, leaseHash, leaseExpiresAt],
          );
          if (!insertedWriteLease.rowCount) {
            await client.query("ROLLBACK");
            return;
          }
        }
      }
      const leased = await client.query(
        `UPDATE task_runs SET status = 'leased', device_id = $1, lease_token_hash = $2,
                lease_expires_at = $3, attempts = attempts + 1,
                updated_at = now()
         WHERE id = $4 AND target_device_id = $1 AND status = 'queued' AND attempts < 3
         RETURNING id`,
        [connection.deviceId, leaseHash, leaseExpiresAt, candidate.run_id],
      );
      if (!leased.rowCount) {
        await client.query("ROLLBACK");
        return;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const context = await this.loadContext(candidate.task_id);
    const snapshot = { ...candidate.agent_snapshot };
    const privateConfig = snapshot.privateConfig as EncryptedEnvelope | undefined;
    if (privateConfig) {
      snapshot.private = await this.cipher.decrypt(privateConfig);
      delete snapshot.privateConfig;
    }
    this.send(connection, {
      type: "agent.run.assigned",
      run: {
        id: candidate.run_id,
        taskId: candidate.task_id,
        taskRevision: candidate.task_revision,
        agentId: candidate.agent_id,
        title: candidate.task_title,
        sourceRoomId: candidate.source_room_id,
        taskRoomId: candidate.task_room_id,
        anchorMessageId: candidate.anchor_message_id,
        contextVersion: candidate.context_version,
        workspaceBindingId: candidate.workspace_binding_id,
        workspaceBindingRevision: candidate.workspace_binding_revision,
        targetDeviceId: candidate.target_device_id,
        requestedScopes: candidate.requested_scopes,
        agent: snapshot,
        context,
        leaseToken,
        leaseSeconds: this.config.HOST_LEASE_SECONDS,
      },
    });
  }

  private async loadContext(taskId: string) {
    const result = await this.pool.query(
      `SELECT m.server_msg_id AS "messageId", m.content, m.sender_openim_id AS "senderId",
              m.seq, m.sent_at AS "sentAt", CASE WHEN m.room_id = t.source_room_id THEN 'source' ELSE 'task' END AS channel
       FROM tasks t JOIN message_mirrors m ON m.room_id IN (t.source_room_id, t.task_room_id)
       WHERE t.id = $1 ORDER BY m.sent_at DESC LIMIT 80`,
      [taskId],
    );
    return result.rows.reverse();
  }

  private async onMessage(connection: Connection, raw: Buffer | string) {
    try {
      const message = incomingSchema.parse(JSON.parse(raw.toString()));
      if (message.type === "host.register") return await this.registerHost(connection, message);
      if (!connection.deviceId)
        throw new ApiError(400, "HOST_NOT_REGISTERED", "请先注册 Host 设备。");
      if (message.type === "host.heartbeat") {
        return await this.heartbeat(connection, message.pendingApprovalIds);
      }
      if (message.type === "run.accept")
        return await this.acceptRun(connection, message.runId, message.leaseToken);
      if (message.type === "run.progress") return await this.progressRun(connection, message);
      if (message.type === "run.complete")
        return await this.completeRun(
          connection,
          message.runId,
          message.leaseToken,
          message.content,
          message.agentActions,
          message.invalidActionCount,
        );
      if (message.type === "run.fail")
        return await this.failRun(connection, message.runId, message.leaseToken, message.error);
      if (message.type === "approval.requested") {
        return await this.requestApproval(connection, message);
      }
    } catch (error) {
      this.send(connection, {
        type: "error",
        code: error instanceof ApiError ? error.code : "INVALID_EVENT",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async registerHost(
    connection: Connection,
    message: Extract<z.infer<typeof incomingSchema>, { type: "host.register" }>,
  ) {
    const owned = await this.pool.query<{ id: string }>(
      `SELECT id FROM agents WHERE owner_id = $1 AND id = ANY($2::uuid[])
       AND execution_target = 'local' AND archived_at IS NULL`,
      [connection.userId, message.agentIds],
    );
    const allowed = new Set(owned.rows.map((row) => row.id));
    if (allowed.size !== new Set(message.agentIds).size) {
      throw new ApiError(403, "INVALID_HOST_AGENTS", "Host 只能托管当前用户拥有的本地 Agent。");
    }
    let result = message.deviceId
      ? await this.pool.query<{ id: string }>(
          `UPDATE devices SET name = $1, platform = $2, is_agent_host = true,
                  last_seen_at = now(), updated_at = now()
           WHERE id = $3 AND user_id = $4 RETURNING id`,
          [message.name, message.platform, message.deviceId, connection.userId],
        )
      : await this.pool.query<{ id: string }>(
          `INSERT INTO devices(user_id, name, platform, is_agent_host)
           VALUES ($1, $2, $3, true) RETURNING id`,
          [connection.userId, message.name, message.platform],
        );
    if (!result.rows[0] && message.deviceId) {
      result = await this.pool.query<{ id: string }>(
        `INSERT INTO devices(user_id, name, platform, is_agent_host)
         VALUES ($1, $2, $3, true) RETURNING id`,
        [connection.userId, message.name, message.platform],
      );
    }
    if (!result.rows[0])
      throw new ApiError(500, "DEVICE_REGISTRATION_FAILED", "Host 设备注册失败。");
    connection.deviceId = result.rows[0].id;
    connection.agentIds = allowed;
    // Set iteration order is used to prefer the most recently registered Host.
    // Moving this connection to the end prevents the same Agent answering from
    // every active desktop while still allowing a newer Host to take over.
    if (this.connections.delete(connection)) this.connections.add(connection);
    if (allowed.size) {
      await this.pool.query(
        `UPDATE agents SET runtime_status = 'online', runtime_last_seen_at = now(), updated_at = now()
         WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL`,
        [connection.userId, [...allowed]],
      );
      this.publishToUser(connection.userId, {
        type: "agent.runtime.updated",
        agentIds: [...allowed],
        status: "online",
      });
    }
    await this.pool.query(
      `UPDATE workspace_bindings SET status = 'online', last_seen_at = now(), updated_at = now()
       WHERE device_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [connection.deviceId, connection.userId],
    );
    await this.reconcileApprovals(connection, message.pendingApprovalIds);
    await this.pool.query(
      `UPDATE tasks SET status = 'approved', wait_reason = NULL, updated_at = now()
       WHERE status = 'waiting_for_host' AND approved_review_id IS NOT NULL
         AND workspace_binding_id IN (
           SELECT id FROM workspace_bindings WHERE device_id = $1 AND user_id = $2
         )`,
      [connection.deviceId, connection.userId],
    );
    this.send(connection, {
      type: "host.registered",
      deviceId: connection.deviceId,
      agentIds: [...allowed],
    });
    await this.dispatchQueued(connection.userId);
  }

  private async heartbeat(connection: Connection, pendingApprovalIds: string[]) {
    const leaseExpiresAt = new Date(Date.now() + this.config.HOST_LEASE_SECONDS * 1_000);
    await this.pool.query(
      "UPDATE devices SET last_seen_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2",
      [connection.deviceId, connection.userId],
    );
    await this.pool.query(
      `UPDATE workspace_bindings SET status = 'online', last_seen_at = now(), updated_at = now()
       WHERE device_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [connection.deviceId, connection.userId],
    );
    await this.pool.query(
      `UPDATE task_runs SET lease_expires_at = $1, updated_at = now()
       WHERE device_id = $2 AND status IN ('leased', 'running', 'waiting_for_approval')
         AND lease_expires_at > now()`,
      [leaseExpiresAt, connection.deviceId],
    );
    await this.pool.query(
      `UPDATE workspace_write_leases wl
       SET expires_at = $1
       FROM task_runs tr
       WHERE wl.run_id = tr.id AND tr.device_id = $2
         AND tr.status IN ('leased', 'running', 'waiting_for_approval')`,
      [leaseExpiresAt, connection.deviceId],
    );
    if (connection.agentIds.size) {
      await this.pool.query(
        `UPDATE agents SET runtime_status = 'online', runtime_last_seen_at = now(), updated_at = now()
         WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL`,
        [connection.userId, [...connection.agentIds]],
      );
    }
    await this.reconcileApprovals(connection, pendingApprovalIds);
    this.send(connection, { type: "host.heartbeat.ack", at: new Date().toISOString() });
  }

  private async markAgentsOffline(connection: Connection) {
    const sameDeviceOnline = [...this.connections].some(
      (candidate) =>
        candidate !== connection &&
        candidate.userId === connection.userId &&
        candidate.deviceId === connection.deviceId,
    );
    if (connection.deviceId && !sameDeviceOnline) {
      await this.pool.query(
        `UPDATE workspace_bindings SET status = 'offline', updated_at = now()
         WHERE device_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [connection.deviceId, connection.userId],
      );
      await this.pool.query(
        `UPDATE tasks SET status = 'waiting_for_host',
                wait_reason = '项目主机连接已断开。', updated_at = now()
         WHERE workspace_binding_id IN (
           SELECT id FROM workspace_bindings WHERE device_id = $1 AND user_id = $2
         ) AND status IN ('approved', 'queued', 'running', 'waiting', 'waiting_for_approval')`,
        [connection.deviceId, connection.userId],
      );
    }
    if (!connection.agentIds.size) return;
    const stillOnline = new Set(
      [...this.connections]
        .filter((candidate) => candidate.userId === connection.userId)
        .flatMap((candidate) => [...candidate.agentIds]),
    );
    const offline = [...connection.agentIds].filter((agentId) => !stillOnline.has(agentId));
    if (!offline.length) return;
    await this.pool.query(
      `UPDATE agents SET runtime_status = 'offline', updated_at = now()
       WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL`,
      [connection.userId, offline],
    );
    this.publishToUser(connection.userId, {
      type: "agent.runtime.updated",
      agentIds: offline,
      status: "offline",
    });
  }

  private async requestApproval(
    connection: Connection,
    message: Extract<z.infer<typeof incomingSchema>, { type: "approval.requested" }>,
  ) {
    const client = await this.pool.connect();
    let roomId = "";
    let created = false;
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    try {
      await client.query("BEGIN");
      const run = await client.query<{
        task_id: string;
        task_revision: number;
        agent_id: string;
        workspace_binding_id: string;
        binding_revision: number;
        requested_scopes: string[];
        source_room_id: string;
        host_user_id: string;
      }>(
        `SELECT tr.task_id, t.revision AS task_revision, tr.agent_id,
                t.workspace_binding_id, t.binding_revision, t.requested_scopes,
                t.source_room_id, d.user_id AS host_user_id
         FROM task_runs tr
         JOIN tasks t ON t.id = tr.task_id
         JOIN devices d ON d.id = tr.target_device_id
         JOIN workspace_bindings wb ON wb.id = t.workspace_binding_id
         WHERE tr.id = $1 AND tr.target_device_id = $2 AND tr.device_id = $2
           AND tr.lease_token_hash = $3 AND tr.lease_expires_at > now()
           AND tr.status IN ('leased', 'running', 'waiting_for_approval')
           AND wb.device_id = $2 AND wb.user_id = $4 AND wb.revision = t.binding_revision
           AND wb.revoked_at IS NULL
         FOR UPDATE`,
        [message.runId, connection.deviceId, tokenHash(message.leaseToken), connection.userId],
      );
      const current = run.rows[0];
      if (!current) throw new ApiError(409, "LEASE_INVALID", "审批请求的运行租约无效或已过期。");
      if (
        current.task_id !== message.taskId ||
        current.task_revision !== message.taskRevision ||
        current.agent_id !== message.agentId ||
        current.workspace_binding_id !== message.workspaceBindingId
      ) {
        throw new ApiError(409, "APPROVAL_CORRELATION_MISMATCH", "审批请求与当前运行不匹配。");
      }
      if (!current.requested_scopes.includes(message.requestedScope)) {
        throw new ApiError(
          403,
          "APPROVAL_SCOPE_NOT_REQUESTED",
          "Runtime 请求了 Task 范围外的权限。",
        );
      }
      roomId = current.source_room_id;
      const existing = await client.query<{
        id: string;
        run_id: string;
        session_id: string;
        turn_id: string;
        provider_request_id: string;
      }>(
        `SELECT id, run_id, session_id, turn_id, provider_request_id
         FROM execution_approval_requests
         WHERE id = $1 OR idempotency_key = $2`,
        [message.approvalId, message.idempotencyKey],
      );
      if (existing.rows[0]) {
        const approval = existing.rows[0];
        if (
          approval.id !== message.approvalId ||
          approval.run_id !== message.runId ||
          approval.session_id !== message.sessionId ||
          approval.turn_id !== message.turnId ||
          approval.provider_request_id !== message.providerRequestId
        ) {
          throw new ApiError(409, "APPROVAL_IDEMPOTENCY_CONFLICT", "审批幂等键关联了其他请求。");
        }
      } else {
        const encryptedDetails = await this.cipher.encrypt(message.details);
        await client.query(
          `INSERT INTO execution_approval_requests(
             id, idempotency_key, task_id, task_revision, run_id, session_id, turn_id,
             agent_id, workspace_binding_id, host_device_id, provider_request_id,
             requested_scope, requested_constraints, redacted_summary, encrypted_details,
             expires_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15::jsonb,
             now() + interval '5 minutes'
           )`,
          [
            message.approvalId,
            message.idempotencyKey,
            message.taskId,
            message.taskRevision,
            message.runId,
            message.sessionId,
            message.turnId,
            message.agentId,
            message.workspaceBindingId,
            connection.deviceId,
            message.providerRequestId,
            message.requestedScope,
            JSON.stringify(message.requestedConstraints),
            redactAuditText(message.summary),
            JSON.stringify(encryptedDetails),
          ],
        );
        created = true;
        await appendCollaborationAudit(client, {
          actorAgentId: message.agentId,
          roomId,
          taskId: message.taskId,
          taskRevision: message.taskRevision,
          runId: message.runId,
          hostDeviceId: connection.deviceId!,
          eventType: "runtime.approval_requested",
          summary: message.summary,
          outcome: "pending",
          metadata: { approvalId: message.approvalId, requestedScope: message.requestedScope },
        });
      }
      await client.query(
        `UPDATE task_runs SET status = 'waiting_for_approval', updated_at = now()
         WHERE id = $1 AND status IN ('leased', 'running')`,
        [message.runId],
      );
      await client.query(
        `UPDATE tasks SET status = 'waiting_for_approval',
                wait_reason = '等待项目主机所有者确认 Runtime 操作。', updated_at = now()
         WHERE id = $1 AND status NOT IN ('done', 'failed', 'cancelled')`,
        [message.taskId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    this.send(connection, {
      type: "approval.registered",
      approvalId: message.approvalId,
      runId: message.runId,
      expiresAt,
      reused: !created,
    });
    if (created) {
      this.publishToUser(connection.userId, {
        type: "runtime.approval-requested",
        approvalId: message.approvalId,
        taskId: message.taskId,
        taskRevision: message.taskRevision,
        runId: message.runId,
        agentId: message.agentId,
        requestedScope: message.requestedScope,
        requestedConstraints: message.requestedConstraints,
        summary: redactAuditText(message.summary),
        expiresAt,
      });
      await this.publishToRoom(roomId, {
        type: "runtime.approval-waiting",
        approvalId: message.approvalId,
        taskId: message.taskId,
        runId: message.runId,
        requestedScope: message.requestedScope,
        summary: redactAuditText(message.summary),
      });
    }
  }

  private async reconcileApprovals(connection: Connection, pendingApprovalIds: string[]) {
    if (!connection.deviceId) return;
    const known = await this.pool.query<{
      id: string;
      run_id: string;
      session_id: string;
      turn_id: string;
      provider_request_id: string;
      status: string;
      decision: string | null;
      expires_at: Date;
    }>(
      `SELECT id, run_id, session_id, turn_id, provider_request_id, status, decision, expires_at
       FROM execution_approval_requests
       WHERE host_device_id = $1 AND id = ANY($2::uuid[])`,
      [connection.deviceId, pendingApprovalIds],
    );
    for (const approval of known.rows) {
      if (approval.status === "pending" && approval.expires_at.getTime() > Date.now()) {
        await this.pool.query(
          `UPDATE tasks SET status = 'waiting_for_approval',
                  wait_reason = '等待项目主机所有者确认 Runtime 操作。', updated_at = now()
           WHERE id = (SELECT task_id FROM execution_approval_requests WHERE id = $1)
             AND status NOT IN ('done', 'failed', 'cancelled')`,
          [approval.id],
        );
        this.send(connection, {
          type: "approval.registered",
          approvalId: approval.id,
          runId: approval.run_id,
          expiresAt: approval.expires_at,
          reused: true,
        });
      } else {
        this.send(connection, {
          type: "approval.resolved",
          approvalId: approval.id,
          runId: approval.run_id,
          sessionId: approval.session_id,
          turnId: approval.turn_id,
          providerRequestId: approval.provider_request_id,
          decision: approval.decision ?? "deny",
        });
      }
    }
    const abandoned = await this.pool.query<{
      id: string;
      run_id: string;
      task_id: string;
    }>(
      `UPDATE execution_approval_requests
       SET status = 'expired', decision = 'deny', decided_at = now()
       WHERE host_device_id = $1 AND status = 'pending'
         AND NOT (id = ANY($2::uuid[]))
       RETURNING id, run_id, task_id`,
      [connection.deviceId, pendingApprovalIds],
    );
    for (const approval of abandoned.rows) {
      await this.pool.query(
        `UPDATE task_runs SET status = 'failed', completed_at = now(),
                error = 'APPROVAL_NON_RESUMABLE: Host 重启后无法恢复 Runtime 审批。',
                lease_token_hash = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND status = 'waiting_for_approval'`,
        [approval.run_id],
      );
      await this.pool.query("DELETE FROM workspace_write_leases WHERE run_id = $1", [
        approval.run_id,
      ]);
      await this.pool.query(
        `UPDATE tasks SET status = 'blocked',
                wait_reason = '项目主机重启后无法恢复待审批操作。', updated_at = now()
         WHERE id = $1 AND status = 'waiting_for_approval'`,
        [approval.task_id],
      );
    }
  }

  private async verifyLease(
    connection: Connection,
    runId: string,
    leaseToken: string,
    statuses: string[],
  ) {
    const result = await this.pool.query<{ task_id: string; agent_id: string }>(
      `SELECT task_id, agent_id FROM task_runs
       WHERE id = $1 AND device_id = $2 AND lease_token_hash = $3
         AND lease_expires_at > now() AND status = ANY($4::text[])`,
      [runId, connection.deviceId, tokenHash(leaseToken), statuses],
    );
    if (!result.rows[0]) throw new ApiError(409, "LEASE_INVALID", "运行租约无效或已过期。");
    return result.rows[0];
  }

  private async acceptRun(connection: Connection, runId: string, leaseToken: string) {
    const run = await this.verifyLease(connection, runId, leaseToken, ["leased"]);
    await this.pool.query(
      "UPDATE task_runs SET status = 'running', started_at = now(), updated_at = now() WHERE id = $1",
      [runId],
    );
    await this.pool.query("UPDATE tasks SET status = 'running', updated_at = now() WHERE id = $1", [
      run.task_id,
    ]);
    this.send(connection, { type: "run.accepted", runId });
    await this.publishTask(run.task_id, { type: "task.run.updated", runId, status: "running" });
  }

  private async progressRun(
    connection: Connection,
    message: Extract<z.infer<typeof incomingSchema>, { type: "run.progress" }>,
  ) {
    const run = await this.verifyLease(connection, message.runId, message.leaseToken, ["running"]);
    await this.publishTask(run.task_id, {
      type: "task.run.progress",
      runId: message.runId,
      activity: message.activity,
      content: message.content,
    });
  }

  private async completeRun(
    connection: Connection,
    runId: string,
    leaseToken: string,
    content: string,
    agentActions: unknown[],
    invalidActionCount: number,
  ) {
    const run = await this.verifyLease(connection, runId, leaseToken, ["running", "leased"]);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const detail = await client.query<{
        task_id: string;
        task_revision: number;
        agent_id: string;
        agent_openim_id: string;
        agent_name: string;
        group_id: string;
        source_room_id: string;
      }>(
        `SELECT tr.task_id, t.revision AS task_revision, tr.agent_id,
                a.openim_user_id AS agent_openim_id, a.name AS agent_name,
                r.openim_group_id AS group_id, t.source_room_id
         FROM task_runs tr JOIN agents a ON a.id = tr.agent_id JOIN tasks t ON t.id = tr.task_id
         JOIN rooms r ON r.id = t.task_room_id WHERE tr.id = $1 FOR UPDATE`,
        [runId],
      );
      if (!detail.rows[0]) throw new ApiError(404, "RUN_NOT_FOUND", "运行不存在。");
      const actionResult = await applyAgentActions(client, {
        runId,
        taskId: detail.rows[0].task_id,
        taskRevision: detail.rows[0].task_revision,
        agentId: detail.rows[0].agent_id,
        actions: agentActions,
      });
      const actionErrors = [
        ...(invalidActionCount ? [`包含 ${invalidActionCount} 个无效 Agent 动作。`] : []),
        ...actionResult.errors,
      ];
      const fallbackSummary = actionResult.hasCompletionSummary
        ? ""
        : normalizeCompletionSummary(content);
      await client.query(
        `UPDATE task_runs SET status = $1, completed_at = CASE WHEN $1 = 'complete' THEN now() ELSE NULL END,
                error = $2, lease_token_hash = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE id = $3`,
        [actionErrors.length ? "waiting" : "complete", actionErrors.join(" ") || null, runId],
      );
      await client.query("DELETE FROM workspace_write_leases WHERE run_id = $1", [runId]);
      if (actionErrors.length) {
        await client.query(
          `UPDATE tasks SET status = CASE
                    WHEN status IN ('waiting_for_budget', 'waiting_for_permission', 'waiting_for_assignee')
                      THEN status ELSE 'blocked' END,
                  wait_reason = COALESCE(wait_reason, $1), updated_at = now()
           WHERE id = $2`,
          [actionErrors.join(" "), run.task_id],
        );
      } else if (actionResult.createdTasks.length) {
        await client.query(
          `UPDATE tasks SET status = 'waiting', wait_reason = '等待委派的子 Task 完成。',
                  completion_summary = CASE
                    WHEN $1::text = '' THEN completion_summary
                    WHEN completion_summary IS NULL OR completion_summary = '' THEN $1
                    WHEN completion_summary = $1 THEN completion_summary
                    ELSE completion_summary || E'\n' || $1
                  END,
                  updated_at = now()
           WHERE id = $2 AND status IN ('approved', 'queued', 'running', 'waiting')`,
          [fallbackSummary, run.task_id],
        );
      } else {
        await client.query(
          `UPDATE tasks SET status = 'review', wait_reason = NULL,
                  completion_summary = CASE
                    WHEN $1::text = '' THEN completion_summary
                    WHEN completion_summary IS NULL OR completion_summary = '' THEN $1
                    WHEN completion_summary = $1 THEN completion_summary
                    ELSE completion_summary || E'\\n' || $1
                  END,
                  updated_at = now()
           WHERE id = $2 AND status IN ('approved', 'queued', 'running', 'waiting', 'review')`,
          [fallbackSummary, run.task_id],
        );
      }
      await enqueueOutbox(client, "openim.message.send", "task_run", runId, {
        sendID: detail.rows[0].agent_openim_id,
        senderNickname: detail.rows[0].agent_name,
        groupID: detail.rows[0].group_id,
        content,
        ex: { kind: "agent-message", runId, taskId: run.task_id, final: true },
      });
      await client.query("COMMIT");
      for (const userId of actionResult.dispatchUserIds) await this.dispatchQueued(userId);
      for (const child of actionResult.createdTasks) {
        await this.publishToRoom(detail.rows[0].source_room_id, {
          type: "task.delegated",
          parentTaskId: run.task_id,
          taskId: child.taskId,
          taskRoomId: child.taskRoomId,
          status: child.status,
        });
      }
      await this.publishTask(run.task_id, {
        type: "task.run.updated",
        runId,
        status: actionErrors.length ? "waiting" : "complete",
        content,
        actionErrors,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async failRun(connection: Connection, runId: string, leaseToken: string, error: string) {
    const run = await this.verifyLease(connection, runId, leaseToken, ["leased", "running"]);
    const result = await this.pool.query<{ status: string }>(
      `UPDATE task_runs SET status = CASE WHEN attempts < 3 THEN 'queued' ELSE 'failed' END,
              error = $1, device_id = NULL, lease_token_hash = NULL, lease_expires_at = NULL,
              updated_at = now(), completed_at = CASE WHEN attempts >= 3 THEN now() ELSE completed_at END
       WHERE id = $2 RETURNING status`,
      [error, runId],
    );
    await this.pool.query("DELETE FROM workspace_write_leases WHERE run_id = $1", [runId]);
    if (result.rows[0].status === "failed") {
      await this.pool.query(
        "UPDATE tasks SET status = 'blocked', updated_at = now() WHERE id = $1",
        [run.task_id],
      );
    }
    await this.publishTask(run.task_id, {
      type: "task.run.updated",
      runId,
      status: result.rows[0].status,
      error,
    });
    if (result.rows[0].status === "queued") await this.dispatchQueued(connection.userId);
  }

  private async publishTask(taskId: string, event: Record<string, unknown>) {
    const task = await this.pool.query<{ task_room_id: string }>(
      "SELECT task_room_id FROM tasks WHERE id = $1",
      [taskId],
    );
    if (task.rows[0]) await this.publishToRoom(task.rows[0].task_room_id, { ...event, taskId });
  }

  private async sweepExpiredLeases() {
    await this.sweepExpiredApprovals();
    await this.pool.query("DELETE FROM workspace_write_leases WHERE expires_at <= now()");
    const expired = await this.pool.query<{ user_id: string; task_id: string }>(
      `WITH changed AS (
         UPDATE task_runs SET
           status = CASE WHEN attempts < 3 THEN 'queued' ELSE 'failed' END,
           device_id = NULL, lease_token_hash = NULL, lease_expires_at = NULL,
           error = 'Agent Host 租约已过期。', updated_at = now()
         WHERE status IN ('leased', 'running') AND lease_expires_at <= now()
         RETURNING target_device_id, task_id, status
       ) SELECT d.user_id, changed.task_id FROM changed
           JOIN devices d ON d.id = changed.target_device_id`,
    );
    const owners = new Set(expired.rows.map((row) => row.user_id));
    for (const owner of owners) await this.dispatchQueued(owner);
  }

  private async sweepExpiredApprovals() {
    const expired = await this.pool.query<{
      id: string;
      run_id: string;
      task_id: string;
      session_id: string;
      turn_id: string;
      provider_request_id: string;
      host_device_id: string;
      host_user_id: string;
      source_room_id: string;
    }>(
      `SELECT ear.id, ear.run_id, ear.task_id, ear.session_id, ear.turn_id,
              ear.provider_request_id, ear.host_device_id, d.user_id AS host_user_id,
              t.source_room_id
       FROM execution_approval_requests ear
       JOIN task_runs tr ON tr.id = ear.run_id
       JOIN tasks t ON t.id = ear.task_id
       JOIN devices d ON d.id = ear.host_device_id
       WHERE ear.status = 'pending'
         AND (ear.expires_at <= now() OR tr.lease_expires_at <= now())`,
    );
    for (const approval of expired.rows) {
      const changed = await this.pool.query(
        `UPDATE execution_approval_requests
         SET status = 'expired', decision = 'deny', decided_at = now()
         WHERE id = $1 AND status = 'pending' RETURNING id`,
        [approval.id],
      );
      if (!changed.rowCount) continue;
      await this.pool.query(
        `UPDATE task_runs SET status = 'failed', completed_at = now(),
                error = 'APPROVAL_EXPIRED: Runtime 审批已超时。',
                lease_token_hash = NULL, lease_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND status = 'waiting_for_approval'`,
        [approval.run_id],
      );
      await this.pool.query("DELETE FROM workspace_write_leases WHERE run_id = $1", [
        approval.run_id,
      ]);
      await this.pool.query(
        `UPDATE tasks SET status = 'blocked',
                wait_reason = 'Runtime 审批已超时，操作未执行。', updated_at = now()
         WHERE id = $1 AND status IN ('waiting_for_approval', 'waiting_for_host')`,
        [approval.task_id],
      );
      this.publishToDevice(approval.host_user_id, approval.host_device_id, {
        type: "approval.resolved",
        approvalId: approval.id,
        runId: approval.run_id,
        sessionId: approval.session_id,
        turnId: approval.turn_id,
        providerRequestId: approval.provider_request_id,
        decision: "deny",
        reason: "expired",
      });
      await this.publishToRoom(approval.source_room_id, {
        type: "runtime.approval-expired",
        approvalId: approval.id,
        taskId: approval.task_id,
        runId: approval.run_id,
      });
    }
  }

  private send(connection: Connection, event: Record<string, unknown>) {
    if (connection.socket.readyState === 1) connection.socket.send(JSON.stringify(event));
  }
}
