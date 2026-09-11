import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";

import { appendCollaborationAudit } from "./collaboration-audit.js";
import type { EventPublisher } from "./events.js";
import { ApiError, parseBody, parseParams, parseQuery, requireRevision } from "./http.js";
import { enqueueOutbox } from "./outbox.js";
import { agentScopesForTask, currentTaskGrant } from "./task-permissions.js";
import {
  aggregateTaskCompletionSummaries,
  formatTaskCompletionMessage,
  normalizeCompletionArtifactRefs,
} from "./task-completion-summary.js";

const idParams = z.object({ id: z.string().uuid() });
const taskStatuses = [
  "pending_review",
  "changes_requested",
  "approved",
  "queued",
  "running",
  "waiting",
  "waiting_for_host",
  "waiting_for_permission",
  "waiting_for_approval",
  "waiting_for_assignee",
  "waiting_for_budget",
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
const budgetBody = z.object({
  maxDepth: z.number().int().min(0).max(8),
  maxDescendants: z.number().int().min(0).max(100),
  maxRuns: z.number().int().min(1).max(500),
  maxWallTimeMs: z.number().int().min(60_000).max(86_400_000),
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
  requestedScopes: z
    .array(z.enum(["workspace.read", "workspace.write", "command.run", "network.read"]))
    .max(4)
    .optional(),
  assigneeIds: z.array(z.string().uuid()).min(1).max(16),
  proposedByAgentId: z.string().uuid().optional(),
  parentTaskId: z.string().uuid().optional(),
});
const proposalUpdateBody = proposalBody.pick({
  title: true,
  objective: true,
  expectedResult: true,
  plan: true,
  acceptanceCriteria: true,
  requestedAccess: true,
  requestedScopes: true,
  proposedByAgentId: true,
});

const governedScopes = (input: {
  requestedAccess: "read" | "write";
  requestedScopes?: string[];
}) => {
  const scopes = new Set(input.requestedScopes ?? []);
  scopes.add("workspace.read");
  if (input.requestedAccess === "write") scopes.add("workspace.write");
  return [...scopes];
};

const requireAdminRole = (role: string | null | undefined) => {
  if (role !== "owner" && role !== "admin") {
    throw new ApiError(403, "ROOM_ADMIN_REQUIRED", "只有群主或管理员可以执行此操作。");
  }
};

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
  provider: string;
  protocol: string;
  runtime_model: string | null;
  runtime_endpoint: string | null;
  runtime_command: string | null;
  runtime_args: string[];
  runtime_auth: string;
  capabilities: unknown;
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
  provider: agent.provider,
  protocol: agent.protocol,
  model: agent.runtime_model,
  runtimeEndpoint: agent.runtime_endpoint,
  runtimeCommand: agent.runtime_command,
  runtimeArgs: agent.runtime_args,
  runtimeAuth: agent.runtime_auth,
  capabilities: agent.capabilities,
  skillPolicy: agent.skill_policy,
  skillRefs: agent.skill_refs,
  privateConfig: agent.private_config,
  version: agent.version,
});

const taskSelect = `
  SELECT DISTINCT t.id, t.title, t.objective, t.expected_result AS "expectedResult",
         t.plan, t.acceptance_criteria AS "acceptanceCriteria",
         t.requested_access AS "requestedAccess", t.requested_scopes AS "requestedScopes",
         t.creator_id AS "creatorId",
         t.requested_by_user_id AS "requestedByUserId",
         t.proposed_by_agent_id AS "proposedByAgentId",
         t.source_room_id AS "sourceRoomId", t.task_room_id AS "taskRoomId",
         t.anchor_message_id AS "anchorMessageId", t.status, t.revision,
         t.approval_required AS "approvalRequired",
         t.approved_review_id AS "approvedReviewId",
         t.started_by_user_id AS "startedByUserId", t.started_at AS "startedAt",
         t.workspace_binding_id AS "workspaceBindingId",
         t.binding_revision AS "workspaceBindingRevision",
         t.parent_task_id AS "parentTaskId", t.root_task_id AS "rootTaskId",
         t.delegated_by_agent_id AS "delegatedByAgentId", t.depth,
         t.budget, t.budget_usage AS "budgetUsage", t.wait_reason AS "waitReason",
         t.artifact_refs AS "artifactRefs",
         t.completion_summary AS "completionSummary",
         t.source_summary_published_at AS "sourceSummaryPublishedAt",
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
         WHERE ra.room_id = $1
           AND a.id IN (${input.assigneeIds.map((_, index) => `$${index + 2}`).join(",")})
           AND a.archived_at IS NULL`,
        [input.sourceRoomId, ...input.assigneeIds],
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
      const bindingSnapshot = input.parentTaskId
        ? await client.query<{
            workspace_binding_id: string | null;
            binding_revision: number | null;
            root_task_id: string;
            depth: number;
          }>(
            `SELECT workspace_binding_id, binding_revision, root_task_id, depth
             FROM tasks WHERE id = $1 AND source_room_id = $2`,
            [input.parentTaskId, input.sourceRoomId],
          )
        : await client.query<{
            workspace_binding_id: string | null;
            binding_revision: number | null;
            root_task_id: string;
            depth: number;
          }>(
            `SELECT rwb.workspace_binding_id, rwb.binding_revision,
                    NULL::uuid AS root_task_id, -1 AS depth
             FROM room_workspace_bindings rwb
             WHERE rwb.room_id = $1 AND rwb.status = 'active'`,
            [input.sourceRoomId],
          );
      if (input.parentTaskId && !bindingSnapshot.rows[0]) {
        throw new ApiError(400, "INVALID_PARENT_TASK", "父 Task 不属于当前来源群。");
      }
      const inherited = bindingSnapshot.rows[0];
      const requestedScopes = governedScopes(input);
      const rootTaskId = input.parentTaskId
        ? (inherited?.root_task_id ?? input.parentTaskId)
        : null;
      let rootBudgetUsage: { descendants: number; runs: number; startedAt: number } | undefined;
      if (rootTaskId) {
        const root = await client.query<{
          budget: {
            maxDepth: number;
            maxDescendants: number;
            maxRuns: number;
            maxWallTimeMs: number;
          };
          budget_usage: { startedAt?: number };
          started_at: Date | null;
        }>("SELECT budget, budget_usage, started_at FROM tasks WHERE id = $1 FOR UPDATE", [
          rootTaskId,
        ]);
        const nextDepth = (inherited?.depth ?? -1) + 1;
        if (nextDepth > root.rows[0].budget.maxDepth) {
          throw new ApiError(409, "TASK_DEPTH_BUDGET_EXHAUSTED", "子 Task 已达到委派深度上限。");
        }
        const [descendants, runs] = await Promise.all([
          client.query<{ count: string }>(
            "SELECT count(*) AS count FROM tasks WHERE root_task_id = $1 AND id <> $1",
            [rootTaskId],
          ),
          client.query<{ count: string }>(
            `SELECT count(*) AS count FROM task_runs tr
             JOIN tasks t ON t.id = tr.task_id WHERE t.root_task_id = $1`,
            [rootTaskId],
          ),
        ]);
        const descendantCount = Number(descendants.rows[0]?.count ?? 0);
        if (descendantCount + 1 > root.rows[0].budget.maxDescendants) {
          throw new ApiError(
            409,
            "TASK_DESCENDANT_BUDGET_EXHAUSTED",
            "根 Task 的子 Task 数量预算已耗尽。",
          );
        }
        const startedAt =
          root.rows[0].budget_usage?.startedAt ?? root.rows[0].started_at?.getTime() ?? Date.now();
        if (root.rows[0].started_at && Date.now() - startedAt > root.rows[0].budget.maxWallTimeMs) {
          throw new ApiError(409, "TASK_TIME_BUDGET_EXHAUSTED", "根 Task 的运行时长预算已耗尽。");
        }
        rootBudgetUsage = {
          descendants: descendantCount + 1,
          runs: Number(runs.rows[0]?.count ?? 0),
          startedAt,
        };
      }
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
           acceptance_criteria, requested_access, requested_scopes, status, revision,
           context_version, latest_source_seq, approval_required, workspace_binding_id,
           binding_revision, parent_task_id, root_task_id, depth
         ) VALUES (
           $1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13::jsonb,
           'pending_review',1,1,$14,true,$15,$16,$17,$18,$19
         )`,
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
          JSON.stringify(requestedScopes),
          anchorSeq,
          inherited?.workspace_binding_id ?? null,
          inherited?.binding_revision ?? null,
          input.parentTaskId ?? null,
          rootTaskId,
          (inherited?.depth ?? -1) + 1,
        ],
      );
      if (!rootTaskId) {
        await client.query("UPDATE tasks SET root_task_id = id WHERE id = $1", [taskId]);
      } else if (rootBudgetUsage) {
        await client.query("UPDATE tasks SET budget_usage = $1::jsonb WHERE id = $2", [
          JSON.stringify(rootBudgetUsage),
          rootTaskId,
        ]);
      }
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
      await appendCollaborationAudit(client, {
        actorUserId: request.user.sub,
        actorAgentId: input.proposedByAgentId,
        roomId: input.sourceRoomId,
        taskId,
        taskRevision: 1,
        eventType: input.parentTaskId ? "task.delegated" : "task.proposed",
        summary: input.parentTaskId
          ? `已创建子 Task“${input.title}”，等待审核。`
          : `已提出 Task“${input.title}”，等待审核。`,
        outcome: "pending_review",
        metadata: {
          parentTaskId: input.parentTaskId ?? null,
          assigneeIds: input.assigneeIds,
          scopes: requestedScopes,
        },
      });
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
      const task = await client.query<{
        task_room_id: string;
        source_room_id: string;
        revision: number;
        status: string;
      }>(
        `SELECT t.task_room_id, t.source_room_id, t.revision, t.status
         FROM tasks t JOIN room_members rm ON rm.room_id = t.source_room_id
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
                requested_access = $6, requested_scopes = $7::jsonb,
                proposed_by_agent_id = COALESCE($8, proposed_by_agent_id),
                revision = revision + 1, status = 'pending_review',
                approved_review_id = NULL, updated_at = now()
         WHERE id = $9`,
        [
          input.title,
          input.objective,
          input.expectedResult,
          JSON.stringify(input.plan),
          JSON.stringify(input.acceptanceCriteria),
          input.requestedAccess,
          JSON.stringify(governedScopes(input)),
          input.proposedByAgentId ?? null,
          id,
        ],
      );
      await client.query(
        `UPDATE task_permission_grants SET revoked_at = now()
         WHERE task_id = $1 AND revoked_at IS NULL`,
        [id],
      );
      await appendCollaborationAudit(client, {
        actorUserId: request.user.sub,
        roomId: task.rows[0].source_room_id,
        taskId: id,
        taskRevision: revision + 1,
        eventType: "task.proposal_updated",
        summary: `Task 方案已更新为 v${revision + 1}，旧审核与权限已失效。`,
        outcome: "pending_review",
      });
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

  app.patch("/v1/tasks/:id/budget", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = parseParams(idParams, request);
    const budget = parseBody(budgetBody, request);
    const revision = requireRevision(request);
    const client = await pool.connect();
    let taskRoomId = "";
    try {
      await client.query("BEGIN");
      const task = await client.query<{
        revision: number;
        task_room_id: string;
        source_room_id: string;
        member_role: string;
      }>(
        `SELECT t.revision, t.task_room_id, t.source_room_id, rm.role AS member_role FROM tasks t
         JOIN room_members rm ON rm.room_id = t.source_room_id
         WHERE t.id = $1 AND rm.user_id = $2 FOR UPDATE`,
        [id, request.user.sub],
      );
      if (!task.rows[0]) throw new ApiError(404, "TASK_NOT_FOUND", "Task 不存在。");
      requireAdminRole(task.rows[0].member_role);
      if (task.rows[0].revision !== revision) {
        throw new ApiError(409, "REVISION_CONFLICT", "Task 已被修改，请刷新后重试。");
      }
      taskRoomId = task.rows[0].task_room_id;
      await client.query(
        `UPDATE tasks SET budget = $1::jsonb, revision = revision + 1,
                status = 'pending_review', approved_review_id = NULL,
                wait_reason = '任务预算已修改，请重新审核。', updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(budget), id],
      );
      await client.query(
        "UPDATE task_permission_grants SET revoked_at = now() WHERE task_id = $1 AND revoked_at IS NULL",
        [id],
      );
      await appendCollaborationAudit(client, {
        actorUserId: request.user.sub,
        roomId: task.rows[0].source_room_id,
        taskId: id,
        taskRevision: revision + 1,
        eventType: "task.budget_updated",
        summary: `Task 预算已更新，方案升至 v${revision + 1} 并等待重新审核。`,
        outcome: "pending_review",
        metadata: { budget },
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await events.publishToRoom(taskRoomId, {
      type: "task.budget.updated",
      taskId: id,
      revision: revision + 1,
      budget,
    });
    return { id, revision: revision + 1, status: "pending_review", budget };
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
        source_room_id: string;
        revision: number;
        title: string;
        objective: string;
        expected_result: string;
        plan: unknown;
        acceptance_criteria: unknown;
        requested_access: string;
        requested_scopes: string[];
        status: string;
        member_role: string;
      }>(
        `SELECT t.*, rm.role AS member_role FROM tasks t
         JOIN room_members rm ON rm.room_id = t.source_room_id
         WHERE t.id = $1 AND rm.user_id = $2 FOR UPDATE`,
        [id, request.user.sub],
      );
      if (!task.rows[0]) throw new ApiError(404, "TASK_NOT_FOUND", "Task 不存在。");
      requireAdminRole(task.rows[0].member_role);
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
        requestedScopes: task.rows[0].requested_scopes,
      };
      const inserted = await client.query(
        `INSERT INTO task_reviews(
           task_id, task_revision, reviewer_user_id, reviewer_name_snapshot,
           reviewer_role, decision, comment, task_snapshot
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         RETURNING id, task_id AS "taskId", task_revision AS "taskRevision",
                   reviewer_user_id AS "reviewerUserId",
                   reviewer_name_snapshot AS "reviewerName", decision, comment,
                   reviewed_at AS "reviewedAt"`,
        [
          id,
          revision,
          request.user.sub,
          user.rows[0]?.display_name ?? "用户",
          task.rows[0].member_role,
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
      await appendCollaborationAudit(client, {
        actorUserId: request.user.sub,
        roomId: task.rows[0].source_room_id,
        taskId: id,
        taskRevision: revision,
        eventType: "task.reviewed",
        summary: `Task v${revision} 审核结果：${input.decision}。`,
        outcome: input.decision,
        metadata: { reviewerRole: task.rows[0].member_role },
      });
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

  app.post("/v1/tasks/:id/start", { preHandler: [app.authenticate] }, async (request, reply) => {
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
        source_room_id: string;
        revision: number;
        status: string;
        approved_review_id: string | null;
        context_version: number;
        requested_access: string;
        requested_scopes: Array<
          "workspace.read" | "workspace.write" | "command.run" | "network.read"
        >;
        workspace_binding_id: string | null;
        binding_revision: number | null;
        host_device_id: string | null;
        host_user_id: string | null;
        binding_status: string | null;
        binding_revoked_at: Date | null;
        current_binding_revision: number | null;
        baseline_scopes: string[] | null;
        member_role: string;
        root_task_id: string;
      }>(
        `SELECT t.task_room_id, t.source_room_id, t.revision, t.status,
                t.approved_review_id, t.context_version,
                t.requested_access, t.requested_scopes, t.workspace_binding_id,
                t.binding_revision, wb.device_id AS host_device_id,
                wb.user_id AS host_user_id,
                wb.status AS binding_status, wb.revoked_at AS binding_revoked_at,
                wb.revision AS current_binding_revision, wb.baseline_scopes,
                rm.role AS member_role, t.root_task_id
         FROM tasks t JOIN room_members rm ON rm.room_id = t.source_room_id
         LEFT JOIN workspace_bindings wb ON wb.id = t.workspace_binding_id
         WHERE t.id = $1 AND rm.user_id = $2 FOR UPDATE`,
        [id, request.user.sub],
      );
      if (!task.rows[0]) throw new ApiError(404, "TASK_NOT_FOUND", "Task 不存在。");
      requireAdminRole(task.rows[0].member_role);
      taskRoomId = task.rows[0].task_room_id;
      if (task.rows[0].revision !== revision) {
        throw new ApiError(409, "REVISION_CONFLICT", "Task 已被修改，请重新审核最新版本。");
      }
      if (task.rows[0].status === "queued" || task.rows[0].status === "running") {
        const existingRuns = await client.query<{ id: string }>(
          `SELECT id FROM task_runs
           WHERE task_id = $1 AND idempotency_key LIKE $2
           ORDER BY created_at`,
          [id, `task:${id}:revision:${revision}:%`],
        );
        if (existingRuns.rows.length) {
          await client.query("COMMIT");
          return reply.send({
            id,
            status: task.rows[0].status,
            runIds: existingRuns.rows.map((run) => run.id),
            reused: true,
          });
        }
      }
      if (task.rows[0].status !== "approved" || !task.rows[0].approved_review_id) {
        throw new ApiError(409, "REVIEW_REQUIRED", "当前版本尚未通过人工审核。");
      }
      const approval = await client.query(
        `SELECT tr.id FROM task_reviews tr
         JOIN tasks approved_task ON approved_task.id = tr.task_id
         JOIN room_members reviewer ON reviewer.room_id = approved_task.source_room_id
           AND reviewer.user_id = tr.reviewer_user_id
         WHERE tr.id = $1 AND tr.task_id = $2 AND tr.task_revision = $3
           AND tr.decision = 'approved' AND reviewer.role IN ('owner', 'admin')`,
        [task.rows[0].approved_review_id, id, revision],
      );
      if (!approval.rowCount) {
        throw new ApiError(409, "REVIEW_STALE", "审核记录与当前 Task 版本不一致。");
      }
      const waitForGate = async (
        status:
          | "waiting_for_host"
          | "waiting_for_permission"
          | "waiting_for_assignee"
          | "waiting_for_budget",
        code: string,
        message: string,
      ) => {
        await client.query(
          "UPDATE tasks SET status = $1, wait_reason = $2, updated_at = now() WHERE id = $3",
          [status, message, id],
        );
        await appendCollaborationAudit(client, {
          actorUserId: request.user.sub,
          roomId: task.rows[0].source_room_id,
          taskId: id,
          taskRevision: revision,
          hostDeviceId: task.rows[0].host_device_id ?? undefined,
          eventType: "task.execution_denied",
          summary: message,
          outcome: status,
          metadata: { code },
        });
        await client.query("COMMIT");
        await events.publishToRoom(taskRoomId, {
          type: "task.waiting",
          taskId: id,
          status,
          reason: message,
        });
        return reply.status(409).send({ error: { code, message }, id, status });
      };
      if (
        !task.rows[0].workspace_binding_id ||
        !task.rows[0].host_device_id ||
        task.rows[0].binding_revoked_at ||
        task.rows[0].binding_revision !== task.rows[0].current_binding_revision
      ) {
        return await waitForGate(
          "waiting_for_host",
          "WORKSPACE_BINDING_REQUIRED",
          "Task 需要当前有效的项目主机绑定。",
        );
      }
      if (task.rows[0].binding_status !== "online") {
        return await waitForGate(
          "waiting_for_host",
          "HOST_OFFLINE",
          "项目主机当前离线，恢复在线后可继续。",
        );
      }
      const baselineScopes = new Set(task.rows[0].baseline_scopes ?? []);
      const scopeOutsideRoom = task.rows[0].requested_scopes.find(
        (scope) => !baselineScopes.has(scope),
      );
      if (scopeOutsideRoom) {
        return await waitForGate(
          "waiting_for_permission",
          "ROOM_SCOPE_EXCEEDED",
          `项目主机尚未向群组开放 ${scopeOutsideRoom}。`,
        );
      }
      const permissionGrant = await currentTaskGrant(client, {
        taskId: id,
        taskRevision: revision,
        workspaceBindingId: task.rows[0].workspace_binding_id,
        bindingRevision: task.rows[0].binding_revision!,
        requiredScopes: task.rows[0].requested_scopes,
      });
      if (
        task.rows[0].requested_scopes.some((scope) => scope !== "workspace.read") &&
        !permissionGrant
      ) {
        return await waitForGate(
          "waiting_for_permission",
          "HOST_GRANT_REQUIRED",
          "当前 Task revision 尚未获得项目主机权限授权。",
        );
      }
      const agents = await client.query<AgentForRun>(
        `SELECT a.* FROM task_assignees ta JOIN agents a ON a.id = ta.agent_id
         JOIN room_agents ra ON ra.agent_id = a.id AND ra.room_id = $2
         WHERE ta.task_id = $1 AND a.archived_at IS NULL`,
        [id, task.rows[0].source_room_id],
      );
      const assigneeCount = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM task_assignees WHERE task_id = $1",
        [id],
      );
      if (!agents.rows.length || agents.rows.length !== Number(assigneeCount.rows[0].count)) {
        return await waitForGate(
          "waiting_for_assignee",
          "ASSIGNEE_UNAVAILABLE",
          "执行 Agent 已离开群聊、停用或不存在，请重新分派。",
        );
      }
      if (agents.rows.some((agent) => agent.execution_target !== "local")) {
        throw new ApiError(
          409,
          "UNSUPPORTED_EXECUTION_TARGET",
          "Task 包含托管 Agent，但云端 Worker 尚未接入。",
        );
      }
      const agentScopes = await agentScopesForTask(client, id);
      const missingAgentScope = task.rows[0].requested_scopes.find(
        (scope) => !agentScopes.has(scope),
      );
      if (missingAgentScope) {
        return await waitForGate(
          "waiting_for_assignee",
          "AGENT_CAPABILITY_MISSING",
          `至少一个执行 Agent 不具备 ${missingAgentScope} 能力，请重新分派。`,
        );
      }
      const root = await client.query<{
        budget: {
          maxDepth: number;
          maxDescendants: number;
          maxRuns: number;
          maxWallTimeMs: number;
        };
        budget_usage: { descendants?: number; runs?: number; startedAt?: number };
        started_at: Date | null;
      }>("SELECT budget, budget_usage, started_at FROM tasks WHERE id = $1 FOR UPDATE", [
        task.rows[0].root_task_id,
      ]);
      const budget = root.rows[0].budget;
      const usage = root.rows[0].budget_usage ?? {};
      const runCount = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM task_runs tr
         JOIN tasks t ON t.id = tr.task_id WHERE t.root_task_id = $1`,
        [task.rows[0].root_task_id],
      );
      const currentRuns = Number(runCount.rows[0]?.count ?? 0);
      const startedAt = usage.startedAt ?? root.rows[0].started_at?.getTime() ?? Date.now();
      if (Date.now() - startedAt > budget.maxWallTimeMs) {
        return await waitForGate(
          "waiting_for_budget",
          "TASK_TIME_BUDGET_EXHAUSTED",
          "根 Task 的运行时长预算已耗尽。",
        );
      }
      if (currentRuns + agents.rows.length > budget.maxRuns) {
        return await waitForGate(
          "waiting_for_budget",
          "TASK_RUN_BUDGET_EXHAUSTED",
          `根 Task 的 Agent Run 上限为 ${budget.maxRuns}。`,
        );
      }
      for (const agent of agents.rows) {
        const runId = randomUUID();
        runIds.push(runId);
        await client.query(
          `INSERT INTO task_runs(
             id, task_id, agent_id, status, execution_target, context_version,
             agent_snapshot, approval_id, started_by_user_id, target_device_id,
             permission_grant_id, idempotency_key, requested_scopes, write_intent
           ) VALUES (
             $1,$2,$3,'queued',$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb,$13
           )`,
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
            task.rows[0].host_device_id,
            permissionGrant?.id ?? null,
            `task:${id}:revision:${revision}:agent:${agent.id}`,
            JSON.stringify(task.rows[0].requested_scopes),
            task.rows[0].requested_scopes.includes("workspace.write"),
          ],
        );
      }
      owners.add(task.rows[0].host_user_id!);
      await client.query("UPDATE tasks SET budget_usage = $1::jsonb WHERE id = $2", [
        JSON.stringify({
          ...usage,
          runs: currentRuns + agents.rows.length,
          descendants: usage.descendants ?? 0,
          startedAt,
        }),
        task.rows[0].root_task_id,
      ]);
      await client.query(
        `UPDATE tasks SET status = 'queued', started_by_user_id = $1,
                started_at = now(), wait_reason = NULL, updated_at = now() WHERE id = $2`,
        [request.user.sub, id],
      );
      await appendCollaborationAudit(client, {
        actorUserId: request.user.sub,
        roomId: task.rows[0].source_room_id,
        taskId: id,
        taskRevision: revision,
        hostDeviceId: task.rows[0].host_device_id,
        eventType: "task.execution_started",
        summary: `Task v${revision} 已通过双重授权并创建 ${runIds.length} 个 Run。`,
        outcome: "queued",
        metadata: { runIds, scopes: task.rows[0].requested_scopes },
      });
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
    const client = await pool.connect();
    let task: {
      task_room_id: string;
      source_room_id: string;
      source_group_id: string | null;
      parent_task_id: string | null;
      member_role: string;
      status: string;
      title: string;
      completion_summary: string | null;
      artifact_refs: string[];
      source_summary_published_at: Date | null;
    };
    let parentUpdate: {
      id: string;
      taskRoomId: string;
      sourceRoomId: string;
      status: string;
      artifactRefs: string[];
    } | null = null;
    let summaryPublication: {
      sourceRoomId: string;
      taskId: string;
      artifactRefs: string[];
    } | null = null;
    try {
      await client.query("BEGIN");
      const found = await client.query<typeof task>(
        `SELECT t.task_room_id, t.source_room_id, source_room.openim_group_id AS source_group_id,
                t.parent_task_id, t.status, t.title, t.completion_summary, t.artifact_refs,
                t.source_summary_published_at, rm.role AS member_role FROM tasks t
         JOIN room_members rm ON rm.room_id = t.source_room_id
         JOIN rooms source_room ON source_room.id = t.source_room_id
         WHERE t.id = $1 AND rm.user_id = $2 FOR UPDATE`,
        [id, request.user.sub],
      );
      if (!found.rows[0]) throw new ApiError(404, "TASK_NOT_FOUND", "Task 不存在。");
      task = found.rows[0];
      requireAdminRole(task.member_role);
      if (status === "done") {
        const unfinished = await client.query(
          `SELECT 1 FROM tasks WHERE parent_task_id = $1 AND status <> 'done' LIMIT 1`,
          [id],
        );
        if (unfinished.rowCount) {
          throw new ApiError(
            409,
            "CHILD_TASKS_INCOMPLETE",
            "仍有必需子 Task 未完成，父 Task 不能标记为完成。",
          );
        }
      }
      await client.query(
        "UPDATE tasks SET status = $1, wait_reason = NULL, updated_at = now() WHERE id = $2",
        [status, id],
      );
      await appendCollaborationAudit(client, {
        actorUserId: request.user.sub,
        roomId: task.source_room_id,
        taskId: id,
        eventType: status === "failed" ? "task.execution_failed" : "task.status_changed",
        summary: `Task 状态已更新为 ${status}。`,
        outcome: status,
      });
      if (task.parent_task_id) {
        const parent = await client.query<{
          task_room_id: string;
          status: string;
          title: string;
          completion_summary: string | null;
          artifact_refs: string[];
        }>(
          `SELECT task_room_id, status, title, completion_summary, artifact_refs
           FROM tasks WHERE id = $1 FOR UPDATE`,
          [task.parent_task_id],
        );
        const siblings = await client.query<{
          status: string;
          title: string;
          completion_summary: string | null;
          artifact_refs: string[];
        }>(
          `SELECT status, title, completion_summary, artifact_refs
           FROM tasks WHERE parent_task_id = $1 ORDER BY created_at, id`,
          [task.parent_task_id],
        );
        const blockedChild = siblings.rows.some((child) =>
          ["blocked", "failed", "cancelled"].includes(child.status),
        );
        const allDone =
          siblings.rows.length > 0 && siblings.rows.every((child) => child.status === "done");
        if (blockedChild) {
          await client.query(
            `UPDATE tasks SET status = 'blocked',
                    wait_reason = '至少一个必需子 Task 已阻塞，请先处理。', updated_at = now()
             WHERE id = $1 AND status NOT IN ('done', 'failed', 'cancelled')`,
            [task.parent_task_id],
          );
          parentUpdate = {
            id: task.parent_task_id,
            taskRoomId: parent.rows[0].task_room_id,
            sourceRoomId: task.source_room_id,
            status: "blocked",
            artifactRefs: [],
          };
        } else if (
          allDone &&
          !["review", "done", "failed", "cancelled"].includes(parent.rows[0].status)
        ) {
          const artifactRefs = [
            ...new Set([
              ...(parent.rows[0].artifact_refs ?? []),
              ...siblings.rows.flatMap((child) => child.artifact_refs ?? []),
            ]),
          ];
          const completionSummary = aggregateTaskCompletionSummaries([
            ...(parent.rows[0].completion_summary
              ? [
                  {
                    title: parent.rows[0].title,
                    completion_summary: parent.rows[0].completion_summary,
                  },
                ]
              : []),
            ...siblings.rows,
          ]);
          await client.query(
            `UPDATE tasks SET status = 'review', wait_reason = NULL,
                    completion_summary = $1, artifact_refs = $2::jsonb, updated_at = now()
             WHERE id = $3 AND status NOT IN ('done', 'failed', 'cancelled')`,
            [completionSummary, JSON.stringify(artifactRefs), task.parent_task_id],
          );
          parentUpdate = {
            id: task.parent_task_id,
            taskRoomId: parent.rows[0].task_room_id,
            sourceRoomId: task.source_room_id,
            status: "review",
            artifactRefs,
          };
        }
      }
      if (
        status === "done" &&
        task.status !== "done" &&
        !task.parent_task_id &&
        !task.source_summary_published_at
      ) {
        if (!task.source_group_id) {
          throw new ApiError(
            409,
            "SOURCE_ROOM_NOT_PUBLISHABLE",
            "来源群尚未绑定 OpenIM 群，无法发布 Task 总结。",
          );
        }
        const agentSender = await client.query<{
          openim_user_id: string;
          name: string;
        }>(
          `SELECT a.openim_user_id, a.name FROM task_assignees ta
           JOIN agents a ON a.id = ta.agent_id
           WHERE ta.task_id = $1 ORDER BY a.id LIMIT 1`,
          [id],
        );
        let sender: { openimUserId: string; name: string };
        if (agentSender.rows[0]) {
          sender = {
            openimUserId: agentSender.rows[0].openim_user_id,
            name: agentSender.rows[0].name,
          };
        } else {
          const userSender = (
            await client.query<{ openim_user_id: string; display_name: string }>(
              "SELECT openim_user_id, display_name FROM users WHERE id = $1",
              [request.user.sub],
            )
          ).rows[0];
          if (!userSender) {
            throw new ApiError(
              409,
              "TASK_SUMMARY_SENDER_UNAVAILABLE",
              "没有可用于发布 Task 总结的群成员身份。",
            );
          }
          sender = { openimUserId: userSender.openim_user_id, name: userSender.display_name };
        }
        const artifactRefs = normalizeCompletionArtifactRefs(task.artifact_refs);
        const content = formatTaskCompletionMessage({
          title: task.title,
          completionSummary: task.completion_summary,
          artifactRefs,
        });
        await enqueueOutbox(client, "openim.message.send", "task_source_summary", id, {
          sendID: sender.openimUserId,
          senderNickname: sender.name,
          groupID: task.source_group_id,
          content,
          ex: {
            kind: "task-summary",
            taskId: id,
            artifactRefs,
            final: true,
            deliveryKey: `task-summary:${id}`,
          },
        });
        await client.query(
          "UPDATE tasks SET source_summary_published_at = now(), updated_at = now() WHERE id = $1",
          [id],
        );
        await appendCollaborationAudit(client, {
          actorUserId: request.user.sub,
          roomId: task.source_room_id,
          taskId: id,
          eventType: "task.summary_published",
          summary: "Task 验收总结已发布到来源群。",
          outcome: "published",
          metadata: { artifactRefs },
        });
        summaryPublication = { sourceRoomId: task.source_room_id, taskId: id, artifactRefs };
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await events.publishToRoom(task!.task_room_id, {
      type: "task.updated",
      taskId: id,
      status,
    });
    if (parentUpdate) {
      await events.publishToRoom(parentUpdate.taskRoomId, {
        type: "task.children-aggregated",
        taskId: parentUpdate.id,
        status: parentUpdate.status,
        artifactRefs: parentUpdate.artifactRefs,
      });
      await events.publishToRoom(parentUpdate.sourceRoomId, {
        type: "task.children-aggregated",
        taskId: parentUpdate.id,
        status: parentUpdate.status,
        artifactRefs: parentUpdate.artifactRefs,
      });
    }
    if (summaryPublication) {
      await events.publishToRoom(summaryPublication.sourceRoomId, {
        type: "task.summary.published",
        taskId: summaryPublication.taskId,
        artifactRefs: summaryPublication.artifactRefs,
      });
    }
    return { id, status };
  });
};
