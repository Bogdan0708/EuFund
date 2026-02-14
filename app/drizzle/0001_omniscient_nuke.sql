CREATE TYPE "public"."risk_level" AS ENUM('very_low', 'low', 'medium', 'high', 'very_high');--> statement-breakpoint
CREATE TYPE "public"."work_package_status" AS ENUM('planned', 'active', 'completed', 'delayed', 'cancelled');--> statement-breakpoint
CREATE TABLE "compliance_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"criterion_name" varchar(255) NOT NULL,
	"requirement_text" text,
	"compliance_score" integer,
	"status" varchar(50) DEFAULT 'pending',
	"evidence_documents" jsonb DEFAULT '[]'::jsonb,
	"assessor_notes" text,
	"assessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "project_timelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"work_package_id" uuid,
	"task_name" varchar(255) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"dependencies" jsonb DEFAULT '[]'::jsonb,
	"progress_percentage" integer DEFAULT 0,
	"assigned_to" uuid,
	"risk_level" "risk_level" DEFAULT 'low',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "risk_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"risk_type" varchar(100) NOT NULL,
	"description" text,
	"probability" integer,
	"impact" integer,
	"mitigation_strategy" text,
	"status" varchar(50) DEFAULT 'identified',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "work_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"start_date" date,
	"end_date" date,
	"budget_allocated" numeric(12, 2),
	"budget_spent" numeric(12, 2) DEFAULT '0',
	"status" "work_package_status" DEFAULT 'planned',
	"lead_partner_id" uuid,
	"dependencies" jsonb DEFAULT '[]'::jsonb,
	"milestones" jsonb DEFAULT '[]'::jsonb,
	"deliverables" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_timelines" ADD CONSTRAINT "project_timelines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_timelines" ADD CONSTRAINT "project_timelines_work_package_id_work_packages_id_fk" FOREIGN KEY ("work_package_id") REFERENCES "public"."work_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_timelines" ADD CONSTRAINT "project_timelines_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_lead_partner_id_organizations_id_fk" FOREIGN KEY ("lead_partner_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_compliance_check_project" ON "compliance_checks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_timeline_project" ON "project_timelines" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_timeline_wp" ON "project_timelines" USING btree ("work_package_id");--> statement-breakpoint
CREATE INDEX "idx_risk_project" ON "risk_assessments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_wp_project" ON "work_packages" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_wp_status" ON "work_packages" USING btree ("status");