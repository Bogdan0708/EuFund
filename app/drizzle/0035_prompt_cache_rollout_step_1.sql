-- Prompt-cache rollout, steps (1) + (2) of the audit sequence.
--
--   (1) flip the global prompt_cache_enabled kill-switch from false to true.
--   (2) ramp v3_prompt_cache_enabled targeting from {percentage: 0} to 10.
--   (3) observe ai_call_completed cache.hit distribution for 24-48 h
--       (next PR ramps to 50, then a final PR to 100).
--
-- Both flags are read by lib/ai/providers/router.ts; both must resolve true
-- for a request to enter the cache path. The router skips the global flag
-- read entirely when req.cache?.enabled !== true, so this migration costs
-- nothing for non-opted-in callers.
--
-- Guarded with WHERE clauses so re-running the migration after a hand-ramp
-- via the admin API doesn't clobber a higher percentage.

UPDATE feature_flags
SET enabled = true, updated_at = NOW()
WHERE key = 'prompt_cache_enabled'
  AND enabled = false;
--> statement-breakpoint

UPDATE feature_flags
SET targeting = jsonb_set(targeting, '{percentage}', '10'::jsonb, true),
    updated_at = NOW()
WHERE key = 'v3_prompt_cache_enabled'
  AND COALESCE((targeting->>'percentage')::int, 0) = 0;
