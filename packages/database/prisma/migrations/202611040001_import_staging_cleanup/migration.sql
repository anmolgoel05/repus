ALTER TABLE import_jobs ADD COLUMN staging_deleted_at timestamptz;

CREATE INDEX import_jobs_pending_staging_cleanup_idx ON import_jobs (id)
 WHERE staging_deleted_at IS NULL AND status IN ('COMPLETED', 'CANCELLED');
