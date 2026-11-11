CREATE TYPE "CustomFieldType" AS ENUM ('TEXT','NUMBER','DATE','BOOLEAN');
CREATE TABLE custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  type "CustomFieldType" NOT NULL DEFAULT 'TEXT',
  required BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,key)
);
CREATE INDEX custom_field_definitions_tenant_label_idx ON custom_field_definitions(tenant_id,label);
ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON custom_field_definitions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
