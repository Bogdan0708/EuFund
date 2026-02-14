CREATE TYPE "public"."call_status" AS ENUM('previzionat', 'deschis', 'in_evaluare', 'inchis', 'anulat');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('granted', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('privacy_policy', 'terms_of_service', 'data_processing', 'marketing', 'analytics');--> statement-breakpoint
CREATE TYPE "public"."doc_type" AS ENUM('ghid_solicitant', 'bilant', 'certificat', 'aviz', 'studiu_fezabilitate', 'plan_afaceri', 'deviz', 'acord_parteneriat', 'declaratie', 'altul');--> statement-breakpoint
CREATE TYPE "public"."legislation_type" AS ENUM('regulament_eu', 'directiva_eu', 'oug', 'hg', 'lege', 'ordin', 'ghid', 'instructiune');--> statement-breakpoint
CREATE TYPE "public"."notif_type" AS ENUM('deadline', 'apel_nou', 'legislatie_update', 'compliance', 'system', 'colaborare');--> statement-breakpoint
CREATE TYPE "public"."org_size" AS ENUM('micro', 'mica', 'medie', 'mare');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('srl', 'sa', 'pfa', 'ong', 'uat', 'institutie_publica', 'altul');--> statement-breakpoint
CREATE TYPE "public"."program_status" AS ENUM('activ', 'inactiv', 'arhivat');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('ciorna', 'in_lucru', 'verificare', 'finalizat', 'depus', 'aprobat', 'respins', 'arhivat');--> statement-breakpoint
CREATE TYPE "public"."signature_status" AS ENUM('pending', 'prepared', 'signing', 'signed', 'rejected', 'expired', 'error');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'org_admin', 'project_manager', 'viewer');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(50),
	"resource_id" uuid,
	"old_value" jsonb,
	"new_value" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "calls_for_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"call_code" varchar(100) NOT NULL,
	"title_ro" varchar(1000) NOT NULL,
	"title_en" varchar(1000),
	"description_ro" text,
	"objective" text,
	"eligible_types" text[],
	"eligible_regions" text[],
	"eligible_caen" text[],
	"budget_total" numeric(15, 2),
	"budget_min" numeric(15, 2),
	"budget_max" numeric(15, 2),
	"cofinancing_rate" numeric(5, 2),
	"duration_min" integer,
	"duration_max" integer,
	"submission_start" timestamp with time zone,
	"submission_end" timestamp with time zone,
	"guide_url" varchar(500),
	"status" "call_status" DEFAULT 'previzionat',
	"is_competitive" boolean DEFAULT true,
	"evaluation_criteria" jsonb,
	"eligible_expenses" jsonb,
	"state_aid_scheme" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "compliance_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"generated_by" uuid NOT NULL,
	"overall_score" numeric(5, 2),
	"items" jsonb NOT NULL,
	"model_used" varchar(100),
	"tokens_used" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_type" "consent_type" NOT NULL,
	"status" "consent_status" DEFAULT 'granted' NOT NULL,
	"version" varchar(50) NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"granted_at" timestamp with time zone DEFAULT now(),
	"withdrawn_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"project_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"doc_type" "doc_type" NOT NULL,
	"filename" varchar(500) NOT NULL,
	"mime_type" varchar(100),
	"file_size" bigint,
	"storage_path" varchar(500) NOT NULL,
	"encryption_key_id" varchar(100),
	"ocr_text" text,
	"ai_summary" text,
	"extracted_data" jsonb,
	"checksum_sha256" varchar(64),
	"created_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "external_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(100) NOT NULL,
	"credential_ref" varchar(255),
	"base_url" varchar(500),
	"environment" varchar(20) DEFAULT 'production',
	"rate_limit_max" integer DEFAULT 10,
	"rate_limit_window_ms" integer DEFAULT 60000,
	"is_active" boolean DEFAULT true,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "funding_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"programme" varchar(100),
	"status" varchar(50) DEFAULT 'open',
	"opening_date" timestamp with time zone,
	"deadline_date" timestamp with time zone,
	"budget" numeric(15, 2),
	"currency" varchar(10) DEFAULT 'EUR',
	"topics" text[],
	"eligibility_criteria" jsonb,
	"source_url" varchar(500),
	"synced_at" timestamp with time zone DEFAULT now(),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "funding_calls_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "funding_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name_ro" varchar(500) NOT NULL,
	"name_en" varchar(500),
	"description_ro" text,
	"description_en" text,
	"managing_auth" varchar(255),
	"fund_source" varchar(50),
	"total_budget" numeric(15, 2),
	"period_start" date,
	"period_end" date,
	"website_url" varchar(500),
	"status" "program_status" DEFAULT 'activ',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "funding_programs_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "legislation_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"celex" varchar(50) NOT NULL,
	"title" text NOT NULL,
	"title_ro" text,
	"document_type" varchar(50),
	"published_date" date,
	"text_ro" text,
	"text_en" text,
	"subjects" text[],
	"in_force" boolean DEFAULT true,
	"source_url" varchar(500),
	"fetched_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "legislation_cache_celex_unique" UNIQUE("celex")
);
--> statement-breakpoint
CREATE TABLE "legislation_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ext_id" varchar(255),
	"type" "legislation_type" NOT NULL,
	"title_ro" text NOT NULL,
	"title_en" text,
	"issuer" varchar(255),
	"number" varchar(50),
	"published_date" date,
	"effective_date" date,
	"expiry_date" date,
	"source_url" varchar(500),
	"full_text" text,
	"relevance_tags" text[],
	"programs" text[],
	"is_active" boolean DEFAULT true,
	"superseded_by" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "legislation_documents_ext_id_unique" UNIQUE("ext_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notif_type" NOT NULL,
	"title_ro" varchar(500) NOT NULL,
	"body_ro" text,
	"link" varchar(500),
	"is_read" boolean DEFAULT false,
	"sent_email" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(500) NOT NULL,
	"cui" varchar(20),
	"reg_com" varchar(30),
	"org_type" "org_type" NOT NULL,
	"org_size" "org_size",
	"caen_primary" varchar(10),
	"caen_secondary" text[],
	"address" jsonb,
	"nuts_region" varchar(10),
	"legal_rep_name" varchar(255),
	"legal_rep_role" varchar(100),
	"contact_email" varchar(255),
	"contact_phone" varchar(20),
	"website" varchar(500),
	"founded_date" date,
	"employee_count" integer,
	"annual_revenue" numeric(15, 2),
	"is_vat_payer" boolean DEFAULT true,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "organizations_cui_unique" UNIQUE("cui")
);
--> statement-breakpoint
CREATE TABLE "project_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"section" varchar(100),
	"content" text NOT NULL,
	"resolved" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_by" uuid NOT NULL,
	"change_summary" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"call_id" uuid,
	"created_by" uuid NOT NULL,
	"title" varchar(1000) NOT NULL,
	"acronym" varchar(50),
	"status" "project_status" DEFAULT 'ciorna',
	"current_version" integer DEFAULT 1,
	"start_date" date,
	"end_date" date,
	"duration_months" integer,
	"total_budget" numeric(15, 2),
	"eu_contribution" numeric(15, 2),
	"national_contrib" numeric(15, 2),
	"own_contrib" numeric(15, 2),
	"section_summary" text,
	"section_context" text,
	"section_objectives" jsonb,
	"section_methodology" jsonb,
	"section_budget" jsonb,
	"section_indicators" jsonb,
	"section_sustainability" text,
	"section_partnership" jsonb,
	"section_risks" jsonb,
	"section_custom" jsonb DEFAULT '{}'::jsonb,
	"compliance_score" numeric(5, 2),
	"last_compliance_check" timestamp with time zone,
	"match_score" numeric(5, 2),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signature_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_workflow_id" varchar(255),
	"document_id" uuid,
	"project_id" uuid,
	"initiated_by" uuid NOT NULL,
	"document_title" varchar(500) NOT NULL,
	"document_hash" varchar(128),
	"status" "signature_status" DEFAULT 'pending',
	"signers" jsonb DEFAULT '[]'::jsonb,
	"audit_trail" jsonb DEFAULT '[]'::jsonb,
	"provider" varchar(50) DEFAULT 'certsign',
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"full_name" varchar(255) NOT NULL,
	"phone" varchar(20),
	"preferred_lang" varchar(5) DEFAULT 'ro',
	"avatar_url" varchar(500),
	"email_verified" boolean DEFAULT false,
	"mfa_enabled" boolean DEFAULT false,
	"mfa_secret" varchar(255),
	"date_of_birth" date,
	"age_verified" boolean DEFAULT false,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls_for_proposals" ADD CONSTRAINT "calls_for_proposals_program_id_funding_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."funding_programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_reports" ADD CONSTRAINT "compliance_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_reports" ADD CONSTRAINT "compliance_reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_call_id_calls_for_proposals_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls_for_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_workflows" ADD CONSTRAINT "signature_workflows_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_workflows" ADD CONSTRAINT "signature_workflows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_workflows" ADD CONSTRAINT "signature_workflows_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_user" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_resource" ON "audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_calls_program" ON "calls_for_proposals" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "idx_calls_status" ON "calls_for_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_calls_deadline" ON "calls_for_proposals" USING btree ("submission_end");--> statement-breakpoint
CREATE INDEX "idx_consent_user" ON "consent_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_documents_org" ON "documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_documents_project" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ext_integration_provider" ON "external_integrations" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_funding_calls_status" ON "funding_calls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_funding_calls_deadline" ON "funding_calls" USING btree ("deadline_date");--> statement-breakpoint
CREATE INDEX "idx_funding_calls_programme" ON "funding_calls" USING btree ("programme");--> statement-breakpoint
CREATE INDEX "idx_legislation_cache_celex" ON "legislation_cache" USING btree ("celex");--> statement-breakpoint
CREATE INDEX "idx_legislation_cache_type" ON "legislation_cache" USING btree ("document_type");--> statement-breakpoint
CREATE INDEX "idx_legislation_type" ON "legislation_documents" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_legislation_active" ON "legislation_documents" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_notif_user_unread" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_org_member_unique" ON "org_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_org_cui" ON "organizations" USING btree ("cui");--> statement-breakpoint
CREATE INDEX "idx_org_type" ON "organizations" USING btree ("org_type");--> statement-breakpoint
CREATE INDEX "idx_org_region" ON "organizations" USING btree ("nuts_region");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_project_version_unique" ON "project_versions" USING btree ("project_id","version_number");--> statement-breakpoint
CREATE INDEX "idx_projects_org" ON "projects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_projects_call" ON "projects" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "idx_projects_status" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sig_workflows_status" ON "signature_workflows" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sig_workflows_project" ON "signature_workflows" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_sig_workflows_initiator" ON "signature_workflows" USING btree ("initiated_by");