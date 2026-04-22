-- Seed the prompt_cache_enabled feature flag (default disabled).
-- Global kill-switch for router prompt caching. The router only reads this flag
-- when req.cache?.enabled === true, so while disabled no caller pays a DB read.
-- Idempotent: safe to re-run.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'prompt_cache_enabled',
  false,
  'Global kill-switch for router prompt caching',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
