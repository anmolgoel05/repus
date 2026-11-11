CREATE TYPE "ApiKeyRole" AS ENUM ('MARKETER','VIEWER');
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  key_hash TEXT NOT NULL UNIQUE,
  role "ApiKeyRole" NOT NULL DEFAULT 'MARKETER',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,created_by_user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX api_keys_tenant_revoked_created_idx ON api_keys(tenant_id,revoked_at,created_at);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_keys
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid
    OR key_hash = NULLIF(current_setting('app.api_key_hash',true),''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
