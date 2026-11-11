-- Authentication tables need narrow bootstrap claims because a request must identify
-- its tenant before the ordinary app.tenant_id claim can be installed.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_auth_scope ON tenants
  USING (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'true'
  )
  WITH CHECK (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'true'
    OR NULLIF(current_setting('app.auth_user_email', true), '') IS NOT NULL
  );

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_auth_scope ON users
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'true'
    OR normalized_email = NULLIF(current_setting('app.auth_user_email', true), '')
    OR id = NULLIF(current_setting('app.auth_user_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'true'
  );

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY session_auth_scope ON sessions
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR token_hash = NULLIF(current_setting('app.session_token_hash', true), '')
  )
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE one_time_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY one_time_token_auth_scope ON one_time_tokens
  USING (
    token_hash = NULLIF(current_setting('app.one_time_token_hash', true), '')
    OR user_id IN (
      SELECT id FROM users
      WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    user_id IN (
      SELECT id FROM users
      WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
    OR current_setting('app.platform_admin', true) = 'true'
  );

-- Tenant quota rows are workspace-owned as well as cross-tenant operator controls.
ALTER TABLE tenant_sending_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_sending_limit_scope ON tenant_sending_limits
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'true'
  );

-- Platform ledgers are internal shared controls; API access requires an explicit request context.
ALTER TABLE platform_daily_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_daily_usage_internal_scope ON platform_daily_usage
  USING (
    NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL
    OR current_setting('app.platform_admin', true) = 'true'
    OR current_setting('app.trusted_worker', true) = 'true'
  )
  WITH CHECK (
    NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL
    OR current_setting('app.platform_admin', true) = 'true'
    OR current_setting('app.trusted_worker', true) = 'true'
  );

ALTER TABLE platform_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_audit_admin_scope ON platform_audit_logs
  USING (current_setting('app.platform_admin', true) = 'true')
  WITH CHECK (current_setting('app.platform_admin', true) = 'true');

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_delivery_internal_scope ON webhook_deliveries
  USING (
    current_setting('app.platform_admin', true) = 'true'
    OR current_setting('app.trusted_worker', true) = 'true'
  )
  WITH CHECK (
    current_setting('app.platform_admin', true) = 'true'
    OR current_setting('app.trusted_worker', true) = 'true'
  );
