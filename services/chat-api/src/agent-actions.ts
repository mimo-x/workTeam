import { randomUUID } from "node:crypto";

import type pg from "pg";
import { z } from "zod";

import { appendCollaborationAudit } from "./collaboration-audit.js";
import { enqueueOutbox } from "./outbox.js";
import { normalizeCompletionSummary } from "./task-completion-summary.js";

const scopes = ["workspace.read", "workspace.write", "command.run", "network.read"] as const;
type PermissionScope = (typeof scopes)[number];
type Constraints = {
  pathPrefixes?: string[];
  commandExecutables?: string[];
  networkDomains?: string[];
};

const base = {
  protocolVersion: z.literal(1),
  actionId: z.string().trim().min(1).max(256),
  taskId: z.string().uuid(),
  taskRevision: z.number().int().positive(),
};
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    ...base,
    action: z.literal("create_subtask"),
    title: z.string().trim().min(1).max(200),
    objective: z.string().trim().min(1).max(4_000),
    expectedResult: z.string().trim().min(1).max(4_000),
    assigneeIds: z.array(z.string().uuid()).min(1).max(16),
    requestedScopes: z.array(z.enum(scopes)).max(4),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(1_000)).max(32),
  }),
  z.object({
    ...base,
    action: z.literal("assign_agent"),
    subtaskId: z.string().uuid(),
    assigneeIds: z.array(z.string().uuid()).min(1).max(16),
  }),
  z.object({
    ...base,
    action: z.literal("request_review"),
    reviewerAgentId: z.string().uuid().optional(),
  }),
  z.object({
    ...base,
    action: z.literal("request_permission"),
    requestedScopes: z.array(z.enum(scopes)).min(1).max(4),
    constraints: z.object({
      pathPrefixes: z.array(z.string()).max(64).optional(),
      commandExecutables: z.array(z.string()).max(64).optional(),
      networkDomains: z.array(z.string()).max(64).optional(),
    }),
    reason: z.string().trim().min(1).max(2_000),
  }),
  z.object({ ...base, action: z.literal("block"), reason: z.string().trim().min(1).max(2_000) }),
  z.object({
    ...base,
    action: z.literal("complete"),
    summary: z.string().trim().min(1).max(4_000),
    artifactRefs: z.array(z.string().trim().min(1).max(2_048)).max(64),
  }),
]);

type AgentAction = z.infer<typeof actionSchema>;

type ParentContext = {
  id: string;
  revision: number;
  creator_id: string;
  source_room_id: string;
  task_room_id: string;
  root_task_id: string;
  depth: number;
  requested_scopes: PermissionScope[];
  workspace_binding_id: string;
  binding_revision: number;
  approved_review_id: string;
  context_version: number;
  latest_source_seq: string;
  root_budget: { maxDepth: number; maxDescendants: number; maxRuns: number; maxWallTimeMs: number };
  root_budget_usage: { descendants?: number; runs?: number; startedAt?: number };
  root_started_at: Date | null;
  host_user_id: string;
  host_device_id: string;
  binding_status: string;
  current_binding_revision: number;
};

type AgentRow = {
  id: string;
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
  capabilities: string[];
  runtime_status: string;
  skill_policy: string;
  skill_refs: unknown;
  private_config: unknown;
  version: number;
};

const capabilitiesForScopes = (agent: AgentRow) => {
  const capabilities = new Set(agent.capabilities ?? []);
  const available = new Set<PermissionScope>();
  if (capabilities.has("read_workspace")) available.add("workspace.read");
  if (capabilities.has("write_workspace") || agent.workspace_access === "write") {
    available.add("workspace.write");
  }
  if (capabilities.has("run_command")) available.add("command.run");
  if (capabilities.has("network_read") || capabilities.has("network.read")) {
    available.add("network.read");
  }
  return available;
};

const snapshotAgent = (agent: AgentRow, write: boolean) => ({
  id: agent.id,
  name: agent.name,
  title: agent.title,
  mention: agent.mention,
  description: agent.description,
  workspaceAccess: write && agent.workspace_access === "write" ? "write" : "read",
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

const parentContext = async (client: pg.PoolClient, taskId: string) => {
  const result = await client.query<ParentContext>(
    `SELECT t.id, t.revision, t.creator_id, t.source_room_id, t.task_room_id,
            t.root_task_id, t.depth, t.requested_scopes, t.workspace_binding_id,
            t.binding_revision, t.approved_review_id, t.context_version, t.latest_source_seq,
            root.budget AS root_budget, root.budget_usage AS root_budget_usage,
            root.started_at AS root_started_at, wb.user_id AS host_user_id,
            wb.device_id AS host_device_id, wb.status AS binding_status,
            wb.revision AS current_binding_revision
     FROM tasks t JOIN tasks root ON root.id = t.root_task_id
     JOIN workspace_bindings wb ON wb.id = t.workspace_binding_id
     WHERE t.id = $1 FOR UPDATE`,
    [taskId],
  );
  return result.rows[0];
};

const rejectAction = async (
  client: pg.PoolClient,
  taskId: string,
  actionId: string,
  reason: string,
) => {
  await client.query(
    `UPDATE task_agent_actions SET status = 'rejected', error = $1 WHERE task_id = $2 AND action_id = $3`,
    [reason, taskId, actionId],
  );
  return reason;
};

const createSubtask = async (
  client: pg.PoolClient,
  parent: ParentContext,
  delegatedByAgentId: string,
  parentRunId: string,
  action: Extract<AgentAction, { action: "create_subtask" }>,
): Promise<
  | { error: string; status: "waiting_for_budget" | "waiting_for_assignee" }
  | {
      taskId: string;
      taskRoomId: string;
      runIds: string[];
      status: string;
      waitReason: string | null;
    }
> => {
  const budget = parent.root_budget;
  const usage = parent.root_budget_usage ?? {};
  const [descendantCount, runCount] = await Promise.all([
    client.query<{ count: string }>(
      "SELECT count(*) AS count FROM tasks WHERE root_task_id = $1 AND id <> $1",
      [parent.root_task_id],
    ),
    client.query<{ count: string }>(
      `SELECT count(*) AS count FROM task_runs tr
       JOIN tasks t ON t.id = tr.task_id WHERE t.root_task_id = $1`,
      [parent.root_task_id],
    ),
  ]);
  const currentDescendants = Number(descendantCount.rows[0]?.count ?? 0);
  const currentRuns = Number(runCount.rows[0]?.count ?? 0);
  const startedAt = usage.startedAt ?? parent.root_started_at?.getTime() ?? Date.now();
  const nextDepth = parent.depth + 1;
  const requestedScopes = [
    ...new Set<PermissionScope>(["workspace.read", ...action.requestedScopes]),
  ];
  if (nextDepth > budget.maxDepth) {
    return { error: `委派深度超过上限 ${budget.maxDepth}。`, status: "waiting_for_budget" };
  }
  if (currentDescendants + 1 > budget.maxDescendants) {
    return {
      error: `子 Task 数量超过上限 ${budget.maxDescendants}。`,
      status: "waiting_for_budget",
    };
  }
  if (Date.now() - startedAt > budget.maxWallTimeMs) {
    return { error: "根 Task 的 30 分钟运行时长预算已耗尽。", status: "waiting_for_budget" };
  }
  const scopesInsideParent = requestedScopes.every((scope) =>
    parent.requested_scopes.includes(scope),
  );
  const agents = await client.query<AgentRow>(
    `SELECT a.* FROM agents a JOIN room_agents ra ON ra.agent_id = a.id
     WHERE ra.room_id = $1
       AND a.id IN (${action.assigneeIds.map((_, index) => `$${index + 2}`).join(",")})
       AND a.archived_at IS NULL`,
    [parent.source_room_id, ...action.assigneeIds],
  );
  const uniqueAssignees = new Set(action.assigneeIds);
  if (agents.rows.length !== uniqueAssignees.size) {
    return {
      error: "指定 Agent 已不在群内、未知或已停用，未创建子 Task。",
      status: "waiting_for_assignee",
    };
  }
  let status = "queued";
  let waitReason: string | null = null;
  const missingCapability = agents.rows.find((agent) => {
    const available = capabilitiesForScopes(agent);
    return requestedScopes.some((scope) => !available.has(scope));
  });
  if (missingCapability) {
    status = "waiting_for_assignee";
    waitReason = `${missingCapability.name} 不具备子 Task 所需能力。`;
  } else if (
    agents.rows.some(
      (agent) => agent.execution_target !== "local" || agent.runtime_status !== "online",
    )
  ) {
    status = "waiting_for_assignee";
    waitReason = "指定 Agent 当前不可用，请等待上线或重新分派。";
  }
  if (!scopesInsideParent) {
    status = "waiting_for_permission";
    waitReason = "子 Task 请求超出父 Task 范围，需要管理员调整方案。";
  }
  if (
    parent.binding_revision !== parent.current_binding_revision ||
    parent.binding_status !== "online"
  ) {
    status = "waiting_for_host";
    waitReason = "项目主机离线或绑定版本已经变化。";
  }
  const machineScopes = requestedScopes.filter((scope) => scope !== "workspace.read");
  const grants = machineScopes.length
    ? await client.query<{
        id: string;
        scopes: PermissionScope[];
        constraints: Constraints;
        approved_by_user_id: string;
        expires_at: Date;
      }>(
        `SELECT id, scopes, constraints, approved_by_user_id, expires_at
         FROM task_permission_grants
         WHERE task_id = $1 AND task_revision = $2 AND workspace_binding_id = $3
           AND binding_revision = $4 AND revoked_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC`,
        [parent.id, parent.revision, parent.workspace_binding_id, parent.binding_revision],
      )
    : { rows: [] };
  const inheritedGrant = grants.rows.find((grant) =>
    machineScopes.every((scope) => grant.scopes.includes(scope)),
  );
  if (machineScopes.length && !inheritedGrant) {
    status = "waiting_for_permission";
    waitReason = "父 Task 没有可继承的当前主机授权。";
  }
  const plannedRuns = status === "queued" ? agents.rows.length : 0;
  if (currentRuns + plannedRuns > budget.maxRuns) {
    return { error: `Agent Run 数量超过上限 ${budget.maxRuns}。`, status: "waiting_for_budget" };
  }

  const taskId = randomUUID();
  const taskRoomId = randomUUID();
  const taskGroupId = `grp_task_${taskRoomId.replaceAll("-", "")}`;
  const childReviewId = randomUUID();
  const members = await client.query<{
    user_id: string;
    openim_user_id: string;
    display_name: string;
  }>(
    `SELECT rm.user_id, u.openim_user_id, u.display_name
     FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = $1`,
    [parent.source_room_id],
  );
  const creator =
    members.rows.find((member) => member.user_id === parent.creator_id) ?? members.rows[0];
  await client.query(
    `INSERT INTO rooms(id, owner_id, openim_group_id, type, name, source_room_id)
     VALUES ($1,$2,$3,'task',$4,$5)`,
    [taskRoomId, creator.user_id, taskGroupId, action.title, parent.source_room_id],
  );
  for (const member of members.rows) {
    await client.query(`INSERT INTO room_members(room_id, user_id, role) VALUES ($1,$2,$3)`, [
      taskRoomId,
      member.user_id,
      member.user_id === creator.user_id ? "owner" : "member",
    ]);
  }
  for (const agent of agents.rows) {
    await client.query("INSERT INTO room_agents(room_id, agent_id, added_by) VALUES ($1,$2,$3)", [
      taskRoomId,
      agent.id,
      creator.user_id,
    ]);
  }
  await client.query(
    `INSERT INTO tasks(
       id, creator_id, requested_by_user_id, proposed_by_agent_id, source_room_id,
       task_room_id, anchor_message_id, title, objective, expected_result, plan,
       acceptance_criteria, requested_access, requested_scopes, status, revision,
       approved_review_id, started_by_user_id, started_at, context_version,
       latest_source_seq, approval_required, workspace_binding_id, binding_revision,
       parent_task_id, root_task_id, delegated_by_agent_id, depth, wait_reason
     ) VALUES (
       $1,$2,$2,$3,$4,$5,$6,$7,$8,$9,'[]'::jsonb,$10::jsonb,$11,$12::jsonb,$13,1,
       NULL,$2,now(),$14,$15,true,$16,$17,$18,$19,$3,$20,$21
     )`,
    [
      taskId,
      creator.user_id,
      delegatedByAgentId,
      parent.source_room_id,
      taskRoomId,
      `agent-action:${action.actionId}`,
      action.title,
      action.objective,
      action.expectedResult,
      JSON.stringify(action.acceptanceCriteria),
      requestedScopes.includes("workspace.write") ? "write" : "read",
      JSON.stringify(requestedScopes),
      status,
      parent.context_version,
      parent.latest_source_seq,
      parent.workspace_binding_id,
      parent.binding_revision,
      parent.id,
      parent.root_task_id,
      nextDepth,
      waitReason,
    ],
  );
  const review = await client.query<{
    reviewer_user_id: string;
    reviewer_role: string;
    reviewer_name_snapshot: string;
  }>(
    `SELECT reviewer_user_id, reviewer_role, reviewer_name_snapshot
     FROM task_reviews WHERE id = $1`,
    [parent.approved_review_id],
  );
  await client.query(
    `INSERT INTO task_reviews(
       id, task_id, task_revision, reviewer_user_id, reviewer_role,
       reviewer_name_snapshot, decision, comment, task_snapshot
     ) VALUES (
       $1,$2,1,$3,$4,$5,'approved','继承父 Task 已审核的委派范围。',$6::jsonb
     )`,
    [
      childReviewId,
      taskId,
      review.rows[0].reviewer_user_id,
      review.rows[0].reviewer_role,
      review.rows[0].reviewer_name_snapshot,
      JSON.stringify({
        title: action.title,
        objective: action.objective,
        expectedResult: action.expectedResult,
        plan: [],
        acceptanceCriteria: action.acceptanceCriteria,
        requestedAccess: requestedScopes.includes("workspace.write") ? "write" : "read",
        requestedScopes,
      }),
    ],
  );
  await client.query("UPDATE tasks SET approved_review_id = $1 WHERE id = $2", [
    childReviewId,
    taskId,
  ]);
  for (const agent of agents.rows) {
    await client.query("INSERT INTO task_assignees(task_id, agent_id) VALUES ($1,$2)", [
      taskId,
      agent.id,
    ]);
  }
  let childGrantId: string | null = null;
  if (inheritedGrant) {
    childGrantId = randomUUID();
    await client.query(
      `INSERT INTO task_permission_grants(
         id, task_id, task_revision, workspace_binding_id, binding_revision,
         host_user_id, host_device_id, scopes, constraints, approved_by_user_id, expires_at
       ) VALUES ($1,$2,1,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,
      [
        childGrantId,
        taskId,
        parent.workspace_binding_id,
        parent.binding_revision,
        parent.host_user_id,
        parent.host_device_id,
        JSON.stringify(requestedScopes.filter((scope) => inheritedGrant.scopes.includes(scope))),
        JSON.stringify(inheritedGrant.constraints),
        inheritedGrant.approved_by_user_id,
        inheritedGrant.expires_at,
      ],
    );
  }
  const runIds: string[] = [];
  if (status === "queued") {
    for (const agent of agents.rows) {
      const runId = randomUUID();
      runIds.push(runId);
      await client.query(
        `INSERT INTO task_runs(
           id, task_id, agent_id, status, execution_target, context_version,
           agent_snapshot, approval_id, started_by_user_id, target_device_id,
           permission_grant_id, parent_run_id, idempotency_key, requested_scopes, write_intent
         ) VALUES ($1,$2,$3,'queued',$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
        [
          runId,
          taskId,
          agent.id,
          agent.execution_target,
          parent.context_version,
          JSON.stringify(snapshotAgent(agent, requestedScopes.includes("workspace.write"))),
          childReviewId,
          creator.user_id,
          parent.host_device_id,
          childGrantId,
          parentRunId,
          `task:${taskId}:revision:1:agent:${agent.id}`,
          JSON.stringify(requestedScopes),
          requestedScopes.includes("workspace.write"),
        ],
      );
    }
  }
  await client.query(
    `UPDATE tasks SET budget_usage = $1::jsonb, updated_at = now() WHERE id = $2`,
    [
      JSON.stringify({
        ...usage,
        descendants: currentDescendants + 1,
        runs: currentRuns + plannedRuns,
        startedAt,
      }),
      parent.root_task_id,
    ],
  );
  await enqueueOutbox(client, "openim.group.create", "room", taskRoomId, {
    groupID: taskGroupId,
    name: action.title,
    ownerUserID: creator.openim_user_id,
    memberUserIDs: [
      ...members.rows.map((member) => member.openim_user_id),
      ...agents.rows.map((agent) => agent.openim_user_id),
    ],
  });
  return { taskId, taskRoomId, runIds, status, waitReason };
};

export const applyAgentActions = async (
  client: pg.PoolClient,
  input: {
    runId: string;
    taskId: string;
    taskRevision: number;
    agentId: string;
    actions: unknown[];
  },
) => {
  const parent = await parentContext(client, input.taskId);
  const createdTasks: Array<{ taskId: string; taskRoomId: string; status: string }> = [];
  const errors: string[] = [];
  const dispatchUserIds = new Set<string>();
  let hasCompletionSummary = false;
  if (!parent || parent.revision !== input.taskRevision) {
    return {
      createdTasks,
      errors: ["Agent 动作关联的 Task revision 已失效。"],
      dispatchUserIds,
      hasCompletionSummary,
    };
  }
  for (const raw of input.actions) {
    const parsed = actionSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push("Agent 动作格式或协议版本无效。");
      continue;
    }
    const action = parsed.data;
    if (action.taskId !== input.taskId || action.taskRevision !== input.taskRevision) {
      errors.push("Agent 动作与当前 Task 或 revision 不匹配。");
      continue;
    }
    const inserted = await client.query(
      `INSERT INTO task_agent_actions(
         task_id, task_revision, run_id, action_id, action_type, payload
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (task_id, action_id) DO NOTHING RETURNING id`,
      [
        input.taskId,
        input.taskRevision,
        input.runId,
        action.actionId,
        action.action,
        JSON.stringify(action),
      ],
    );
    if (!inserted.rowCount) continue;
    if (action.action === "create_subtask") {
      const result = await createSubtask(client, parent, input.agentId, input.runId, action);
      if ("error" in result) {
        errors.push(await rejectAction(client, input.taskId, action.actionId, result.error));
        await client.query(
          `UPDATE tasks SET status = $1, wait_reason = $2, updated_at = now()
           WHERE id = $3 AND status NOT IN ('done', 'failed', 'cancelled')`,
          [result.status, result.error, input.taskId],
        );
        if (result.status === "waiting_for_budget") {
          await client.query(
            `UPDATE tasks SET status = 'waiting_for_budget', wait_reason = $1, updated_at = now()
             WHERE id = $2 AND status NOT IN ('done', 'failed', 'cancelled')`,
            [result.error, parent.root_task_id],
          );
        }
      } else {
        createdTasks.push({
          taskId: result.taskId,
          taskRoomId: result.taskRoomId,
          status: result.status,
        });
        if (result.runIds.length) dispatchUserIds.add(parent.host_user_id);
        await client.query(
          `UPDATE task_agent_actions SET status = 'applied', applied_at = now()
           WHERE task_id = $1 AND action_id = $2`,
          [input.taskId, action.actionId],
        );
      }
    } else if (action.action === "assign_agent") {
      const child = await client.query(
        "SELECT 1 FROM tasks WHERE id = $1 AND parent_task_id = $2",
        [action.subtaskId, input.taskId],
      );
      if (!child.rowCount) {
        errors.push(
          await rejectAction(
            client,
            input.taskId,
            action.actionId,
            "只能重新分派当前 Task 的直接子 Task。",
          ),
        );
      } else {
        const agents = await client.query<{ id: string }>(
          `SELECT a.id FROM agents a JOIN room_agents ra ON ra.agent_id = a.id
           WHERE ra.room_id = $1
             AND a.id IN (${action.assigneeIds.map((_, index) => `$${index + 2}`).join(",")})
             AND a.archived_at IS NULL`,
          [parent.source_room_id, ...action.assigneeIds],
        );
        if (agents.rows.length !== new Set(action.assigneeIds).size) {
          await client.query(
            `UPDATE tasks SET status = 'waiting_for_assignee',
                    wait_reason = '重新分派的 Agent 不在群内或已停用。', updated_at = now()
             WHERE id = $1`,
            [action.subtaskId],
          );
        } else {
          await client.query("DELETE FROM task_assignees WHERE task_id = $1", [action.subtaskId]);
          for (const agent of agents.rows) {
            await client.query("INSERT INTO task_assignees(task_id, agent_id) VALUES ($1,$2)", [
              action.subtaskId,
              agent.id,
            ]);
          }
        }
        await client.query(
          `UPDATE task_agent_actions SET status = 'applied', applied_at = now()
           WHERE task_id = $1 AND action_id = $2`,
          [input.taskId, action.actionId],
        );
      }
    } else {
      const status =
        action.action === "request_permission"
          ? "waiting_for_permission"
          : action.action === "block"
            ? "blocked"
            : "review";
      const waitReason =
        action.action === "request_permission"
          ? action.reason
          : action.action === "block"
            ? action.reason
            : null;
      let artifacts: string[] | undefined;
      if (action.action === "complete") {
        const currentArtifacts = await client.query<{ artifact_refs: string[] }>(
          "SELECT artifact_refs FROM tasks WHERE id = $1",
          [input.taskId],
        );
        artifacts = [
          ...new Set([...(currentArtifacts.rows[0]?.artifact_refs ?? []), ...action.artifactRefs]),
        ];
      }
      const completionSummary =
        action.action === "complete" ? normalizeCompletionSummary(action.summary) : undefined;
      if (completionSummary) hasCompletionSummary = true;
      await client.query(
        `UPDATE tasks SET status = $1, wait_reason = $2,
                completion_summary = CASE
                  WHEN $3::text IS NULL THEN completion_summary
                  WHEN completion_summary IS NULL OR completion_summary = '' THEN $3
                  WHEN completion_summary = $3 THEN completion_summary
                  ELSE completion_summary || E'\\n' || $3
                END,
                artifact_refs = COALESCE($4::jsonb, artifact_refs), updated_at = now()
         WHERE id = $5`,
        [
          status,
          waitReason,
          completionSummary ?? null,
          artifacts ? JSON.stringify(artifacts) : null,
          input.taskId,
        ],
      );
      await client.query(
        `UPDATE task_agent_actions SET status = 'applied', applied_at = now()
         WHERE task_id = $1 AND action_id = $2`,
        [input.taskId, action.actionId],
      );
    }
    await appendCollaborationAudit(client, {
      actorAgentId: input.agentId,
      roomId: parent.source_room_id,
      taskId: input.taskId,
      taskRevision: input.taskRevision,
      runId: input.runId,
      hostDeviceId: parent.host_device_id,
      eventType: `agent_action.${action.action}`,
      summary: `Agent 提交的 ${action.action} 动作已处理。`,
      outcome: errors.length ? "blocked" : "applied",
      metadata: { actionId: action.actionId },
    });
  }
  return { createdTasks, errors, dispatchUserIds, hasCompletionSummary };
};
