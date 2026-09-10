import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type pg from "pg";
import { z } from "zod";

import type { AppConfig } from "./config.js";
import type { EventPublisher } from "./events.js";
import { ApiError, parseBody } from "./http.js";
import { enqueueOutbox } from "./outbox.js";
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
const incomingSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("host.register"),
    deviceId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    platform: z.string().trim().min(1).max(32),
    agentIds: z.array(z.string().uuid()).max(64),
  }),
  z.object({ type: z.literal("host.heartbeat") }),
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
  }),
  z.object({
    type: z.literal("run.fail"),
    runId: z.string().uuid(),
    leaseToken: z.string().min(16),
    error: z.string().trim().min(1).max(4_000),
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
        agentId: candidate.agent_id,
        title: candidate.task_title,
        sourceRoomId: candidate.source_room_id,
        taskRoomId: candidate.task_room_id,
        anchorMessageId: candidate.anchor_message_id,
        contextVersion: candidate.context_version,
        workspaceBindingId: candidate.workspace_binding_id,
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
      if (message.type === "host.heartbeat") return await this.heartbeat(connection);
      if (message.type === "run.accept")
        return await this.acceptRun(connection, message.runId, message.leaseToken);
      if (message.type === "run.progress") return await this.progressRun(connection, message);
      if (message.type === "run.complete")
        return await this.completeRun(
          connection,
          message.runId,
          message.leaseToken,
          message.content,
        );
      if (message.type === "run.fail")
        return await this.failRun(connection, message.runId, message.leaseToken, message.error);
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

  private async heartbeat(connection: Connection) {
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
       WHERE device_id = $2 AND status IN ('leased', 'running') AND lease_expires_at > now()`,
      [leaseExpiresAt, connection.deviceId],
    );
    await this.pool.query(
      `UPDATE workspace_write_leases wl
       SET expires_at = $1
       FROM task_runs tr
       WHERE wl.run_id = tr.id AND tr.device_id = $2
         AND tr.status IN ('leased', 'running')`,
      [leaseExpiresAt, connection.deviceId],
    );
    if (connection.agentIds.size) {
      await this.pool.query(
        `UPDATE agents SET runtime_status = 'online', runtime_last_seen_at = now(), updated_at = now()
         WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL`,
        [connection.userId, [...connection.agentIds]],
      );
    }
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
         ) AND status IN ('approved', 'queued', 'running', 'waiting')`,
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
  ) {
    const run = await this.verifyLease(connection, runId, leaseToken, ["running", "leased"]);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const detail = await client.query<{
        task_id: string;
        agent_openim_id: string;
        agent_name: string;
        group_id: string;
      }>(
        `SELECT tr.task_id, a.openim_user_id AS agent_openim_id, a.name AS agent_name,
                r.openim_group_id AS group_id
         FROM task_runs tr JOIN agents a ON a.id = tr.agent_id JOIN tasks t ON t.id = tr.task_id
         JOIN rooms r ON r.id = t.task_room_id WHERE tr.id = $1 FOR UPDATE`,
        [runId],
      );
      if (!detail.rows[0]) throw new ApiError(404, "RUN_NOT_FOUND", "运行不存在。");
      await client.query(
        `UPDATE task_runs SET status = 'complete', completed_at = now(), lease_token_hash = NULL,
                lease_expires_at = NULL, updated_at = now() WHERE id = $1`,
        [runId],
      );
      await client.query("DELETE FROM workspace_write_leases WHERE run_id = $1", [runId]);
      await client.query("UPDATE tasks SET status = 'review', updated_at = now() WHERE id = $1", [
        run.task_id,
      ]);
      await enqueueOutbox(client, "openim.message.send", "task_run", runId, {
        sendID: detail.rows[0].agent_openim_id,
        senderNickname: detail.rows[0].agent_name,
        groupID: detail.rows[0].group_id,
        content,
        ex: { kind: "agent-message", runId, taskId: run.task_id, final: true },
      });
      await client.query("COMMIT");
      await this.publishTask(run.task_id, {
        type: "task.run.updated",
        runId,
        status: "complete",
        content,
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

  private send(connection: Connection, event: Record<string, unknown>) {
    if (connection.socket.readyState === 1) connection.socket.send(JSON.stringify(event));
  }
}
