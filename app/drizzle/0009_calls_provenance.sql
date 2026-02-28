CREATE TYPE "public"."connector_access_method" AS ENUM('api', 'html', 'pdf', 'docx', 'rss', 'manual');--> statement-breakpoint
CREATE TYPE "public"."connector_run_status" AS ENUM('running', 'success', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."extraction_method" AS ENUM('regex', 'rule', 'llm', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."review_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'in_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "funding_call_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"call_external_key" varchar(255) NOT NULL,
	"extraction_version" integer DEFAULT 1 NOT NULL,
	"field_name" varchar(100) NOT NULL,
	"field_value_json" jsonb NOT NULL,
	"confidence" numeric(5, 4),
	"evidence_snippet" text,
	"evidence_page" integer,
	"evidence_locator" varchar(500),
	"method" "extraction_method" DEFAULT 'hybrid' NOT NULL,
	"validated" boolean DEFAULT false NOT NULL,
	"validation_errors" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "funding_call_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_external_key" varchar(255) NOT NULL,
	"version_no" integer NOT NULL,
	"change_type" varchar(50) DEFAULT 'updated' NOT NULL,
	"changed_fields" jsonb NOT NULL,
	"diff_summary" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "funding_documents_raw" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"run_id" uuid,
	"external_key" varchar(255) NOT NULL,
	"source_url" varchar(1000) NOT NULL,
	"document_type" varchar(100) NOT NULL,
	"language" varchar(10) DEFAULT 'ro' NOT NULL,
	"file_type" varchar(20) NOT NULL,
	"title" text,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now(),
	"sha256" varchar(64) NOT NULL,
	"storage_path" varchar(500) NOT NULL,
	"text_content" text,
	"structure_json" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "funding_review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_external_key" varchar(255) NOT NULL,
	"document_id" uuid,
	"reason" text NOT NULL,
	"severity" "review_severity" DEFAULT 'medium' NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"assigned_to" uuid,
	"created_by" uuid,
	"resolution_notes" text,
	"resolved_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "source_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"owner" varchar(255),
	"base_url" varchar(1000),
	"access_method" "connector_access_method" DEFAULT 'html' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "source_connectors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "source_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"status" "connector_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"finished_at" timestamp with time zone,
	"items_discovered" integer DEFAULT 0 NOT NULL,
	"items_changed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "source_connector_id" uuid;--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "external_id" varchar(255);--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "funding_call_extractions" ADD CONSTRAINT "funding_call_extractions_document_id_funding_documents_raw_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."funding_documents_raw"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_call_versions" ADD CONSTRAINT "funding_call_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_documents_raw" ADD CONSTRAINT "funding_documents_raw_connector_id_source_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."source_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_documents_raw" ADD CONSTRAINT "funding_documents_raw_run_id_source_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."source_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_review_queue" ADD CONSTRAINT "funding_review_queue_document_id_funding_documents_raw_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."funding_documents_raw"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_review_queue" ADD CONSTRAINT "funding_review_queue_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_review_queue" ADD CONSTRAINT "funding_review_queue_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_runs" ADD CONSTRAINT "source_runs_connector_id_source_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."source_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_funding_call_extractions_call_key" ON "funding_call_extractions" USING btree ("call_external_key");--> statement-breakpoint
CREATE INDEX "idx_funding_call_extractions_field" ON "funding_call_extractions" USING btree ("field_name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_funding_call_extractions_unique" ON "funding_call_extractions" USING btree ("document_id","call_external_key","field_name","extraction_version");--> statement-breakpoint
CREATE INDEX "idx_funding_call_versions_call_key" ON "funding_call_versions" USING btree ("call_external_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_funding_call_versions_unique" ON "funding_call_versions" USING btree ("call_external_key","version_no");--> statement-breakpoint
CREATE INDEX "idx_funding_docs_raw_connector" ON "funding_documents_raw" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "idx_funding_docs_raw_fetched" ON "funding_documents_raw" USING btree ("fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_funding_docs_raw_unique_version" ON "funding_documents_raw" USING btree ("connector_id","external_key","sha256");--> statement-breakpoint
CREATE INDEX "idx_funding_review_queue_status" ON "funding_review_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_funding_review_queue_severity" ON "funding_review_queue" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_funding_review_queue_assigned" ON "funding_review_queue" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "idx_source_connectors_active" ON "source_connectors" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_source_runs_connector" ON "source_runs" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "idx_source_runs_status" ON "source_runs" USING btree ("status");--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD CONSTRAINT "calls_for_proposals_source_connector_id_source_connectors_id_fk" FOREIGN KEY ("source_connector_id") REFERENCES "public"."source_connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_calls_connector" ON "calls_for_proposals" USING btree ("source_connector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_calls_unique_external" ON "calls_for_proposals" USING btree ("source_connector_id","external_id");