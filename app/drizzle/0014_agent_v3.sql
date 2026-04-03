-- Agent V3: new enums, extended call_knowledge, and agent session tables
--> statement-breakpoint
CREATE TYPE "public"."call_knowledge_status" AS ENUM('provisional', 'primed', 'verified');
--> statement-breakpoint
CREATE TYPE "public"."agent_session_status" AS ENUM('active', 'paused', 'completed', 'abandoned', 'error');
--> statement-breakpoint
CREATE TYPE "public"."agent_phase" AS ENUM('discovery', 'research', 'structuring', 'drafting', 'review');
--> statement-breakpoint
CREATE TYPE "public"."agent_section_status" AS ENUM('pending', 'generating', 'draft', 'accepted', 'stale', 'invalidated', 'needs_review', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."agent_section_version_kind" AS ENUM('draft', 'accepted', 'regenerated', 'system_rewrite');
--> statement-breakpoint

-- Extend call_knowledge (create if missing, add new columns, drop old columns)
CREATE TABLE IF NOT EXISTS "call_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" text NOT NULL,
	"program" text NOT NULL,
	"call_title" text NOT NULL,
	"normalized" jsonb DEFAULT '{}' NOT NULL,
	"status" "call_knowledge_status" DEFAULT 'provisional' NOT NULL,
	"extracted_from" varchar(20) DEFAULT 'qdrant_obsidian' NOT NULL,
	"structure_confidence" real DEFAULT 0 NOT NULL,
	"freshness_confidence" real DEFAULT 0 NOT NULL,
	"source_docs" jsonb DEFAULT '[]' NOT NULL,
	"field_provenance" jsonb DEFAULT '{}',
	"content_extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"freshness_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Add new columns to call_knowledge if they don't exist (for DBs that already have the table)
ALTER TABLE "call_knowledge" ADD COLUMN IF NOT EXISTS "normalized" jsonb DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_knowledge" ADD COLUMN IF NOT EXISTS "status" "call_knowledge_status" DEFAULT 'provisional' NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_knowledge" ADD COLUMN IF NOT EXISTS "extracted_from" varchar(20) DEFAULT 'qdrant_obsidian' NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_knowledge" ADD COLUMN IF NOT EXISTS "structure_confidence" real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_knowledge" ADD COLUMN IF NOT EXISTS "freshness_confidence" real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_knowledge" ADD COLUMN IF NOT EXISTS "source_docs" jsonb DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_knowledge" ADD COLUMN IF NOT EXISTS "field_provenance" jsonb DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "call_knowledge" ADD COLUMN IF NOT EXISTS "content_extracted_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "call_knowledge" ADD COLUMN IF NOT EXISTS "freshness_checked_at" timestamp with time zone;
--> statement-breakpoint

-- Drop old call_knowledge columns if they exist
ALTER TABLE "call_knowledge" DROP COLUMN IF EXISTS "sections";
--> statement-breakpoint
ALTER TABLE "call_knowledge" DROP COLUMN IF EXISTS "requirements";
--> statement-breakpoint
ALTER TABLE "call_knowledge" DROP COLUMN IF EXISTS "evaluation";
--> statement-breakpoint
ALTER TABLE "call_knowledge" DROP COLUMN IF EXISTS "eligibility";
--> statement-breakpoint
ALTER TABLE "call_knowledge" DROP COLUMN IF EXISTS "source";
--> statement-breakpoint
ALTER TABLE "call_knowledge" DROP COLUMN IF EXISTS "verified_at";
--> statement-breakpoint

-- Recreate unique index on call_id
DROP INDEX IF EXISTS "idx_call_knowledge_call_id";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_call_knowledge_call_id" ON "call_knowledge" USING btree ("call_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_call_knowledge_program" ON "call_knowledge" USING btree ("program");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_call_knowledge_content_extracted" ON "call_knowledge" USING btree ("content_extracted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_call_knowledge_freshness_checked" ON "call_knowledge" USING btree ("freshness_checked_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_call_knowledge_status" ON "call_knowledge" USING btree ("status");
--> statement-breakpoint

-- Agent sessions table
CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "agent_session_status" DEFAULT 'active' NOT NULL,
	"locale" varchar(5) DEFAULT 'ro' NOT NULL,
	"selected_call_id" varchar(255),
	"current_phase" "agent_phase" DEFAULT 'discovery' NOT NULL,
	"blueprint" jsonb,
	"eligibility" jsonb,
	"outline" jsonb,
	"warnings" jsonb DEFAULT '[]',
	"planning_artifact" jsonb,
	"message_summary" text,
	"state_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Agent sections table
CREATE TABLE "agent_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"section_key" varchar(100) NOT NULL,
	"title" varchar(500) NOT NULL,
	"document_order" integer NOT NULL,
	"generation_order" integer NOT NULL,
	"status" "agent_section_status" DEFAULT 'pending' NOT NULL,
	"content" text,
	"accepted_content" text,
	"model_used" varchar(100),
	"retry_count" integer DEFAULT 0 NOT NULL,
	"sources_used" jsonb,
	"prompt_version" varchar(50),
	"latency_ms" integer,
	"token_usage" jsonb,
	"error_class" varchar(100),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Agent section versions table
CREATE TABLE "agent_section_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"kind" "agent_section_version_kind" NOT NULL,
	"content" text NOT NULL,
	"model_used" varchar(100),
	"sources_used" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Agent messages table
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" varchar(15) NOT NULL,
	"message_type" varchar(20) NOT NULL,
	"content" jsonb NOT NULL,
	"tool_name" varchar(100),
	"tool_call_id" varchar(100),
	"sequence_number" integer NOT NULL,
	"compacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Agent checkpoints table
CREATE TABLE "agent_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"checkpoint_type" varchar(30) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Foreign keys
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_sections" ADD CONSTRAINT "agent_sections_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_section_versions" ADD CONSTRAINT "agent_section_versions_section_id_agent_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."agent_sections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_checkpoints" ADD CONSTRAINT "agent_checkpoints_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Indexes for agent_sessions
CREATE INDEX "idx_agent_sessions_user_status" ON "agent_sessions" USING btree ("user_id", "status", "updated_at");
--> statement-breakpoint
CREATE INDEX "idx_agent_sessions_call" ON "agent_sessions" USING btree ("selected_call_id");
--> statement-breakpoint

-- Indexes for agent_sections
CREATE UNIQUE INDEX "uniq_agent_section_session_key" ON "agent_sections" USING btree ("session_id", "section_key");
--> statement-breakpoint
CREATE INDEX "idx_agent_sections_order" ON "agent_sections" USING btree ("session_id", "document_order");
--> statement-breakpoint
CREATE INDEX "idx_agent_sections_status" ON "agent_sections" USING btree ("session_id", "status");
--> statement-breakpoint

-- Indexes for agent_messages
CREATE INDEX "idx_agent_messages_seq" ON "agent_messages" USING btree ("session_id", "sequence_number");
--> statement-breakpoint
CREATE INDEX "idx_agent_messages_compacted" ON "agent_messages" USING btree ("session_id", "compacted_at");
--> statement-breakpoint

-- Indexes for agent_checkpoints
CREATE INDEX "idx_agent_checkpoints_created" ON "agent_checkpoints" USING btree ("session_id", "created_at");
