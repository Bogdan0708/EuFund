-- Seed the v3_chat_model_sonnet feature flag (default disabled).
-- Independent rollout control for the Opus→Sonnet downgrade on the V3
-- agent chat loop. Previously the model selection at
-- app/src/lib/ai/agent/runtime.ts:215 was piggy-backed on
-- `chat_tools_trimmed`, which ALSO strips the agent's write tools — so
-- the cost downgrade could not be enabled without changing agent
-- behavior. This flag decouples the two.
--
-- Idempotent: safe to re-run.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'v3_chat_model_sonnet',
  false,
  'V3 agent chat loop: route the planning model to claude-sonnet-4-6 instead of claude-opus-4-6. Independent of chat_tools_trimmed.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
