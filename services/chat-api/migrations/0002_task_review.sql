ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check CHECK (
    status IN (
      'pending_review', 'changes_requested', 'approved', 'queued', 'running', 'waiting',
      'review', 'blocked', 'done', 'failed', 'cancelled'
    )
  );

ALTER TABLE tasks
  ADD COLUMN objective text NOT NULL DEFAULT '',
  ADD COLUMN expected_result text NOT NULL DEFAULT '',
  ADD COLUMN plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN requested_access text NOT NULL DEFAULT 'read'
    CHECK (requested_access IN ('read', 'write')),
  ADD COLUMN requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN proposed_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD COLUMN approval_required boolean NOT NULL DEFAULT true,
  ADD COLUMN started_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN started_at timestamptz;

UPDATE tasks
SET objective = title,
    expected_result = title,
    requested_by_user_id = creator_id,
    approval_required = false;

CREATE TABLE task_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_revision integer NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES users(id),
  reviewer_name_snapshot text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'changes_requested', 'rejected')),
  comment text NOT NULL DEFAULT '',
  task_snapshot jsonb NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_reviews_task_reviewed_idx ON task_reviews(task_id, reviewed_at DESC);

ALTER TABLE tasks
  ADD COLUMN approved_review_id uuid REFERENCES task_reviews(id) ON DELETE SET NULL;

ALTER TABLE task_runs
  ADD COLUMN approval_id uuid REFERENCES task_reviews(id) ON DELETE SET NULL,
  ADD COLUMN started_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
