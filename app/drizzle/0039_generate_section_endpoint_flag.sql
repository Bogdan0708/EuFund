-- Seed the generate_section_endpoint_enabled feature flag (default disabled).
-- Gates the UI's "Generate next section" button and the
-- /api/v1/agent-sessions/:id/sections/generate SSE endpoint.
-- When on, one click runs ensureDraftingReady() (eligibility → freeze →
-- write) and streams a single section draft. When off, drafting goes
-- through the legacy chat tool path.
-- Idempotent: safe to re-run.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'generate_section_endpoint_enabled',
  false,
  'Gates the deterministic /sections/generate SSE endpoint and Generate button.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
