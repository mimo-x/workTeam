import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";

import type { EventPublisher } from "./events.js";
import { ApiError, parseBody, parseParams, parseQuery } from "./http.js";

const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  status: z
    .enum(["queued", "running", "waiting", "review", "blocked", "done", "failed", "cancelled"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const statusBody = z.object({
  status: z.enum([
    "queued",
    "running",
    "waiting",
    "review",
    "blocked",
    "done",
    "failed",
    "cancelled",
  ]),
});

const taskSelect = `
  SELECT DISTINCT t.id, t.title, t.creator_id AS "creatorId", t.source_room_id AS "sourceRoomId",
         t.task_room_id AS "taskRoomId", t.anchor_message_id AS "anchorMessageId",
         t.status, t.context_version AS "contextVersion", t.latest_source_seq AS "latestSourceSeq",
         t.created_at AS "createdAt", t.updated_at AS "updatedAt"
  FROM tasks t`;

export const registerTaskRoutes = (app: FastifyInstance, pool: pg.Pool, events: EventPublisher) => {
  app.get("/v1/tasks", { preHandler: [app.authenticate] }, async (request) => {
    const { status, limit } = parseQuery(listQuery, request);
    const result = await pool.query(
      `${taskSelect}
       JOIN room_members rm ON rm.room_id = t.source_room_id OR rm.room_id = t.task_room_id
       WHERE rm.user_id = $1 AND ($2::text IS NULL OR t.status = $2)
       ORDER BY t.updated_at DESC LIMIT $3`,
      [request.user.sub, status ?? null, limit],
    );
    return { data: result.rows };
  });

  app.get("/v1/tasks/:id", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = parseParams(idParams, request);
    const task = await pool.query(
      `${taskSelect}
       JOIN room_members rm ON rm.room_id = t.source_room_id OR rm.room_id = t.task_room_id
       WHERE t.id = $1 AND rm.user_id = $2`,
      [id, request.user.sub],
    );
    if (!task.rows[0]) throw new ApiError(404, "TASK_NOT_FOUND", "Task 不存在。");
    const [assignees, runs, context] = await Promise.all([
      pool.query(
        `SELECT a.id, a.name, a.title, a.mention FROM task_assignees ta
         JOIN agents a ON a.id = ta.agent_id WHERE ta.task_id = $1`,
        [id],
      ),
      pool.query(
        `SELECT id, agent_id AS "agentId", device_id AS "deviceId", status, execution_target AS "executionTarget",
                context_version AS "contextVersion", attempts, output_message_id AS "outputMessageId", error,
                started_at AS "startedAt", completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM task_runs WHERE task_id = $1 ORDER BY created_at`,
        [id],
      ),
      pool.query(
        `SELECT tce.message_id AS "messageId", tce.context_version AS "contextVersion",
                tce.source_seq AS "sourceSeq", tce.created_at AS "createdAt", m.content,
                m.sender_openim_id AS "senderId"
         FROM task_context_events tce LEFT JOIN message_mirrors m ON m.server_msg_id = tce.message_id
         WHERE tce.task_id = $1 ORDER BY tce.context_version DESC LIMIT 200`,
        [id],
      ),
    ]);
    return {
      ...task.rows[0],
      assignees: assignees.rows,
      runs: runs.rows,
      contextEvents: context.rows.reverse(),
    };
  });

  app.patch("/v1/tasks/:id/status", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = parseParams(idParams, request);
    const { status } = parseBody(statusBody, request);
    const result = await pool.query<{ task_room_id: string }>(
      `UPDATE tasks t SET status = $1, updated_at = now()
       WHERE t.id = $2 AND EXISTS (
         SELECT 1 FROM room_members rm WHERE rm.room_id = t.task_room_id AND rm.user_id = $3
       ) RETURNING task_room_id`,
      [status, id, request.user.sub],
    );
    if (!result.rows[0]) throw new ApiError(404, "TASK_NOT_FOUND", "Task 不存在。");
    await events.publishToRoom(result.rows[0].task_room_id, {
      type: "task.updated",
      taskId: id,
      status,
    });
    return { id, status };
  });
};
