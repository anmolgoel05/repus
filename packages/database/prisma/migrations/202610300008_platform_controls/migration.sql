CREATE TABLE platform_controls (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  sending_paused BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id UUID
);
INSERT INTO platform_controls (id, sending_paused) VALUES (1, FALSE);
ALTER TABLE platform_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_control_access ON platform_controls
  USING (current_setting('app.platform_admin',true) = 'true'
    OR current_setting('app.trusted_worker',true) = 'true'
    OR NULLIF(current_setting('app.tenant_id',true),'') IS NOT NULL)
  WITH CHECK (current_setting('app.platform_admin',true) = 'true');
