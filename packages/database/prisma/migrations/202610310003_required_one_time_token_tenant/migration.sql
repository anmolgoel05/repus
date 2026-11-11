UPDATE one_time_tokens AS token
SET tenant_id = account.tenant_id
FROM users AS account
WHERE account.id = token.user_id
  AND token.tenant_id IS NULL;

ALTER TABLE one_time_tokens
  ALTER COLUMN tenant_id SET NOT NULL;
