-- INSERT ... RETURNING and retention queries require visibility of worker records.
-- Tenant requests still have no access to platform queue-health history.
CREATE POLICY platform_queue_health_worker_read
  ON platform_queue_health_samples FOR SELECT
  USING (current_setting('app.trusted_worker', true) = 'true');
