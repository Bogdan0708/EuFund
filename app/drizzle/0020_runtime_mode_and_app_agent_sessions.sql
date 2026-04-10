-- Managed Agents Phase 2: runtime_mode enum + application_agent_sessions table
-- Stores managed-runtime metadata (runtime mode, degradation reason,
-- last turn model, tool count). Created lazily on first managed turn.
-- Never stores conversation content.

DO $$ BEGIN
  CREATE TYPE "public"."runtime_mode" AS ENUM('v3', 'managed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "application_agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"runtime_mode" "runtime_mode" DEFAULT 'managed' NOT NULL,
	"created_with_flag" boolean DEFAULT false NOT NULL,
	"status" "agent_session_status" DEFAULT 'active' NOT NULL,
	"degraded_at" timestamp with time zone,
	"degraded_reason" text,
	"last_turn_at" timestamp with time zone,
	"last_turn_model" varchar(50),
	"last_turn_tool_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "application_agent_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint

ALTER TABLE "application_agent_sessions"
  ADD CONSTRAINT "application_agent_sessions_session_id_agent_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "application_agent_sessions"
  ADD CONSTRAINT "application_agent_sessions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_app_agent_sessions_user_status"
  ON "application_agent_sessions" USING btree ("user_id", "status", "updated_at");
