ALTER TABLE platform_controls
  ADD COLUMN default_tenant_daily_limit integer,
  ADD COLUMN default_tenant_monthly_limit integer,
  ADD CONSTRAINT platform_default_tenant_daily_limit_check CHECK (default_tenant_daily_limit BETWEEN 0 AND 10000000),
  ADD CONSTRAINT platform_default_tenant_monthly_limit_check CHECK (default_tenant_monthly_limit BETWEEN 0 AND 100000000);
