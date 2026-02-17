ALTER TABLE users ADD COLUMN stripe_customer_id VARCHAR(255);
ALTER TABLE users ADD COLUMN stripe_subscription_id VARCHAR(255);
ALTER TABLE users ADD COLUMN subscription_status VARCHAR(50) DEFAULT 'none';
ALTER TABLE users ADD COLUMN subscription_period_end TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN api_calls_this_month INTEGER DEFAULT 0;
CREATE INDEX idx_users_stripe_customer ON users(stripe_customer_id);
