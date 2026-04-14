-- Phase 3a: add 'rejected' status to agent_section_status enum
-- and rejection_reason column to agent_sections
--> statement-breakpoint
ALTER TYPE "public"."agent_section_status" ADD VALUE 'rejected';
--> statement-breakpoint
ALTER TABLE "agent_sections" ADD COLUMN "rejection_reason" text;
