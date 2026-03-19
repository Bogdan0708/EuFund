CREATE TYPE "public"."alert_urgency" AS ENUM('daily');--> statement-breakpoint
CREATE TYPE "public"."discovery_method" AS ENUM('crawler', 'perplexity', 'manual');--> statement-breakpoint
CREATE TYPE "public"."discovery_status" AS ENUM('pending_review', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."file_category" AS ENUM('uploaded', 'generated');--> statement-breakpoint
CREATE TYPE "public"."project_doc_status" AS ENUM('draft', 'review', 'final');--> statement-breakpoint
CREATE TYPE "public"."project_status_v2" AS ENUM('draft', 'action_plan', 'built', 'exported');--> statement-breakpoint
CREATE TYPE "public"."workflow_message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('active', 'paused', 'completed', 'abandoned');--> statement-breakpoint
ALTER TYPE "public"."user_tier" ADD VALUE 'plus' BEFORE 'pro';--> statement-breakpoint
ALTER TYPE "public"."user_tier" ADD VALUE 'ultra';--> statement-breakpoint
CREATE TABLE "discovered_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_url" text NOT NULL,
	"source_domain" text NOT NULL,
	"title" text NOT NULL,
	"program" text,
	"summary" text,
	"raw_content" text,
	"content_hash" text NOT NULL,
	"discovered_at" timestamp DEFAULT now() NOT NULL,
	"discovery_method" "discovery_method" NOT NULL,
	"discovery_source" text,
	"status" "discovery_status" DEFAULT 'pending_review' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"call_id" uuid,
	CONSTRAINT "discovered_calls_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE TABLE "program_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"program" text NOT NULL,
	"urgency" "alert_urgency" DEFAULT 'daily' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sections" jsonb NOT NULL,
	"action_plan" jsonb,
	"metadata" jsonb,
	"status" "project_doc_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_path" text NOT NULL,
	"category" "file_category" NOT NULL,
	"description" text,
	"extracted_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"invited_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp,
	CONSTRAINT "uq_team_owner_member" UNIQUE("owner_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"event_id" integer,
	"role" "workflow_message_role" NOT NULL,
	"content" text NOT NULL,
	"step" integer,
	"event_type" varchar(50),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"current_step" integer DEFAULT 1 NOT NULL,
	"context" jsonb DEFAULT '{}' NOT NULL,
	"status" "workflow_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "ec_external_id" varchar(255);--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "ec_topics" jsonb;--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "ec_eligibility_criteria" jsonb;--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "ec_source_url" text;--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "ec_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "discovered_calls" ADD CONSTRAINT "discovered_calls_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_calls" ADD CONSTRAINT "discovered_calls_call_id_calls_for_proposals_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls_for_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_alerts" ADD CONSTRAINT "program_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_messages" ADD CONSTRAINT "workflow_messages_session_id_workflow_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workflow_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_sessions" ADD CONSTRAINT "workflow_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_sessions" ADD CONSTRAINT "workflow_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_discovered_calls_status" ON "discovered_calls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_program_alerts_user" ON "program_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_project_documents_project" ON "project_documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_project_files_project" ON "project_files" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_team_members_owner" ON "team_members" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_team_members_member" ON "team_members" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_messages_session" ON "workflow_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_messages_created" ON "workflow_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_workflow_sessions_user" ON "workflow_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_sessions_status" ON "workflow_sessions" USING btree ("status");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;