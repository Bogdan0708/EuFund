-- EU Funds Platform - PostgreSQL Index Optimization
-- Target: <100ms query response time

-- Organizations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_cui ON organizations(cui);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_status ON organizations(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_created_at ON organizations(created_at DESC);

-- Users
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_organization_id ON users(organization_id);

-- Proposals
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_organization_id ON proposals(organization_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_funding_program ON proposals(funding_program);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_created_at ON proposals(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_org_status ON proposals(organization_id, status);

-- Audit logs (GDPR compliance - high volume)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_data_subject ON audit_logs(data_subject_id) WHERE data_subject_id IS NOT NULL;
-- Partition audit logs by month for retention management
-- ALTER TABLE audit_logs PARTITION BY RANGE (created_at);

-- Sessions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_expires ON sessions(expires);

-- QES Signatures
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signatures_proposal_id ON signatures(proposal_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signatures_status ON signatures(status);

-- Full-text search for proposals (Romanian)
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proposals_fts ON proposals USING gin(to_tsvector('romanian', title || ' ' || description));

-- Connection pooling recommendation: PgBouncer with transaction mode
-- max_connections = 200 (RDS r6g.large default)
-- pgbouncer pool_size = 25 per app instance
-- pgbouncer max_client_conn = 1000

-- Query optimization settings
-- SET work_mem = '256MB';
-- SET maintenance_work_mem = '512MB';
-- SET effective_cache_size = '12GB';  -- 75% of instance RAM
-- SET random_page_cost = 1.1;  -- SSD storage
-- SET shared_preload_libraries = 'pg_stat_statements';

-- Monitor slow queries
-- CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
-- SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 20;
