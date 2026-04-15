-- Schema-drift fix: add project_id and outline_frozen to agent_sessions.
-- Both columns were added to the ORM schema (app/src/lib/db/schema.ts) in
-- commits 993e676 (project_id) and 088d413 (outline_frozen) without an
-- accompanying migration, so production (which runs db:migrate) is missing
-- them while dev (which runs db:push) is not.
--
-- This migration is additive and default-safe:
--   - project_id is nullable
--   - outline_frozen defaults to false
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "project_id" uuid;
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "outline_frozen" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_sessions"
    ADD CONSTRAINT "agent_sessions_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
