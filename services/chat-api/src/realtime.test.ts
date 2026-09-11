import assert from "node:assert/strict";
import test from "node:test";

import { RealtimeHub } from "./realtime.js";

type TestConnection = {
  socket: { readyState: number; send(value: string): void; close(): void };
  userId: string;
  deviceId: string | null;
  agentIds: Set<string>;
};

test("stale host device IDs are replaced without rejecting the WebSocket handler", async () => {
  const sent: string[] = [];
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("SELECT id FROM agents")) return { rows: [] };
      if (sql.includes("UPDATE devices")) return { rows: [] };
      if (sql.includes("INSERT INTO devices")) return { rows: [{ id: "device_new" }] };
      if (sql.includes("UPDATE workspace_bindings") || sql.includes("UPDATE tasks")) {
        return { rows: [] };
      }
      if (sql.includes("execution_approval_requests")) return { rows: [] };
      if (sql.includes("SELECT tr.id AS run_id")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const hub = new RealtimeHub(
    pool as never,
    undefined as never,
    { HOST_HEARTBEAT_SECONDS: 10, HOST_LEASE_SECONDS: 30 } as never,
    undefined as never,
  );
  const connection: TestConnection = {
    socket: { readyState: 1, send: (value: string) => sent.push(value), close() {} },
    userId: "user_1",
    deviceId: null,
    agentIds: new Set<string>(),
  };
  await (
    hub as unknown as { onMessage(connection: TestConnection, raw: Buffer): Promise<void> }
  ).onMessage(
    connection,
    Buffer.from(
      JSON.stringify({
        type: "host.register",
        deviceId: "00000000-0000-4000-8000-000000000001",
        name: "test-host",
        platform: "linux",
        agentIds: [],
      }),
    ),
  );
  assert.equal(connection.deviceId, "device_new");
  assert.match(sent.join("\n"), /host\.registered/);
  assert.equal(queries.filter((sql) => sql.includes("INSERT INTO devices")).length, 1);
});

test("host registration errors are sent as protocol errors instead of escaping", async () => {
  const sent: string[] = [];
  const pool = {
    async query(sql: string) {
      if (sql.includes("SELECT id FROM agents")) return { rows: [] };
      if (sql.includes("UPDATE devices") || sql.includes("INSERT INTO devices"))
        return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const hub = new RealtimeHub(
    pool as never,
    undefined as never,
    { HOST_HEARTBEAT_SECONDS: 10, HOST_LEASE_SECONDS: 30 } as never,
    undefined as never,
  );
  const connection: TestConnection = {
    socket: { readyState: 1, send: (value: string) => sent.push(value), close() {} },
    userId: "user_1",
    deviceId: null,
    agentIds: new Set<string>(),
  };
  await (
    hub as unknown as { onMessage(connection: TestConnection, raw: Buffer): Promise<void> }
  ).onMessage(
    connection,
    Buffer.from(
      JSON.stringify({ type: "host.register", name: "test-host", platform: "linux", agentIds: [] }),
    ),
  );
  assert.match(sent.join("\n"), /DEVICE_REGISTRATION_FAILED/);
});

test("BDD: Given two active hosts When a friend mentions my Agent Then only one matching host receives the chat request", () => {
  const firstHostEvents: string[] = [];
  const latestHostEvents: string[] = [];
  const otherUserEvents: string[] = [];
  const hub = new RealtimeHub(
    undefined as never,
    undefined as never,
    { HOST_HEARTBEAT_SECONDS: 10, HOST_LEASE_SECONDS: 30 } as never,
    undefined as never,
  );
  const connections = (
    hub as unknown as {
      connections: Set<TestConnection>;
    }
  ).connections;
  connections.add({
    socket: { readyState: 1, send: (value: string) => firstHostEvents.push(value), close() {} },
    userId: "alice",
    deviceId: "alice-first",
    agentIds: new Set(["alice-agent"]),
  });
  connections.add({
    socket: { readyState: 1, send: (value: string) => latestHostEvents.push(value), close() {} },
    userId: "alice",
    deviceId: "alice-latest",
    agentIds: new Set(["alice-agent"]),
  });
  connections.add({
    socket: { readyState: 1, send: (value: string) => otherUserEvents.push(value), close() {} },
    userId: "bob",
    deviceId: "bob-device",
    agentIds: new Set(["alice-agent"]),
  });

  const delivered = hub.publishToAgentHost("alice", "alice-agent", {
    type: "agent.chat.requested",
    roomId: "shared-room",
  });

  assert.equal(delivered, true);
  assert.equal(firstHostEvents.length, 0);
  assert.equal(latestHostEvents.length, 1);
  assert.match(latestHostEvents[0], /agent\.chat\.requested/);
  assert.equal(otherUserEvents.length, 0);
});
