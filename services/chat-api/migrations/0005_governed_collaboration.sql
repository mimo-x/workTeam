ALTER TABLE workspace_bindings
  ALTER COLUMN path_config DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS baseline_scopes jsonb NOT NULL DEFAULT '["workspace.read"]'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

ALTER TABLE workspace_bindings DROP CONSTRAINT IF EXISTS workspace_bindings_status_check;
ALTER TABLE workspace_bindings
  ADD CONSTRAINT workspace_bindings_status_check
  CHECK (status IN ('online', 'offline', 'unknown', 'revoked'));

CREATE TABLE IF NOT EXISTS room_workspace_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  workspace_binding_id uuid NOT NULL REFERENCES workspace_bindings(id) ON DELETE CASCADE,
  binding_revision integer NOT NULL,
  shared_by_user_id uuid NOT NULL REFERENCES users(id),
  activated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'shared'
    CHECK (status IN ('shared', 'active', 'replaced', 'revoked')),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  ended_at timestamptz,
  UNIQUE (room_id, workspace_binding_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS room_workspace_bindings_active_uq
  ON room_workspace_bindings(room_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS room_workspace_bindings_binding_idx
  ON room_workspace_bindings(workspace_binding_id, status);

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check CHECK (
    status IN (
      'pending_review', 'changes_requested', 'approved', 'queued', 'running', 'waiting',
      'waiting_for_host', 'waiting_for_permission', 'waiting_for_approval',
      'waiting_for_assignee', 'waiting_for_budget', 'review', 'blocked', 'done', 'failed',
      'cancelled'
    )
  ),
  ADD COLUMN IF NOT EXISTS requested_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS workspace_binding_id uuid
    REFERENCES workspace_bindings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS binding_revision integer,
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS root_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delegated_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS depth integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget jsonb NOT NULL DEFAULT
    '{"maxDepth":3,"maxDescendants":12,"maxRuns":24,"maxWallTimeMs":1800000}'::jsonb,
  ADD COLUMN IF NOT EXISTS budget_usage jsonb NOT NULL DEFAULT
    '{"descendants":0,"runs":0}'::jsonb,
  ADD COLUMN IF NOT EXISTS wait_reason text,
  ADD COLUMN IF NOT EXISTS artifact_refs jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE tasks
SET requested_scopes = CASE
  WHEN requested_access = 'write'
    THEN '["workspace.read", "workspace.write"]'::jsonb
  ELSE '["workspace.read"]'::jsonb
END
WHERE requested_scopes = '[]'::jsonb;

UPDATE tasks
SET root_task_id = id
WHERE root_task_id IS NULL;

UPDATE tasks
SET status = 'pending_review',
    revision = revision + 1,
    approved_review_id = NULL,
    started_by_user_id = NULL,
    started_at = NULL,
    wait_reason = '升级后需重新确认当前任务范围与主机权限。'
WHERE status NOT IN ('pending_review', 'changes_requested', 'done', 'failed', 'cancelled');

CREATE INDEX IF NOT EXISTS tasks_root_parent_idx ON tasks(root_task_id, parent_task_id);
CREATE INDEX IF NOT EXISTS tasks_binding_status_idx ON tasks(workspace_binding_id, status);

ALTER TABLE task_reviews
  ADD COLUMN IF NOT EXISTS reviewer_role text NOT NULL DEFAULT 'member'
    CHECK (reviewer_role IN ('owner', 'admin', 'member'));

CREATE TABLE IF NOT EXISTS task_permission_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_revision integer NOT NULL,
  workspace_binding_id uuid NOT NULL REFERENCES workspace_bindings(id) ON DELETE CASCADE,
  binding_revision integer NOT NULL,
  host_user_id uuid NOT NULL REFERENCES users(id),
  host_device_id uuid NOT NULL REFERENCES devices(id),
  scopes jsonb NOT NULL,
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT task_permission_grants_expiry_ck CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS task_permission_grants_current_idx
  ON task_permission_grants(task_id, task_revision, workspace_binding_id, binding_revision, expires_at);

ALTER TABLE task_runs
  ADD COLUMN IF NOT EXISTS target_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS permission_grant_id uuid
    REFERENCES task_permission_grants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES task_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS requested_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS write_intent boolean NOT NULL DEFAULT false;
ALTER TABLE task_runs DROP CONSTRAINT IF EXISTS task_runs_status_check;
ALTER TABLE task_runs ADD CONSTRAINT task_runs_status_check CHECK (
  status IN (
    'queued', 'leased', 'running', 'waiting', 'waiting_for_approval',
    'review', 'blocked', 'complete', 'failed', 'cancelled'
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS task_runs_idempotency_uq
  ON task_runs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_runs_target_dispatch_idx
  ON task_runs(target_device_id, status, lease_expires_at);

CREATE TABLE IF NOT EXISTS execution_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_revision integer NOT NULL,
  run_id uuid NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  turn_id text NOT NULL,
  agent_id uuid NOT NULL REFERENCES agents(id),
  workspace_binding_id uuid NOT NULL REFERENCES workspace_bindings(id) ON DELETE CASCADE,
  host_device_id uuid NOT NULL REFERENCES devices(id),
  provider_request_id text NOT NULL,
  requested_scope text NOT NULL
    CHECK (requested_scope IN ('workspace.read', 'workspace.write', 'command.run', 'network.read')),
  requested_constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  redacted_summary text NOT NULL,
  encrypted_details jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  decision text CHECK (
    decision IS NULL OR decision IN ('deny', 'allow_once', 'allow_for_task')
  ),
  decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  CONSTRAINT execution_approval_requests_expiry_ck CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS execution_approval_requests_host_status_idx
  ON execution_approval_requests(host_device_id, status, expires_at);

CREATE TABLE IF NOT EXISTS task_agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_revision integer NOT NULL,
  run_id uuid NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  action_id text NOT NULL,
  action_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted', 'rejected', 'applied')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE(task_id, action_id)
);
CREATE INDEX IF NOT EXISTS task_agent_actions_run_idx ON task_agent_actions(run_id, created_at);

CREATE TABLE IF NOT EXISTS workspace_write_leases (
  workspace_binding_id uuid PRIMARY KEY REFERENCES workspace_bindings(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  lease_token_hash text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT workspace_write_leases_expiry_ck CHECK (expires_at > acquired_at)
);

CREATE TABLE IF NOT EXISTS collaboration_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  task_revision integer,
  run_id uuid REFERENCES task_runs(id) ON DELETE SET NULL,
  host_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  audience text NOT NULL DEFAULT 'room'
    CHECK (audience IN ('room', 'host_owner', 'system')),
  redacted_summary text NOT NULL,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collaboration_audit_room_created_idx
  ON collaboration_audit_events(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS collaboration_audit_task_created_idx
  ON collaboration_audit_events(task_id, created_at DESC);
