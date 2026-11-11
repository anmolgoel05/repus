ALTER TABLE platform_controls
  ADD COLUMN daily_send_limit INTEGER,
  ADD COLUMN monthly_send_limit INTEGER,
  ADD CONSTRAINT platform_controls_daily_send_limit_nonnegative CHECK (daily_send_limit IS NULL OR daily_send_limit >= 0),
  ADD CONSTRAINT platform_controls_monthly_send_limit_nonnegative CHECK (monthly_send_limit IS NULL OR monthly_send_limit >= 0);
