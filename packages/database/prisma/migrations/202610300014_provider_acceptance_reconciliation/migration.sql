ALTER TABLE campaign_recipients
  ADD COLUMN provider_accepted_at TIMESTAMPTZ,
  ADD COLUMN send_started_at TIMESTAMPTZ;

-- Existing terminal send states were already accounted by the send worker;
-- seed the idempotency marker so a delayed provider event cannot count them twice.
UPDATE campaign_recipients
SET provider_accepted_at = sent_at
WHERE status IN ('SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED')
  AND sent_at IS NOT NULL
  AND provider_accepted_at IS NULL;

UPDATE campaign_recipients
SET send_started_at = NOW()
WHERE status = 'SENDING' AND send_started_at IS NULL;

CREATE INDEX campaign_recipients_send_review_idx
  ON campaign_recipients (tenant_id, campaign_id, status, send_started_at);
