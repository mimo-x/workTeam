## Why

Codex Desktop already supports multi-user rooms, Agent mentions, Task review, local Agent Hosts, and Runtime approvals, but these capabilities do not yet share one enforceable authority model. A room member can currently initiate or review work without a durable project-host binding, and remote execution cannot route a Runtime approval back to the person whose computer and workspace are affected.

The next product milestone is a governed collaboration loop in which colleagues and Agents work in one room, Agents can delegate bounded subtasks, and every machine-side action is constrained by an explicit human-approved task and execution environment.

## What Changes

- Bind each collaboration room and its Tasks to one explicit project host and workspace binding; never expose the host's absolute path to other room members.
- Enforce room roles so members may discuss and request work while owners or admins review Task scope and change Task lifecycle state.
- Add revision-bound Task permission grants. Workspace write, command, and network access must be authorized for a specific Task revision and host; expanding scope invalidates the previous grant.
- Route Runtime approval requests from a remote Agent Host to the project-host owner, and return approve, deny, or task-scoped decisions to the exact suspended run.
- Replace informal Agent-to-Agent task delegation with persisted parent/child Tasks, structured delegation actions, capability checks, and bounded execution budgets.
- Keep ordinary Agent discussion and the existing Loop feature lightweight; only reviewed Task actions may cause governed machine work.
- Add group-visible Task trees, host state, approval cards, blocked states, and redacted audit events to the desktop workbench.
- Preserve local-only mode by treating the local user as both room administrator and project-host owner while applying the same authorization rules.

## Capabilities

### New Capabilities

- `room-governance`: Room roles and the authority to bind workspaces, review Tasks, and control lifecycle transitions.
- `workspace-execution-binding`: Single-host workspace selection, private local-path handling, online state, and deterministic Task routing.
- `task-permission-grants`: Revision-bound, risk-tiered permission envelopes and their invalidation rules.
- `remote-execution-approval`: Durable Runtime approval requests and decisions routed between the Agent Host and its authorized human owner.
- `agent-task-delegation`: Persisted parent/child Tasks, structured delegation actions, capability validation, budgets, and write serialization.

### Modified Capabilities

- `agent-runtime`: Runtime approval events must be correlated to a Task run and remain resumable across the remote host protocol.
- `agent-workbench`: The desktop workbench must expose host binding, Task authority, delegated work, permission requests, and audit outcomes.

## Impact

- Shared desktop/backend contracts in `src/shared`, IPC/preload APIs, and Agent Runtime event metadata.
- Local orchestration in `src/main/agent-team.ts` and remote execution in `src/main/remote-agent-host.ts`.
- Chat API room, Task, realtime, audit, authorization, PostgreSQL schema, and migration behavior.
- Team chat, Task board, settings, and design-system component guidance.
- Existing room and Task records require backward-compatible migration defaults; no existing message history or stable Agent identity is replaced.
