# Agent Team Chat API

The business backend owns accounts, friendships, Agents, rooms, Tasks, settings, encrypted
configuration, and desktop-host scheduling. OpenIM remains the realtime delivery and offline-message
service.

The desktop client uses the API as the cloud source of truth after login. It supports remote friend
search/requests, human and Agent direct rooms, group membership replacement, public-Agent owner
approval, structured Agent mentions, Task creation, and realtime refresh through the Agent Host
WebSocket.

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
callback mirrors messages idempotently, updates active Task context, and creates a TaskRun when a
structured Agent mention is present.

## Realtime Agent Host protocol

1. Authenticated clients call `POST /v1/realtime/ticket`.
2. Connect to `GET /v1/realtime?ticket=...` within 60 seconds.
3. Send `host.register`, then a `host.heartbeat` every 10 seconds.
4. For `agent.run.assigned`, respond with `run.accept`, stream `run.progress`, and finish with
   `run.complete` or `run.fail` using the supplied lease token.

Run leases expire after 30 seconds and are retried up to three times. The server never returns Agent
private instructions or decrypted secrets outside an authenticated lease owned by the Agent owner.
