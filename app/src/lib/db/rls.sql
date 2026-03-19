-- =============================================================
-- Row-Level Security Policies — User-based isolation
-- =============================================================
-- Variable: app.current_user_id (set by withUserRLS in db/index.ts)

-- Enable RLS on relevant tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owners too
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE project_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE project_files FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;

-- Drop old org-based policies
DROP POLICY IF EXISTS projects_org_isolation ON projects;
DROP POLICY IF EXISTS documents_org_isolation ON documents;
DROP POLICY IF EXISTS orgs_member_access ON organizations;
DROP POLICY IF EXISTS org_members_visibility ON org_members;
DROP POLICY IF EXISTS ai_reviews_org_isolation ON ai_reviews;

-- Projects: user owns directly, or is a team member of the owner
CREATE POLICY projects_user_isolation ON projects
  USING (
    user_id = current_setting('app.current_user_id')::uuid
    OR user_id IN (
      SELECT owner_id FROM team_members
      WHERE member_id = current_setting('app.current_user_id')::uuid
      AND accepted_at IS NOT NULL
    )
  );

-- Project documents: follows project access
CREATE POLICY project_documents_isolation ON project_documents
  USING (
    project_id IN (
      SELECT id FROM projects
      WHERE user_id = current_setting('app.current_user_id')::uuid
      OR user_id IN (
        SELECT owner_id FROM team_members
        WHERE member_id = current_setting('app.current_user_id')::uuid
        AND accepted_at IS NOT NULL
      )
    )
  );

-- Project files: follows project access
CREATE POLICY project_files_isolation ON project_files
  USING (
    project_id IN (
      SELECT id FROM projects
      WHERE user_id = current_setting('app.current_user_id')::uuid
      OR user_id IN (
        SELECT owner_id FROM team_members
        WHERE member_id = current_setting('app.current_user_id')::uuid
        AND accepted_at IS NOT NULL
      )
    )
  );

-- Workflow sessions: user's own sessions
CREATE POLICY workflow_sessions_user ON workflow_sessions
  USING (user_id = current_setting('app.current_user_id')::uuid);

-- Workflow messages: via session ownership
CREATE POLICY workflow_messages_user ON workflow_messages
  USING (
    session_id IN (
      SELECT id FROM workflow_sessions
      WHERE user_id = current_setting('app.current_user_id')::uuid
    )
  );

-- Notifications: user's own
CREATE POLICY notifications_user ON notifications
  USING (user_id = current_setting('app.current_user_id')::uuid);

-- Consent records: user's own
CREATE POLICY consent_records_user ON consent_records
  USING (user_id = current_setting('app.current_user_id')::uuid);

-- Audit log: append-only insert, admin-only read
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_insert ON audit_log;
DROP POLICY IF EXISTS audit_admin_read ON audit_log;

CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT WITH CHECK (true);

CREATE POLICY audit_admin_read ON audit_log
  FOR SELECT USING (
    (SELECT is_platform_admin FROM users WHERE id = current_setting('app.current_user_id')::uuid)
  );
