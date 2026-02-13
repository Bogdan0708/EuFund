-- Row-Level Security Policies for FondEU
-- Applied after schema creation

-- Enable RLS on sensitive tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (security best practice)
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

-- Projects: users can only see projects from their organizations
CREATE POLICY projects_org_isolation ON projects
    FOR ALL
    USING (org_id IN (
        SELECT om.org_id FROM org_members om
        WHERE om.user_id = current_setting('app.user_id', true)::uuid
    ));

-- Documents: same org isolation
CREATE POLICY documents_org_isolation ON documents
    FOR ALL
    USING (
        org_id IN (
            SELECT om.org_id FROM org_members om
            WHERE om.user_id = current_setting('app.user_id', true)::uuid
        )
        OR org_id IS NULL -- system documents
    );

-- Organizations: members can see their orgs
CREATE POLICY orgs_member_access ON organizations
    FOR ALL
    USING (id IN (
        SELECT om.org_id FROM org_members om
        WHERE om.user_id = current_setting('app.user_id', true)::uuid
    ));

-- Org Members: can see members of their orgs
CREATE POLICY org_members_access ON org_members
    FOR ALL
    USING (org_id IN (
        SELECT om2.org_id FROM org_members om2
        WHERE om2.user_id = current_setting('app.user_id', true)::uuid
    ));

-- Notifications: users can only see their own
CREATE POLICY notifications_user_only ON notifications
    FOR ALL
    USING (user_id = current_setting('app.user_id', true)::uuid);

-- Consent records: users can only see their own
CREATE POLICY consent_user_only ON consent_records
    FOR ALL
    USING (user_id = current_setting('app.user_id', true)::uuid);

-- Audit log: append-only (no UPDATE/DELETE), admin-only SELECT
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert_only ON audit_log
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY audit_admin_read ON audit_log
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM org_members om
            WHERE om.user_id = current_setting('app.user_id', true)::uuid
            AND om.role = 'admin'
        )
    );

-- Service role bypass (for backend operations)
-- CREATE ROLE fondeu_service;
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO fondeu_service;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO fondeu_service;
