ALTER TABLE one_time_tokens
 ADD COLUMN token_encrypted text,
 ADD COLUMN delivery_status text NOT NULL DEFAULT 'PENDING',
 ADD COLUMN delivery_attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN delivery_next_attempt_at timestamptz,
 ADD COLUMN delivery_started_at timestamptz,
 ADD COLUMN delivery_sent_at timestamptz,
 ADD COLUMN delivery_message_id text,
 ADD CONSTRAINT account_email_delivery_status_check CHECK (delivery_status IN ('PENDING','SENDING','SENT','FAILED','UNCERTAIN','SKIPPED')),
 ADD CONSTRAINT account_email_delivery_attempts_check CHECK (delivery_attempts BETWEEN 0 AND 5);
CREATE INDEX one_time_tokens_pending_delivery_idx ON one_time_tokens(delivery_next_attempt_at,created_at)
 WHERE delivery_status='PENDING' AND token_encrypted IS NOT NULL;
