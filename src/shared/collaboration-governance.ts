import type {
  AgentActionV1,
  AgentTask,
  ExecutionApprovalRequest,
  PermissionConstraints,
  PermissionScope,
  RoomMemberRole,
  TaskBudget,
  TaskBudgetUsage,
  TaskPermissionGrant,
  TaskStatus,
  WorkspaceBindingSummary,
} from "./agent-team";

export const DEFAULT_TASK_BUDGET: TaskBudget = {
  maxDepth: 3,
  maxDescendants: 12,
  maxRuns: 24,
  maxWallTimeMs: 30 * 60 * 1_000,
};

const PERMISSION_SCOPES = new Set<PermissionScope>([
  "workspace.read",
  "workspace.write",
  "command.run",
  "network.read",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringValue = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const stringArray = (value: unknown, max = 64) =>
  Array.isArray(value) ? [...new Set(value.map(stringValue).filter(Boolean))].slice(0, max) : [];

export const normalizePermissionScopes = (value: unknown): PermissionScope[] =>
  stringArray(value).filter((scope): scope is PermissionScope =>
    PERMISSION_SCOPES.has(scope as PermissionScope),
  );

export const normalizePermissionConstraints = (value: unknown): PermissionConstraints => {
  if (!isRecord(value)) return {};
  const pathPrefixes = stringArray(value.pathPrefixes);
  const commandExecutables = stringArray(value.commandExecutables);
  const networkDomains = stringArray(value.networkDomains).map((domain) => domain.toLowerCase());
  return {
    ...(pathPrefixes.length ? { pathPrefixes } : {}),
    ...(commandExecutables.length ? { commandExecutables } : {}),
    ...(networkDomains.length ? { networkDomains } : {}),
  };
};

export const normalizeWorkspaceBindingSummary = (
  value: unknown,
): WorkspaceBindingSummary | undefined => {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const hostUserId = stringValue(value.hostUserId);
  const hostDeviceId = stringValue(value.hostDeviceId);
  const label = stringValue(value.label);
  if (!id || !hostUserId || !hostDeviceId || !label) return undefined;
  const status = ["online", "offline", "unknown", "revoked"].includes(stringValue(value.status))
    ? (value.status as WorkspaceBindingSummary["status"])
    : "unknown";
  return {
    id,
    hostUserId,
    hostDeviceId,
    label: label.slice(0, 120),
    repositoryUrl: stringValue(value.repositoryUrl) || undefined,
    revision: Math.max(1, Math.floor(Number(value.revision) || 1)),
    baselineScopes: normalizePermissionScopes(value.baselineScopes),
    status,
    lastSeenAt: Number(value.lastSeenAt) || undefined,
  };
};

export const normalizeTaskPermissionGrant = (value: unknown): TaskPermissionGrant | undefined => {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const taskId = stringValue(value.taskId);
  const workspaceBindingId = stringValue(value.workspaceBindingId);
  const hostUserId = stringValue(value.hostUserId);
  const hostDeviceId = stringValue(value.hostDeviceId);
  const approvedByUserId = stringValue(value.approvedByUserId);
  const scopes = normalizePermissionScopes(value.scopes);
  const createdAt = Number(value.createdAt);
  const expiresAt = Number(value.expiresAt);
  if (
    !id ||
    !taskId ||
    !workspaceBindingId ||
    !hostUserId ||
    !hostDeviceId ||
    !approvedByUserId ||
    !scopes.length ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= createdAt
  ) {
    return undefined;
  }
  return {
    id,
    taskId,
    taskRevision: Math.max(1, Math.floor(Number(value.taskRevision) || 1)),
    workspaceBindingId,
    bindingRevision: Math.max(1, Math.floor(Number(value.bindingRevision) || 1)),
    hostUserId,
    hostDeviceId,
    scopes,
    constraints: normalizePermissionConstraints(value.constraints),
    approvedByUserId,
    createdAt,
    expiresAt,
    ...(Number(value.revokedAt) ? { revokedAt: Number(value.revokedAt) } : {}),
  };
};

export const normalizeExecutionApprovalRequest = (
  value: unknown,
): ExecutionApprovalRequest | undefined => {
  if (!isRecord(value)) return undefined;
  const requiredStrings = [
    "id",
    "idempotencyKey",
    "taskId",
    "runId",
    "sessionId",
    "turnId",
    "agentId",
    "workspaceBindingId",
    "hostDeviceId",
    "providerRequestId",
    "summary",
  ] as const;
  const strings = Object.fromEntries(
    requiredStrings.map((key) => [key, stringValue(value[key])]),
  ) as Record<(typeof requiredStrings)[number], string>;
  if (requiredStrings.some((key) => !strings[key])) return undefined;
  const requestedScope = normalizePermissionScopes([value.requestedScope])[0];
  const status = stringValue(value.status);
  const decision = stringValue(value.decision);
  const createdAt = Number(value.createdAt);
  const expiresAt = Number(value.expiresAt);
  if (
    !requestedScope ||
    !["pending", "approved", "denied", "expired"].includes(status) ||
    (decision && !["deny", "allow_once", "allow_for_task"].includes(decision)) ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= createdAt
  ) {
    return undefined;
  }
  return {
    ...strings,
    taskRevision: Math.max(1, Math.floor(Number(value.taskRevision) || 1)),
    requestedScope,
    requestedConstraints: normalizePermissionConstraints(value.requestedConstraints),
    summary: strings.summary.slice(0, 500),
    status: status as ExecutionApprovalRequest["status"],
    ...(decision ? { decision: decision as ExecutionApprovalRequest["decision"] } : {}),
    ...(stringValue(value.decidedByUserId)
      ? { decidedByUserId: stringValue(value.decidedByUserId) }
      : {}),
    createdAt,
    expiresAt,
    ...(Number(value.decidedAt) ? { decidedAt: Number(value.decidedAt) } : {}),
  };
};

export const normalizeTaskBudget = (value: unknown): TaskBudget => {
  const raw = isRecord(value) ? value : {};
  return {
    maxDepth: Math.max(
      0,
      Math.min(8, Math.floor(Number(raw.maxDepth) || DEFAULT_TASK_BUDGET.maxDepth)),
    ),
    maxDescendants: Math.max(
      0,
      Math.min(100, Math.floor(Number(raw.maxDescendants) || DEFAULT_TASK_BUDGET.maxDescendants)),
    ),
    maxRuns: Math.max(
      1,
      Math.min(500, Math.floor(Number(raw.maxRuns) || DEFAULT_TASK_BUDGET.maxRuns)),
    ),
    maxWallTimeMs: Math.max(
      60_000,
      Math.min(
        24 * 60 * 60 * 1_000,
        Math.floor(Number(raw.maxWallTimeMs) || DEFAULT_TASK_BUDGET.maxWallTimeMs),
      ),
    ),
  };
};

export const normalizeTaskBudgetUsage = (
  value: unknown,
  fallbackStartedAt: number,
): TaskBudgetUsage => {
  const raw = isRecord(value) ? value : {};
  return {
    descendants: Math.max(0, Math.floor(Number(raw.descendants) || 0)),
    runs: Math.max(0, Math.floor(Number(raw.runs) || 0)),
    startedAt: Number(raw.startedAt) || fallbackStartedAt,
  };
};

export const normalizeTaskGovernance = (
  task: Partial<AgentTask>,
): Pick<
  AgentTask,
  | "requestedScopes"
  | "workspaceBinding"
  | "workspaceBindingRevision"
  | "permissionGrantIds"
  | "rootTaskId"
  | "parentTaskId"
  | "delegatedByAgentId"
  | "depth"
  | "budget"
  | "budgetUsage"
  | "waitReason"
  | "artifactRefs"
  | "completionSummary"
  | "sourceSummaryPublishedAt"
> => {
  const requestedScopes = normalizePermissionScopes(task.requestedScopes);
  const createdAt = Number(task.createdAt) || Date.now();
  return {
    requestedScopes:
      requestedScopes.length > 0
        ? requestedScopes
        : task.requestedAccess === "write"
          ? ["workspace.read", "workspace.write"]
          : ["workspace.read"],
    workspaceBinding: normalizeWorkspaceBindingSummary(task.workspaceBinding),
    workspaceBindingRevision: Math.max(
      1,
      Math.floor(Number(task.workspaceBindingRevision ?? task.workspaceBinding?.revision) || 1),
    ),
    permissionGrantIds: stringArray(task.permissionGrantIds),
    rootTaskId: stringValue(task.rootTaskId) || stringValue(task.id),
    parentTaskId: stringValue(task.parentTaskId) || undefined,
    delegatedByAgentId: stringValue(task.delegatedByAgentId) || undefined,
    depth: Math.max(0, Math.min(8, Math.floor(Number(task.depth) || 0))),
    budget: normalizeTaskBudget(task.budget),
    budgetUsage: normalizeTaskBudgetUsage(task.budgetUsage, createdAt),
    waitReason: stringValue(task.waitReason) || undefined,
    artifactRefs: stringArray(task.artifactRefs),
    completionSummary: stringValue(task.completionSummary).slice(0, 4_000) || undefined,
    sourceSummaryPublishedAt: Number(task.sourceSummaryPublishedAt) || undefined,
  };
};

export type RoomGovernedAction =
  | "chat"
  | "request_task"
  | "review_task"
  | "start_task"
  | "change_task_status"
  | "manage_binding"
  | "change_budget";

export type AuthorizationDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "ROOM_MEMBERSHIP_REQUIRED" | "ROOM_ADMIN_REQUIRED" | "TASK_TRANSITION_INVALID";
    };

export const authorizeRoomAction = (
  role: RoomMemberRole | undefined,
  action: RoomGovernedAction,
): AuthorizationDecision => {
  if (!role) return { allowed: false, code: "ROOM_MEMBERSHIP_REQUIRED" };
  if (action === "chat" || action === "request_task") return { allowed: true };
  return role === "owner" || role === "admin"
    ? { allowed: true }
    : { allowed: false, code: "ROOM_ADMIN_REQUIRED" };
};

const TASK_LIFECYCLE_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  pending_review: new Set(["changes_requested", "approved", "cancelled"]),
  changes_requested: new Set(["pending_review", "cancelled"]),
  approved: new Set(["queued", "waiting_for_host", "waiting_for_permission", "cancelled"]),
  queued: new Set([
    "running",
    "waiting_for_host",
    "waiting_for_permission",
    "waiting_for_assignee",
    "waiting_for_budget",
    "cancelled",
  ]),
  running: new Set([
    "waiting",
    "waiting_for_host",
    "waiting_for_permission",
    "waiting_for_approval",
    "waiting_for_assignee",
    "waiting_for_budget",
    "review",
    "blocked",
    "failed",
    "cancelled",
  ]),
  waiting: new Set(["queued", "running", "blocked", "failed", "cancelled"]),
  waiting_for_host: new Set(["queued", "running", "blocked", "failed", "cancelled"]),
  waiting_for_permission: new Set(["queued", "running", "blocked", "failed", "cancelled"]),
  waiting_for_approval: new Set(["running", "blocked", "failed", "cancelled"]),
  waiting_for_assignee: new Set(["queued", "blocked", "cancelled"]),
  waiting_for_budget: new Set(["queued", "running", "blocked", "cancelled"]),
  review: new Set(["done", "changes_requested", "blocked", "cancelled"]),
  blocked: new Set(["queued", "cancelled"]),
  done: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export const authorizeTaskLifecycleTransition = (
  role: RoomMemberRole | undefined,
  from: TaskStatus,
  to: TaskStatus,
): AuthorizationDecision => {
  const roleDecision = authorizeRoomAction(role, "change_task_status");
  if (!roleDecision.allowed) return roleDecision;
  return TASK_LIFECYCLE_TRANSITIONS[from].has(to)
    ? { allowed: true }
    : { allowed: false, code: "TASK_TRANSITION_INVALID" };
};

export type PermissionRequest = {
  scopes: PermissionScope[];
  path?: string;
  commandExecutable?: string;
  networkDomain?: string;
};

export type PermissionEvaluation = {
  allowed: boolean;
  effectiveScopes: PermissionScope[];
  missingScopes: PermissionScope[];
  reason?:
    | "TASK_SCOPE_MISSING"
    | "AGENT_CAPABILITY_MISSING"
    | "PARENT_SCOPE_MISSING"
    | "GRANT_MISSING_OR_STALE"
    | "CONSTRAINT_MISMATCH";
  grantIds: string[];
};

type PermissionEvaluationInput = {
  taskId: string;
  taskRevision: number;
  workspaceBindingId: string;
  bindingRevision: number;
  hostDeviceId: string;
  taskScopes: PermissionScope[];
  agentScopes: PermissionScope[];
  baselineScopes: PermissionScope[];
  parentScopes?: PermissionScope[];
  grants: TaskPermissionGrant[];
  request: PermissionRequest;
  now?: number;
};

const currentGrant = (grant: TaskPermissionGrant, input: PermissionEvaluationInput, now: number) =>
  grant.taskId === input.taskId &&
  grant.taskRevision === input.taskRevision &&
  grant.workspaceBindingId === input.workspaceBindingId &&
  grant.bindingRevision === input.bindingRevision &&
  grant.hostDeviceId === input.hostDeviceId &&
  !grant.revokedAt &&
  grant.expiresAt > now;

const isSafeWorkspacePath = (value: string) => {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  return (
    Boolean(normalized) &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.split("/").includes("..")
  );
};

const pathMatches = (path: string, prefixes: string[] | undefined) => {
  if (!isSafeWorkspacePath(path)) return false;
  if (!prefixes?.length) return true;
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  return prefixes.some((prefix) => {
    const candidate = prefix.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
    return candidate && (normalized === candidate || normalized.startsWith(`${candidate}/`));
  });
};

const commandMatches = (executable: string, allowed: string[] | undefined) =>
  Boolean(executable) &&
  !/[;&|`$<>\n\r]/.test(executable) &&
  Boolean(allowed?.includes(executable));

const domainMatches = (domain: string, allowed: string[] | undefined) => {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, "");
  return (
    Boolean(normalized) &&
    Boolean(allowed?.some((item) => normalized === item || normalized.endsWith(`.${item}`)))
  );
};

const constraintsAllow = (
  scope: PermissionScope,
  request: PermissionRequest,
  grant: TaskPermissionGrant,
) => {
  if (request.path && (scope === "workspace.read" || scope === "workspace.write"))
    return pathMatches(request.path, grant.constraints.pathPrefixes);
  if (request.commandExecutable && scope === "command.run")
    return commandMatches(request.commandExecutable, grant.constraints.commandExecutables);
  if (request.networkDomain && scope === "network.read")
    return domainMatches(request.networkDomain, grant.constraints.networkDomains);
  return true;
};

export const evaluatePermissionEnvelope = (
  input: PermissionEvaluationInput,
): PermissionEvaluation => {
  const requested = [...new Set(input.request.scopes)];
  const taskScopes = new Set(input.taskScopes);
  const agentScopes = new Set(input.agentScopes);
  const parentScopes = input.parentScopes ? new Set(input.parentScopes) : undefined;
  const now = input.now ?? Date.now();
  const grants = input.grants.filter((grant) => currentGrant(grant, input, now));
  const effectiveScopes: PermissionScope[] = [];
  const grantIds = new Set<string>();

  for (const scope of requested) {
    if (!taskScopes.has(scope))
      return {
        allowed: false,
        effectiveScopes,
        missingScopes: [scope],
        reason: "TASK_SCOPE_MISSING",
        grantIds: [...grantIds],
      };
    if (!agentScopes.has(scope))
      return {
        allowed: false,
        effectiveScopes,
        missingScopes: [scope],
        reason: "AGENT_CAPABILITY_MISSING",
        grantIds: [...grantIds],
      };
    if (parentScopes && !parentScopes.has(scope))
      return {
        allowed: false,
        effectiveScopes,
        missingScopes: [scope],
        reason: "PARENT_SCOPE_MISSING",
        grantIds: [...grantIds],
      };

    if (
      scope === "workspace.read" &&
      input.baselineScopes.includes(scope) &&
      !input.request.path &&
      !input.request.commandExecutable &&
      !input.request.networkDomain
    ) {
      effectiveScopes.push(scope);
      continue;
    }
    const scopeGrants = grants.filter((grant) => grant.scopes.includes(scope));
    if (!scopeGrants.length)
      return {
        allowed: false,
        effectiveScopes,
        missingScopes: [scope],
        reason: "GRANT_MISSING_OR_STALE",
        grantIds: [...grantIds],
      };
    const matchingGrant = scopeGrants.find((grant) =>
      constraintsAllow(scope, input.request, grant),
    );
    if (!matchingGrant)
      return {
        allowed: false,
        effectiveScopes,
        missingScopes: [scope],
        reason: "CONSTRAINT_MISMATCH",
        grantIds: [...grantIds],
      };
    effectiveScopes.push(scope);
    grantIds.add(matchingGrant.id);
  }

  return {
    allowed: true,
    effectiveScopes,
    missingScopes: [],
    grantIds: [...grantIds],
  };
};

const baseAction = (raw: Record<string, unknown>) => {
  const protocolVersion = Number(raw.protocolVersion);
  const actionId = stringValue(raw.actionId);
  const taskId = stringValue(raw.taskId);
  const taskRevision = Math.floor(Number(raw.taskRevision));
  if (protocolVersion !== 1 || !actionId || !taskId || taskRevision < 1) return undefined;
  return { protocolVersion: 1 as const, actionId, taskId, taskRevision };
};

export const parseAgentActionV1 = (value: unknown): AgentActionV1 | undefined => {
  if (!isRecord(value)) return undefined;
  const base = baseAction(value);
  const action = stringValue(value.action);
  if (!base) return undefined;

  if (action === "create_subtask") {
    const title = stringValue(value.title).slice(0, 200);
    const objective = stringValue(value.objective).slice(0, 4_000);
    const expectedResult = stringValue(value.expectedResult).slice(0, 4_000);
    const assigneeIds = stringArray(value.assigneeIds, 16);
    if (!title || !objective || !expectedResult || !assigneeIds.length) return undefined;
    return {
      ...base,
      action,
      title,
      objective,
      expectedResult,
      assigneeIds,
      requestedScopes: normalizePermissionScopes(value.requestedScopes),
      acceptanceCriteria: stringArray(value.acceptanceCriteria, 32),
    };
  }
  if (action === "assign_agent") {
    const subtaskId = stringValue(value.subtaskId);
    const assigneeIds = stringArray(value.assigneeIds, 16);
    return subtaskId && assigneeIds.length
      ? { ...base, action, subtaskId, assigneeIds }
      : undefined;
  }
  if (action === "request_review") {
    return { ...base, action, reviewerAgentId: stringValue(value.reviewerAgentId) || undefined };
  }
  if (action === "request_permission") {
    const requestedScopes = normalizePermissionScopes(value.requestedScopes);
    const reason = stringValue(value.reason).slice(0, 2_000);
    return requestedScopes.length && reason
      ? {
          ...base,
          action,
          requestedScopes,
          constraints: normalizePermissionConstraints(value.constraints),
          reason,
        }
      : undefined;
  }
  if (action === "block") {
    const reason = stringValue(value.reason).slice(0, 2_000);
    return reason ? { ...base, action, reason } : undefined;
  }
  if (action === "complete") {
    const summary = stringValue(value.summary).slice(0, 4_000);
    return summary
      ? { ...base, action, summary, artifactRefs: stringArray(value.artifactRefs, 64) }
      : undefined;
  }
  return undefined;
};

const ACTION_MARKERS = [
  /<!--\s*agent-action-v1\s*([\s\S]*?)-->/gi,
  /```agent-action-v1\s*([\s\S]*?)```/gi,
];

export const extractAgentActionsV1 = (content: string) => {
  const actions: AgentActionV1[] = [];
  let invalidCount = 0;
  let cleanContent = content;
  for (const marker of ACTION_MARKERS) {
    cleanContent = cleanContent.replace(marker, (_match, payload: string) => {
      try {
        const action = parseAgentActionV1(JSON.parse(payload.trim()));
        if (action) actions.push(action);
        else invalidCount += 1;
      } catch {
        invalidCount += 1;
      }
      return "";
    });
  }
  return {
    content: cleanContent.replace(/\n{3,}/g, "\n\n").trim(),
    actions,
    invalidCount,
  };
};
