import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DataType, newDb } from "pg-mem";
import type pg from "pg";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

const createPool = () => {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: randomUUID,
    impure: true,
  });
  const adapter = memory.adapters.createPg();
  return new adapter.Pool() as unknown as pg.Pool;
};

const migrationSql = async (name: string) => {
  const sql = await readFile(join(migrationsDir, name), "utf8");
  if (name !== "0001_initial.sql") return sql;
  return sql
    .replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", "")
    .replace(
      "status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting', 'review', 'blocked', 'done', 'failed', 'cancelled')),",
      "status text NOT NULL DEFAULT 'queued' CONSTRAINT tasks_status_check CHECK (status IN ('queued', 'running', 'waiting', 'review', 'blocked', 'done', 'failed', 'cancelled')),",
    );
};

const migrationNames = async () =>
  (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();

const applyMigrations = async (pool: pg.Pool, names: string[]) => {
  for (const name of names) await pool.query(await migrationSql(name));
};

test("fresh databases apply every governed collaboration migration", async () => {
  const pool = createPool();
  try {
    await applyMigrations(pool, await migrationNames());
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN (
         'room_workspace_bindings', 'task_permission_grants',
         'execution_approval_requests', 'workspace_write_leases',
         'collaboration_audit_events', 'task_agent_actions'
       )`,
    );
    assert.deepEqual(tables.rows.map((row) => row.table_name).sort(), [
      "collaboration_audit_events",
      "execution_approval_requests",
      "room_workspace_bindings",
      "task_agent_actions",
      "task_permission_grants",
      "workspace_write_leases",
    ]);
  } finally {
    await pool.end();
  }
});

test("existing tasks survive upgrade but active work requires reconfirmation", async () => {
  const pool = createPool();
  try {
    const names = await migrationNames();
    await applyMigrations(
      pool,
      names.filter((name) => name < "0005_governed_collaboration.sql"),
    );
    const userId = randomUUID();
    const sourceRoomId = randomUUID();
    const taskRoomId = randomUUID();
    const taskId = randomUUID();
    await pool.query(
      `INSERT INTO users(id, email, handle, display_name, password_hash, openim_user_id)
       VALUES ($1, 'owner@example.test', 'owner', 'Owner', 'hash', 'owner-openim')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO rooms(id, owner_id, type, name) VALUES
       ($1, $3, 'group', 'Source'), ($2, $3, 'task', 'Task')`,
      [sourceRoomId, taskRoomId, userId],
    );
    await pool.query(
      `INSERT INTO tasks(
         id, creator_id, source_room_id, task_room_id, anchor_message_id, title,
         objective, expected_result, requested_access, status, revision
       ) VALUES ($1, $2, $3, $4, 'legacy-anchor', 'Legacy write Task',
         'Write code', 'Working code', 'write', 'running', 2)`,
      [taskId, userId, sourceRoomId, taskRoomId],
    );

    await applyMigrations(pool, [
      "0005_governed_collaboration.sql",
      "0006_task_completion_summary.sql",
    ]);

    const upgraded = await pool.query(
      `SELECT status, revision, requested_scopes, root_task_id, wait_reason,
              workspace_binding_id, parent_task_id, completion_summary,
              source_summary_published_at
       FROM tasks WHERE id = $1`,
      [taskId],
    );
    assert.equal(upgraded.rows[0].status, "pending_review");
    assert.equal(upgraded.rows[0].revision, 3);
    assert.deepEqual(upgraded.rows[0].requested_scopes, ["workspace.read", "workspace.write"]);
    assert.equal(upgraded.rows[0].root_task_id, taskId);
    assert.match(upgraded.rows[0].wait_reason, /重新确认/);
    assert.equal(upgraded.rows[0].workspace_binding_id, null);
    assert.equal(upgraded.rows[0].parent_task_id, null);
    assert.equal(upgraded.rows[0].completion_summary, null);
    assert.equal(upgraded.rows[0].source_summary_published_at, null);

    await pool.query(
      `INSERT INTO message_mirrors(
         server_msg_id, client_msg_id, room_id, openim_conversation_id, sender_openim_id,
         sender_user_id, content, delivery_key, sent_at
       ) VALUES ('summary-server-1', 'summary-client-1', $1, 'source-conversation',
                 'owner-openim', $2, 'Summary', 'task-summary:legacy-task', now())`,
      [sourceRoomId, userId],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO message_mirrors(
           server_msg_id, client_msg_id, room_id, openim_conversation_id, sender_openim_id,
           sender_user_id, content, delivery_key, sent_at
         ) VALUES ('summary-server-2', 'summary-client-2', $1, 'source-conversation',
                   'owner-openim', $2, 'Summary retry', 'task-summary:legacy-task', now())`,
        [sourceRoomId, userId],
      ),
    );
  } finally {
    await pool.end();
  }
});
