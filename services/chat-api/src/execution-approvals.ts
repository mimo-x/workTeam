import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";

import { appendCollaborationAudit } from "./collaboration-audit.js";
import type { EventPublisher } from "./events.js";
import { ApiError, parseBody, parseParams, parseQuery } from "./http.js";
import type { EnvelopeCipher } from "./security.js";
import type { EncryptedEnvelope } from "./schema.js";

const permissionScopes = [
  "workspace.read",
  "workspace.write",
  "command.run",
  "network.read",
] as const;
type PermissionScope = (typeof permissionScopes)[number];
type PermissionConstraints = {
  pathPrefixes?: string[];
  commandExecutables?: string[];
  networkDomains?: string[];
};

const constraintsSchema = z.object({
  pathPrefixes: z.array(z.string().trim().min(1).max(1_024)).max(64).optional(),
  commandExecutables: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9._+-]{1,128}$/),
    )
    .max(64)
    .optional(),
  networkDomains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
    )
    .max(64)
    .optional(),
});
const approvalParams = z.object({ id: z.string().uuid() });
const taskParams = z.object({ taskId: z.string().uuid() });
const approvalQuery = z.object({
  status: z.enum(["pending", "approved", "denied", "expired"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const decisionBody = z.object({
  decision: z.enum(["deny", "allow_once", "allow_for_task"]),
  constraints: constraintsSchema.optional(),
});

export type ExecutionApprovalRow = {
  id: string;
  idempotency_key: string;
  task_id: string;
  task_revision: number;
  run_id: string;
  session_id: string;
  turn_id: string;
  agent_id: string;
  workspace_binding_id: string;
  host_device_id: string;
  host_user_id: string;
  provider_request_id: string;
  requested_scope: PermissionScope;
  requested_constraints: PermissionConstraints;
  redacted_summary: string;
  encrypted_details: EncryptedEnvelope;
  status: "pending" | "approved" | "denied" | "expired";
  decision: "deny" | "allow_once" | "allow_for_task" | null;
  decided_by_user_id: string | null;
  created_at: Date;
  expires_at: Date;
  decided_at: Date | null;
};

const selectedConstraintValues = (constraints: PermissionConstraints, scope: PermissionScope) => {
  if (scope === "workspace.read" || scope === "workspace.write") {
    return constraints.pathPrefixes ?? [];
  }
  if (scope === "command.run") return constraints.commandExecutables ?? [];
  return constraints.networkDomains ?? [];
};

const constraintSubset = (
  selected: PermissionConstraints,
  requested: PermissionConstraints,
  scope: PermissionScope,
) => {
  const selectedValues = selectedConstraintValues(selected, scope);
  const requestedValues = selectedConstraintValues(requested, scope);
  if (!requestedValues.length) return selectedValues.length === 0;
  if (!selectedValues.length) return false;
  if (scope === "workspace.read" || scope === "workspace.write") {
    return selectedValues.every((path) =>
      requestedValues.some(
        (prefix) => path === prefix || path.startsWith(`${prefix.replace(/\/$/, "")}/`),
      ),
    );
  }
  if (scope === "network.read") {
    return selectedValues.every((domain) =>
      requestedValues.some((parent) => domain === parent || domain.endsWith(`.${parent}`)),
    );
  }
  return selectedValues.every((command) => requestedValues.includes(command));
};

const mergeConstraints = (
  existing: PermissionConstraints,
  selected: PermissionConstraints,
  scope: PermissionScope,
) => {
  const merged: PermissionConstraints = { ...existing };
  if (scope === "workspace.read" || scope === "workspace.write") {
    merged.pathPrefixes = [
      ...new Set([...(existing.pathPrefixes ?? []), ...(selected.pathPrefixes ?? [])]),
    ];
  } else if (scope === "command.run") {
    merged.commandExecutables = [
      ...new Set([...(existing.commandExecutables ?? []), ...(selected.commandExecutables ?? [])]),
    ];
  } else {
    merged.networkDomains = [
      ...new Set([...(existing.networkDomains ?? []), ...(selected.networkDomains ?? [])]),
    ];
  }
  return merged;
};

const approvalDto = async (
  row: ExecutionApprovalRow,
  cipher: EnvelopeCipher,
  includePrivate: boolean,
) => ({
  id: row.id,
  taskId: row.task_id,
  taskRevision: row.task_revision,
  runId: row.run_id,
  agentId: row.agent_id,
  workspaceBindingId: row.workspace_binding_id,
  hostDeviceId: row.host_device_id,
  requestedScope: row.requested_scope,
  summary: row.redacted_summary,
  status: row.status,
  decision: row.decision,
  decidedByUserId: row.decided_by_user_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  decidedAt: row.decided_at,
  ...(includePrivate
    ? {
        idempotencyKey: row.idempotency_key,
        sessionId: row.session_id,
        turnId: row.turn_id,
        providerRequestId: row.provider_request_id,
        requestedConstraints: row.requested_constraints,
        details: await cipher.decrypt(row.encrypted_details),
      }
    : {}),
});

const approvalSelect = `SELECT ear.*, d.user_id AS host_user_id
  FROM execution_approval_requests ear
  JOIN devices d ON d.id = ear.host_device_id`;

export const registerExecutionApprovalRoutes = (
  app: FastifyInstance,
  pool: pg.Pool,
  cipher: EnvelopeCipher,
  events: EventPublisher,
) => {
  app.get("/v1/execution-approvals", { preHandler: [app.authenticate] }, async (request) => {
    const { status, limit } = parseQuery(approvalQuery, request);
    const result = await pool.query<ExecutionApprovalRow>(
      `${approvalSelect}
       WHERE d.user_id = $1 AND ($2::text IS NULL OR ear.status = $2)
       ORDER BY ear.created_at DESC LIMIT $3`,
      [request.user.sub, status ?? null, limit],
    );
    return {
      data: await Promise.all(result.rows.map((row) => approvalDto(row, cipher, true))),
    };
  });

  app.get(
    "/v1/tasks/:taskId/execution-approvals",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { taskId } = parseParams(taskParams, request);
      const membership = await pool.query(
        `SELECT 1 FROM tasks t JOIN room_members rm ON rm.room_id = t.source_room_id
         WHERE t.id = $1 AND rm.user_id = $2`,
        [taskId, request.user.sub],
      );
      if (!membership.rowCount) throw new ApiError(404, "TASK_NOT_FOUND", "Task 不存在。");
      const result = await pool.query<ExecutionApprovalRow>(
        `${approvalSelect} WHERE ear.task_id = $1 ORDER BY ear.created_at DESC`,
        [taskId],
      );
      return {
        data: await Promise.all(
          result.rows.map((row) => approvalDto(row, cipher, row.host_user_id === request.user.sub)),
        ),
      };
    },
  );

  app.post(
    "/v1/execution-approvals/:id/decision",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = parseParams(approvalParams, request);
      const input = parseBody(decisionBody, request);
      const client = await pool.connect();
      let approval: ExecutionApprovalRow;
      let roomId = "";
      let selectedConstraints: PermissionConstraints = {};
      let transactionClosed = false;
      try {
        await client.query("BEGIN");
        const result = await client.query<
          ExecutionApprovalRow & {
            source_room_id: string;
            current_task_revision: number;
            task_workspace_binding_id: string;
            task_binding_revision: number;
            current_binding_revision: number;
            run_status: string;
            target_device_id: string;
            permission_grant_id: string | null;
            parent_task_id: string | null;
          }
        >(
          `SELECT ear.*, d.user_id AS host_user_id, t.source_room_id,
                  t.revision AS current_task_revision,
                  t.workspace_binding_id AS task_workspace_binding_id,
                  t.binding_revision AS task_binding_revision,
                  t.parent_task_id,
                  wb.revision AS current_binding_revision,
                  tr.status AS run_status, tr.target_device_id, tr.permission_grant_id
           FROM execution_approval_requests ear
           JOIN devices d ON d.id = ear.host_device_id
           JOIN tasks t ON t.id = ear.task_id
           JOIN workspace_bindings wb ON wb.id = ear.workspace_binding_id
           JOIN task_runs tr ON tr.id = ear.run_id
           WHERE ear.id = $1 FOR UPDATE`,
          [id],
        );
        const current = result.rows[0];
        if (!current) throw new ApiError(404, "APPROVAL_NOT_FOUND", "审批不存在。");
        if (current.host_user_id !== request.user.sub) {
          throw new ApiError(403, "HOST_OWNER_REQUIRED", "只有项目主机所有者可以处理该审批。");
        }
        if (current.status !== "pending") {
          throw new ApiError(409, "APPROVAL_ALREADY_DECIDED", "审批已经处理，不能重复决定。");
        }
        if (current.expires_at.getTime() <= Date.now()) {
          throw new ApiError(409, "APPROVAL_EXPIRED", "审批已过期。");
        }
        if (
          current.task_revision !== current.current_task_revision ||
          current.workspace_binding_id !== current.task_workspace_binding_id ||
          current.task_binding_revision !== current.current_binding_revision ||
          current.host_device_id !== current.target_device_id ||
          current.run_status !== "waiting_for_approval"
        ) {
          throw new ApiError(409, "APPROVAL_STALE", "审批关联的执行状态已经变化。");
        }
        selectedConstraints = input.constraints ?? current.requested_constraints;
        if (
          !constraintSubset(
            selectedConstraints,
            current.requested_constraints,
            current.requested_scope,
          )
        ) {
          throw new ApiError(400, "APPROVAL_SCOPE_EXCEEDED", "审批约束不能超出 Runtime 请求。");
        }
        if (
          input.decision === "allow_for_task" &&
          selectedConstraintValues(selectedConstraints, current.requested_scope).length === 0
        ) {
          throw new ApiError(
            400,
            "APPROVAL_CONSTRAINT_REQUIRED",
            "Task 级允许必须包含明确且可复用的约束。",
          );
        }
        roomId = current.source_room_id;
        if (input.decision === "allow_for_task") {
          if (current.parent_task_id) {
            const parentGrant = await client.query<{
              scopes: PermissionScope[];
              constraints: PermissionConstraints;
            }>(
              `SELECT tpg.scopes, tpg.constraints
               FROM task_permission_grants tpg
               JOIN tasks parent ON parent.id = tpg.task_id
               WHERE tpg.task_id = $1 AND tpg.task_revision = parent.revision
                 AND tpg.workspace_binding_id = $2
                 AND tpg.binding_revision = $3
                 AND tpg.revoked_at IS NULL AND tpg.expires_at > now()`,
              [
                current.parent_task_id,
                current.workspace_binding_id,
                current.current_binding_revision,
              ],
            );
            const insideParent = parentGrant.rows.some(
              (grant) =>
                grant.scopes.includes(current.requested_scope) &&
                constraintSubset(selectedConstraints, grant.constraints, current.requested_scope),
            );
            if (!insideParent) {
              throw new ApiError(
                400,
                "PARENT_SCOPE_EXCEEDED",
                "Task 级允许不能超出父 Task 的授权约束。",
              );
            }
          }
          const grant = current.permission_grant_id
            ? await client.query<{
                scopes: PermissionScope[];
                constraints: PermissionConstraints;
                expires_at: Date;
              }>(
                `SELECT scopes, constraints, expires_at FROM task_permission_grants
                 WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
                [current.permission_grant_id],
              )
            : null;
          const scopes = grant?.rows[0]?.scopes ?? [current.requested_scope];
          const constraints = mergeConstraints(
            grant?.rows[0]?.constraints ?? {},
            selectedConstraints,
            current.requested_scope,
          );
          const createdGrant = await client.query<{ id: string }>(
            `INSERT INTO task_permission_grants(
               id, task_id, task_revision, workspace_binding_id, binding_revision,
               host_user_id, host_device_id, scopes, constraints, approved_by_user_id, expires_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$6,$10)
             RETURNING id`,
            [
              randomUUID(),
              current.task_id,
              current.task_revision,
              current.workspace_binding_id,
              current.current_binding_revision,
              current.host_user_id,
              current.host_device_id,
              JSON.stringify(scopes),
              JSON.stringify(constraints),
              grant?.rows[0]?.expires_at ?? new Date(Date.now() + 3_600_000),
            ],
          );
          await client.query("UPDATE task_runs SET permission_grant_id = $1 WHERE id = $2", [
            createdGrant.rows[0].id,
            current.run_id,
          ]);
        }
        const status = input.decision === "deny" ? "denied" : "approved";
        const decided = await client.query<ExecutionApprovalRow>(
          `UPDATE execution_approval_requests
           SET status = $1, decision = $2, decided_by_user_id = $3, decided_at = now()
           WHERE id = $4 RETURNING *, $3::uuid AS host_user_id`,
          [status, input.decision, request.user.sub, id],
        );
        approval = decided.rows[0];
        await client.query(
          "UPDATE task_runs SET status = 'running', updated_at = now() WHERE id = $1 AND status = 'waiting_for_approval'",
          [current.run_id],
        );
        await client.query(
          "UPDATE tasks SET status = 'running', wait_reason = NULL, updated_at = now() WHERE id = $1 AND status = 'waiting_for_approval'",
          [current.task_id],
        );
        await appendCollaborationAudit(client, {
          actorUserId: request.user.sub,
          roomId,
          taskId: current.task_id,
          taskRevision: current.task_revision,
          runId: current.run_id,
          hostDeviceId: current.host_device_id,
          eventType: "runtime.approval_decided",
          summary: `${current.redacted_summary}：主机所有者已${input.decision === "deny" ? "拒绝" : "允许"}。`,
          outcome: input.decision,
          metadata: { approvalId: id, requestedScope: current.requested_scope },
        });
        await client.query("COMMIT");
        transactionClosed = true;
      } catch (error) {
        if (!transactionClosed) await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      events.publishToDevice(approval!.host_user_id, approval!.host_device_id, {
        type: "approval.resolved",
        approvalId: approval!.id,
        runId: approval!.run_id,
        sessionId: approval!.session_id,
        turnId: approval!.turn_id,
        providerRequestId: approval!.provider_request_id,
        decision: approval!.decision,
      });
      await events.publishToRoom(roomId, {
        type: "runtime.approval-decided",
        taskId: approval!.task_id,
        runId: approval!.run_id,
        approvalId: approval!.id,
        status: approval!.status,
      });
      return approvalDto(approval!, cipher, true);
    },
  );
};
