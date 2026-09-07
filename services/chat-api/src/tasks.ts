import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";

import type { EventPublisher } from "./events.js";
import { ApiError, parseBody, parseParams, parseQuery, requireRevision } from "./http.js";
import { enqueueOutbox } from "./outbox.js";

const idParams = z.object({ id: z.string().uuid() });
const taskStatuses = [
  "pending_review",
  "changes_requested",
  "approved",
  "queued",
  "running",
  "waiting",
  "review",
  "blocked",
  "done",
  "failed",
  "cancelled",
] as const;
const listQuery = z.object({
  status: z.enum(taskStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const statusBody = z.object({
  status: z.enum(["waiting", "review", "blocked", "done", "failed", "cancelled"]),
});
const reviewBody = z.object({
  decision: z.enum(["approved", "changes_requested", "rejected"]),
  comment: z.string().trim().max(4_000).default(""),
});
const proposalBody = z.object({
  sourceRoomId: z.string().uuid(),
  anchorMessageId: z.string().trim().min(1).max(256),
  title: z.string().trim().min(1).max(100),
  objective: z.string().trim().min(1).max(4_000),
  expectedResult: z.string().trim().min(1).max(4_000),
  plan: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
  requestedAccess: z.enum(["read", "write"]).default("read"),
  assigneeIds: z.array(z.string().uuid()).min(1).max(16),
  proposedByAgentId: z.string().uuid().optional(),
});
const proposalUpdateBody = proposalBody.pick({
  title: true,
  objective: true,
  expectedResult: true,
  plan: true,
  acceptanceCriteria: true,
  requestedAccess: true,
  proposedByAgentId: true,
});

type AgentForRun = {
  id: string;
  owner_id: string;
  openim_user_id: string;
  name: string;
  title: string;
  mention: string;
  description: string;
  workspace_access: string;
  execution_target: string;
  skill_policy: string;
  skill_refs: unknown;
  private_config: unknown;
  version: number;
};

const snapshotAgent = (agent: AgentForRun) => ({
  id: agent.id,
  name: agent.name,
  title: agent.title,
  mention: agent.mention,
  description: agent.description,
  workspaceAccess: agent.workspace_access,
  executionTarget: agent.execution_target,
  skillPolicy: agent.skill_policy,
  skillRefs: agent.skill_refs,
  privateConfig: agent.private_config,
  version: agent.version,
});

const taskSelect = `
  SELECT DISTINCT t.id, t.title, t.objective, t.expected_result AS "expectedResult",
         t.plan, t.acceptance_criteria AS "acceptanceCriteria",
         t.requested_access AS "requestedAccess", t.creator_id AS "creatorId",
         t.requested_by_user_id AS "requestedByUserId",
         t.proposed_by_agent_id AS "proposedByAgentId",
         t.source_room_id AS "sourceRoomId", t.task_room_id AS "taskRoomId",
         t.anchor_message_id AS "anchorMessageId", t.status, t.revision,
         t.approval_required AS "approvalRequired",
         t.approved_review_id AS "approvedReviewId",
         t.started_by_user_id AS "startedByUserId", t.started_at AS "startedAt",
         t.context_version AS "contextVersion", t.latest_source_seq AS "latestSourceSeq",
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
    const [assignees, runs, context, reviews] = await Promise.all([
      pool.query(
        `SELECT a.id, a.name, a.title, a.mention FROM task_assignees ta
         JOIN agents a ON a.id = ta.agent_id WHERE ta.task_id = $1`,
        [id],
      ),
      pool.query(
        `SELECT id, agent_id AS "agentId", device_id AS "deviceId", status,
                execution_target AS "executionTarget", context_version AS "contextVersion",
                attempts, output_message_id AS "outputMessageId", approval_id AS "approvalId",
                started_by_user_id AS "startedByUserId", error, started_at AS "startedAt",
                completed_at AS "completedAt", created_at AS "createdAt", updated_at AS "updatedAt"
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
      pool.query(
        `SELECT id, task_id AS "taskId", task_revision AS "taskRevision",
                reviewer_user_id AS "reviewerUserId",
                reviewer_name_snapshot AS "reviewerName", decision, comment,
                reviewed_at AS "reviewedAt"
         FROM task_reviews WHERE task_id = $1 ORDER BY reviewed_at`,
        [id],
      ),
    ]);
    return {
      ...task.rows[0],
      assignees: assignees.rows,
      runs: runs.rows,
      reviews: reviews.rows,
      contextEvents: context.rows.reverse(),
    };
  });

  app.post("/v1/tasks", { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = parseBody(proposalBody, request);
    const client = await pool.connect();
    const taskId = randomUUID();
    const taskRoomId = randomUUID();
    const taskGroupId = `grp_task_${taskRoomId.replaceAll("-", "")}`;
    try {
      await client.query("BEGIN");
      const source = await client.query<{ id: string; openim_user_id: string }>(
        `SELECT r.id, u.openim_user_id
         FROM rooms r JOIN room_members rm ON rm.room_id = r.id
         JOIN users u ON u.id = rm.user_id
         WHERE r.id = $1 AND rm.user_id = $2 AND r.archived_at IS NULL`,
        [input.sourceRoomId, request.user.sub],
      );
      if (!source.rows[0]) throw new ApiError(404, "ROOM_NOT_FOUND", "来源群不存在。");
      const agents = await client.query<AgentForRun>(
        `SELECT a.* FROM agents a JOIN room_agents ra ON ra.agent_id = a.id
         WHERE ra.room_id = $1 AND a.id = ANY($2::uuid[]) AND a.archived_at IS NULL`,
        [input.sourceRoomId, input.assigneeIds],
      );
      if (agents.rows.length !== new Set(input.assigneeIds).size) {
        throw new ApiError(400, "INVALID_ASSIGNEES", "执行 Agent 不在来源群中。");
      }
      if (
        input.proposedByAgentId &&
        !agents.rows.some((agent) => agent.id === input.proposedByAgentId)
      ) {
        throw new ApiError(400, "INVALID_PROPOSER", "提议 Agent 必须是 Task 执行人。");
      }
      const anchor = await client.query<{ seq: string }>(
        `SELECT seq FROM message_mirrors
         WHERE room_id = $1 AND server_msg_id = $2`,
        [input.sourceRoomId, input.anchorMessageId],
      );
      if (!anchor.rows[0]) {
        throw new ApiError(400, "INVALID_ANCHOR", "Task 必须关联来源群中的一条消息。");
      }
      const anchorSeq = Number(anchor.rows[0].seq);
      await client.query(
        `INSERT INTO rooms(id, owner_id, openim_group_id, type, name, source_room_id)
         VALUES ($1, $2, $3, 'task', $4, $5)`,
        [taskRoomId, request.user.sub, taskGroupId, input.title, input.sourceRoomId],
      );
      await client.query(
        "INSERT INTO room_members(room_id, user_id, role) VALUES ($1, $2, 'owner')",
        [taskRoomId, request.user.sub],
      );
      for (const agent of agents.rows) {
        await client.query(
          "INSERT INTO room_agents(room_id, agent_id, added_by) VALUES ($1, $2, $3)",
          [taskRoomId, agent.id, request.user.sub],
        );
      }
      await client.query(
        `INSERT INTO tasks(
           id, creator_id, requested_by_user_id, proposed_by_agent_id, source_room_id,
           task_room_id, anchor_message_id, title, objective, expected_result, plan,
           acceptance_criteria, requested_access, status, revision, context_version,
           latest_source_seq, approval_required
         ) VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,'pending_review',1,1,$13,true)`,
        [
          taskId,
          request.user.sub,
          input.proposedByAgentId ?? null,
          input.sourceRoomId,
          taskRoomId,
          input.anchorMessageId,
          input.title,
          input.objective,
          input.expectedResult,
          JSON.stringify(input.plan),
          JSON.stringify(input.acceptanceCriteria),
          input.requestedAccess,
          anchorSeq,
        ],
      );
      await client.query(
        `INSERT INTO task_context_events(task_id, message_id, context_version, source_seq)
         VALUES ($1, $2, 1, $3)`,
        [taskId, input.anchorMessageId, anchorSeq],
      );
      for (const agent of agents.rows) {
        await client.query("INSERT INTO task_assignees(task_id, agent_id) VALUES ($1, $2)", [
          taskId,
          agent.id,
        ]);
      }
      await enqueueOutbox(client, "openim.group.create", "room", taskRoomId, {
        groupID: taskGroupId,
        name: input.title,
        ownerUserID: source.rows[0].openim_user_id,
        memberUserIDs: [
          source.rows[0].openim_user_id,
          ...agents.rows.map((agent) => agent.openim_user_id),
        ],
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await events.publishToRoom(input.sourceRoomId, {
      type: "task.proposed",
      taskId,
      taskRoomId,
      anchorMessageId: input.anchorMessageId,
    });
    return reply.status(201).send({ id: taskId, taskRoomId, status: "pending_review" });
  });

  app.patch("/v1/tasks/:id/proposal", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = parseParams(idParams, request);
    const input = parseBody(proposalUpdateBody, request);
    const revision = requireRevision(request);
    const client = await pool.connect();
    let taskRoomId = "";
    try {
      await client.query("BEGIN");
      const task = await client.query<{ task_room_id: string; revision: number; status: string }>(
        `SELECT t.task_room_id, t.revision, t.status
         FROM tasks t JOIN room_members rm ON rm.room_id = t.task_room_id
         WHERE t.id = $1 AND rm.user_id = $2 FOR UPDATE`,
        [id, request.user.sub],
      );
      if (!task.rows[0]) throw new ApiError(404, "TASK_NOT_FOUND", "Task 不存在。");
      if (task.rows[0].revision !== revision) {
        throw new ApiError(409, "REVISION_CONFLICT", "Task 已被修改，请基于最新版本更新。");
      }
      if (!["pending_review", "changes_requested", "approved"].includes(task.rows[0].status)) {
        throw new ApiError(409, "TASK_NOT_EDITABLE", "执行中的 Task 不能修改方案。");
      }
      if (input.proposedByAgentId) {
        const proposer = await client.query(
          "SELECT 1 FROM task_assignees WHERE task_id = $1 AND agent_id = $2",
          [id, input.proposedByAgentId],
        );
        if (!proposer.rowCount) {
          throw new ApiError(400, "INVALID_PROPOSER", "提议 Agent 必须是 Task 执行人。");
        }
      }
      taskRoomId = task.rows[0].task_room_id;
      await client.query(
        `UPDATE tasks SET title = $1, objective = $2, expected_result = $3,
                plan = $4::jsonb, acceptance_criteria = $5::jsonb,
                requested_access = $6,
                proposed_by_agent_id = COALESCE($7, proposed_by_agent_id),
                revision = revision + 1, status = 'pending_review',
                approved_review_id = NULL, updated_at = now()
         WHERE id = $8`,
        [
          input.title,
          input.objective,
          input.expectedResult,
          JSON.stringify(input.plan),
          JSON.stringify(input.acceptanceCriteria),
          input.requestedAccess,
          input.proposedByAgentId ?? null,
          id,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await events.publishToRoom(taskRoomId, {
      type: "task.proposal.updated",
      taskId: id,
      revision: revision + 1,
    });
    return { id, status: "pending_review", revision: revision + 1 };
  });

  app.post("/v1/tasks/:id/reviews", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = parseParams(idParams, request);
    const input = parseBody(reviewBody, request);
    const revision = requireRevision(request);
    const client = await pool.connect();
    let review: Record<string, unknown>;
    let taskRoomId = "";
    try {
      await client.query("BEGIN");
      const task = await client.query<{
        task_room_id: string;
        revision: number;
        title: string;
        objective: string;
        expected_result: string;
        plan: unknown;
        acceptance_criteria: unknown;
        requested_access: string;
        status: string;
      }>(
        `SELECT t.* FROM tasks t JOIN room_members rm ON rm.room_id = t.task_room_id
         WHERE t.id = $1 AND rm.user_id = $2 FOR UPDATE`,
        [id, request.user.sub],
      );
      if (!task.rows[0]) throw new ApiError(404, "TASK_NOT_FOUND", "Task 不存在。");
      if (task.rows[0].revision !== revision) {
        throw new ApiError(409, "REVISION_CONFLICT", "Task 已被修改，请重新审核最新版本。");
      }
      if (!["pending_review", "changes_requested", "approved"].includes(task.rows[0].status)) {
        throw new ApiError(409, "TASK_NOT_REVIEWABLE", "当前 Task 状态不允许审核。");
      }
      const user = await client.query<{ display_name: string }>(
        "SELECT display_name FROM users WHERE id = $1",
        [request.user.sub],
      );
      const snapshot = {
        title: task.rows[0].title,
        objective: task.rows[0].objective,
        expectedResult: task.rows[0].expected_result,
        plan: task.rows[0].plan,
        acceptanceCriteria: task.rows[0].acceptance_criteria,
        requestedAccess: task.rows[0].requested_access,
      };
      const inserted = await client.query(
        `INSERT INTO task_reviews(
           task_id, task_revision, reviewer_user_id, reviewer_name_snapshot,
           decision, comment, task_snapshot
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         RETURNING id, task_id AS "taskId", task_revision AS "taskRevision",
                   reviewer_user_id AS "reviewerUserId",
                   reviewer_name_snapshot AS "reviewerName", decision, comment,
                   reviewed_at AS "reviewedAt"`,
        [
          id,
          revision,
          request.user.sub,
          user.rows[0]?.display_name ?? "用户",
          input.decision,
          input.comment,
          JSON.stringify(snapshot),
        ],
      );
      review = inserted.rows[0];
      taskRoomId = task.rows[0].task_room_id;
      await client.query(
        `UPDATE tasks SET status = $1, approved_review_id = $2, updated_at = now()
         WHERE id = $3`,
        [
          input.decision === "approved"
            ? "approved"
            : input.decision === "changes_requested"
              ? "changes_requested"
              : "cancelled",
          input.decision === "approved" ? inserted.rows[0].id : null,
          id,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await events.publishToRoom(taskRoomId, { type: "task.reviewed", taskId: id, review });
    return review;
  });

  app.post("/v1/tasks/:id/start", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = parseParams(idParams, request);
    const revision = requireRevision(request);
    const client = await pool.connect();
    let taskRoomId = "";
    const owners = new Set<string>();
    const runIds: string[] = [];
    try {
      await client.query("BEGIN");
      const task = await client.query<{
        task_room_id: string;
        revision: number;
        status: string;
        approved_review_id: string | null;
        context_version: number;
        requested_access: string;
      }>(
        `SELECT t.task_room_id, t.revision, t.status, t.approved_review_id, t.context_version,
                t.requested_access
         FROM tasks t JOIN room_members rm ON rm.room_id = t.task_room_id
         WHERE t.id = $1 AND rm.user_id = $2 FOR UPDATE`,
        [id, request.user.sub],
      );
      if (!task.rows[0]) throw new ApiError(404, "TASK_NOT_FOUND", "Task 不存在。");
      if (task.rows[0].revision !== revision) {
        throw new ApiError(409, "REVISION_CONFLICT", "Task 已被修改，请重新审核最新版本。");
      }
      if (task.rows[0].status !== "approved" || !task.rows[0].approved_review_id) {
        throw new ApiError(409, "REVIEW_REQUIRED", "当前版本尚未通过人工审核。");
      }
      const approval = await client.query(
        `SELECT id FROM task_reviews
         WHERE id = $1 AND task_id = $2 AND task_revision = $3 AND decision = 'approved'`,
        [task.rows[0].approved_review_id, id, revision],
      );
      if (!approval.rowCount) {
        throw new ApiError(409, "REVIEW_STALE", "审核记录与当前 Task 版本不一致。");
      }
      const agents = await client.query<AgentForRun>(
        `SELECT a.* FROM task_assignees ta JOIN agents a ON a.id = ta.agent_id
         WHERE ta.task_id = $1 AND a.archived_at IS NULL`,
        [id],
      );
      if (!agents.rows.length) throw new ApiError(409, "NO_ASSIGNEES", "Task 没有执行 Agent。");
      for (const agent of agents.rows) {
        const runId = randomUUID();
        runIds.push(runId);
        owners.add(agent.owner_id);
        await client.query(
          `INSERT INTO task_runs(
             id, task_id, agent_id, status, execution_target, context_version,
             agent_snapshot, approval_id, started_by_user_id
           ) VALUES ($1,$2,$3,'queued',$4,$5,$6::jsonb,$7,$8)`,
          [
            runId,
            id,
            agent.id,
            agent.execution_target,
            task.rows[0].context_version,
            JSON.stringify({
              ...snapshotAgent(agent),
              workspaceAccess:
                task.rows[0].requested_access === "write" && agent.workspace_access === "write"
                  ? "write"
                  : "read",
            }),
            task.rows[0].approved_review_id,
            request.user.sub,
          ],
        );
      }
      taskRoomId = task.rows[0].task_room_id;
      await client.query(
        `UPDATE tasks SET status = 'queued', started_by_user_id = $1,
                started_at = now(), updated_at = now() WHERE id = $2`,
        [request.user.sub, id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await events.publishToRoom(taskRoomId, {
      type: "task.started",
      taskId: id,
      startedByUserId: request.user.sub,
      runIds,
    });
    for (const owner of owners) await events.dispatchQueued(owner);
    return { id, status: "queued", runIds };
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
