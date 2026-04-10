-- Managed Agents Phase 2: agent_messages observability columns
-- Adds runtime_mode, provider, model columns to tag each persisted
-- message with which runtime produced it. Existing rows backfill
-- with runtime_mode='v3' via the default.

ALTER TABLE "agent_messages"
  ADD COLUMN IF NOT EXISTS "runtime_mode" "runtime_mode" DEFAULT 'v3' NOT NULL;
--> statement-breakpoint

ALTER TABLE "agent_messages"
  ADD COLUMN IF NOT EXISTS "provider" varchar(20);
--> statement-breakpoint

ALTER TABLE "agent_messages"
  ADD COLUMN IF NOT EXISTS "model" varchar(50);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_agent_messages_runtime"
  ON "agent_messages" USING btree ("runtime_mode", "created_at");
