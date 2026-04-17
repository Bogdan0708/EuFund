-- Per-turn cost telemetry for the managed agent runtime.
-- Captures the Anthropic streamed `usage` block plus derived cost in
-- integer micro-dollars (dollars × 1,000,000) so we can aggregate without
-- float drift.
--
-- All columns are nullable: old rows pre-instrumentation stay untouched,
-- and turns that fail before the first stream event (no model chosen yet)
-- leave them null. `model` is denormalised here so dashboards can split by
-- model without joining through agent_messages.
--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN IF NOT EXISTS "model" varchar(100);
--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN IF NOT EXISTS "input_tokens" integer;
--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN IF NOT EXISTS "output_tokens" integer;
--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN IF NOT EXISTS "cache_read_input_tokens" integer;
--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN IF NOT EXISTS "cache_creation_input_tokens" integer;
--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN IF NOT EXISTS "cost_usd_micros" bigint;
