ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS delivery_key text;

ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_delivery_key_uq UNIQUE (delivery_key);
