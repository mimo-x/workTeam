import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";

import { appendCollaborationAudit } from "./collaboration-audit.js";
import type { EventPublisher } from "./events.js";
import { ApiError, parseBody, parseParams } from "./http.js";

const permissionScopes = [
  "workspace.read",
  "workspace.write",
  "command.run",
  "network.read",
] as const;
type PermissionScope = (typeof permissionScopes)[number];

const taskParams = z.object({ id: z.string().uuid() });
const grantParams = taskParams.extend({ grantId: z.string().uuid() });
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
const grantBody = z.object({
  scopes: z.array(z.enum(permissionScopes)).min(1).max(4),
  constraints: constraintsSchema.default({}),
  expiresInSeconds: z.number().int().min(60).max(86_400).default(3_600),
});

type TaskGrantContext = {
  task_id: string;
  task_revision: number;
  source_room_id: string;
  parent_task_id: string | null;
  requested_scopes: PermissionScope[];
  workspace_binding_id: string | null;
  binding_revision: number | null;
  host_user_id: string | null;
  host_device_id: string | null;
  current_binding_revision: number | null;
  baseline_scopes: PermissionScope[] | null;
  binding_revoked_at: Date | null;
  member_role: "owner" | "admin" | "member" | null;
};

type GrantRow = {
  id: string;
  task_id: string;
  task_revision: number;
  workspace_binding_id: string;
  binding_revision: number;
  host_user_id: string;
  host_device_id: string;
  scopes: PermissionScope[];
  constraints: PermissionConstraints;
  approved_by_user_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};

type PermissionConstraints = z.infer<typeof constraintsSchema>;

const getTaskGrantContext = async (
  client: pg.Pool | pg.PoolClient,
  taskId: string,
  userId: string,
) => {
  const result = await client.query<TaskGrantContext>(
    `SELECT t.id AS task_id, t.revision AS task_revision, t.source_room_id,
            t.parent_task_id, t.requested_scopes, t.workspace_binding_id,
            t.binding_revision, wb.user_id AS host_user_id,
            wb.device_id AS host_device_id, wb.revision AS current_binding_revision,
            wb.baseline_scopes, wb.revoked_at AS binding_revoked_at,
            rm.role AS member_role
     FROM tasks t
     LEFT JOIN workspace_bindings wb ON wb.id = t.workspace_binding_id
     LEFT JOIN room_members rm ON rm.room_id = t.source_room_id AND rm.user_id = $2
     WHERE t.id = $1`,
    [taskId, userId],
  );
  const context = result.rows[0];
  if (!context || !context.member_role) {
    throw new ApiError(404, "TASK_NOT_FOUND", "Task 不存在或当前用户不是群成员。");
  }
  return context;
};

const agentScopesForTask = async (client: pg.Pool | pg.PoolClient, taskId: string) => {
  const result = await client.query<{ capabilities: string[]; workspace_access: string }>(
    `SELECT a.capabilities, a.workspace_access FROM task_assignees ta
     JOIN agents a ON a.id = ta.agent_id
     WHERE ta.task_id = $1 AND a.archived_at IS NULL`,
    [taskId],
  );
  const scopes = new Set<PermissionScope>();
  for (const agent of result.rows) {
    const capabilities = new Set(agent.capabilities);
    if (capabilities.has("read_workspace")) scopes.add("workspace.read");
    if (capabilities.has("write_workspace") || agent.workspace_access === "write") {
      scopes.add("workspace.write");
    }
    if (capabilities.has("run_command")) scopes.add("command.run");
    if (capabilities.has("network_read") || capabilities.has("network.read")) {
      scopes.add("network.read");
    }
  }
  return scopes;
};

const safeRelativePrefix = (value: string) => {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  return (
    Boolean(normalized) &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.split("/").includes("..")
  );
};

const constraintSubset = (
  child: PermissionConstraints,
  parent: PermissionConstraints,
  scope: PermissionScope,
) => {
  if (scope === "workspace.write" || scope === "workspace.read") {
    const childPaths = child.pathPrefixes ?? [];
    const parentPaths = parent.pathPrefixes ?? [];
    if (childPaths.some((path) => !safeRelativePrefix(path))) return false;
    if (!parentPaths.length) return true;
    return (
      childPaths.length > 0 &&
      childPaths.every((path) =>
        parentPaths.some(
          (prefix) => path === prefix || path.startsWith(`${prefix.replace(/\/$/, "")}/`),
        ),
      )
    );
  }
  if (scope === "command.run") {
    const parentCommands = parent.commandExecutables ?? [];
    const childCommands = child.commandExecutables ?? [];
    return (
      childCommands.length > 0 &&
      (!parentCommands.length || childCommands.every((command) => parentCommands.includes(command)))
    );
  }
  if (scope === "network.read") {
    const parentDomains = parent.networkDomains ?? [];
    const childDomains = child.networkDomains ?? [];
    return (
      childDomains.length > 0 &&
      (!parentDomains.length ||
        childDomains.every((domain) =>
          parentDomains.some((parent) => domain === parent || domain.endsWith(`.${parent}`)),
        ))
    );
  }
  return true;
};

const grantDto = (row: GrantRow, includeConstraints: boolean) => ({
  id: row.id,
  taskId: row.task_id,
  taskRevision: row.task_revision,
  workspaceBindingId: row.workspace_binding_id,
  bindingRevision: row.binding_revision,
  hostUserId: row.host_user_id,
  hostDeviceId: row.host_device_id,
  scopes: row.scopes,
  ...(includeConstraints
    ? { constraints: row.constraints }
    : {
        constraintSummary: {
          pathPrefixes: row.constraints.pathPrefixes?.length ?? 0,
          commandExecutables: row.constraints.commandExecutables?.length ?? 0,
          networkDomains: row.constraints.networkDomains?.length ?? 0,
        },
      }),
  approvedByUserId: row.approved_by_user_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
});

export const registerTaskPermissionRoutes = (
  app: FastifyInstance,
  pool: pg.Pool,
  events: EventPublisher,
) => {
  app.get(
    "/v1/tasks/:id/permission-grants",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = parseParams(taskParams, request);
      const context = await getTaskGrantContext(pool, id, request.user.sub);
      const grants = await pool.query<GrantRow>(
        `SELECT * FROM task_permission_grants WHERE task_id = $1 ORDER BY created_at DESC`,
        [id],
      );
      return {
        data: grants.rows.map((grant) =>
          grantDto(grant, context.host_user_id === request.user.sub),
        ),
      };
    },
  );

  app.post(
    "/v1/tasks/:id/permission-grants",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = parseParams(taskParams, request);
      const input = parseBody(grantBody, request);
      const client = await pool.connect();
      let created: GrantRow;
      let roomId = "";
      try {
        await client.query("BEGIN");
        const context = await getTaskGrantContext(client, id, request.user.sub);
        roomId = context.source_room_id;
        if (!context.workspace_binding_id || !context.host_user_id || !context.host_device_id) {
          throw new ApiError(409, "WORKSPACE_BINDING_REQUIRED", "Task 尚未绑定项目主机。");
        }
        if (context.host_user_id !== request.user.sub) {
          throw new ApiError(403, "HOST_OWNER_REQUIRED", "只有项目主机所有者可以授权电脑权限。");
        }
        if (
          context.binding_revoked_at ||
          context.binding_revision !== context.current_binding_revision
        ) {
          throw new ApiError(409, "WORKSPACE_BINDING_STALE", "Task 的项目主机绑定已失效。");
        }
        const requestedScopes = new Set(context.requested_scopes);
        const baselineScopes = new Set(context.baseline_scopes ?? []);
        const agentScopes = await agentScopesForTask(client, id);
        for (const scope of input.scopes) {
          if (!requestedScopes.has(scope)) {
            throw new ApiError(400, "TASK_SCOPE_EXCEEDED", `Task 未请求 ${scope} 权限。`);
          }
          if (!baselineScopes.has(scope)) {
            throw new ApiError(400, "ROOM_SCOPE_EXCEEDED", `项目主机未向群组开放 ${scope} 权限。`);
          }
          if (!agentScopes.has(scope)) {
            throw new ApiError(
              400,
              "AGENT_CAPABILITY_MISSING",
              `执行 Agent 不具备 ${scope} 能力。`,
            );
          }
          if (!constraintSubset(input.constraints, {}, scope)) {
            throw new ApiError(400, "INVALID_CONSTRAINT", `${scope} 的约束不安全或不完整。`);
          }
        }
        if (context.parent_task_id) {
          const parent = await client.query<{
            revision: number;
            requested_scopes: PermissionScope[];
          }>("SELECT revision, requested_scopes FROM tasks WHERE id = $1", [
            context.parent_task_id,
          ]);
          const parentGrants = await client.query<GrantRow>(
            `SELECT * FROM task_permission_grants
             WHERE task_id = $1 AND task_revision = $2
               AND workspace_binding_id = $3 AND binding_revision = $4
               AND revoked_at IS NULL AND expires_at > now()`,
            [
              context.parent_task_id,
              parent.rows[0]?.revision ?? 0,
              context.workspace_binding_id,
              context.binding_revision,
            ],
          );
          for (const scope of input.scopes) {
            const parentGrant = parentGrants.rows.find(
              (grant) =>
                grant.scopes.includes(scope) &&
                constraintSubset(input.constraints, grant.constraints, scope),
            );
            const inheritedRead =
              scope === "workspace.read" && parent.rows[0]?.requested_scopes.includes(scope);
            if (!parentGrant && !inheritedRead) {
              throw new ApiError(400, "PARENT_SCOPE_EXCEEDED", `父 Task 未授权 ${scope}。`);
            }
          }
        }
        const inserted = await client.query<GrantRow>(
          `INSERT INTO task_permission_grants(
             id, task_id, task_revision, workspace_binding_id, binding_revision,
             host_user_id, host_device_id, scopes, constraints, approved_by_user_id, expires_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$6,$10)
           RETURNING *`,
          [
            randomUUID(),
            id,
            context.task_revision,
            context.workspace_binding_id,
            context.binding_revision,
            context.host_user_id,
            context.host_device_id,
            JSON.stringify([...new Set(input.scopes)]),
            JSON.stringify(input.constraints),
            new Date(Date.now() + input.expiresInSeconds * 1_000),
          ],
        );
        created = inserted.rows[0];
        await client.query(
          `UPDATE tasks SET wait_reason = NULL,
                  status = CASE WHEN status = 'waiting_for_permission' THEN 'approved' ELSE status END,
                  updated_at = now()
           WHERE id = $1`,
          [id],
        );
        await appendCollaborationAudit(client, {
          actorUserId: request.user.sub,
          roomId,
          taskId: id,
          taskRevision: context.task_revision,
          hostDeviceId: context.host_device_id,
          eventType: "task_permission.granted",
          summary: `项目主机所有者已为 Task v${context.task_revision} 授权。`,
          outcome: "approved",
          metadata: { grantId: created.id, scopes: created.scopes },
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      await events.publishToRoom(roomId, {
        type: "task.permission-granted",
        taskId: id,
        grant: grantDto(created!, false),
      });
      return reply.status(201).send(grantDto(created!, true));
    },
  );

  app.delete(
    "/v1/tasks/:id/permission-grants/:grantId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, grantId } = parseParams(grantParams, request);
      const context = await getTaskGrantContext(pool, id, request.user.sub);
      if (context.host_user_id !== request.user.sub) {
        throw new ApiError(403, "HOST_OWNER_REQUIRED", "只有项目主机所有者可以撤销授权。");
      }
      const revoked = await pool.query(
        `UPDATE task_permission_grants SET revoked_at = now()
         WHERE id = $1 AND task_id = $2 AND host_user_id = $3 AND revoked_at IS NULL
         RETURNING id`,
        [grantId, id, request.user.sub],
      );
      if (!revoked.rowCount) throw new ApiError(404, "GRANT_NOT_FOUND", "授权不存在或已撤销。");
      await pool.query(
        `UPDATE tasks SET status = 'waiting_for_permission', wait_reason = '项目主机授权已撤销。',
                updated_at = now()
         WHERE id = $1 AND status NOT IN ('done', 'failed', 'cancelled')`,
        [id],
      );
      await pool.query(
        `UPDATE task_runs SET status = 'cancelled', completed_at = now(),
                error = '项目主机授权已撤销。', updated_at = now()
         WHERE task_id = $1 AND permission_grant_id = $2
           AND status IN ('queued', 'leased', 'running', 'waiting')`,
        [id, grantId],
      );
      await pool.query(
        `DELETE FROM workspace_write_leases
         WHERE run_id IN (
           SELECT id FROM task_runs WHERE task_id = $1 AND permission_grant_id = $2
         )`,
        [id, grantId],
      );
      const deniedApprovals = await pool.query<{
        id: string;
        run_id: string;
        session_id: string;
        turn_id: string;
        provider_request_id: string;
        host_device_id: string;
      }>(
        `UPDATE execution_approval_requests
         SET status = 'denied', decision = 'deny', decided_by_user_id = $3, decided_at = now()
         WHERE run_id IN (
           SELECT id FROM task_runs WHERE task_id = $1 AND permission_grant_id = $2
         ) AND status = 'pending'
         RETURNING id, run_id, session_id, turn_id, provider_request_id, host_device_id`,
        [id, grantId, request.user.sub],
      );
      for (const approval of deniedApprovals.rows) {
        events.publishToDevice(request.user.sub, approval.host_device_id, {
          type: "approval.resolved",
          approvalId: approval.id,
          runId: approval.run_id,
          sessionId: approval.session_id,
          turnId: approval.turn_id,
          providerRequestId: approval.provider_request_id,
          decision: "deny",
          reason: "grant_revoked",
        });
      }
      await appendCollaborationAudit(pool, {
        actorUserId: request.user.sub,
        roomId: context.source_room_id,
        taskId: id,
        taskRevision: context.task_revision,
        hostDeviceId: context.host_device_id ?? undefined,
        eventType: "task_permission.revoked",
        summary: "项目主机所有者已撤销 Task 权限，未完成执行已停止。",
        outcome: "revoked",
        metadata: { grantId },
      });
      await events.publishToRoom(context.source_room_id, {
        type: "task.permission-revoked",
        taskId: id,
        grantId,
      });
      return reply.status(204).send();
    },
  );
};

export const currentTaskGrant = async (
  client: pg.PoolClient,
  input: {
    taskId: string;
    taskRevision: number;
    workspaceBindingId: string;
    bindingRevision: number;
    requiredScopes: PermissionScope[];
  },
) => {
  const required = input.requiredScopes.filter((scope) => scope !== "workspace.read");
  if (!required.length) return null;
  const grants = await client.query<GrantRow>(
    `SELECT * FROM task_permission_grants
     WHERE task_id = $1 AND task_revision = $2 AND workspace_binding_id = $3
       AND binding_revision = $4 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC`,
    [input.taskId, input.taskRevision, input.workspaceBindingId, input.bindingRevision],
  );
  return (
    grants.rows.find((grant) => required.every((scope) => grant.scopes.includes(scope))) ?? null
  );
};
