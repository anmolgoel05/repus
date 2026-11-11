CREATE TYPE "MembershipStatus" AS ENUM ('PENDING','ACTIVE','DISABLED');

ALTER TABLE one_time_tokens
  ADD COLUMN tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE one_time_tokens AS token
SET tenant_id = account.tenant_id
FROM users AS account
WHERE account.id = token.user_id;
CREATE INDEX one_time_tokens_tenant_purpose_idx ON one_time_tokens(tenant_id,purpose,expires_at);

CREATE TABLE organization_memberships (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role "Role" NOT NULL DEFAULT 'MARKETER',
  status "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX organization_memberships_user_status_idx ON organization_memberships(user_id, status);

INSERT INTO organization_memberships (tenant_id,user_id,role,status,created_at,updated_at)
SELECT tenant_id,id,role,
  CASE status WHEN 'ACTIVE' THEN 'ACTIVE'::"MembershipStatus"
    WHEN 'DISABLED' THEN 'DISABLED'::"MembershipStatus"
    ELSE 'PENDING'::"MembershipStatus" END,
  created_at,updated_at
FROM users;

ALTER TABLE sessions
  DROP CONSTRAINT sessions_tenant_id_user_id_fkey,
  ADD CONSTRAINT sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  ADD CONSTRAINT sessions_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  ADD CONSTRAINT sessions_organization_membership_fkey
  FOREIGN KEY (tenant_id,user_id)
  REFERENCES organization_memberships(tenant_id,user_id)
  ON DELETE CASCADE;

ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_membership_scope ON organization_memberships
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR user_id = NULLIF(current_setting('app.auth_user_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'true'
  );

DROP POLICY user_auth_scope ON users;
CREATE POLICY user_auth_scope ON users
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'true'
    OR normalized_email = NULLIF(current_setting('app.auth_user_email', true), '')
    OR id = NULLIF(current_setting('app.auth_user_id', true), '')::uuid
    OR id IN (
      SELECT user_id FROM organization_memberships
      WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'true'
  );

DROP POLICY tenant_auth_scope ON tenants;
CREATE POLICY tenant_auth_scope ON tenants
  USING (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'true'
    OR id = NULLIF(current_setting('app.organization_create_id', true), '')::uuid
  )
  WITH CHECK (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR current_setting('app.platform_admin', true) = 'true'
    OR id = NULLIF(current_setting('app.organization_create_id', true), '')::uuid
  );
