CREATE TABLE platform_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  tenant_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX platform_audit_logs_created_at_idx ON platform_audit_logs(created_at);
CREATE INDEX platform_audit_logs_tenant_created_idx ON platform_audit_logs(tenant_id,created_at);

-- Cross-tenant quota controls are reachable only inside the explicit platform-admin transaction.
CREATE POLICY platform_admin_access ON tenant_sending_limits
  USING (current_setting('app.platform_admin',true) = 'true')
  WITH CHECK (current_setting('app.platform_admin',true) = 'true');
