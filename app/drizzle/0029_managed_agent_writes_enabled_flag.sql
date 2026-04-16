-- Managed agent Phase 3b write-surface feature flag
-- Disabled by default. Enable per-user via DB update with userIds targeting
-- after the PR-B history normalizer is in production and its metrics show
-- zero classification_error events across a sample of >=100 managed turns.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'managed_agent_writes_enabled',
  false,
  'Gates managed runtime write tools (Phase 3b). Default off. Enable per-user via targeting.userIds after normalizer metrics are clean.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
