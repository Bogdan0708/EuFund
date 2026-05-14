-- Seed the chat_tools_trimmed feature flag (default disabled).
-- When enabled, the chat tool surface (V3 + managed) is narrowed to
-- read + rule + a single scoped save_section_draft({ content }) tool.
-- Navigation write tools (save_call_blueprint, freeze_outline,
-- set_selected_call, approve_revision, reject_section, rollback_section,
-- mark_section_stale, set_application_status, create_export_snapshot)
-- are removed from the model's tool surface. Iteration caps drop to 3
-- and V3 model swaps from Opus to Sonnet for chat turns.
-- Idempotent: safe to re-run.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'chat_tools_trimmed',
  false,
  'Narrows chat tool surface to read+rule+scoped save; drops iteration caps to 3; swaps V3 chat model to Sonnet.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
