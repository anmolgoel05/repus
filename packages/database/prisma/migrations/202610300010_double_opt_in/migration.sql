ALTER TABLE tenants ADD COLUMN double_opt_in_enabled BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE contact_confirmation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  email_queued_at TIMESTAMPTZ,
  email_queue_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX contact_confirmation_tokens_tenant_contact_expiry_idx ON contact_confirmation_tokens(tenant_id, contact_id, expires_at);
ALTER TABLE contact_confirmation_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_confirmation_token_access ON contact_confirmation_tokens
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR token_hash = current_setting('app.contact_confirmation_token_hash', true)
  )
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
