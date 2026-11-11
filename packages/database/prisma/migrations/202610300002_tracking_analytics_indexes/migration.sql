CREATE INDEX email_events_tenant_type_occurred_idx
  ON email_events (tenant_id, event_type, occurred_at);

CREATE INDEX email_events_unique_engagement_idx
  ON email_events (tenant_id, event_type, recipient_id)
  WHERE event_type IN ('open', 'click') AND event_data->>'unique' = 'true';
