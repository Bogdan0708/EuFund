-- Phase 1 section versioning: append-only per-section version history
-- Current state stays in workflow_sessions.context JSONB; only history moves here.
-- Cascade delete from workflow_sessions so orphan versions can't linger.
CREATE TABLE "section_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"section_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "uq_section_versions_session_section_version" UNIQUE("session_id","section_id","version")
);
--> statement-breakpoint
ALTER TABLE "section_versions" ADD CONSTRAINT "section_versions_session_id_workflow_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workflow_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "section_versions" ADD CONSTRAINT "section_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_section_versions_session_section" ON "section_versions" USING btree ("session_id","section_id");
--> statement-breakpoint
CREATE INDEX "idx_section_versions_created_at" ON "section_versions" USING btree ("created_at");
