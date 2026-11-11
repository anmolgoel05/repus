ALTER TABLE tenant_sending_limits
  ADD COLUMN quota_overrides JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE tenant_sending_limits
  ADD CONSTRAINT tenant_sending_limits_quota_overrides_array
  CHECK (jsonb_typeof(quota_overrides) = 'array');
