-- Managed agent Phase 2 feature flag
-- Disabled by default. Enable via DB update with userIds targeting.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'managed_agent_enabled',
  false,
  'Route POST /api/ai/agent to the managed runtime for allowlisted users. Phase 2 pilot — discovery/research only, no writes.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
