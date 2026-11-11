CREATE INDEX campaign_recipients_campaign_status_id_idx
  ON campaign_recipients (tenant_id, campaign_id, status, id);
