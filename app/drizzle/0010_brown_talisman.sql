CREATE TYPE "public"."funding_instrument_type" AS ENUM('grant', 'state_aid', 'de_minimis', 'loan', 'guarantee', 'equity', 'combined');--> statement-breakpoint
CREATE TYPE "public"."implementing_channel" AS ENUM('mysmis', 'pnrr_portal', 'bank_network', 'afm_portal', 'minister_portal', 'e_licitatie');--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "instrument_type" "funding_instrument_type" DEFAULT 'grant';--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "implementing_channel" "implementing_channel" DEFAULT 'mysmis';--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "guarantee_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "interest_subsidy" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "legal_basis" text;--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "official_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_calls_code_unique" ON "calls_for_proposals" USING btree ("call_code");