## Context

See `proposal.md` for motivation. The current system already has `room_members.role`, `workspace_bindings`, reviewed Tasks, leased `task_runs`, a realtime Agent Host protocol, normalized Runtime approval events, local write serialization, and Agent discussion Loops. The gaps are that Task authorization checks only membership in several endpoints, runs are dispatched by Agent owner rather than an explicit project host, remote approvals are not bridged, and Agent delegation is represented primarily by chat text and Loop metadata.

The backend must become authoritative for shared authorization and execution state. The bound desktop remains authoritative for its private local path, provider session, credentials, and the final decision to perform a machine-side action.

## Goals / Non-Goals

**Goals:**

- Complete one secure multi-user loop from group request through delegated execution, review, and audit.
- Make every machine operation attributable to one Task revision, one workspace binding, and one host device.
- Allow useful Agent autonomy inside a bounded grant without allowing Agents or room members to expand it.
- Preserve local-only behavior and existing Agent identities, messages, rooms, and Task history.

**Non-Goals:**

- Distributed writes across multiple member computers or automatic repository merge coordination.
- Hosted cloud Runtime workers.
- Browser clicking, native application automation, external publishing, deployment, or remote destructive actions.
- Replacing OpenIM as the chat transport or using OpenIM membership as the authorization database.

## Decisions

### 1. Separate the collaboration plane from the execution plane

OpenIM carries human and Agent-visible messages. The Chat API owns rooms, roles, Tasks, grants, leases, approvals, budgets, and audit events. The Agent Host owns the local workspace mapping and Runtime process.

A normal group has one active `RoomWorkspaceBinding` containing an opaque `workspaceBindingId`, `hostUserId`, `hostDeviceId`, display label, repository identity, revision, baseline read scopes, and status. The device keeps the mapping from the opaque ID to an absolute path in local secure storage. Task creation snapshots the binding ID and revision. `task_runs.target_device_id` is assigned before leasing, and realtime dispatch filters by it.

Alternative considered: continue dispatching each run to the Agent owner's device. Rejected because Agent ownership does not prove that devices share a path, repository revision, or credential set.

### 2. Use two independent authorization gates

Gate A is business authority: a room `owner` or `admin` approves the Task revision, plan, assignees, requested scopes, and budget. Gate B is machine authority: the workspace host owner signs a `TaskPermissionGrant` for the same revision and binding.

The effective scopes are the intersection of the Task request, Agent capabilities, room baseline, host grant, and any parent Task grant. Missing scopes deny by default. Editing a security-relevant Task field increments its revision and revokes prior approval and grants in one transaction.

Existing Task review/start/status endpoints will use a shared server-side authorization policy instead of membership-only queries. Local-only mode calls the same policy with the local user holding both roles.

Alternative considered: let any room member approve because all members can see the Task. Rejected because group membership does not grant authority over another person's project or computer.

### 3. Model permission grants and approval requests separately

`TaskPermissionGrant` authorizes a reusable envelope: scopes, path constraints, command constraints, network domains, expiry, Task revision, binding revision, approver, and revocation state. It never stores a provider request ID.

`ExecutionApprovalRequest` represents one suspended Runtime request and includes a unique idempotency key plus Task, Run, Session, Turn, Agent, host device, provider request ID, risk classification, redacted summary, encrypted private details, expiry, and decision. Decisions are `deny`, `allow_once`, or `allow_for_task`; the last creates a grant no broader than the request before resolving the Runtime request.

Automatic command permission is limited to normalized executable/cwd/argument constraints configured in the grant. Shell composition, workspace escape, credential access, unknown commands, and unapproved domains always create an execution approval. Unsupported external side effects are denied rather than offered for approval in this release.

Alternative considered: translate all approvals directly through WebSocket without persistence. Rejected because disconnects would lose authority state and make duplicate or stale decisions hard to reject.

### 4. Extend the Host protocol with resumable approvals

The Agent Host sends `approval.requested` with the run lease, correlation identifiers, scope request, summary, and encrypted detail. The server validates the active lease, upserts by idempotency key, marks the Run `waiting_for_approval`, and notifies only the host owner. A decision is persisted first, then delivered as `approval.resolved` to the device holding the matching lease.

The Host resolves the exact Runtime provider request without creating a second Turn. Heartbeats include pending approval IDs so the server can redeliver missing decisions. If the provider session cannot preserve the request after restart, the Host reports a structured non-resumable failure; the system never replays the machine action automatically.

### 5. Persist Agent delegation as a Task tree

Provider portability requires a versioned `AgentActionV1` envelope. Runtimes with native structured tool calls may emit it directly; text-only Runtimes may use the existing hidden marker transport, but the orchestrator validates the same schema and strips it before publishing chat content.

Supported actions are `create_subtask`, `assign_agent`, `request_review`, `request_permission`, `block`, and `complete`. A subtask stores `parent_task_id`, `root_task_id`, `delegated_by_agent_id`, inherited binding revision, requested scopes, and budget counters. The server verifies room membership, Agent availability, capabilities, permission intersection, and remaining root budget before inserting the subtask and consuming budget atomically.

Defaults are depth 3, 12 descendants, 24 total Runs, and 30 minutes wall time. Read-only Runs can lease concurrently. A database-backed workspace write lease keyed by binding ID allows only one potentially writing Run at a time, including Runs owned by different Agents. Existing Agent Loop remains a non-authoritative discussion primitive.

Alternative considered: allow Agent mentions to recursively schedule Runs. Rejected because mentions lack durable scope, parentage, budget accounting, and reliable failure recovery.

### 6. Expose one state model to chat, Task board, and approvals

Shared contracts add workspace-binding summaries, Task authority, grant summaries, Task hierarchy, budgets, and actionable wait reasons. Task statuses gain `waiting_for_host`, `waiting_for_permission`, `waiting_for_approval`, `waiting_for_assignee`, and `waiting_for_budget`; backend and local snapshots use the same values.

The team UI shows compact system events in the message flow and an inspector for the Task tree, host readiness, permission envelope, approvals, and redacted audit. Exact command/path details are returned only to the authorized host owner. New components and states are documented in the design system.

### 7. Make audit append-only and audience-aware

`collaboration_audit_events` records actor, room, Task/revision, Run, Agent, host device, event type, redacted summary, outcome, and timestamp. Private approval payloads use the existing envelope cipher and are excluded from room snapshots and OpenIM messages. The API applies audience-specific serialization rather than relying on the UI to hide fields.

## Risks / Trade-offs

- [A single host is a throughput and availability bottleneck] -> Expose host health, queue state, and explicit rebinding; do not silently route elsewhere.
- [Provider approval semantics differ] -> Keep the normalized decision set small, require correlation metadata, and mark unsupported/non-resumable providers clearly.
- [Command classification can be bypassed through shells] -> Auto-allow only validated executable/cwd/argument constraints; route composed or unknown commands to approval.
- [Task trees can create noisy chat] -> Publish compact lifecycle events and keep detailed Run output in the Task inspector.
- [Migration could accidentally grant old Tasks new authority] -> Migrate old active Tasks without a permission grant and require review before their next machine action.
- [Server-side encrypted approval detail is still sensitive] -> Limit retention, redact audit summaries, never place secrets in OpenIM, and restrict exact detail to the host owner.

## Migration Plan

1. Add nullable binding, hierarchy, budget, grant, approval, write-lease, and audit schema while old clients continue to read existing rooms and Tasks.
2. Register existing device workspace mappings as opaque bindings. Existing local rooms receive a local binding; cloud rooms remain unbound until a host owner shares one.
3. Deploy serializers and read APIs, then role enforcement and grant checks behind `governedExecution` capability negotiation.
4. Upgrade Agent Host and desktop clients to the new realtime protocol before enabling governed remote execution.
5. Enable structured delegation only after binding, authorization, approval, and audit tests pass end to end.
6. Rollback disables new execution and delegation while retaining the new records for audit; schema columns remain backward compatible and existing chat history is untouched.

