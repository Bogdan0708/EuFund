-- Add provenance columns to calls_for_proposals (links calls to source connectors).
-- All statements are idempotent: safe to re-run on databases where 0008 already applied these objects.

ALTER TABLE "calls_for_proposals" ADD COLUMN IF NOT EXISTS "source_connector_id" uuid;
--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN IF NOT EXISTS "external_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "calls_for_proposals"
    ADD CONSTRAINT "calls_for_proposals_source_connector_id_source_connectors_id_fk"
    FOREIGN KEY ("source_connector_id") REFERENCES "public"."source_connectors"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_calls_connector" ON "calls_for_proposals" USING btree ("source_connector_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_calls_unique_external" ON "calls_for_proposals" USING btree ("source_connector_id","external_id");
