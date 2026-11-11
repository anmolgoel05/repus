ALTER TABLE tenant_sending_limits
  ADD COLUMN media_storage_limit_bytes INTEGER NOT NULL DEFAULT 104857600,
  ADD CONSTRAINT tenant_sending_limits_media_storage_nonnegative CHECK (media_storage_limit_bytes >= 0);
