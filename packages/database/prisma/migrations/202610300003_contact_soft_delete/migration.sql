ALTER TABLE contacts ADD COLUMN deleted_at TIMESTAMPTZ;
CREATE INDEX contacts_tenant_deleted_at_idx ON contacts (tenant_id, deleted_at);
