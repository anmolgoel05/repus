ALTER TABLE campaign_recipients
  ADD COLUMN quota_date DATE;

UPDATE campaign_recipients AS recipient
SET quota_date = COALESCE(campaign.quota_date, (recipient.created_at AT TIME ZONE 'UTC')::date)
FROM campaigns AS campaign
WHERE campaign.id = recipient.campaign_id
  AND recipient.tenant_id = campaign.tenant_id;

ALTER TABLE campaign_recipients
  ALTER COLUMN quota_date SET NOT NULL;

CREATE INDEX campaign_recipients_quota_date_idx
  ON campaign_recipients (tenant_id, quota_date);
