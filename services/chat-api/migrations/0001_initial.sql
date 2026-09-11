CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  handle text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  avatar_url text,
  openim_user_id text NOT NULL,
  email_verified_at timestamptz,
  disabled_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lower_ck CHECK (email = lower(email)),
  CONSTRAINT users_handle_lower_ck CHECK (handle = lower(handle))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_lower_uq ON users(handle);
CREATE UNIQUE INDEX IF NOT EXISTS users_openim_user_id_uq ON users(openim_user_id);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  device_name text NOT NULL DEFAULT 'Unknown device',
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_sessions_token_hash_uq ON refresh_sessions(token_hash);

CREATE TABLE IF NOT EXISTS account_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS account_tokens_hash_uq ON account_tokens(token_hash);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform text NOT NULL,
  is_agent_host boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id);

CREATE TABLE IF NOT EXISTS friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friend_requests_not_self_ck CHECK (sender_id <> receiver_id)
);
CREATE INDEX IF NOT EXISTS friend_requests_receiver_status_idx ON friend_requests(receiver_id, status);
CREATE INDEX IF NOT EXISTS friend_requests_sender_status_idx ON friend_requests(sender_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_pair_uq
  ON friend_requests(sender_id, receiver_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS friendships (
  user_low_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low_id, user_high_id),
  CONSTRAINT friendships_order_ck CHECK (user_low_id::text < user_high_id::text)
);

CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  openim_user_id text NOT NULL,
  name text NOT NULL,
  title text NOT NULL DEFAULT 'Agent',
  mention text NOT NULL,
  description text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  workspace_access text NOT NULL DEFAULT 'read' CHECK (workspace_access IN ('read', 'write')),
  execution_target text NOT NULL DEFAULT 'local' CHECK (execution_target IN ('local', 'hosted')),
  skill_policy text NOT NULL DEFAULT 'none' CHECK (skill_policy IN ('none', 'allowlist', 'all')),
  skill_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  private_config jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_openim_user_id_uq ON agents(openim_user_id);
CREATE INDEX IF NOT EXISTS agents_owner_idx ON agents(owner_id);
CREATE INDEX IF NOT EXISTS agents_visibility_idx ON agents(visibility);

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  openim_group_id text,
  type text NOT NULL CHECK (type IN ('direct', 'group', 'task')),
  name text NOT NULL,
  direct_key text,
  source_room_id uuid REFERENCES rooms(id) ON DELETE SET NULL,
  revision integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rooms_openim_group_id_uq ON rooms(openim_group_id) WHERE openim_group_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rooms_direct_key_uq ON rooms(direct_key) WHERE direct_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS room_members (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS room_agents (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  added_by uuid NOT NULL REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, agent_id)
);

CREATE TABLE IF NOT EXISTS agent_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_invitations_agent_status_idx ON agent_invitations(agent_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS agent_invitations_pending_uq
  ON agent_invitations(room_id, agent_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS message_mirrors (
  server_msg_id text PRIMARY KEY,
  client_msg_id text NOT NULL,
  room_id uuid REFERENCES rooms(id) ON DELETE SET NULL,
  openim_conversation_id text NOT NULL,
  sender_openim_id text NOT NULL,
  sender_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  sender_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  content text NOT NULL,
  content_type integer NOT NULL DEFAULT 101,
  seq bigint NOT NULL DEFAULT 0,
  target_agent_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS message_mirrors_client_msg_id_uq ON message_mirrors(client_msg_id);
CREATE INDEX IF NOT EXISTS message_mirrors_room_seq_idx ON message_mirrors(room_id, seq);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES users(id),
  source_room_id uuid NOT NULL REFERENCES rooms(id),
  task_room_id uuid NOT NULL REFERENCES rooms(id),
  anchor_message_id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting', 'review', 'blocked', 'done', 'failed', 'cancelled')),
  context_version integer NOT NULL DEFAULT 1,
  latest_source_seq bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_anchor_message_uq ON tasks(anchor_message_id);
CREATE INDEX IF NOT EXISTS tasks_source_status_idx ON tasks(source_room_id, status);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id),
  PRIMARY KEY (task_id, agent_id)
);

CREATE TABLE IF NOT EXISTS task_context_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  context_version integer NOT NULL,
  source_seq bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_context_task_message_uq ON task_context_events(task_id, message_id);

CREATE TABLE IF NOT EXISTS task_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id),
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CONSTRAINT task_runs_status_check CHECK (status IN ('queued', 'leased', 'running', 'waiting', 'review', 'blocked', 'complete', 'failed', 'cancelled')),
  execution_target text NOT NULL DEFAULT 'local' CHECK (execution_target IN ('local', 'hosted')),
  context_version integer NOT NULL,
  agent_snapshot jsonb NOT NULL,
  lease_token_hash text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  output_message_id text,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_runs_dispatch_idx ON task_runs(status, execution_target);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  label text NOT NULL,
  path_config jsonb NOT NULL,
  repository_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, label)
);

CREATE TABLE IF NOT EXISTS encrypted_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type text NOT NULL,
  scope_id uuid,
  name text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS encrypted_configs_global_scope_uq
  ON encrypted_configs(owner_id, scope_type, name) WHERE scope_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS encrypted_configs_named_scope_uq
  ON encrypted_configs(owner_id, scope_type, scope_id, name) WHERE scope_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox_events(processed_at, available_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_actor_created_idx ON audit_events(actor_id, created_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS legacy_mappings (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  legacy_id text NOT NULL,
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, legacy_id)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
