CREATE TABLE image_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  token_hash TEXT NOT NULL UNIQUE,
  token_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,id)
);
CREATE INDEX image_assets_tenant_created_idx ON image_assets(tenant_id,created_at);
ALTER TABLE image_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON image_assets
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid
    OR token_hash = NULLIF(current_setting('app.image_token_hash',true),''))
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
