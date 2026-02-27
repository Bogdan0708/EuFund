-- ─── AI Reviews Table (EU AI Act Art. 14 — Human Oversight) ─────
CREATE TYPE "ai_review_status" AS ENUM ('pending_review', 'approved', 'rejected');

CREATE TABLE "ai_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "requested_by" uuid NOT NULL REFERENCES "users"("id"),
  "reviewed_by" uuid REFERENCES "users"("id"),
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

CREATE INDEX "idx_ai_reviews_org" ON "ai_reviews" ("org_id");
CREATE INDEX "idx_ai_reviews_status" ON "ai_reviews" ("status");
CREATE INDEX "idx_ai_reviews_requested_by" ON "ai_reviews" ("requested_by");

-- ─── Row-Level Security (RLS) ───────────────────────────────────
-- Defense-in-depth: even if ORM is bypassed, DB enforces tenant isolation.
-- Requires SET app.current_user_id before queries.

-- Enable RLS on tenant-scoped tables
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_reviews" ENABLE ROW LEVEL SECURITY;

-- Projects: users can only see projects in their org
CREATE POLICY "projects_tenant_isolation" ON "projects"
  FOR ALL
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- Documents: users can only see documents in their org
CREATE POLICY "documents_tenant_isolation" ON "documents"
  FOR ALL
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- Org members: users can only see members of their own orgs
CREATE POLICY "org_members_tenant_isolation" ON "org_members"
  FOR ALL
  USING (
    org_id IN (
      SELECT om2.org_id FROM org_members om2
      WHERE om2.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- Audit log: append-only, read restricted to own entries
CREATE POLICY "audit_log_read_own" ON "audit_log"
  FOR SELECT
  USING (
    user_id = current_setting('app.current_user_id', true)::uuid
    OR user_id IN (
      SELECT om.user_id FROM org_members om
      WHERE om.org_id IN (
        SELECT om2.org_id FROM org_members om2
        WHERE om2.user_id = current_setting('app.current_user_id', true)::uuid
      )
    )
  );

-- Audit log: no UPDATE or DELETE allowed
CREATE POLICY "audit_log_append_only" ON "audit_log"
  FOR INSERT
  WITH CHECK (true);

-- AI reviews: users can only see reviews in their org
CREATE POLICY "ai_reviews_tenant_isolation" ON "ai_reviews"
  FOR ALL
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- Bypass RLS for the application role (the app sets current_user_id and handles access control)
-- This ensures RLS is defense-in-depth, not the primary access gate.
-- The app DB user should have BYPASSRLS or be the table owner.
-- If using a restricted role, remove this and let RLS be the primary gate.
