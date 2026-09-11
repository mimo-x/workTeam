ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS completion_summary text,
  ADD COLUMN IF NOT EXISTS source_summary_published_at timestamptz;

ALTER TABLE message_mirrors
  ADD COLUMN IF NOT EXISTS delivery_key text;

CREATE UNIQUE INDEX IF NOT EXISTS message_mirrors_delivery_key_uq
  ON message_mirrors(delivery_key);
