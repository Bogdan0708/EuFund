-- Seed the deterministic_preselect_enabled feature flag (default disabled).
-- Gates server-side deterministic preselect at /proiecte/nou first-message dispatch.
-- Hard dependency on managed_agent_writes_enabled (the preselect route creates
-- sessions via the managed write surface, so both flags must be enabled for the
-- feature to function end-to-end).
-- Admins enable via targeting JSONB: {"userIds": [...]} or {"percentage": 10}.
-- Idempotent: safe to re-run.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'deterministic_preselect_enabled',
  false,
  'Gates server-side deterministic call preselect at /proiecte/nou first-message dispatch. Hard dependency on managed_agent_writes_enabled.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
