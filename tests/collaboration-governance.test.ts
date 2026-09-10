import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeRoomAction,
  authorizeTaskLifecycleTransition,
  DEFAULT_TASK_BUDGET,
  evaluatePermissionEnvelope,
  normalizeExecutionApprovalRequest,
  normalizeTaskGovernance,
  normalizeTaskPermissionGrant,
  normalizeWorkspaceBindingSummary,
  parseAgentActionV1,
} from "../src/shared/collaboration-governance";
import type { PermissionScope, TaskPermissionGrant } from "../src/shared/agent-team";

test("legacy Tasks receive backward-compatible governed defaults", () => {
  const normalized = normalizeTaskGovernance({
    id: "task-old",
    requestedAccess: "write",
    createdAt: 100,
  });
  assert.deepEqual(normalized.requestedScopes, ["workspace.read", "workspace.write"]);
  assert.equal(normalized.rootTaskId, "task-old");
  assert.equal(normalized.depth, 0);
  assert.deepEqual(normalized.budget, DEFAULT_TASK_BUDGET);
  assert.deepEqual(normalized.budgetUsage, { descendants: 0, runs: 0, startedAt: 100 });
});

test("workspace binding summaries discard private or malformed fields", () => {
  const normalized = normalizeWorkspaceBindingSummary({
    id: "binding-1",
    hostUserId: "user-1",
    hostDeviceId: "device-1",
    label: "Project Alpha",
    repositoryUrl: "https://example.test/repo.git",
    localPath: "/private/project",
    revision: 2,
    baselineScopes: ["workspace.read", "workspace.write", "invalid"],
    status: "online",
  });
  assert.deepEqual(normalized, {
    id: "binding-1",
    hostUserId: "user-1",
    hostDeviceId: "device-1",
    label: "Project Alpha",
    repositoryUrl: "https://example.test/repo.git",
    revision: 2,
    baselineScopes: ["workspace.read", "workspace.write"],
    status: "online",
    lastSeenAt: undefined,
  });
  assert.equal(normalizeWorkspaceBindingSummary({ id: "missing-owner" }), undefined);
});

test("room roles allow discussion but reserve governed actions for owner and admin", () => {
  for (const role of ["owner", "admin", "member"] as const) {
    assert.equal(authorizeRoomAction(role, "chat").allowed, true);
    assert.equal(authorizeRoomAction(role, "request_task").allowed, true);
  }
  for (const action of [
    "review_task",
    "start_task",
    "change_task_status",
    "manage_binding",
    "change_budget",
  ] as const) {
    assert.equal(authorizeRoomAction("owner", action).allowed, true);
    assert.equal(authorizeRoomAction("admin", action).allowed, true);
    assert.deepEqual(authorizeRoomAction("member", action), {
      allowed: false,
      code: "ROOM_ADMIN_REQUIRED",
    });
    assert.deepEqual(authorizeRoomAction(undefined, action), {
      allowed: false,
      code: "ROOM_MEMBERSHIP_REQUIRED",
    });
  }
});

test("task lifecycle policy validates both the latest role and state transition", () => {
  assert.deepEqual(authorizeTaskLifecycleTransition("member", "review", "done"), {
    allowed: false,
    code: "ROOM_ADMIN_REQUIRED",
  });
  assert.equal(authorizeTaskLifecycleTransition("admin", "review", "done").allowed, true);
  assert.deepEqual(authorizeTaskLifecycleTransition("owner", "done", "running"), {
    allowed: false,
    code: "TASK_TRANSITION_INVALID",
  });
});

const grant = (overrides: Partial<TaskPermissionGrant> = {}): TaskPermissionGrant => ({
  id: "grant-1",
  taskId: "task-1",
  taskRevision: 2,
  workspaceBindingId: "binding-1",
  bindingRevision: 3,
  hostUserId: "host-user",
  hostDeviceId: "host-device",
  scopes: ["workspace.write", "command.run", "network.read"],
  constraints: {
    pathPrefixes: ["src"],
    commandExecutables: ["npm", "git"],
    networkDomains: ["api.example.com"],
  },
  approvedByUserId: "host-user",
  createdAt: 1_000,
  expiresAt: 10_000,
  ...overrides,
});

test("grant and approval parsers reject malformed or private extra fields", () => {
  assert.deepEqual(
    normalizeTaskPermissionGrant({ ...grant(), privatePath: "/private/project" }),
    grant(),
  );
  assert.equal(normalizeTaskPermissionGrant({ ...grant(), expiresAt: 500 }), undefined);

  const approval = normalizeExecutionApprovalRequest({
    id: "approval-1",
    idempotencyKey: "provider:request-1",
    taskId: "task-1",
    taskRevision: 2,
    runId: "run-1",
    sessionId: "session-1",
    turnId: "turn-1",
    agentId: "agent-1",
    workspaceBindingId: "binding-1",
    hostDeviceId: "host-device",
    providerRequestId: "request-1",
    requestedScope: "command.run",
    requestedConstraints: { commandExecutables: ["npm"] },
    summary: "Run npm test",
    encryptedDetails: "must-not-leak",
    status: "pending",
    createdAt: 1_000,
    expiresAt: 10_000,
  });
  assert.equal(approval?.summary, "Run npm test");
  assert.equal("encryptedDetails" in (approval ?? {}), false);
  assert.equal(normalizeExecutionApprovalRequest({ ...approval, status: "unknown" }), undefined);
});

const evaluate = (
  request: {
    scopes: PermissionScope[];
    path?: string;
    commandExecutable?: string;
    networkDomain?: string;
  },
  overrides: Partial<Parameters<typeof evaluatePermissionEnvelope>[0]> = {},
) =>
  evaluatePermissionEnvelope({
    taskId: "task-1",
    taskRevision: 2,
    workspaceBindingId: "binding-1",
    bindingRevision: 3,
    hostDeviceId: "host-device",
    taskScopes: ["workspace.read", "workspace.write", "command.run", "network.read"],
    agentScopes: ["workspace.read", "workspace.write", "command.run", "network.read"],
    baselineScopes: ["workspace.read"],
    grants: [grant()],
    request,
    now: 2_000,
    ...overrides,
  });

test("permission envelope accepts baseline read and constrained grants", () => {
  assert.equal(evaluate({ scopes: ["workspace.read"] }).allowed, true);
  assert.equal(evaluate({ scopes: ["workspace.write"], path: "src/main.ts" }).allowed, true);
  assert.equal(evaluate({ scopes: ["command.run"], commandExecutable: "npm" }).allowed, true);
  assert.equal(
    evaluate({ scopes: ["network.read"], networkDomain: "v1.api.example.com" }).allowed,
    true,
  );
});

test("permission envelope rejects missing task, Agent, parent, stale grant, and constraint scopes", () => {
  assert.equal(
    evaluate({ scopes: ["workspace.write"] }, { taskScopes: ["workspace.read"] }).reason,
    "TASK_SCOPE_MISSING",
  );
  assert.equal(
    evaluate({ scopes: ["workspace.write"] }, { agentScopes: ["workspace.read"] }).reason,
    "AGENT_CAPABILITY_MISSING",
  );
  assert.equal(
    evaluate({ scopes: ["workspace.write"] }, { parentScopes: ["workspace.read"] }).reason,
    "PARENT_SCOPE_MISSING",
  );
  assert.equal(
    evaluate({ scopes: ["workspace.write"] }, { taskRevision: 3 }).reason,
    "GRANT_MISSING_OR_STALE",
  );
  assert.equal(
    evaluate({ scopes: ["workspace.write"], path: "../secret" }).reason,
    "CONSTRAINT_MISMATCH",
  );
  assert.equal(
    evaluate({ scopes: ["command.run"], commandExecutable: "npm;rm" }).reason,
    "CONSTRAINT_MISMATCH",
  );
  assert.equal(
    evaluate({ scopes: ["network.read"], networkDomain: "evil-example.com" }).reason,
    "CONSTRAINT_MISMATCH",
  );
  assert.equal(
    evaluate({ scopes: ["workspace.write"] }, { grants: [grant({ revokedAt: 1_500 })] }).reason,
    "GRANT_MISSING_OR_STALE",
  );
});

test("AgentActionV1 parser accepts valid structured actions and rejects malformed input", () => {
  const action = parseAgentActionV1({
    protocolVersion: 1,
    actionId: "action-1",
    taskId: "task-1",
    taskRevision: 2,
    action: "create_subtask",
    title: "Review authorization",
    objective: "Review the authorization policy",
    expectedResult: "A review report",
    assigneeIds: ["agent-reviewer"],
    requestedScopes: ["workspace.read", "workspace.write", "unknown"],
    acceptanceCriteria: ["Report is posted"],
  });
  assert.equal(action?.action, "create_subtask");
  assert.deepEqual(action?.requestedScopes, ["workspace.read", "workspace.write"]);
  assert.equal(parseAgentActionV1({ ...action, protocolVersion: 2 }), undefined);
  assert.equal(parseAgentActionV1({ ...action, assigneeIds: [] }), undefined);
  assert.equal(parseAgentActionV1({ protocolVersion: 1, action: "unknown" }), undefined);
});
