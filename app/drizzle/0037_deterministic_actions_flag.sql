-- Seed the deterministic_actions_enabled feature flag (default disabled).
-- Gates the UI's use of /api/v1/agent-sessions/:id/actions/* endpoints.
-- When on, UI buttons drive workflow mutations via REST; when off, the
-- legacy in-chat tool path is used.
-- Idempotent: safe to re-run.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'deterministic_actions_enabled',
  false,
  'Gates the UI from routing workflow actions (freeze, accept, reject, rollback, change-call, export) through deterministic REST endpoints. When off, the legacy in-chat tool path is used.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
