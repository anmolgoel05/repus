CREATE INDEX "campaigns_tenant_created_id_idx" ON "campaigns" ("tenant_id", "created_at" DESC, "id" DESC);
