-- Seed the v3_prompt_cache_enabled feature flag.
-- V3-specific rollout flag: gates whether the V3 agent runtime opts into
-- Anthropic prompt caching by passing cache: { enabled: true } on the
-- generate() call. Orthogonal to the global kill switch prompt_cache_enabled
-- (both flags must resolve true for caching to be active).
--
-- Seeded with percentage: 0 so no users hit caching at deploy time.
-- Ramp via PATCH /api/v1/admin/feature-flags/v3_prompt_cache_enabled during
-- the production canary (see docs/superpowers/plans/2026-04-22-v3-rag-prompt-caching-pr2-v3-optin.md PR 2c).
--
-- Idempotent: safe to re-run.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'v3_prompt_cache_enabled',
  true,
  'V3 agent runtime: opt-in to prompt caching. Percentage-targeted on userId.',
  '{"percentage": 0}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
