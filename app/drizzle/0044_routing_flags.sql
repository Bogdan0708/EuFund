-- Routing-policy feature flags for interactive section generation.
--
-- May 19 2026: prod incident with multiple 300s Cloud Run timeouts on
-- generate_section. Even with cancellation propagation and the per-turn
-- cap, Opus is the wrong default for the SSE-bounded interactive path —
-- it's 5x the cost and 2-3x the latency of Sonnet, with quality
-- differences a user mostly can't see on structured EU-funding prose.
-- These three flags gate the routing change so we can roll it back from
-- the admin UI without reverting code.
--
-- Idempotent: safe to re-run.

INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'interactive_section_sonnet_default',
  false,
  'When ON, interactive generate_section/regenerate_section route to claude-sonnet-4-6 by default regardless of section importance. Opus reserved for explicit qualityMode=deep paths.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'deep_regeneration_enabled',
  false,
  'Enables the qualityMode=deep regeneration path (Opus, user-initiated only). When OFF, the existing isEscalation-based retry-to-Opus path stays as the only Opus route.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'section_extra_long_enabled',
  false,
  'Enables the extra_long section length tier (20k maxTokens). Without this flag, extra_long spec values fall back to the long tier (12k) so the SSE path stays bounded.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
