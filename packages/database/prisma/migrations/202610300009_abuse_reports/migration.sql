CREATE TABLE abuse_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_address VARCHAR(320) NOT NULL,
  campaign_reference VARCHAR(160),
  message_id VARCHAR(320),
  reporter_email VARCHAR(320),
  category VARCHAR(40) NOT NULL,
  details VARCHAR(3000) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX abuse_reports_status_created_at_idx ON abuse_reports(status, created_at);
ALTER TABLE abuse_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY abuse_report_public_insert ON abuse_reports
  FOR INSERT WITH CHECK (current_setting('app.public_abuse_report', true) = 'true');
CREATE POLICY abuse_report_platform_admin ON abuse_reports
  FOR ALL USING (current_setting('app.platform_admin', true) = 'true')
  WITH CHECK (current_setting('app.platform_admin', true) = 'true');
