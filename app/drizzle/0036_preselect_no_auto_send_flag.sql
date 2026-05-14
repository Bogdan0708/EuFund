-- Seed the preselect_no_auto_send feature flag (default disabled).
-- Gates the UI's first-message auto-send to /api/ai/agent after deterministic
-- preselect picks a call. When enabled, preselect ends with adoptSession() and
-- the UI renders a static welcome string; no model turn fires until the user
-- explicitly chats or clicks Generate.
-- Admins enable via targeting JSONB: {"userIds": [...]} or {"percentage": 10}.
-- Idempotent: safe to re-run.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'preselect_no_auto_send',
  false,
  'Gates the UI from auto-sending the project description to /api/ai/agent after deterministic preselect. When on, preselect is the workflow start; chat is opt-in.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
