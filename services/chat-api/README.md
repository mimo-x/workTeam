# Agent Team Chat API

The business backend owns accounts, friendships, Agents, rooms, Tasks, settings, encrypted
configuration, and desktop-host scheduling. OpenIM remains the realtime delivery and offline-message
service.

The desktop client uses the API as the cloud source of truth after login. It supports remote friend
search/requests, human and Agent direct rooms, group membership replacement, public-Agent owner
approval, structured Agent mentions, Task creation, and realtime refresh through the Agent Host
WebSocket.

## Governed collaboration model

A group has one explicit active workspace binding. A binding identifies a host user and device, a
human-readable project label, optional repository identity, revision, baseline scopes, and online
state. It never contains an absolute path: the desktop stores the binding-to-path mapping locally and
resolves it immediately before Runtime launch.

The authorization gates are intentionally separate:

- Room `owner` and `admin` roles review, start, change, and accept Tasks.
- The active host owner creates or revokes constrained Task permission grants.
- The host owner alone receives full Runtime approval details and can decide `deny`, `allow_once`, or
  `allow_for_task`.
- Ordinary members can chat, request a Task, and read redacted progress/audit events.
- Agents can delegate through validated `AgentActionV1` actions only within their room membership,
  capabilities, effective parent scope, and root budget.

Default root budgets are depth 3, 12 descendants, 24 Runs, and 30 minutes. A Task snapshots the
binding ID and revision. Rebinding a room, revising a Task, revoking a grant, removing an assignee, or
exhausting a budget fails closed with a specific waiting state.

The first release supports `workspace.read`, constrained `workspace.write`, constrained
`command.run`, and constrained `network.read`. Browser/native-app control, external publishing,
deployment, account/permission changes, and destructive remote operations are excluded.

## Agent Registry

`/v1/agents` is the authenticated Agent Registry. It supports owned, public, and available scopes;
public responses include only discoverable metadata, Runtime provider/protocol, declared capabilities,
version, and online status. Private instructions and secrets are returned only to the owner. Runtime
status is reported separately from visibility: an offline Agent remains discoverable but must not be
started until its local Host or remote Runtime is online.

## Local development

```bash
cp .env.backend.example .env.backend.local
# Fill JWT_SECRET, ENCRYPTION_MASTER_KEY, OPENIM_ADMIN_TOKEN and OPENIM_CALLBACK_TOKEN.
docker compose -f deploy/docker-compose.yml up --build
```

Without OpenIM configuration, authentication and business APIs still work; `/v1/im/session` returns
`503 OPENIM_UNAVAILABLE` and the outbox worker waits without consuming events.

Run the API directly:

```bash
npm run backend:migrate -- --env-file=.env.backend.local
npm run backend:dev -- --env-file=.env.backend.local
npm run backend:worker -- --env-file=.env.backend.local
```

The supported Node.js environment-file form is also available directly:

```bash
node --env-file=.env.backend.local --import tsx services/chat-api/src/server.ts
```

## OpenIM callbacks

Configure both the before-send and after-send message callbacks to the internal API service:

```text
http://api:8790/internal/openim/callbacks/message/before?token=<OPENIM_CALLBACK_TOKEN>
http://api:8790/internal/openim/callbacks/message/after?token=<OPENIM_CALLBACK_TOKEN>
```

The before callback rejects messages from unknown users and unauthorized room members. The after
callback mirrors messages idempotently and updates active Task context. Message text—including text
that resembles an Agent action marker—is never executed. Task proposals come through the authenticated
Task API, and structured Agent actions are accepted only as correlated output from a leased Run.

## Project-host setup

The desktop performs the normal flow, but these are the corresponding APIs:

1. The authenticated host registers its active device through the realtime connection.
2. `POST /v1/workspace-bindings` declares the device, label, repository identity, and baseline scopes.
3. `POST /v1/workspace-bindings/:id/share` makes the redacted binding visible to a room.
4. A room owner/admin uses `PUT /v1/rooms/:roomId/workspace-binding` with `If-Match` to activate it.
5. The host owner uses `POST /v1/tasks/:id/permission-grants` for the smallest relative paths,
   command executables, and network domains required by the Task.

Do not add a path field to any of these API payloads. The desktop registers the same opaque binding ID
in its encrypted local binding store. A missing, removed, stale, or mismatched local mapping prevents
Runtime creation.

## Realtime Agent Host protocol

1. Authenticated clients call `POST /v1/realtime/ticket`.
2. Connect to `GET /v1/realtime?ticket=...` within 60 seconds.
3. Send `host.register`, then a `host.heartbeat` every 10 seconds.
4. For `agent.run.assigned`, respond with `run.accept`, stream `run.progress`, and finish with
   `run.complete` or `run.fail` using the supplied lease token.
5. When a Runtime requests a protected operation, send `approval.requested` with the Run lease,
   Task/Run/Session/Turn/Agent/device correlation, exact scope/constraints, redacted summary, and
   private details. Keep its approval ID in `host.heartbeat.pendingApprovalIds` until
   `approval.resolved` arrives.

Run leases expire after 30 seconds and are retried up to three times. The server never returns Agent
private instructions or decrypted secrets outside an authenticated lease owned by the Agent owner.
Write Runs for one binding acquire a backend lease and serialize; read-only Runs can lease in parallel.
An offline host moves affected Tasks to `waiting_for_host`; heartbeat recovery restores approved work
without duplicating the Run. Expired or non-resumable Runtime approvals are denied and fail closed.

## Deployment and privacy checklist

- Terminate TLS before the API and WebSocket endpoints; use independent strong JWT and callback
  secrets.
- Use `KEY_PROVIDER=vault-transit` in production. Keep `VAULT_TOKEN`, OpenIM administrator tokens,
  Runtime credentials, and approval detail encryption keys off desktops and out of OpenIM.
- Keep absolute paths only in the host desktop's local encrypted store. PostgreSQL and OpenIM may
  contain binding IDs, labels, repository identities, revisions, counts, and redacted summaries.
- Run both the API and outbox worker. Approval notifications and task/audit timeline messages depend on
  the outbox path remaining healthy.
- Monitor host heartbeats, queued/expired leases, `waiting_for_host`, `waiting_for_permission`,
  `waiting_for_approval`, and blocked audit outcomes.
- After a host replacement or repository checkout change, create/share a new binding or increment its
  revision, reactivate it as an admin, and review affected Tasks again. Never silently reuse old grants.
