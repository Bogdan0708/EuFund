-- Phase 3a: add 'rollback' value to agent_section_version_kind enum
-- and rolled_back_from_version column to agent_section_versions
--> statement-breakpoint
ALTER TYPE "public"."agent_section_version_kind" ADD VALUE 'rollback';
--> statement-breakpoint
ALTER TABLE "agent_section_versions" ADD COLUMN "rolled_back_from_version" integer;
