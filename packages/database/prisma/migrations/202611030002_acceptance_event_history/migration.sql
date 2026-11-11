-- Preserve existing acceptance history and add the normalized event for receipts
-- whose acceptance was previously stored only on campaign_recipients.
INSERT INTO email_events (tenant_id, recipient_id, event_type, event_key, event_data, occurred_at)
SELECT cr.tenant_id, cr.id, 'accepted', 'accepted:' || cr.id::text,
       jsonb_build_object('providerMessageId', cr.provider_message_id, 'source', 'acceptance_backfill'),
       cr.provider_accepted_at
FROM campaign_recipients cr
WHERE cr.provider_accepted_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM email_events e WHERE e.tenant_id=cr.tenant_id AND e.recipient_id=cr.id AND e.event_type='accepted')
ON CONFLICT (tenant_id, event_key) DO NOTHING;
