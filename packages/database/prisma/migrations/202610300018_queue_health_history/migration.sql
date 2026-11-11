CREATE TABLE platform_queue_health_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  queues JSONB NOT NULL,
  failed_job_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_job_count >= 0),
  health_check_failures INTEGER NOT NULL DEFAULT 0 CHECK (health_check_failures >= 0)
);

CREATE INDEX platform_queue_health_samples_checked_at_idx
  ON platform_queue_health_samples(checked_at DESC);

ALTER TABLE platform_queue_health_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_queue_health_admin_read
  ON platform_queue_health_samples FOR SELECT
  USING (current_setting('app.platform_admin', true) = 'true');

CREATE POLICY platform_queue_health_worker_insert
  ON platform_queue_health_samples FOR INSERT
  WITH CHECK (current_setting('app.trusted_worker', true) = 'true');

CREATE POLICY platform_queue_health_worker_delete
  ON platform_queue_health_samples FOR DELETE
  USING (current_setting('app.trusted_worker', true) = 'true');
