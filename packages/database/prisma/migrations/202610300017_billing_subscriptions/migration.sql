CREATE TABLE billing_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL,
  provider_customer_id VARCHAR(200),
  provider_subscription_id VARCHAR(200),
  plan VARCHAR(80) NOT NULL,
  status VARCHAR(40) NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_subscriptions_provider_subscription_key UNIQUE (provider, provider_subscription_id)
);
CREATE INDEX billing_subscriptions_tenant_status_updated_idx
  ON billing_subscriptions(tenant_id, status, updated_at);
ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing_subscriptions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
