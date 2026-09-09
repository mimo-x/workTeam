ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'codex',
  ADD COLUMN IF NOT EXISTS protocol text NOT NULL DEFAULT 'app-server',
  ADD COLUMN IF NOT EXISTS runtime_model text,
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '["chat", "stream_progress", "read_workspace"]'::jsonb,
  ADD COLUMN IF NOT EXISTS runtime_status text NOT NULL DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS runtime_last_seen_at timestamptz;

ALTER TABLE agents ADD CONSTRAINT agents_runtime_status_ck
  CHECK (runtime_status IN ('online', 'offline', 'unknown'));

CREATE INDEX IF NOT EXISTS agents_runtime_status_idx ON agents(runtime_status, runtime_last_seen_at);
