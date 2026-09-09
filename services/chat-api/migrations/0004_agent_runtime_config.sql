ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS runtime_endpoint text,
  ADD COLUMN IF NOT EXISTS runtime_command text,
  ADD COLUMN IF NOT EXISTS runtime_args jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS runtime_auth text NOT NULL DEFAULT 'none';

ALTER TABLE agents ADD CONSTRAINT agents_runtime_auth_ck
  CHECK (runtime_auth IN ('bearer', 'none'));
