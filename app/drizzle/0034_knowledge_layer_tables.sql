-- Knowledge layer tables. These are defined in app/src/lib/db/schema.ts but
-- were never migrated, so production logs every phase transition with
-- "relation \"session_knowledge\" does not exist" and the section-accept
-- pattern distiller silently drops to no-ops. This brings the DB in line
-- with the schema for both session_knowledge and proposal_patterns.
--
-- Idempotent: enum guarded by EXCEPTION block, tables/indexes use IF NOT EXISTS.

DO $$ BEGIN
  CREATE TYPE "public"."session_knowledge_kind" AS ENUM(
    'brief', 'evidence_map', 'risks', 'budget_rationale',
    'decision_log', 'section_pattern'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "session_knowledge" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "project_id" uuid,
  "kind" "session_knowledge_kind" NOT NULL,
  "slug" varchar(200) NOT NULL,
  "title" varchar(500) NOT NULL,
  "content_md" text NOT NULL,
  "frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "derived_from_section_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "session_knowledge"
    ADD CONSTRAINT "session_knowledge_session_id_agent_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "session_knowledge"
    ADD CONSTRAINT "session_knowledge_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "session_knowledge"
    ADD CONSTRAINT "session_knowledge_derived_from_section_id_agent_sections_id_fk"
    FOREIGN KEY ("derived_from_section_id") REFERENCES "public"."agent_sections"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_session_knowledge_session_kind"
  ON "session_knowledge" USING btree ("session_id", "kind");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_session_knowledge_project_kind"
  ON "session_knowledge" USING btree ("project_id", "kind");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_session_knowledge_session_slug"
  ON "session_knowledge" USING btree ("session_id", "slug");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "proposal_patterns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "program" varchar(50) NOT NULL,
  "section_type" varchar(100) NOT NULL,
  "title" varchar(500) NOT NULL,
  "content_md" text NOT NULL,
  "frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "derived_from_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "times_used" integer DEFAULT 0 NOT NULL,
  "times_accepted" integer DEFAULT 0 NOT NULL,
  "avg_regen_count" real DEFAULT 0 NOT NULL,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_proposal_patterns_program_section"
  ON "proposal_patterns" USING btree ("program", "section_type");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_proposal_patterns_used"
  ON "proposal_patterns" USING btree ("times_used");
