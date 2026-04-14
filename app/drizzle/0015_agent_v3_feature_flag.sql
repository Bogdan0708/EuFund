-- Agent V3 feature flag
-- Disabled by default (0% rollout). Enable via DB update or admin API.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'agent_v3_enabled',
  false,
  'Enable Agent V3 conversational interface (replaces V2 orchestrator)',
  '{"percentage": 0}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
