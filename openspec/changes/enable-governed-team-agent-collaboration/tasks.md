## 1. Shared contracts and authorization policy

- [x] 1.1 Add shared workspace-binding, permission-grant, execution-approval, Task hierarchy, budget, wait-status, and `AgentActionV1` types with backward-compatible snapshot parsers; verify focused parser tests and `npm run typecheck` pass.
- [x] 1.2 Implement pure room-role and Task-lifecycle authorization policies for owner/admin/member behavior; verify table-driven tests reject member review/start/status mutations while preserving chat and proposal access.
- [x] 1.3 Implement the permission-envelope evaluator and invalidation rules for Task revision, binding revision, parent grants, scope constraints, expiry, and revocation; verify unit tests cover every allow and deny branch.

## 2. Backend persistence and room binding

- [x] 2.1 Add a backward-compatible migration for opaque workspace bindings, room bindings, Task binding snapshots and hierarchy, budgets, grants, approvals, write leases, audit events, and new wait statuses; verify migration from the existing schema and a fresh database both succeed.
- [x] 2.2 Add host-owner APIs to register a private local workspace mapping as an opaque binding and share a redacted binding summary with a room; verify API tests never return absolute paths or private config to another member.
- [x] 2.3 Add owner/admin APIs to activate or replace a room workspace binding with optimistic revision checks; verify unauthorized role, stale revision, unshared binding, and rebinding-active-Task scenarios.
- [x] 2.4 Snapshot the room binding into new Tasks and mark existing Tasks as requiring reconfirmation after a rebind; verify Task creation, child inheritance, and rebind tests.

## 3. Governed Task authorization

- [x] 3.1 Apply the shared role policy to Task proposal, review, start, budget, and lifecycle endpoints instead of membership-only checks; verify backend integration tests cover owner, admin, member, removed member, and host-owner-only cases.
- [x] 3.2 Add Task permission-grant create, list, and revoke endpoints restricted to the bound host owner; verify grant constraints cannot exceed requested scopes, room baseline, parent grant, Agent capabilities, or current revisions.
- [x] 3.3 Make Task start require both a current admin review and a valid host grant whenever machine scopes are requested; verify missing or stale gates produce actionable waiting states without creating a TaskRun.
- [x] 3.4 Add audience-aware append-only audit serialization for binding, review, grant, delegation, execution, denial, failure, and revocation events; verify secrets and host paths are redacted in room-member responses.

## 4. Single-host routing and recovery

- [x] 4.1 Change TaskRun creation and realtime leasing to target the Task's bound device rather than the Agent owner's arbitrary device; verify a non-bound device cannot lease the Run.
- [x] 4.2 Implement `waiting_for_host`, bound-device heartbeat recovery, idempotent Run creation, and lease redelivery; verify offline/reconnect and expired-lease tests do not duplicate execution.
- [x] 4.3 Add a binding-keyed backend write lease while retaining parallel read leases; verify two write Runs serialize across Agents and read-only Runs remain concurrent.
- [x] 4.4 Store the opaque binding-to-path mapping on the owning desktop and resolve it before Runtime session creation; verify invalid, removed, or mismatched mappings fail before launching a Runtime.

## 5. Remote execution approvals

- [x] 5.1 Extend normalized Runtime approval events with Task, revision, Run, Session, Turn, Agent, device, and provider-request correlation; verify Codex and supported custom Runtime adapters preserve identifiers.
- [x] 5.2 Extend the Agent Host realtime protocol with approval request, pending-ID heartbeat, and approval resolution events; verify schema validation rejects stale lease, wrong device, wrong request ID, and duplicate decisions.
- [x] 5.3 Persist encrypted approval details, redacted summaries, expiry, and decisions in the backend and notify only the host owner; verify room admins who do not own the host cannot access details or resolve requests.
- [x] 5.4 Suspend and resume the exact Runtime request for `deny`, `allow_once`, and `allow_for_task`; verify denial, timeout, reconnect, Host restart, and non-resumable provider behavior all fail closed.

## 6. Structured Agent delegation

- [x] 6.1 Parse native or hidden-marker `AgentActionV1` envelopes through one validator and remove transport markers from published chat; verify malformed, unknown-version, and unknown-Agent actions create no work.
- [x] 6.2 Implement transactional child-Task creation with inherited binding/grant intersection and root budget accounting; verify depth 3, 12 descendants, 24 Runs, 30-minute defaults, and concurrent budget consumption.
- [x] 6.3 Validate room membership, Agent availability, required capabilities, effective scopes, and assignee freshness before scheduling delegated Runs; verify each mismatch enters the specified actionable waiting state.
- [x] 6.4 Aggregate child completion, blocking, artifacts, and read-only review into the parent Task while keeping discussion Loops non-authoritative; verify a Loop cannot trigger machine work and a parent cannot complete with a required blocked child.
- [x] 6.5 Apply equivalent governed delegation and authorization state machines in local-only mode; verify the local user fulfills both admin and host-owner gates without receiving a global auto-approval capability.

## 7. Desktop collaboration experience

- [x] 7.1 Add room host-binding setup and readiness UI showing only label, repository identity, owner, revision, and online state; verify keyboard interaction, loading/error states, and path privacy in component tests.
- [x] 7.2 Add a Task inspector with parent/child hierarchy, assignees, effective scopes, budget use, host state, wait reason, and role-aware review/start controls; verify member/admin/host-owner snapshots render the correct actions.
- [x] 7.3 Add the host-owner approval inbox and approval card for deny, once, and Task-scoped decisions with confirmation of exact constraints; verify unauthorized clients receive only a redacted waiting event.
- [x] 7.4 Add compact group timeline events and a redacted audit view for delegation, approvals, Runs, failures, and artifacts; verify sensitive values do not appear in rendered text, copied diagnostics, or OpenIM payloads.
- [x] 7.5 Document host, permission, Task-tree, approval, audit, waiting, empty, and error patterns in the design system; visually verify light and dark themes at desktop widths.

## 8. End-to-end validation and delivery

- [ ] 8.1 Add a two-user/two-client backend integration scenario covering group chat, member request, admin review, host grant, two-Agent delegation, write serialization, review, and final result; verify `npm run backend:test` passes.
- [ ] 8.2 Add failure-path integration scenarios for unauthorized approval, Prompt Injection text, host offline/reconnect, stale revision, revoked grant, exhausted budget, Runtime approval timeout, and duplicate realtime delivery; verify no forbidden or duplicate operation occurs.
- [ ] 8.3 Run `npm run typecheck`, `npm run lint`, `npm run test:desktop`, `npm run backend:test`, `npm run build`, and `npm run validate:bugs`; record every result and resolve all regressions caused by this change.
- [ ] 8.4 Update the README and deployment documentation for project-host binding, role responsibilities, permissions, recovery, audit privacy, and first-release exclusions; verify examples match the final API and UI terminology.
