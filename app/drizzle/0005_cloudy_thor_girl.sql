CREATE TYPE "public"."ai_review_status" AS ENUM('pending_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "ai_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"reviewed_by" uuid,
	"feature" varchar(100) NOT NULL,
	"risk_level" varchar(20) NOT NULL,
	"input_summary" text,
	"result_data" jsonb NOT NULL,
	"result_metadata" jsonb DEFAULT '{}'::jsonb,
	"status" "ai_review_status" DEFAULT 'pending_review',
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"targeting" jsonb DEFAULT '{}'::jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "feature_flags_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "entry_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "previous_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_platform_admin" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "ai_reviews" ADD CONSTRAINT "ai_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reviews" ADD CONSTRAINT "ai_reviews_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reviews" ADD CONSTRAINT "ai_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_reviews_org" ON "ai_reviews" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_ai_reviews_status" ON "ai_reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ai_reviews_requested_by" ON "ai_reviews" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "idx_audit_hash_chain" ON "audit_log" USING btree ("created_at","entry_hash");