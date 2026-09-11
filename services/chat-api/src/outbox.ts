import type pg from "pg";

import type { OpenImClient } from "./openim.js";

type OutboxRow = {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export const enqueueOutbox = async (
  client: pg.Pool | pg.PoolClient,
  topic: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
) => {
  await client.query(
    `INSERT INTO outbox_events(topic, aggregate_type, aggregate_id, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [topic, aggregateType, aggregateId, JSON.stringify(payload)],
  );
};

export class OutboxProcessor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly pool: pg.Pool,
    private readonly openim: OpenImClient,
  ) {}

  start(intervalMs = 1_000) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.running || !this.openim.configured) return;
    this.running = true;
    try {
      for (let index = 0; index < 25; index += 1) {
        const row = await this.claim();
        if (!row) break;
        try {
          await this.process(row);
          await this.pool.query(
            "UPDATE outbox_events SET processed_at = now(), last_error = NULL WHERE id = $1",
            [row.id],
          );
        } catch (error) {
          const delay = Math.min(300, 2 ** Math.min(row.attempts, 8));
          await this.pool.query(
            `UPDATE outbox_events
             SET last_error = $2, available_at = now() + ($3 * interval '1 second')
             WHERE id = $1`,
            [row.id, error instanceof Error ? error.message : String(error), delay],
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async claim(): Promise<OutboxRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<OutboxRow>(
        `SELECT id, topic, payload, attempts
         FROM outbox_events
         WHERE processed_at IS NULL AND available_at <= now()
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
      );
      if (!result.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      await client.query(
        "UPDATE outbox_events SET attempts = attempts + 1, available_at = now() + interval '2 minutes' WHERE id = $1",
        [result.rows[0].id],
      );
      await client.query("COMMIT");
      return { ...result.rows[0], attempts: result.rows[0].attempts + 1 };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async process(row: OutboxRow) {
    const payload = row.payload;
    if (row.topic === "openim.user.register") {
      return this.openim.registerUser({
        userID: String(payload.userID),
        nickname: String(payload.nickname),
        faceURL: payload.faceURL ? String(payload.faceURL) : "",
      });
    }
    if (row.topic === "openim.group.create") {
      return this.openim.createGroup({
        groupID: String(payload.groupID),
        name: String(payload.name),
        ownerUserID: String(payload.ownerUserID),
        memberUserIDs: Array.isArray(payload.memberUserIDs)
          ? payload.memberUserIDs.map(String)
          : [],
      });
    }
    if (row.topic === "openim.group.invite") {
      return this.openim.inviteToGroup(
        String(payload.groupID),
        Array.isArray(payload.userIDs) ? payload.userIDs.map(String) : [],
      );
    }
    if (row.topic === "openim.group.kick") {
      return this.openim.kickFromGroup(
        String(payload.groupID),
        Array.isArray(payload.userIDs) ? payload.userIDs.map(String) : [],
      );
    }
    if (row.topic === "openim.message.send") {
      return this.openim.sendMessage({
        sendID: String(payload.sendID),
        senderNickname: String(payload.senderNickname),
        groupID: payload.groupID ? String(payload.groupID) : undefined,
        recvID: payload.recvID ? String(payload.recvID) : undefined,
        content: String(payload.content),
        operationId: row.id,
        ex: {
          ...(payload.ex && typeof payload.ex === "object" ? payload.ex : {}),
          deliveryId: row.id,
          operationId: row.id,
        },
      });
    }
    throw new Error(`Unsupported outbox topic: ${row.topic}`);
  }
}
