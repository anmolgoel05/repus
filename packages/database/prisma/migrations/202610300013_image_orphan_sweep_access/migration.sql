-- Permit the trusted internal worker to check whether a private image object
-- still has a database capability before removing stale orphaned objects.
CREATE POLICY image_assets_trusted_worker_read ON image_assets
  FOR SELECT
  USING (current_setting('app.trusted_worker', true) = 'true');
