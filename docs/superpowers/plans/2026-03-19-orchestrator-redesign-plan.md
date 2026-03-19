# FondEU Orchestrator Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign FondEU from a multi-page dashboard into a minimalist two-page app (Chat + Projects) with a 7-step AI orchestrator, funding discovery pipeline, and tiered pricing.

**Architecture:** Monolithic Next.js app with server-side orchestrator engine dispatching specialized agents through an AI gateway. SSE streaming for real-time updates. Qdrant for knowledge retrieval. Cloud Scheduler for daily funding discovery.

**Tech Stack:** Next.js 14, TypeScript, Drizzle ORM, PostgreSQL, Redis, Qdrant, SSE, Stripe, NextAuth v5, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-19-orchestrator-redesign-design.md`

---

## Phase Overview & Dependencies

```
Phase 1: Schema & Data Migration ──────────────────────┐
Phase 2: Auth Simplification ──────────────────────────┤
Phase 3: Gateway Streaming (ai-gateway repo) ──────────┤ (parallel)
Phase 4: Billing & Tiers ─────────────────────────────┤
                                                        ↓
Phase 5: Orchestrator Engine ──────────────────────────┐
Phase 6: Funding Discovery ───────────────────────────┤
Phase 7: Project Builder & Export ─────────────────────┤
                                                        ↓
Phase 8: UI Redesign ──────────────────────────────────→ Done
```

Phases 1-3 can run in parallel. Phase 3 (gateway) is fully independent (separate repo). Phase 4 depends on Phase 1 (tier enum). Phases 5-7 depend on schema/auth being done. Phase 8 depends on all backend work.

### Known Review Issues (Addressed)

1. **SSE/POST bridge:** Uses Redis pub/sub per session — POST publishes, GET subscribes
2. **JSONB defaults:** Use `default(sql\`'{}'\`)` not `default({})`
3. **Enum migration:** Keep `'enterprise'` as deprecated value (PostgreSQL can't remove enum values)
4. **Gateway client:** Pass structured `messages` array, not flattened string
5. **`Infinity` in tiers:** Use `Number.MAX_SAFE_INTEGER` for unlimited edits
6. **Post-completion editing:** Engine handles messages after step 7 via edit mode
7. **Session lifecycle:** Cron cleanup, max sessions per tier, auto-pause
8. **Caching:** Redis cache for steps 2-5 with TTL

---

## Phase 1: Schema & Data Migration

**Goal:** Add new tables, migrate org-owned projects to user-owned, rewrite RLS policies, consolidate funding call tables.

### File Structure

```
app/src/lib/db/
├── schema.ts              — MODIFY: add new tables/enums, modify projects, drop org refs
├── rls.sql                — MODIFY: rewrite all policies to user-based
├── index.ts               — NO CHANGE (withUserRLS stays)
app/drizzle/
├── 0011_*.sql             — NEW: add new tables + columns
├── 0012_*.sql             — NEW: migrate data + drop old columns
├/tests/integration/
├── schema-migration.test.ts — NEW: verify migration correctness
```

### Task 1.1: Add New Enums and Tables

**Files:**
- Modify: `app/src/lib/db/schema.ts`
- Test: `app/tests/integration/new-tables.test.ts`

- [ ] **Step 1: Write test verifying new tables can be imported**

```typescript
// app/tests/integration/new-tables.test.ts
import { describe, it, expect } from 'vitest'

describe('New schema tables', () => {
  it('exports workflow_sessions table', async () => {
    const { workflowSessions } = await import('@/lib/db/schema')
    expect(workflowSessions).toBeDefined()
  })

  it('exports workflow_messages table', async () => {
    const { workflowMessages } = await import('@/lib/db/schema')
    expect(workflowMessages).toBeDefined()
  })

  it('exports discovered_calls table', async () => {
    const { discoveredCalls } = await import('@/lib/db/schema')
    expect(discoveredCalls).toBeDefined()
  })

  it('exports program_alerts table', async () => {
    const { programAlerts } = await import('@/lib/db/schema')
    expect(programAlerts).toBeDefined()
  })

  it('exports project_documents table', async () => {
    const { projectDocuments } = await import('@/lib/db/schema')
    expect(projectDocuments).toBeDefined()
  })

  it('exports project_files table', async () => {
    const { projectFiles } = await import('@/lib/db/schema')
    expect(projectFiles).toBeDefined()
  })

  it('exports team_members table', async () => {
    const { teamMembers } = await import('@/lib/db/schema')
    expect(teamMembers).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/new-tables.test.ts`
Expected: FAIL — tables not yet defined

- [ ] **Step 3: Add new enums to schema.ts**

Add after line 56 in `app/src/lib/db/schema.ts`:

```typescript
// New enums for orchestrator redesign
export const workflowStatusEnum = pgEnum('workflow_status', [
  'active', 'paused', 'completed', 'abandoned'
])
export const workflowMessageRoleEnum = pgEnum('workflow_message_role', [
  'user', 'assistant', 'system'
])
export const discoveryMethodEnum = pgEnum('discovery_method', [
  'crawler', 'perplexity', 'manual'
])
export const discoveryStatusEnum = pgEnum('discovery_status', [
  'pending_review', 'approved', 'rejected', 'expired'
])
export const alertUrgencyEnum = pgEnum('alert_urgency', ['daily'])
export const projectDocStatusEnum = pgEnum('project_doc_status', [
  'draft', 'review', 'final'
])
export const fileCategory = pgEnum('file_category', ['uploaded', 'generated'])
// Updated project status (English, replaces Romanian projectStatusEnum)
export const projectStatusEnumV2 = pgEnum('project_status_v2', [
  'draft', 'action_plan', 'built', 'exported'
])
```

- [ ] **Step 4: Add workflow_sessions table**

Add after existing tables in `app/src/lib/db/schema.ts`:

```typescript
export const workflowSessions = pgTable('workflow_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  projectId: uuid('project_id').references(() => projects.id),
  currentStep: integer('current_step').notNull().default(1),
  context: jsonb('context').notNull().default(sql`'{}'`),
  status: workflowStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_workflow_sessions_user').on(table.userId),
  statusIdx: index('idx_workflow_sessions_status').on(table.status),
}))
```

- [ ] **Step 5: Add workflow_messages table**

```typescript
export const workflowMessages = pgTable('workflow_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => workflowSessions.id, { onDelete: 'cascade' }),
  eventId: integer('event_id'), // monotonic per session, for SSE replay
  role: workflowMessageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  step: integer('step'),
  eventType: varchar('event_type', { length: 50 }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sessionIdIdx: index('idx_workflow_messages_session').on(table.sessionId),
  createdAtIdx: index('idx_workflow_messages_created').on(table.createdAt),
}))
```

- [ ] **Step 6: Add discovered_calls table**

```typescript
export const discoveredCalls = pgTable('discovered_calls', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceUrl: text('source_url').notNull(),
  sourceDomain: text('source_domain').notNull(),
  title: text('title').notNull(),
  program: text('program'),
  summary: text('summary'),
  rawContent: text('raw_content'),
  contentHash: text('content_hash').notNull().unique(),
  discoveredAt: timestamp('discovered_at').defaultNow().notNull(),
  discoveryMethod: discoveryMethodEnum('discovery_method').notNull(),
  discoverySource: text('discovery_source'),
  status: discoveryStatusEnum('status').notNull().default('pending_review'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  callId: uuid('call_id').references(() => callsForProposals.id),
}, (table) => ({
  statusIdx: index('idx_discovered_calls_status').on(table.status),
}))
```

- [ ] **Step 7: Add program_alerts table**

```typescript
export const programAlerts = pgTable('program_alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  program: text('program').notNull(),
  urgency: alertUrgencyEnum('urgency').notNull().default('daily'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('idx_program_alerts_user').on(table.userId),
}))
```

- [ ] **Step 8: Add project_documents table**

```typescript
export const projectDocuments = pgTable('project_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  version: integer('version').notNull().default(1),
  sections: jsonb('sections').notNull(),
  actionPlan: jsonb('action_plan'),
  metadata: jsonb('metadata'),
  status: projectDocStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  projectIdIdx: index('idx_project_documents_project').on(table.projectId),
}))
```

- [ ] **Step 9: Add project_files table**

```typescript
export const projectFiles = pgTable('project_files', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storagePath: text('storage_path').notNull(),
  category: fileCategory('category').notNull(),
  description: text('description'),
  extractedText: text('extracted_text'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  projectIdIdx: index('idx_project_files_project').on(table.projectId),
}))
```

- [ ] **Step 10: Add team_members table**

```typescript
export const teamMembers = pgTable('team_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  memberId: uuid('member_id').notNull().references(() => users.id),
  invitedAt: timestamp('invited_at').defaultNow().notNull(),
  acceptedAt: timestamp('accepted_at'),
}, (table) => ({
  ownerIdIdx: index('idx_team_members_owner').on(table.ownerId),
  memberIdIdx: index('idx_team_members_member').on(table.memberId),
  uniqueOwnerMember: unique('uq_team_owner_member').on(table.ownerId, table.memberId),
}))
```

- [ ] **Step 11: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/new-tables.test.ts`
Expected: PASS

- [ ] **Step 12: Generate migration**

Run: `cd app && npm run db:generate`
Expected: New migration file in `app/drizzle/` (likely `0011_*.sql`)

- [ ] **Step 13: Commit**

```bash
git add app/src/lib/db/schema.ts app/tests/integration/new-tables.test.ts app/drizzle/
git commit -m "feat(schema): add orchestrator tables — workflow_sessions, messages, discovered_calls, project_documents, project_files, team_members"
```

---

### Task 1.2: Update User Tier Enum

**Files:**
- Modify: `app/src/lib/db/schema.ts` (line 32)
- Test: `app/tests/integration/tier-enum.test.ts`

- [ ] **Step 1: Write test for new tier values**

```typescript
// app/tests/integration/tier-enum.test.ts
import { describe, it, expect } from 'vitest'

describe('User tier enum', () => {
  it('includes plus and ultra tiers', async () => {
    const { userTierEnum } = await import('@/lib/db/schema')
    expect(userTierEnum.enumValues).toContain('plus')
    expect(userTierEnum.enumValues).toContain('ultra')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/tier-enum.test.ts`
Expected: FAIL

- [ ] **Step 3: Update userTierEnum in schema.ts**

Change line 32 of `app/src/lib/db/schema.ts`:

```typescript
// Before:
export const userTierEnum = pgEnum('user_tier', ['free', 'pro', 'enterprise'])

// After (keep 'enterprise' as deprecated — PostgreSQL cannot remove enum values):
export const userTierEnum = pgEnum('user_tier', ['free', 'plus', 'pro', 'enterprise', 'ultra'])
```

Note: This requires a PostgreSQL enum migration. The generated migration should:
1. Add `'plus'` and `'ultra'` values to the enum
2. Rename `'enterprise'` → `'ultra'` for existing rows
3. Remove `'enterprise'` from the enum

If Drizzle generates a destructive migration (drop + recreate), manually edit it to use `ALTER TYPE ... ADD VALUE` and `UPDATE` statements instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/tier-enum.test.ts`
Expected: PASS

- [ ] **Step 5: Generate and review migration**

Run: `cd app && npm run db:generate`
Review the generated SQL. If it drops/recreates the enum, replace with:

```sql
ALTER TYPE user_tier ADD VALUE IF NOT EXISTS 'plus';
ALTER TYPE user_tier ADD VALUE IF NOT EXISTS 'ultra';
UPDATE users SET tier = 'ultra' WHERE tier = 'enterprise';
```

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/db/schema.ts app/drizzle/
git commit -m "feat(schema): update user tier enum — add plus/ultra, deprecate enterprise"
```

---

### Task 1.3: Add userId to Projects Table

**Files:**
- Modify: `app/src/lib/db/schema.ts` (lines 238-275)
- Test: `app/tests/integration/project-userid.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/integration/project-userid.test.ts
import { describe, it, expect } from 'vitest'

describe('Projects table', () => {
  it('has userId column', async () => {
    const { projects } = await import('@/lib/db/schema')
    expect(projects.userId).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/project-userid.test.ts`
Expected: FAIL

- [ ] **Step 3: Add userId column to projects**

In `app/src/lib/db/schema.ts`, add to the `projects` table definition (after `orgId`):

```typescript
userId: uuid('user_id').references(() => users.id),
```

Note: Initially nullable. Will be made NOT NULL after data migration.
Do NOT remove `orgId` yet — that happens in the cleanup migration after data is migrated.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/project-userid.test.ts`
Expected: PASS

- [ ] **Step 5: Generate migration**

Run: `cd app && npm run db:generate`

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/db/schema.ts app/tests/integration/project-userid.test.ts app/drizzle/
git commit -m "feat(schema): add userId column to projects table (nullable, pre-migration)"
```

---

### Task 1.4: Consolidate Funding Call Tables

**Files:**
- Modify: `app/src/lib/db/schema.ts` (lines 419-439 — `fundingCalls` table)
- Test: `app/tests/integration/funding-consolidation.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/integration/funding-consolidation.test.ts
import { describe, it, expect } from 'vitest'

describe('Funding call consolidation', () => {
  it('callsForProposals has ecPortalFields for EC data', async () => {
    const { callsForProposals } = await import('@/lib/db/schema')
    expect(callsForProposals.ecExternalId).toBeDefined()
    expect(callsForProposals.ecTopics).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/funding-consolidation.test.ts`
Expected: FAIL

- [ ] **Step 3: Add EC Portal fields to callsForProposals**

In `app/src/lib/db/schema.ts`, add columns to `callsForProposals` (after existing columns, before the closing):

```typescript
// EC Portal fields (nullable — only set for calls imported from EC feed)
ecExternalId: varchar('ec_external_id', { length: 255 }),
ecTopics: jsonb('ec_topics'),
ecEligibilityCriteria: jsonb('ec_eligibility_criteria'),
ecSourceUrl: text('ec_source_url'),
ecSyncedAt: timestamp('ec_synced_at'),
```

Note: The `fundingCalls` table will be dropped in a later cleanup migration after data is migrated.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/funding-consolidation.test.ts`
Expected: PASS

- [ ] **Step 5: Generate migration**

Run: `cd app && npm run db:generate`

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/db/schema.ts app/tests/integration/funding-consolidation.test.ts app/drizzle/
git commit -m "feat(schema): add EC Portal columns to calls_for_proposals for table consolidation"
```

---

### Task 1.5: Rewrite RLS Policies

**Files:**
- Modify: `app/src/lib/db/rls.sql`
- Test: Manual verification (RLS tests require live database)

- [ ] **Step 1: Rewrite rls.sql for user-based isolation**

Replace the contents of `app/src/lib/db/rls.sql`:

```sql
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
-- User owns the project directly, or is a team member of the project owner
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
```

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/db/rls.sql
git commit -m "feat(rls): rewrite policies for user-based isolation with team_members support"
```

---

### Task 1.6: Write Data Migration Script

**Files:**
- Create: `app/scripts/migrate-org-to-user.ts`
- Test: Manual (requires database)

This script handles the one-time data migration. Run against production after deploying schema changes.

- [ ] **Step 1: Create migration script**

```typescript
// app/scripts/migrate-org-to-user.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL required')

const dryRun = process.argv.includes('--dry-run')
const confirm = process.argv.includes('--confirm')

if (!dryRun && !confirm) {
  console.error('Usage: npx tsx scripts/migrate-org-to-user.ts [--dry-run | --confirm]')
  process.exit(1)
}

async function migrate() {
  const client = postgres(DATABASE_URL!)
  const db = drizzle(client)

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE MIGRATION'}`)

  // Step 1: Populate projects.user_id from org_members
  // Pick the org admin (or first member) for each org
  const projectsToMigrate = await db.execute(sql`
    SELECT p.id as project_id, p.org_id,
      COALESCE(
        (SELECT om.user_id FROM org_members om WHERE om.org_id = p.org_id AND om.role = 'admin' LIMIT 1),
        (SELECT om.user_id FROM org_members om WHERE om.org_id = p.org_id ORDER BY om.joined_at ASC LIMIT 1),
        p.created_by
      ) as target_user_id
    FROM projects p
    WHERE p.user_id IS NULL
  `)

  console.log(`Projects to migrate: ${projectsToMigrate.length}`)

  if (!dryRun) {
    for (const row of projectsToMigrate) {
      await db.execute(sql`
        UPDATE projects SET user_id = ${row.target_user_id} WHERE id = ${row.project_id}
      `)
    }
    console.log('Projects migrated.')
  }

  // Step 2: Migrate documents to project_files
  const docsToMigrate = await db.execute(sql`
    SELECT id, project_id, uploaded_by, doc_type, filename, mime_type,
           file_size, storage_path, ocr_text, ai_summary, created_at
    FROM documents
    WHERE project_id IS NOT NULL
  `)

  console.log(`Documents to migrate to project_files: ${docsToMigrate.length}`)

  if (!dryRun) {
    for (const doc of docsToMigrate) {
      await db.execute(sql`
        INSERT INTO project_files (project_id, user_id, filename, mime_type, size_bytes,
          storage_path, category, description, extracted_text, created_at)
        VALUES (${doc.project_id}, ${doc.uploaded_by}, ${doc.filename}, ${doc.mime_type},
          ${doc.file_size}, ${doc.storage_path}, 'uploaded', ${doc.ai_summary},
          ${doc.ocr_text}, ${doc.created_at})
      `)
    }
    console.log('Documents migrated to project_files.')
  }

  // Step 3: Migrate funding_calls to calls_for_proposals
  const ecCalls = await db.execute(sql`
    SELECT * FROM funding_calls
    WHERE external_id NOT IN (
      SELECT ec_external_id FROM calls_for_proposals WHERE ec_external_id IS NOT NULL
    )
  `)

  console.log(`EC Portal calls to migrate: ${ecCalls.length}`)

  if (!dryRun) {
    for (const call of ecCalls) {
      await db.execute(sql`
        INSERT INTO calls_for_proposals (
          call_code, title_ro, status, submission_start, submission_end,
          budget_total, ec_external_id, ec_topics, ec_eligibility_criteria,
          ec_source_url, ec_synced_at
        ) VALUES (
          ${call.external_id}, ${call.title}, 'deschis',
          ${call.opening_date}, ${call.deadline_date}, ${call.budget},
          ${call.external_id}, ${call.topics}, ${call.eligibility_criteria},
          ${call.source_url}, ${call.synced_at}
        )
      `)
    }
    console.log('EC Portal calls migrated.')
  }

  // Step 4: Rename enterprise tier to ultra
  const enterpriseUsers = await db.execute(sql`
    SELECT id FROM users WHERE tier = 'enterprise'
  `)
  console.log(`Enterprise users to migrate to ultra: ${enterpriseUsers.length}`)

  if (!dryRun) {
    await db.execute(sql`UPDATE users SET tier = 'ultra' WHERE tier = 'enterprise'`)
    console.log('Enterprise tier migrated to ultra.')
  }

  console.log('\nMigration complete.')
  await client.end()
}

migrate().catch(console.error)
```

- [ ] **Step 2: Commit**

```bash
git add app/scripts/migrate-org-to-user.ts
git commit -m "feat(migration): add org-to-user data migration script"
```

---

## Phase 2: Auth Simplification

**Goal:** Replace credentials login with Google + magic link. Remove password infrastructure.

### Task 2.1: Add Google OAuth Provider

**Files:**
- Modify: `app/src/lib/auth/index.ts`
- Test: `app/tests/integration/auth-google.test.ts`

- [ ] **Step 1: Write test for Google provider**

```typescript
// app/tests/integration/auth-google.test.ts
import { describe, it, expect } from 'vitest'

describe('Auth config', () => {
  it('includes Google provider', async () => {
    const config = await import('@/lib/auth/index')
    // The auth config should export providers that include Google
    expect(config).toBeDefined()
  })
})
```

- [ ] **Step 2: Read current auth config**

Read: `app/src/lib/auth/index.ts`
Understand the current NextAuth config — which providers are configured, how JWT strategy works, callbacks.

- [ ] **Step 3: Add Google provider to NextAuth config**

Install: `cd app && npm install next-auth@beta`

In `app/src/lib/auth/index.ts`, add Google provider:

```typescript
import Google from 'next-auth/providers/google'

// Add to providers array:
Google({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  allowDangerousEmailAccountLinking: true, // Link by email if account exists
}),
```

Also add Microsoft provider for municipalities/institutions:

```typescript
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'

MicrosoftEntraID({
  clientId: process.env.MICROSOFT_CLIENT_ID!,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
  allowDangerousEmailAccountLinking: true,
}),
```

Add callback to link Google/Microsoft users to existing accounts by email:

```typescript
// In callbacks.signIn:
async signIn({ user, account }) {
  if (account?.provider === 'google' && user.email) {
    // Check if user exists with this email
    const existing = await db.select().from(users).where(eq(users.email, user.email)).limit(1)
    if (existing.length > 0) {
      // Link to existing account
      user.id = existing[0].id
    }
  }
  return true
}
```

- [ ] **Step 4: Run tests**

Run: `cd app && npm test`
Expected: All existing tests still pass

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/auth/index.ts app/package.json app/package-lock.json
git commit -m "feat(auth): add Google OAuth provider with email linking"
```

---

### Task 2.2: Add Email Magic Link Provider

**Files:**
- Modify: `app/src/lib/auth/index.ts`

- [ ] **Step 1: Add Email provider for magic links**

```typescript
import EmailProvider from 'next-auth/providers/email'

// Add to providers array:
EmailProvider({
  server: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  },
  from: process.env.EMAIL_FROM || 'noreply@platformafinantare.eu',
}),
```

- [ ] **Step 2: Run tests**

Run: `cd app && npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/auth/index.ts
git commit -m "feat(auth): add email magic link provider"
```

---

### Task 2.3: Remove Credentials Provider & Password Infrastructure

**Files:**
- Modify: `app/src/lib/auth/index.ts` — remove Credentials provider
- Delete: `app/src/app/api/auth/register/route.ts` (or strip password logic)
- Delete: `app/src/app/api/auth/forgot-password/route.ts`
- Delete: `app/src/app/api/auth/reset-password/route.ts`
- Delete: `app/src/app/api/auth/verify-email/route.ts`
- Modify: `app/src/lib/auth/helpers.ts` — remove `requireOrgRole()`

- [ ] **Step 1: Remove Credentials provider from auth config**

In `app/src/lib/auth/index.ts`, remove the `CredentialsProvider` import and its configuration from the providers array. Remove any bcrypt imports.

- [ ] **Step 2: Delete password-related API routes**

```bash
rm -f app/src/app/api/auth/forgot-password/route.ts
rm -f app/src/app/api/auth/reset-password/route.ts
rm -f app/src/app/api/auth/verify-email/route.ts
```

- [ ] **Step 3: Simplify register route**

The register route should only handle initial account creation for magic link users (if needed). If NextAuth handles this automatically via the Email provider adapter, delete the register route too.

- [ ] **Step 4: Remove requireOrgRole from helpers.ts**

In `app/src/lib/auth/helpers.ts`, delete the `requireOrgRole()` function. Keep `requireAuth()` and `requirePlatformAdmin()`.

- [ ] **Step 5: Fix any import errors**

Run: `cd app && npm run typecheck`
Fix any TypeScript errors from removed exports. Files that import `requireOrgRole` or password routes need updating.

- [ ] **Step 6: Run tests**

Run: `cd app && npm test`
Fix or delete tests that reference removed functionality.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(auth): remove credentials provider, password infrastructure, and org roles"
```

---

## Phase 3: Gateway Streaming (ai-gateway repo)

**Goal:** Add SSE streaming support to the AI gateway.

**Repo:** `/home/godja/Dev/ai-gateway`

> This phase is independent and can run in parallel with Phases 1-2.

### Task 3.1: Add Stream Support to Provider Interface

**Files:**
- Modify: `/home/godja/Dev/ai-gateway/src/types.ts`
- Modify: `/home/godja/Dev/ai-gateway/src/providers/index.ts`
- Test: `/home/godja/Dev/ai-gateway/src/tests/streaming.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/tests/streaming.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('Streaming support', () => {
  it('completeStream returns a ReadableStream', async () => {
    // Mock provider
    const { completeStream } = await import('../providers/index')
    expect(completeStream).toBeDefined()
    expect(typeof completeStream).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/godja/Dev/ai-gateway && npx vitest run src/tests/streaming.test.ts`

- [ ] **Step 3: Add streaming types**

In `src/types.ts`, add:

```typescript
export interface StreamChunk {
  content: string
  provider: ProviderName
  model: string
  finishReason?: string
  usage?: UsageInfo
}

export type CompletionStream = ReadableStream<StreamChunk>
```

- [ ] **Step 4: Add completeStream to provider router**

In `src/providers/index.ts`, add a `completeStream()` function that:
1. Resolves provider like `complete()` does
2. Calls the provider's stream method
3. Returns a `ReadableStream` that yields `StreamChunk` objects
4. Handles fallback (only pre-stream — if provider selection fails, try next)

- [ ] **Step 5: Implement streaming for OpenAI provider**

In `src/providers/openai.ts`, add a `stream()` method:
- Set `stream: true` in the OpenAI API call
- Parse SSE chunks (`data: {...}`)
- Yield `StreamChunk` for each delta
- Extract usage from final chunk

- [ ] **Step 6: Implement streaming for Claude provider**

In `src/providers/claude.ts`:
- Set `stream: true` in Anthropic API call
- Parse event types: `content_block_delta`, `message_stop`
- Yield `StreamChunk` for each text delta
- Extract usage from `message_stop` event

- [ ] **Step 7: Implement streaming for Gemini provider**

In `src/providers/gemini.ts`:
- Use `generateContentStream()` method
- Yield `StreamChunk` for each candidate text part
- Extract usage from final response

- [ ] **Step 8: Run tests**

Run: `cd /home/godja/Dev/ai-gateway && npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
cd /home/godja/Dev/ai-gateway
git add -A
git commit -m "feat: add streaming support to provider interface (OpenAI, Claude, Gemini)"
```

---

### Task 3.2: Add SSE Streaming Route

**Files:**
- Modify: `/home/godja/Dev/ai-gateway/src/index.ts`

- [ ] **Step 1: Add stream detection to /v1/chat/completions**

In `src/index.ts`, modify the `/v1/chat/completions` handler:

```typescript
// After validation and auth, check for stream: true
if (req.body.stream) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Tenant-ID': tenantId || '',
  })

  try {
    const stream = await completeStream({
      messages: req.body.messages,
      provider: req.body.provider,
      model: req.body.model,
      maxTokens: req.body.max_tokens || req.body.maxTokens,
      temperature: req.body.temperature,
      tenantId,
    })

    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const sseData = {
        id: `chatcmpl-${crypto.randomUUID()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: value.model,
        provider: value.provider,
        choices: [{
          index: 0,
          delta: { content: value.content },
          finish_reason: value.finishReason || null,
        }],
        ...(value.usage ? { usage: value.usage } : {}),
      }
      res.write(`data: ${JSON.stringify(sseData)}\n\n`)
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: { message: 'Stream failed', code: 'ai.stream_failed' } })}\n\n`)
    res.end()
  }
  return
}
// ... existing non-streaming logic
```

- [ ] **Step 2: Increase timeout for streaming requests**

In the route handler, set timeout to 120s when `stream: true`:

```typescript
if (req.body.stream) {
  req.setTimeout(120_000)
}
```

- [ ] **Step 3: Write integration test**

```typescript
// src/tests/streaming-route.test.ts
describe('POST /v1/chat/completions with stream: true', () => {
  it('returns SSE content-type', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${TEST_KEY}`)
      .send({
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      })
    expect(res.headers['content-type']).toContain('text/event-stream')
  })
})
```

- [ ] **Step 4: Run all tests**

Run: `cd /home/godja/Dev/ai-gateway && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/ai-gateway
git add -A
git commit -m "feat: add SSE streaming route for /v1/chat/completions"
```

---

## Phase 4: Billing & Tiers

**Goal:** Update Stripe integration for 4-tier pricing with monthly workflow/edit limits.

### Task 4.1: Update Tier Configuration

**Files:**
- Create: `app/src/lib/billing/tiers.ts`
- Test: `app/tests/unit/tiers.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/unit/tiers.test.ts
import { describe, it, expect } from 'vitest'
import { TIER_LIMITS, getTierLimits } from '@/lib/billing/tiers'

describe('Tier limits', () => {
  it('defines four tiers', () => {
    expect(Object.keys(TIER_LIMITS)).toEqual(['free', 'plus', 'pro', 'ultra'])
  })

  it('free tier has 1 total workflow', () => {
    const limits = getTierLimits('free')
    expect(limits.workflowsPerMonth).toBe(1)
    expect(limits.isLifetimeLimit).toBe(true)
  })

  it('plus tier has 10 workflows/mo', () => {
    const limits = getTierLimits('plus')
    expect(limits.workflowsPerMonth).toBe(10)
    expect(limits.editsPerMonth).toBe(50)
  })

  it('pro tier has premium build model', () => {
    const limits = getTierLimits('pro')
    expect(limits.buildModel).toBe('premium')
  })

  it('ultra tier supports team members', () => {
    const limits = getTierLimits('ultra')
    expect(limits.maxTeamMembers).toBe(5)
  })

  it('unknown tier falls back to free', () => {
    const limits = getTierLimits('unknown' as any)
    expect(limits.workflowsPerMonth).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/tiers.test.ts`

- [ ] **Step 3: Implement tier config**

```typescript
// app/src/lib/billing/tiers.ts

export interface TierLimits {
  workflowsPerMonth: number
  editsPerMonth: number
  maxActiveSessions: number
  fileStorageMB: number
  exportFormats: ('docx' | 'pdf')[]
  buildModel: 'standard' | 'premium'
  maxTeamMembers: number
  isLifetimeLimit: boolean // true = limit is total ever, not per month
  priceGBP: number
}

export const TIER_LIMITS: Record<string, TierLimits> = {
  free: {
    workflowsPerMonth: 1,
    editsPerMonth: 5,
    maxActiveSessions: 1,
    fileStorageMB: 50,
    exportFormats: ['docx'],
    buildModel: 'standard',
    maxTeamMembers: 1,
    isLifetimeLimit: true,
    priceGBP: 0,
  },
  plus: {
    workflowsPerMonth: 10,
    editsPerMonth: 50,
    maxActiveSessions: 2,
    fileStorageMB: 500,
    exportFormats: ['docx'],
    buildModel: 'standard',
    maxTeamMembers: 1,
    isLifetimeLimit: false,
    priceGBP: 10,
  },
  pro: {
    workflowsPerMonth: 50,
    editsPerMonth: 300,
    maxActiveSessions: 3,
    fileStorageMB: 5120,
    exportFormats: ['docx', 'pdf'],
    buildModel: 'premium',
    maxTeamMembers: 1,
    isLifetimeLimit: false,
    priceGBP: 50,
  },
  ultra: {
    workflowsPerMonth: 200,
    editsPerMonth: Number.MAX_SAFE_INTEGER, // unlimited
    maxActiveSessions: 10,
    fileStorageMB: 25600,
    exportFormats: ['docx', 'pdf'],
    buildModel: 'premium',
    maxTeamMembers: 5,
    isLifetimeLimit: false,
    priceGBP: 200,
  },
}

export function getTierLimits(tier: string): TierLimits {
  return TIER_LIMITS[tier] || TIER_LIMITS.free
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/tiers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/billing/tiers.ts app/tests/unit/tiers.test.ts
git commit -m "feat(billing): add 4-tier config — free, plus (£10), pro (£50), ultra (£200)"
```

---

### Task 4.2: Add Workflow Usage Tracking

**Files:**
- Create: `app/src/lib/billing/usage.ts`
- Test: `app/tests/unit/usage.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/unit/usage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/redis/client', () => ({
  getRedisClient: vi.fn(() => ({
    incr: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue('0'),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(2592000),
  })),
}))

describe('Usage tracking', () => {
  it('checkWorkflowLimit returns allowed when under limit', async () => {
    const { checkWorkflowLimit } = await import('@/lib/billing/usage')
    const result = await checkWorkflowLimit('user-123', 'plus')
    expect(result.allowed).toBe(true)
  })

  it('checkWorkflowLimit returns denied when over limit', async () => {
    vi.doMock('@/lib/redis/client', () => ({
      getRedisClient: vi.fn(() => ({
        get: vi.fn().mockResolvedValue('10'),
        ttl: vi.fn().mockResolvedValue(2592000),
      })),
    }))
    vi.resetModules()
    const { checkWorkflowLimit } = await import('@/lib/billing/usage')
    const result = await checkWorkflowLimit('user-123', 'plus')
    expect(result.allowed).toBe(false)
  })

  it('incrementWorkflowCount increments Redis counter', async () => {
    const { incrementWorkflowCount } = await import('@/lib/billing/usage')
    await incrementWorkflowCount('user-123')
    // Should call redis.incr
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/usage.test.ts`

- [ ] **Step 3: Implement usage tracking**

```typescript
// app/src/lib/billing/usage.ts
import { getRedisClient } from '@/lib/redis/client'
import { getTierLimits } from './tiers'

function workflowKey(userId: string): string {
  return `usage:workflows:${userId}`
}

function editKey(userId: string): string {
  return `usage:edits:${userId}`
}

export async function checkWorkflowLimit(
  userId: string,
  tier: string
): Promise<{ allowed: boolean; used: number; limit: number; message?: string }> {
  const limits = getTierLimits(tier)
  const redis = getRedisClient()
  const used = parseInt(await redis.get(workflowKey(userId)) || '0', 10)

  if (used >= limits.workflowsPerMonth) {
    return {
      allowed: false,
      used,
      limit: limits.workflowsPerMonth,
      message: `You've used ${used}/${limits.workflowsPerMonth} ${limits.isLifetimeLimit ? 'total' : 'monthly'} workflows. Upgrade for more.`,
    }
  }

  return { allowed: true, used, limit: limits.workflowsPerMonth }
}

export async function incrementWorkflowCount(userId: string): Promise<number> {
  const redis = getRedisClient()
  const key = workflowKey(userId)
  const count = await redis.incr(key)
  // Set TTL to 30 days if this is the first increment
  const ttl = await redis.ttl(key)
  if (ttl === -1) {
    await redis.expire(key, 30 * 24 * 60 * 60)
  }
  return count
}

export async function checkEditLimit(
  userId: string,
  tier: string
): Promise<{ allowed: boolean; used: number; limit: number; message?: string }> {
  const limits = getTierLimits(tier)
  if (limits.editsPerMonth === Infinity) {
    return { allowed: true, used: 0, limit: Infinity }
  }
  const redis = getRedisClient()
  const used = parseInt(await redis.get(editKey(userId)) || '0', 10)

  if (used >= limits.editsPerMonth) {
    return {
      allowed: false,
      used,
      limit: limits.editsPerMonth,
      message: `You've used ${used}/${limits.editsPerMonth} monthly edits. Upgrade for more.`,
    }
  }

  return { allowed: true, used, limit: limits.editsPerMonth }
}

export async function incrementEditCount(userId: string): Promise<number> {
  const redis = getRedisClient()
  const key = editKey(userId)
  const count = await redis.incr(key)
  const ttl = await redis.ttl(key)
  if (ttl === -1) {
    await redis.expire(key, 30 * 24 * 60 * 60)
  }
  return count
}
```

- [ ] **Step 4: Run tests**

Run: `cd app && npx vitest run tests/unit/usage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/billing/usage.ts app/tests/unit/usage.test.ts
git commit -m "feat(billing): add workflow and edit usage tracking with Redis counters"
```

---

## Phase 5: Orchestrator Engine

**Goal:** Build the core state machine, agent interface, SSE streaming, and agent implementations.

### File Structure

```
app/src/lib/ai/orchestrator/
├── engine.ts       — State machine: step transitions, checkpoints
├── types.ts        — WorkflowContext, AgentResult, SSEEvent types
├── context.ts      — Context accumulation helpers
├── stream.ts       — SSE connection manager
├── gateway.ts      — Gateway client wrapper for agents
├── agents/
│   ├── enhance.ts  — Step 1
│   ├── match.ts    — Step 2
│   ├── validate.ts — Step 3
│   ├── research.ts — Step 4
│   ├── knowledge.ts — Step 5
│   ├── plan.ts     — Step 6
│   └── build.ts    — Step 7
├── prompts/
│   ├── system.ts   — Shared base prompt
│   ├── enhance.ts  — Step 1 prompt
│   ├── match.ts    — Step 2 prompt
│   ├── validate.ts — Step 3 prompt
│   ├── research.ts — Step 4 prompt
│   ├── knowledge.ts — Step 5 prompt
│   ├── plan.ts     — Step 6 prompt
│   └── build.ts    — Step 7 prompt
app/src/app/api/ai/orchestrator/
├── stream/route.ts    — GET SSE endpoint
├── message/route.ts   — POST message endpoint
├── messages/route.ts  — GET message history
├── replay/route.ts    — GET replay missed events
```

### Task 5.1: Define Types

**Files:**
- Create: `app/src/lib/ai/orchestrator/types.ts`
- Test: `app/tests/unit/orchestrator-types.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/unit/orchestrator-types.test.ts
import { describe, it, expect } from 'vitest'
import type { WorkflowContext, AgentResult, SSEEvent, AgentFn } from '@/lib/ai/orchestrator/types'

describe('Orchestrator types', () => {
  it('WorkflowContext has required fields', () => {
    const ctx: WorkflowContext = {
      sessionId: '123',
      userId: '456',
      locale: 'ro',
      tier: 'plus',
      step: 1,
      enhancedIdea: null,
      matchedCalls: null,
      validationResults: null,
      researchResults: null,
      actionPlan: null,
      projectSections: null,
      uploadedFiles: [],
    }
    expect(ctx.sessionId).toBe('123')
  })

  it('AgentFn type is callable', () => {
    const fn: AgentFn = async (ctx, input, stream, gateway) => ({
      data: {},
      checkpoint: null,
    })
    expect(typeof fn).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/orchestrator-types.test.ts`

- [ ] **Step 3: Implement types**

```typescript
// app/src/lib/ai/orchestrator/types.ts

export interface WorkflowContext {
  sessionId: string
  userId: string
  locale: 'ro' | 'en'
  tier: string
  step: number
  enhancedIdea: EnhancedIdea | null
  matchedCalls: MatchedCall[] | null
  validationResults: ValidationResult[] | null
  researchResults: ResearchResult | null
  actionPlan: ActionPlan | null
  projectSections: ProjectSection[] | null
  uploadedFiles: UploadedFile[]
}

export interface EnhancedIdea {
  originalIdea: string
  refinedDescription: string
  sector: string
  region: string
  targetGroup: string
  estimatedBudget: string
  keyObjectives: string[]
}

export interface MatchedCall {
  callId: string
  title: string
  program: string
  score: number
  thematicFit: number
  eligibilityFit: number
  budgetFit: number
  deadline: string
  sourceUrl: string
  reasoning: string
}

export interface ValidationResult {
  callId: string
  isOpen: boolean
  lastVerified: string
  updates: string[]
  warnings: string[]
}

export interface ResearchResult {
  callId: string
  requirements: string[]
  forms: { name: string; url?: string; description: string }[]
  certificates: { name: string; source: string; estimatedTime: string }[]
  deadlines: { item: string; date: string }[]
  additionalSections: string[]
  rawFindings: string
}

export interface ActionPlan {
  matchedCall: {
    title: string
    program: string
    deadline: string
    budget: { min: number; max: number; currency: string }
    sourceUrl: string
  }
  steps: {
    order: number
    title: string
    description: string
    category: 'document' | 'approval' | 'registration' | 'writing' | 'budget'
    deadline?: string
    responsible?: string
    dependencies: number[]
  }[]
  requiredDocuments: {
    name: string
    source: string
    estimatedTime: string
    mandatory: boolean
  }[]
  estimatedTimeline: string
}

export interface ProjectSection {
  title: string
  content: string
  order: number
  source: 'generated' | 'edited'
}

export interface UploadedFile {
  fileId: string
  filename: string
  mimeType: string
  extractedText?: string
}

export interface AgentResult {
  data: Record<string, unknown>
  checkpoint: CheckpointData | null
  tokensUsed?: number
}

export interface CheckpointData {
  question: string
  options?: { id: string; label: string; description?: string }[]
  type: 'select' | 'confirm' | 'freetext'
}

export type SSEEvent = {
  eventId: number
} & (
  | { type: 'step_start'; step: number; label: string }
  | { type: 'step_progress'; step: number; message: string }
  | { type: 'ai_chunk'; step: number; content: string }
  | { type: 'checkpoint'; step: number; data: CheckpointData }
  | { type: 'step_complete'; step: number; summary: string }
  | { type: 'discovery'; items: unknown[] }
  | { type: 'error'; step: number; message: string; retryable: boolean }
  | { type: 'done'; projectId?: string }
)

export interface SSEStream {
  send(event: Omit<SSEEvent, 'eventId'>): void
  close(): void
}

export interface GatewayClient {
  generate(opts: {
    provider: string
    model: string
    system: string
    messages: { role: string; content: string }[]
    maxTokens?: number
    temperature?: number
    stream?: boolean
  }): Promise<{ content: string; tokensUsed: number }>
  embed(text: string): Promise<number[]>
}

export type AgentFn = (
  ctx: WorkflowContext,
  input: string,
  stream: SSEStream,
  gateway: GatewayClient
) => Promise<AgentResult>

export const STEP_LABELS: Record<number, string> = {
  1: 'Enhancing your idea...',
  2: 'Matching with funding calls...',
  3: 'Validating funding call status...',
  4: 'Researching requirements...',
  5: 'Updating knowledge base...',
  6: 'Creating action plan...',
  7: 'Building your project...',
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/orchestrator-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/orchestrator/types.ts app/tests/unit/orchestrator-types.test.ts
git commit -m "feat(orchestrator): define types — WorkflowContext, AgentFn, SSEEvent, action plan interfaces"
```

---

### Task 5.2: Build SSE Stream Manager

**Files:**
- Create: `app/src/lib/ai/orchestrator/stream.ts`
- Test: `app/tests/unit/orchestrator-stream.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/unit/orchestrator-stream.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createSSEStream } from '@/lib/ai/orchestrator/stream'

describe('SSE Stream Manager', () => {
  it('sends formatted SSE events', () => {
    const mockWrite = vi.fn()
    const mockRes = { write: mockWrite, on: vi.fn() } as any
    const stream = createSSEStream(mockRes)

    stream.send({ type: 'step_start', step: 1, label: 'Testing...' })

    expect(mockWrite).toHaveBeenCalledTimes(1)
    const written = mockWrite.mock.calls[0][0] as string
    expect(written).toContain('id: 1')
    expect(written).toContain('"type":"step_start"')
    expect(written).toContain('"step":1')
  })

  it('increments eventId for each event', () => {
    const mockWrite = vi.fn()
    const mockRes = { write: mockWrite, on: vi.fn() } as any
    const stream = createSSEStream(mockRes)

    stream.send({ type: 'step_start', step: 1, label: 'First' })
    stream.send({ type: 'step_complete', step: 1, summary: 'Done' })

    const first = mockWrite.mock.calls[0][0] as string
    const second = mockWrite.mock.calls[1][0] as string
    expect(first).toContain('id: 1')
    expect(second).toContain('id: 2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/orchestrator-stream.test.ts`

- [ ] **Step 3: Implement SSE stream manager**

```typescript
// app/src/lib/ai/orchestrator/stream.ts
import type { SSEStream, SSEEvent } from './types'
import type { ServerResponse } from 'http'

export function createSSEStream(res: ServerResponse): SSEStream & { eventId: number } {
  let eventId = 0

  res.on('close', () => {
    // Client disconnected — cleanup handled by caller
  })

  return {
    get eventId() { return eventId },

    send(event: Omit<SSEEvent, 'eventId'>) {
      eventId++
      const fullEvent: SSEEvent = { ...event, eventId } as SSEEvent
      const data = JSON.stringify(fullEvent)
      res.write(`id: ${eventId}\ndata: ${data}\n\n`)
    },

    close() {
      res.end()
    },
  }
}

export function writeSSEHeaders(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  })
}

export function startHeartbeat(res: ServerResponse, intervalMs = 15_000): NodeJS.Timeout {
  return setInterval(() => {
    res.write(':keepalive\n\n')
  }, intervalMs)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/orchestrator-stream.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/orchestrator/stream.ts app/tests/unit/orchestrator-stream.test.ts
git commit -m "feat(orchestrator): add SSE stream manager with event IDs and heartbeat"
```

---

### Task 5.3: Build Gateway Client Wrapper

**Files:**
- Create: `app/src/lib/ai/orchestrator/gateway.ts`
- Test: `app/tests/unit/orchestrator-gateway.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/unit/orchestrator-gateway.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/client-v2', () => ({
  aiGenerate: vi.fn().mockResolvedValue({
    content: 'test response',
    usage: { totalTokens: 100 },
  }),
  aiEmbed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}))

describe('Gateway Client', () => {
  it('generate calls aiGenerate with provider/model', async () => {
    const { createGatewayClient } = await import('@/lib/ai/orchestrator/gateway')
    const client = createGatewayClient('tenant-fondeu')
    const result = await client.generate({
      provider: 'claude',
      model: 'claude-sonnet-4-0',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    })
    expect(result.content).toBe('test response')
    expect(result.tokensUsed).toBe(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/orchestrator-gateway.test.ts`

- [ ] **Step 3: Implement gateway client**

```typescript
// app/src/lib/ai/orchestrator/gateway.ts
import { aiGenerate, aiEmbed } from '@/lib/ai/client-v2'
import type { GatewayClient } from './types'

export function createGatewayClient(tenantId: string): GatewayClient {
  return {
    async generate(opts) {
      const result = await aiGenerate({
        provider: opts.provider,
        model: opts.model,
        system: opts.system,
        messages: opts.messages, // Pass structured messages array, not flattened string
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        tenantId,
      })
      return {
        content: result.content,
        tokensUsed: result.usage?.totalTokens || 0,
      }
    },

    async embed(text: string) {
      return aiEmbed(text)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/orchestrator-gateway.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/orchestrator/gateway.ts app/tests/unit/orchestrator-gateway.test.ts
git commit -m "feat(orchestrator): add gateway client wrapper for agent AI calls"
```

---

### Task 5.4: Build Orchestrator Engine

**Files:**
- Create: `app/src/lib/ai/orchestrator/engine.ts`
- Test: `app/tests/unit/orchestrator-engine.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/unit/orchestrator-engine.test.ts
import { describe, it, expect, vi } from 'vitest'

// Mock DB
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111' }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
}))

describe('Orchestrator Engine', () => {
  it('createSession creates a new workflow session', async () => {
    const { createSession } = await import('@/lib/ai/orchestrator/engine')
    const session = await createSession('user-123', 'ro', 'plus')
    expect(session).toBeDefined()
    expect(session.id).toBeDefined()
  })

  it('getAgentForStep returns correct agent', async () => {
    const { getAgentForStep } = await import('@/lib/ai/orchestrator/engine')
    const agent = getAgentForStep(1)
    expect(agent).toBeDefined()
    expect(typeof agent).toBe('function')
  })

  it('getAgentForStep throws for invalid step', async () => {
    const { getAgentForStep } = await import('@/lib/ai/orchestrator/engine')
    expect(() => getAgentForStep(0)).toThrow()
    expect(() => getAgentForStep(8)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/orchestrator-engine.test.ts`

- [ ] **Step 3: Implement engine**

```typescript
// app/src/lib/ai/orchestrator/engine.ts
import { db } from '@/lib/db'
import { workflowSessions, workflowMessages } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { WorkflowContext, AgentFn, SSEStream, GatewayClient, AgentResult } from './types'
import { STEP_LABELS } from './types'

// Agent imports
import { enhanceAgent } from './agents/enhance'
import { matchAgent } from './agents/match'
import { validateAgent } from './agents/validate'
import { researchAgent } from './agents/research'
import { knowledgeAgent } from './agents/knowledge'
import { planAgent } from './agents/plan'
import { buildAgent } from './agents/build'

const AGENTS: Record<number, AgentFn> = {
  1: enhanceAgent,
  2: matchAgent,
  3: validateAgent,
  4: researchAgent,
  5: knowledgeAgent,
  6: planAgent,
  7: buildAgent,
}

export function getAgentForStep(step: number): AgentFn {
  const agent = AGENTS[step]
  if (!agent) throw new Error(`Invalid step: ${step}. Must be 1-7.`)
  return agent
}

export async function createSession(
  userId: string,
  locale: 'ro' | 'en',
  tier: string
): Promise<{ id: string; context: WorkflowContext }> {
  const context: WorkflowContext = {
    sessionId: '', // Will be set after insert
    userId,
    locale,
    tier,
    step: 1,
    enhancedIdea: null,
    matchedCalls: null,
    validationResults: null,
    researchResults: null,
    actionPlan: null,
    projectSections: null,
    uploadedFiles: [],
  }

  const [session] = await db
    .insert(workflowSessions)
    .values({
      userId,
      currentStep: 1,
      context: context as unknown as Record<string, unknown>,
      status: 'active',
    })
    .returning()

  context.sessionId = session.id
  return { id: session.id, context }
}

export async function loadSession(sessionId: string): Promise<WorkflowContext | null> {
  const [session] = await db
    .select()
    .from(workflowSessions)
    .where(eq(workflowSessions.id, sessionId))
    .limit(1)

  if (!session) return null

  const ctx = session.context as unknown as WorkflowContext
  ctx.sessionId = session.id
  ctx.step = session.currentStep
  return ctx
}

export async function processMessage(
  sessionId: string,
  input: string,
  stream: SSEStream,
  gateway: GatewayClient
): Promise<void> {
  const ctx = await loadSession(sessionId)
  if (!ctx) {
    stream.send({ type: 'error', step: 0, message: 'Session not found', retryable: false })
    return
  }

  // Store user message
  await db.insert(workflowMessages).values({
    sessionId,
    role: 'user',
    content: input,
    step: ctx.step,
  })

  const agent = getAgentForStep(ctx.step)
  const label = STEP_LABELS[ctx.step] || `Step ${ctx.step}...`

  stream.send({ type: 'step_start', step: ctx.step, label })

  try {
    const result = await agent(ctx, input, stream, gateway)

    // Update context with agent output
    const updatedContext = { ...ctx, ...result.data }

    // Store assistant message
    await db.insert(workflowMessages).values({
      sessionId,
      role: 'assistant',
      content: JSON.stringify(result.data),
      step: ctx.step,
      eventType: result.checkpoint ? 'checkpoint' : 'step_complete',
      metadata: result.checkpoint ? result.checkpoint as unknown as Record<string, unknown> : null,
    })

    if (result.checkpoint) {
      // Pause for user input
      stream.send({ type: 'checkpoint', step: ctx.step, data: result.checkpoint })

      await db
        .update(workflowSessions)
        .set({
          context: updatedContext as unknown as Record<string, unknown>,
          tokenUsage: { total: result.tokensUsed || 0 },
          updatedAt: new Date(),
        })
        .where(eq(workflowSessions.id, sessionId))
    } else {
      // Advance to next step
      const nextStep = ctx.step + 1
      const isComplete = nextStep > 7

      stream.send({
        type: 'step_complete',
        step: ctx.step,
        summary: `Step ${ctx.step} complete`,
      })

      await db
        .update(workflowSessions)
        .set({
          currentStep: isComplete ? 7 : nextStep,
          context: updatedContext as unknown as Record<string, unknown>,
          status: isComplete ? 'completed' : 'active',
          updatedAt: new Date(),
        })
        .where(eq(workflowSessions.id, sessionId))

      if (isComplete) {
        stream.send({ type: 'done', projectId: (updatedContext as any).projectId })
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    stream.send({ type: 'error', step: ctx.step, message, retryable: true })

    await db.insert(workflowMessages).values({
      sessionId,
      role: 'system',
      content: `Error: ${message}`,
      step: ctx.step,
      eventType: 'error',
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/orchestrator-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/orchestrator/engine.ts app/tests/unit/orchestrator-engine.test.ts
git commit -m "feat(orchestrator): add engine — state machine, session management, message processing"
```

---

### Task 5.5: Build System Prompt & Enhance Agent (Step 1)

**Files:**
- Create: `app/src/lib/ai/orchestrator/prompts/system.ts`
- Create: `app/src/lib/ai/orchestrator/prompts/enhance.ts`
- Create: `app/src/lib/ai/orchestrator/agents/enhance.ts`
- Test: `app/tests/unit/agent-enhance.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/unit/agent-enhance.test.ts
import { describe, it, expect, vi } from 'vitest'
import type { WorkflowContext, SSEStream, GatewayClient } from '@/lib/ai/orchestrator/types'

describe('Enhance Agent', () => {
  it('returns enhanced idea with required fields', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          refinedDescription: 'A solar panel installation project for rural schools',
          sector: 'Energy',
          region: 'Nord-Est',
          targetGroup: 'Rural schools',
          estimatedBudget: '500000 EUR',
          keyObjectives: ['Install solar panels', 'Reduce energy costs'],
        }),
        tokensUsed: 500,
      }),
      embed: vi.fn(),
    }

    const ctx: WorkflowContext = {
      sessionId: 'test',
      userId: 'user-1',
      locale: 'ro',
      tier: 'plus',
      step: 1,
      enhancedIdea: null,
      matchedCalls: null,
      validationResults: null,
      researchResults: null,
      actionPlan: null,
      projectSections: null,
      uploadedFiles: [],
    }

    const { enhanceAgent } = await import('@/lib/ai/orchestrator/agents/enhance')
    const result = await enhanceAgent(ctx, 'I want to install solar panels on schools', mockStream, mockGateway)

    expect(result.data.enhancedIdea).toBeDefined()
    expect((result.data.enhancedIdea as any).refinedDescription).toContain('solar')
    expect(result.checkpoint).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/agent-enhance.test.ts`

- [ ] **Step 3: Implement system prompt**

```typescript
// app/src/lib/ai/orchestrator/prompts/system.ts
import type { WorkflowContext } from '../types'

export function getBaseSystemPrompt(ctx: WorkflowContext): string {
  const locale = ctx.locale === 'en' ? 'English' : 'Romanian'
  return `You are an AI assistant specialized in Romanian EU funding applications.

CONTEXT:
- Platform: FondEU (PlatformaFinantare.eu)
- User locale: ${locale}
- Respond in ${locale}

RULES:
- Always cite sources when referencing specific programs or calls
- Use official Romanian program names (PNRR, PEO, POTJ, POCIDIF, etc.)
- Flag uncertainty clearly — never fabricate call details
- Use formal but accessible language
- All monetary values in EUR unless otherwise specified`
}
```

- [ ] **Step 4: Implement enhance prompt**

```typescript
// app/src/lib/ai/orchestrator/prompts/enhance.ts
import type { WorkflowContext } from '../types'
import { getBaseSystemPrompt } from './system'

export function getEnhancePrompt(ctx: WorkflowContext): string {
  return `${getBaseSystemPrompt(ctx)}

ROLE: You are a EU funding project consultant. Your job is to refine the user's raw project idea into a structured concept.

TASK: Given the user's description, produce a structured project concept with:
- refinedDescription: A clear, professional 2-3 sentence description
- sector: The primary sector (Energy, Education, Health, Digital, Environment, Infrastructure, Social, Agriculture)
- region: The Romanian development region if mentioned (Nord-Est, Sud-Est, Sud, Sud-Vest, Vest, Nord-Vest, Centru, București-Ilfov) or "National"
- targetGroup: Who benefits from this project
- estimatedBudget: Rough budget estimate in EUR based on similar projects
- keyObjectives: 3-5 SMART objectives

OUTPUT: Return ONLY valid JSON matching the structure above. No markdown, no explanation.`
}
```

- [ ] **Step 5: Implement enhance agent**

```typescript
// app/src/lib/ai/orchestrator/agents/enhance.ts
import type { AgentFn, EnhancedIdea } from '../types'
import { getEnhancePrompt } from '../prompts/enhance'

export const enhanceAgent: AgentFn = async (ctx, input, stream, gateway) => {
  stream.send({ type: 'step_progress', step: 1, message: 'Analyzing your project idea...' })

  const result = await gateway.generate({
    provider: 'gemini',
    model: 'gemini-2.5-flash-preview',
    system: getEnhancePrompt(ctx),
    messages: [{ role: 'user', content: input }],
    temperature: 0.3,
  })

  let enhancedIdea: EnhancedIdea
  try {
    const parsed = JSON.parse(result.content)
    enhancedIdea = {
      originalIdea: input,
      refinedDescription: parsed.refinedDescription,
      sector: parsed.sector,
      region: parsed.region,
      targetGroup: parsed.targetGroup,
      estimatedBudget: parsed.estimatedBudget,
      keyObjectives: parsed.keyObjectives,
    }
  } catch {
    throw new Error('Failed to parse AI response for idea enhancement')
  }

  stream.send({
    type: 'step_progress',
    step: 1,
    message: `Project refined: ${enhancedIdea.sector} sector, ${enhancedIdea.region} region`,
  })

  // Stream the enhanced idea as AI text for the user to see
  const summary = ctx.locale === 'ro'
    ? `Am îmbunătățit ideea ta de proiect:\n\n**${enhancedIdea.refinedDescription}**\n\nSector: ${enhancedIdea.sector}\nRegiune: ${enhancedIdea.region}\nGrup țintă: ${enhancedIdea.targetGroup}\nBuget estimat: ${enhancedIdea.estimatedBudget}\n\nObiective:\n${enhancedIdea.keyObjectives.map((o, i) => `${i + 1}. ${o}`).join('\n')}`
    : `I've refined your project idea:\n\n**${enhancedIdea.refinedDescription}**\n\nSector: ${enhancedIdea.sector}\nRegion: ${enhancedIdea.region}\nTarget group: ${enhancedIdea.targetGroup}\nEstimated budget: ${enhancedIdea.estimatedBudget}\n\nObjectives:\n${enhancedIdea.keyObjectives.map((o, i) => `${i + 1}. ${o}`).join('\n')}`

  stream.send({ type: 'ai_chunk', step: 1, content: summary })

  return {
    data: { enhancedIdea },
    checkpoint: null,
    tokensUsed: result.tokensUsed,
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/agent-enhance.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/ai/orchestrator/prompts/ app/src/lib/ai/orchestrator/agents/enhance.ts app/tests/unit/agent-enhance.test.ts
git commit -m "feat(orchestrator): add enhance agent (step 1) with system prompts"
```

---

### Task 5.6: Build Match Agent (Step 2)

**Files:**
- Create: `app/src/lib/ai/orchestrator/prompts/match.ts`
- Create: `app/src/lib/ai/orchestrator/agents/match.ts`
- Test: `app/tests/unit/agent-match.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/unit/agent-match.test.ts
import { describe, it, expect, vi } from 'vitest'
import type { WorkflowContext, SSEStream, GatewayClient } from '@/lib/ai/orchestrator/types'

vi.mock('@/lib/rag/pipeline', () => ({
  hybridSearch: vi.fn().mockResolvedValue([
    { content: 'PNRR Call 4.2 - Green Energy for public buildings', metadata: { program: 'PNRR', sourceId: 'call-1' }, score: 0.9 },
    { content: 'PEO Call 2.1 - Education infrastructure', metadata: { program: 'PEO', sourceId: 'call-2' }, score: 0.6 },
  ]),
}))

describe('Match Agent', () => {
  it('returns matched calls with scores', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify([
          { callId: 'call-1', title: 'PNRR Call 4.2', program: 'PNRR', score: 92, thematicFit: 95, eligibilityFit: 88, budgetFit: 90, deadline: '2026-06-30', sourceUrl: 'https://example.com', reasoning: 'Strong match for green energy' },
        ]),
        tokensUsed: 800,
      }),
      embed: vi.fn(),
    }

    const ctx: WorkflowContext = {
      sessionId: 'test', userId: 'user-1', locale: 'ro', tier: 'plus', step: 2,
      enhancedIdea: { originalIdea: 'solar panels', refinedDescription: 'Solar panels for schools', sector: 'Energy', region: 'Nord-Est', targetGroup: 'Schools', estimatedBudget: '500000 EUR', keyObjectives: ['Install panels'] },
      matchedCalls: null, validationResults: null, researchResults: null, actionPlan: null, projectSections: null, uploadedFiles: [],
    }

    const { matchAgent } = await import('@/lib/ai/orchestrator/agents/match')
    const result = await matchAgent(ctx, '', mockStream, mockGateway)

    expect(result.data.matchedCalls).toBeDefined()
    expect((result.data.matchedCalls as any[]).length).toBeGreaterThan(0)
    // Should present checkpoint for user to select a call
    expect(result.checkpoint).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/agent-match.test.ts`

- [ ] **Step 3: Implement match prompt and agent**

Create `app/src/lib/ai/orchestrator/prompts/match.ts` and `app/src/lib/ai/orchestrator/agents/match.ts`.

The match agent:
1. Builds a search query from the enhanced idea (sector + region + objectives)
2. Calls `hybridSearch()` from `@/lib/rag/pipeline` to find relevant calls in Qdrant
3. Also queries `calls_for_proposals` table for active calls matching the sector
4. Sends results to Claude/Gemini to score and rank matches
5. Returns top matches with a checkpoint asking user to select one

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/agent-match.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/orchestrator/prompts/match.ts app/src/lib/ai/orchestrator/agents/match.ts app/tests/unit/agent-match.test.ts
git commit -m "feat(orchestrator): add match agent (step 2) — Qdrant search + scoring + checkpoint"
```

---

### Task 5.7: Build Remaining Agents (Steps 3-7)

**Files:**
- Create: `app/src/lib/ai/orchestrator/agents/validate.ts`
- Create: `app/src/lib/ai/orchestrator/agents/research.ts`
- Create: `app/src/lib/ai/orchestrator/agents/knowledge.ts`
- Create: `app/src/lib/ai/orchestrator/agents/plan.ts`
- Create: `app/src/lib/ai/orchestrator/agents/build.ts`
- Create: corresponding `prompts/*.ts` files
- Test: one test file per agent

Follow the same pattern as Tasks 5.5 and 5.6:

- [ ] **Step 1: Validate agent (Step 3)**

Uses Perplexity (`provider: 'perplexity', model: 'sonar'`) to web-search whether the matched call is still open. Uses Gemini Flash to verify any downloaded documents. Returns validation results. No checkpoint.

- [ ] **Step 2: Research agent (Step 4)**

Uses Perplexity Pro for deep web search on the specific call. Uses Gemini Pro to process large PDFs (ghiduri solicitant). Uses Claude to synthesize findings. Returns requirements, forms, certificates, deadlines, additional sections. No checkpoint.

- [ ] **Step 3: Knowledge agent (Step 5)**

Takes research results, chunks them, generates embeddings via `gateway.embed()`, upserts to Qdrant via existing `@/lib/vectors/store`. Marks as `verified: false`, `sourceType: 'agent_research'`. No checkpoint.

- [ ] **Step 4: Plan agent (Step 6)**

Uses Claude Sonnet to generate a structured `ActionPlan` from all accumulated context. Returns the plan as data. Checkpoint: asks user to confirm the plan before proceeding to build.

- [ ] **Step 5: Build agent (Step 7)**

Uses Claude Sonnet (or GPT-5.4/Opus 4.6 for Pro/Ultra based on `ctx.tier`). Generates all 11 sections + program-specific extras. Streams each section as `ai_chunk` events. Saves project to DB. Returns `projectId`.

- [ ] **Step 6: Run all agent tests**

Run: `cd app && npx vitest run tests/unit/agent-*.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Commit each agent separately**

One commit per agent for clean history.

---

### Task 5.8: Build API Routes

**Files:**
- Create: `app/src/app/api/ai/orchestrator/stream/route.ts`
- Create: `app/src/app/api/ai/orchestrator/message/route.ts`
- Create: `app/src/app/api/ai/orchestrator/messages/route.ts`

- [ ] **Step 1: Implement SSE stream endpoint**

```typescript
// app/src/app/api/ai/orchestrator/stream/route.ts
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { writeSSEHeaders, startHeartbeat } from '@/lib/ai/orchestrator/stream'

export const dynamic = 'force-dynamic'
export const maxDuration = 3600 // Cloud Run max

export async function GET(req: NextRequest) {
  const user = await requireAuth()
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  const lastEventId = req.nextUrl.searchParams.get('lastEventId')

  if (!sessionId) {
    return new Response('Missing sessionId', { status: 400 })
  }

  // Verify session belongs to user
  // Set up SSE response
  // Start heartbeat
  // If lastEventId, replay missed events from workflow_messages
  // Keep connection open until client disconnects

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(':keepalive\n\n'))
      }, 30_000)

      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
```

- [ ] **Step 2: Implement message endpoint**

```typescript
// app/src/app/api/ai/orchestrator/message/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { processMessage, createSession, loadSession } from '@/lib/ai/orchestrator/engine'
import { checkWorkflowLimit, incrementWorkflowCount } from '@/lib/billing/usage'
import { createGatewayClient } from '@/lib/ai/orchestrator/gateway'

export async function POST(req: NextRequest) {
  const user = await requireAuth()
  const body = await req.json()
  const { sessionId, message, locale } = body

  // If no sessionId, create new session (check workflow limits first)
  if (!sessionId) {
    const limitCheck = await checkWorkflowLimit(user.id, user.tier)
    if (!limitCheck.allowed) {
      return NextResponse.json({ error: limitCheck.message }, { status: 429 })
    }
    await incrementWorkflowCount(user.id)
    const session = await createSession(user.id, locale || 'ro', user.tier)
    // Trigger processing asynchronously
    // Return session ID immediately
    return NextResponse.json({ sessionId: session.id }, { status: 202 })
  }

  // Verify session belongs to user, then process
  return NextResponse.json({ ok: true }, { status: 202 })
}
```

- [ ] **Step 3: Implement message history endpoint**

```typescript
// app/src/app/api/ai/orchestrator/messages/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { workflowMessages, workflowSessions } from '@/lib/db/schema'
import { eq, and, asc } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const user = await requireAuth()
  const sessionId = req.nextUrl.searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
  }

  // Verify session belongs to user
  const [session] = await db
    .select()
    .from(workflowSessions)
    .where(and(
      eq(workflowSessions.id, sessionId),
      eq(workflowSessions.userId, user.id)
    ))
    .limit(1)

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const messages = await db
    .select()
    .from(workflowMessages)
    .where(eq(workflowMessages.sessionId, sessionId))
    .orderBy(asc(workflowMessages.createdAt))

  return NextResponse.json({ messages, session })
}
```

- [ ] **Step 4: Add routes to middleware publicPaths if needed**

Check `app/src/middleware.ts` — the orchestrator routes need auth (not public), so no changes needed unless CSRF needs updating.

- [ ] **Step 5: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/src/app/api/ai/orchestrator/
git commit -m "feat(orchestrator): add API routes — SSE stream, message, message history"
```

---

### Task 5.9: Add Redis Pub/Sub Bridge for SSE-POST Communication

**Files:**
- Create: `app/src/lib/ai/orchestrator/pubsub.ts`
- Modify: `app/src/app/api/ai/orchestrator/stream/route.ts`
- Modify: `app/src/app/api/ai/orchestrator/message/route.ts`
- Test: `app/tests/unit/orchestrator-pubsub.test.ts`

The POST `/message` endpoint cannot directly write to the GET `/stream` SSE connection. They are separate HTTP requests. Solution: Redis pub/sub per session.

- [ ] **Step 1: Write test**

```typescript
// app/tests/unit/orchestrator-pubsub.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('Orchestrator PubSub', () => {
  it('publishes events to a session channel', async () => {
    const { publishEvent, getChannelName } = await import('@/lib/ai/orchestrator/pubsub')
    expect(getChannelName('session-123')).toBe('orchestrator:session-123')
  })
})
```

- [ ] **Step 2: Implement pub/sub bridge**

```typescript
// app/src/lib/ai/orchestrator/pubsub.ts
import { getRedisClient } from '@/lib/redis/client'
import Redis from 'ioredis'
import type { SSEEvent } from './types'

export function getChannelName(sessionId: string): string {
  return `orchestrator:${sessionId}`
}

export async function publishEvent(sessionId: string, event: SSEEvent): Promise<void> {
  const redis = getRedisClient()
  await redis.publish(getChannelName(sessionId), JSON.stringify(event))
}

export function subscribeToSession(
  sessionId: string,
  onEvent: (event: SSEEvent) => void
): { unsubscribe: () => void } {
  // Create a dedicated subscriber connection (Redis requires separate conn for sub)
  const sub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
  const channel = getChannelName(sessionId)

  sub.subscribe(channel)
  sub.on('message', (_ch, message) => {
    try {
      const event = JSON.parse(message) as SSEEvent
      onEvent(event)
    } catch { /* ignore parse errors */ }
  })

  return {
    unsubscribe: () => {
      sub.unsubscribe(channel)
      sub.disconnect()
    },
  }
}
```

- [ ] **Step 3: Update stream route to subscribe**

The GET `/stream` route subscribes to the Redis channel for the session. When events arrive, it writes them as SSE data to the response.

- [ ] **Step 4: Update message route to publish**

The POST `/message` route calls `processMessage()` which uses `publishEvent()` instead of writing directly to a response. The `SSEStream` interface is backed by Redis publish.

- [ ] **Step 5: Run test, commit**

```bash
git add app/src/lib/ai/orchestrator/pubsub.ts app/tests/unit/orchestrator-pubsub.test.ts
git commit -m "feat(orchestrator): add Redis pub/sub bridge for SSE-POST communication"
```

---

### Task 5.10: Add Post-Completion Editing

**Files:**
- Modify: `app/src/lib/ai/orchestrator/engine.ts`
- Create: `app/src/lib/ai/orchestrator/agents/edit.ts`
- Create: `app/src/lib/ai/orchestrator/prompts/edit.ts`
- Test: `app/tests/unit/agent-edit.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/unit/agent-edit.test.ts
import { describe, it, expect, vi } from 'vitest'

describe('Edit Agent', () => {
  it('regenerates a single section when requested', async () => {
    // Test that edit agent takes a section number and instruction
    // and returns only that section regenerated
  })
})
```

- [ ] **Step 2: Implement edit agent**

The edit agent:
1. Parses user request to identify which section(s) to modify
2. Loads current project sections from `project_documents`
3. Generates updated section(s) using Claude Sonnet
4. Saves new version to `project_documents` (version++)
5. Returns updated sections

- [ ] **Step 3: Update engine to handle post-completion edits**

In `engine.ts`, after step 7 completes and session status is `completed`, incoming messages route to the edit agent instead of advancing steps. Check edit limits via `checkEditLimit()`.

- [ ] **Step 4: Run test, commit**

```bash
git add app/src/lib/ai/orchestrator/agents/edit.ts app/src/lib/ai/orchestrator/prompts/edit.ts app/tests/unit/agent-edit.test.ts
git commit -m "feat(orchestrator): add post-completion editing via chat"
```

---

### Task 5.11: Add Session Lifecycle Management

**Files:**
- Create: `app/src/lib/ai/orchestrator/lifecycle.ts`
- Test: `app/tests/unit/orchestrator-lifecycle.test.ts`

- [ ] **Step 1: Implement lifecycle functions**

```typescript
// app/src/lib/ai/orchestrator/lifecycle.ts
import { db } from '@/lib/db'
import { workflowSessions } from '@/lib/db/schema'
import { eq, and, lt, sql } from 'drizzle-orm'
import { getTierLimits } from '@/lib/billing/tiers'

// Auto-pause oldest sessions when user exceeds max for their tier
export async function enforceMaxSessions(userId: string, tier: string): Promise<void> {
  const limits = getTierLimits(tier)
  const activeSessions = await db
    .select()
    .from(workflowSessions)
    .where(and(
      eq(workflowSessions.userId, userId),
      sql`${workflowSessions.status} IN ('active', 'paused')`
    ))
    .orderBy(workflowSessions.updatedAt)

  if (activeSessions.length >= limits.maxActiveSessions) {
    // Pause oldest sessions to make room
    const toPause = activeSessions.slice(0, activeSessions.length - limits.maxActiveSessions + 1)
    for (const session of toPause) {
      await db.update(workflowSessions)
        .set({ status: 'paused', updatedAt: new Date() })
        .where(eq(workflowSessions.id, session.id))
    }
  }
}

// Abandon sessions inactive for 7+ days (called by cron)
export async function cleanupAbandonedSessions(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const result = await db.update(workflowSessions)
    .set({ status: 'abandoned', updatedAt: new Date() })
    .where(and(
      sql`${workflowSessions.status} IN ('active', 'paused')`,
      lt(workflowSessions.updatedAt, sevenDaysAgo)
    ))
  return 0 // Return count of affected rows
}
```

- [ ] **Step 2: Test and commit**

---

### Task 5.12: Add Agent Result Caching

**Files:**
- Create: `app/src/lib/ai/orchestrator/cache.ts`
- Test: `app/tests/unit/orchestrator-cache.test.ts`

- [ ] **Step 1: Implement cache layer**

```typescript
// app/src/lib/ai/orchestrator/cache.ts
import { getRedisClient } from '@/lib/redis/client'
import crypto from 'crypto'

function cacheKey(prefix: string, params: Record<string, unknown>): string {
  const hash = crypto.createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 16)
  return `cache:orchestrator:${prefix}:${hash}`
}

export async function getCachedResult<T>(prefix: string, params: Record<string, unknown>): Promise<T | null> {
  const redis = getRedisClient()
  const key = cacheKey(prefix, params)
  const cached = await redis.get(key)
  return cached ? JSON.parse(cached) : null
}

export async function setCachedResult(
  prefix: string,
  params: Record<string, unknown>,
  result: unknown,
  ttlSeconds: number
): Promise<void> {
  const redis = getRedisClient()
  const key = cacheKey(prefix, params)
  await redis.setex(key, ttlSeconds, JSON.stringify(result))
}

// Cache TTLs per step
export const CACHE_TTLS = {
  match: 3600,       // 1h — match results by program+sector+region
  validate: 86400,   // 24h — call validation by callId
  research: 86400,   // 24h — deep research by callId
}
```

- [ ] **Step 2: Integrate cache into match, validate, research agents**

Each agent checks cache before making AI calls. On cache hit, skip the AI call and return cached result. On miss, call AI, cache result, return.

- [ ] **Step 3: Test and commit**

```bash
git add app/src/lib/ai/orchestrator/cache.ts app/tests/unit/orchestrator-cache.test.ts
git commit -m "feat(orchestrator): add Redis caching for steps 2-5 (30-40% cost reduction)"
```

---

### Task 5.13: Add File Upload Handling to Message Endpoint

**Files:**
- Modify: `app/src/app/api/ai/orchestrator/message/route.ts`
- Test: `app/tests/unit/orchestrator-upload.test.ts`

- [ ] **Step 1: Add multipart form parsing to POST /message**

The message endpoint accepts `multipart/form-data` with:
- `sessionId` (text field)
- `message` (text field)
- `files` (file field, multiple, max 15MB each)

On file upload:
1. Store file via `@/lib/storage/gcs` (existing)
2. Parse text via `@/lib/ai/knowledge/parser` (existing)
3. Insert into `project_files` with `category: 'uploaded'`
4. Add to workflow context `uploadedFiles` array
5. Include extracted text in the agent's context

- [ ] **Step 2: Test and commit**

---

### Task 5.14: Add Data Anonymization Sanitizer

**Files:**
- Create: `app/src/lib/ai/orchestrator/sanitizer.ts`
- Test: `app/tests/unit/orchestrator-sanitizer.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/unit/orchestrator-sanitizer.test.ts
import { describe, it, expect } from 'vitest'
import { sanitizeForAI } from '@/lib/ai/orchestrator/sanitizer'

describe('Data Anonymization', () => {
  it('redacts CIF numbers', () => {
    expect(sanitizeForAI('Company CIF RO12345678')).toBe('Company CIF [REDACTED_CIF]')
  })

  it('redacts IBAN numbers', () => {
    expect(sanitizeForAI('Account RO49AAAA1B31007593840000')).toBe('Account [REDACTED_IBAN]')
  })

  it('redacts CNP numbers', () => {
    expect(sanitizeForAI('CNP 1234567890123')).toBe('CNP [REDACTED_CNP]')
  })

  it('preserves non-sensitive text', () => {
    expect(sanitizeForAI('PNRR Call 4.2 budget 500000 EUR')).toBe('PNRR Call 4.2 budget 500000 EUR')
  })
})
```

- [ ] **Step 2: Implement sanitizer**

```typescript
// app/src/lib/ai/orchestrator/sanitizer.ts
const PATTERNS = [
  { regex: /\bRO\d{2,10}\b/g, replacement: '[REDACTED_CIF]' },
  { regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g, replacement: '[REDACTED_IBAN]' },
  { regex: /\b[1-8]\d{12}\b/g, replacement: '[REDACTED_CNP]' },
  { regex: /\b\d{10}\b/g, replacement: '[REDACTED_PHONE]' },
  { regex: /\b[\w.-]+@[\w.-]+\.\w{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
]

export function sanitizeForAI(text: string): string {
  let result = text
  for (const { regex, replacement } of PATTERNS) {
    result = result.replace(regex, replacement)
  }
  return result
}
```

- [ ] **Step 3: Integrate into gateway client** — call `sanitizeForAI()` on all message content before sending to gateway.

- [ ] **Step 4: Run test, commit**

```bash
git add app/src/lib/ai/orchestrator/sanitizer.ts app/tests/unit/orchestrator-sanitizer.test.ts
git commit -m "feat(orchestrator): add data anonymization — redact CIF, IBAN, CNP before AI calls"
```

---

### Task 5.15: Add Compliance Agent (Step 6.5)

**Files:**
- Create: `app/src/lib/ai/orchestrator/agents/compliance.ts`
- Create: `app/src/lib/ai/orchestrator/prompts/compliance.ts`
- Test: `app/tests/unit/agent-compliance.test.ts`

The compliance agent runs between Plan and Build:
1. Takes the action plan + research results (eligibility criteria)
2. Checks each criterion: applicant type eligible? Region eligible? Budget in range? Required documents identified?
3. Produces a pass/fail checklist
4. If critical failures → checkpoint: "These issues may cause rejection. Fix before building?"
5. If all pass → proceed automatically to Build

- [ ] **Step 1: Write test**
- [ ] **Step 2: Implement prompt and agent**
- [ ] **Step 3: Update engine to dispatch compliance agent after step 6**
- [ ] **Step 4: Run test, commit**

```bash
git commit -m "feat(orchestrator): add compliance agent (step 6.5) — flags auto-rejection risks"
```

---

### Task 5.16: Add Preflight Check (Step 7.5)

**Files:**
- Create: `app/src/lib/ai/orchestrator/agents/preflight.ts`
- Test: `app/tests/unit/agent-preflight.test.ts`

After Build completes, run a structured checklist:
- Cross-reference `requiredDocuments` from Research step against uploaded files
- Check budget figures consistent across sections
- Verify all required declarations present
- Return pass/fail checklist, display to user before marking complete

- [ ] **Step 1: Write test**
- [ ] **Step 2: Implement preflight agent**
- [ ] **Step 3: Update engine to dispatch preflight after step 7**
- [ ] **Step 4: Run test, commit**

```bash
git commit -m "feat(orchestrator): add preflight check (step 7.5) — submission readiness validation"
```

---

### Task 5.17: Add Match Reasoning (Include + Exclude)

**Files:**
- Modify: `app/src/lib/ai/orchestrator/agents/match.ts`
- Modify: `app/src/lib/ai/orchestrator/prompts/match.ts`

Update the match agent to return:
- For each matched call: `reasoning` (why it fits)
- Top 3 excluded calls with `exclusionReason` (why they didn't make it)
- Display both in the checkpoint card UI

- [ ] **Step 1: Update match prompt to require exclusion reasoning**
- [ ] **Step 2: Update MatchedCall type to include exclusions**
- [ ] **Step 3: Run test, commit**

```bash
git commit -m "feat(orchestrator): add match reasoning — explain both inclusion and exclusion"
```

---

## Phase 6: Funding Discovery

**Goal:** Build daily discovery pipeline with Cloud Scheduler trigger and chat review.

### Task 6.1: Build Discovery Pipeline

**Files:**
- Create: `app/src/lib/discovery/pipeline.ts`
- Create: `app/src/lib/discovery/perplexity-sweep.ts`
- Create: `app/src/app/api/v1/admin/discovery/run/route.ts`
- Test: `app/tests/unit/discovery-pipeline.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/unit/discovery-pipeline.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: { select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]), insert: vi.fn().mockReturnThis(), values: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/ai/orchestrator/gateway', () => ({ createGatewayClient: vi.fn(() => ({ generate: vi.fn().mockResolvedValue({ content: '[]', tokensUsed: 100 }) })) }))

describe('Discovery Pipeline', () => {
  it('exports runDiscovery function', async () => {
    const { runDiscovery } = await import('@/lib/discovery/pipeline')
    expect(typeof runDiscovery).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/discovery-pipeline.test.ts`

- [ ] **Step 3: Implement discovery pipeline**

The pipeline:
1. Runs all active crawlers from `sourceConnectors` table
2. Runs Perplexity sweep for new calls
3. Computes `contentHash` (SHA-256 of normalized title + sourceDomain + program)
4. Checks for duplicates against `discovered_calls` and `calls_for_proposals`
5. Inserts new finds with `status: 'pending_review'`
6. Flags expired calls in `calls_for_proposals`

- [ ] **Step 4: Create API route**

```typescript
// app/src/app/api/v1/admin/discovery/run/route.ts
// POST handler that runs the pipeline
// Requires platform admin OR Cloud Scheduler service account
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/discovery-pipeline.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/discovery/ app/src/app/api/v1/admin/discovery/ app/tests/unit/discovery-pipeline.test.ts
git commit -m "feat(discovery): add daily funding discovery pipeline with Perplexity sweep"
```

---

### Task 6.2: Set Up Cloud Scheduler

- [ ] **Step 1: Create Cloud Scheduler job**

```bash
gcloud scheduler jobs create http fondeu-daily-discovery \
  --location=europe-west2 \
  --schedule="0 6 * * *" \
  --time-zone="Europe/Bucharest" \
  --uri="https://fondeu-platform-857599941951.europe-west2.run.app/api/v1/admin/discovery/run" \
  --http-method=POST \
  --headers="Authorization=Bearer ${ADMIN_API_KEY}" \
  --attempt-deadline=600s
```

- [ ] **Step 2: Test manually**

Run: `gcloud scheduler jobs run fondeu-daily-discovery --location=europe-west2`
Verify: Check logs in Cloud Run for successful execution.

- [ ] **Step 3: Commit documentation**

Add scheduler details to `docs/infrastructure.md` or similar.

---

## Phase 7: Project Builder & Export

**Goal:** Build DOCX/PDF export from project sections.

### Task 7.1: Add Export Dependencies

- [ ] **Step 1: Install packages**

```bash
cd app && npm install docxtemplater pizzip @react-pdf/renderer
```

- [ ] **Step 2: Commit**

```bash
git add app/package.json app/package-lock.json
git commit -m "chore: add docxtemplater and react-pdf for project export"
```

---

### Task 7.2: Build DOCX Export

**Files:**
- Create: `app/src/lib/export/docx.ts`
- Create: `app/src/lib/export/templates/project-template.docx` (binary template)
- Test: `app/tests/unit/export-docx.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/unit/export-docx.test.ts
import { describe, it, expect } from 'vitest'

describe('DOCX Export', () => {
  it('generates a buffer from project sections', async () => {
    const { generateDocx } = await import('@/lib/export/docx')
    const sections = [
      { title: 'Rezumat proiect', content: 'Test project summary', order: 1, source: 'generated' as const },
      { title: 'Context și justificare', content: 'Test context', order: 2, source: 'generated' as const },
    ]
    const buffer = await generateDocx(sections, { projectTitle: 'Test Project', program: 'PNRR' })
    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Implement DOCX generator**

Uses `docxtemplater` with a template that has placeholders for each section. Generates a professional-looking DOCX with cover page, headers, and formatted sections.

- [ ] **Step 3: Run test, commit**

---

### Task 7.3: Build PDF Export

**Files:**
- Create: `app/src/lib/export/pdf.ts`
- Test: `app/tests/unit/export-pdf.test.ts`

- [ ] **Step 1: Implement PDF generator using @react-pdf/renderer**

Server-side React components that render project sections into PDF format. Custom components for budget tables, risk matrices, and Gantt timelines.

- [ ] **Step 2: Test and commit**

---

### Task 7.4: Build Export API Route

**Files:**
- Create: `app/src/app/api/v1/projects/[id]/export/route.ts`

- [ ] **Step 1: Implement export endpoint**

```typescript
// app/src/app/api/v1/projects/[id]/export/route.ts
// GET ?format=docx|pdf
// Loads project_documents, generates file, stores in project_files as 'generated'
// Returns file download
```

- [ ] **Step 2: Test and commit**

---

## Phase 8: UI Redesign

**Goal:** Build the two-page Apple-style UI.

### Task 8.1: Set Up Design System

**Files:**
- Create: `app/src/styles/design-tokens.css`
- Modify: `app/src/styles/globals.css`

- [ ] **Step 1: Define design tokens**

```css
/* app/src/styles/design-tokens.css */
:root {
  --color-bg: #ffffff;
  --color-bg-secondary: #f5f5f7;
  --color-text: #1d1d1f;
  --color-text-secondary: #6e6e73;
  --color-accent: #0071e3;
  --color-accent-hover: #0077ed;
  --color-border: #d2d2d7;
  --color-success: #34c759;
  --color-error: #ff3b30;

  --font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;
  --font-size-3xl: 2rem;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-full: 9999px;

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.12);

  --transition: 200ms ease;
  --max-chat-width: 720px;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/styles/
git commit -m "feat(ui): add Apple-style design tokens"
```

---

### Task 8.2: Build Chat Page

**Files:**
- Create: `app/src/app/[locale]/page.tsx` (replace existing)
- Create: `app/src/components/chat/ChatPage.tsx`
- Create: `app/src/components/chat/MessageList.tsx`
- Create: `app/src/components/chat/MessageInput.tsx`
- Create: `app/src/components/chat/ProjectSelector.tsx`
- Create: `app/src/components/chat/StepIndicator.tsx`
- Create: `app/src/components/chat/CheckpointCard.tsx`
- Create: `app/src/components/chat/QuickStarts.tsx`
- Create: `app/src/components/chat/AIBadge.tsx`
- Create: `app/src/hooks/useOrchestrator.ts`

- [ ] **Step 1: Build useOrchestrator hook**

Custom hook that manages:
- SSE connection (EventSource)
- Message sending (POST to /api/ai/orchestrator/message)
- Message history loading
- Reconnection with lastEventId
- Session state (current step, status)

- [ ] **Step 2: Build QuickStarts component**

When no active session, show 3-5 prominent entry cards instead of empty chat:
- "Check if I'm eligible for EU funds"
- "Find open calls for my idea"
- "Improve a draft application I already wrote"
Each card starts a new workflow with a pre-filled context hint. Apple-style cards with subtle shadows.

- [ ] **Step 3: Build AIBadge component**

Small inline badge for AI-generated content:
- Blue badge: "AI Generated" — shows on sections with `source: 'generated'`
- Green badge: "Human Edited" — shows on sections with `source: 'edited'`
- Hover shows provenance: model used, generated timestamp, confidence score

- [ ] **Step 4: Build MessageInput component**

Large text area with file attach button. Send on Enter (Shift+Enter for newline). File drop zone. Apple-style minimal design.

- [ ] **Step 3: Build MessageList component**

Renders messages with:
- User messages (right-aligned, subtle background)
- Assistant messages (left-aligned, rendered markdown)
- StepIndicator cards between messages
- CheckpointCard with interactive options

- [ ] **Step 4: Build ProjectSelector component**

Pill in top bar showing current project. Dropdown with recent sessions and "New project" option.

- [ ] **Step 5: Build ChatPage layout**

Compose all components into the chat page layout:
- Top bar with logo, project selector, user menu
- MessageList in scrollable center
- MessageInput fixed at bottom

- [ ] **Step 6: Wire up to root page**

Replace `app/src/app/[locale]/page.tsx` (or the dashboard redirect) to render ChatPage.

- [ ] **Step 7: Run dev server and test manually**

Run: `cd app && npm run dev`
Test: Open localhost:3000, verify layout renders correctly.

- [ ] **Step 8: Commit**

```bash
git add app/src/app/[locale]/page.tsx app/src/components/chat/ app/src/hooks/useOrchestrator.ts
git commit -m "feat(ui): build chat page — message list, input, project selector, SSE integration"
```

---

### Task 8.3: Build Projects Page

**Files:**
- Create: `app/src/app/[locale]/proiecte/page.tsx`
- Create: `app/src/components/projects/ProjectsGrid.tsx`
- Create: `app/src/components/projects/ProjectCard.tsx`
- Create: `app/src/components/projects/ProjectDetail.tsx`
- Create: `app/src/components/projects/SectionEditor.tsx`
- Create: `app/src/components/projects/FilesTab.tsx`

- [ ] **Step 1: Build ProjectCard component**

Minimal card: title, program badge, status pill, last updated date. Apple-style with subtle shadow and hover effect.

- [ ] **Step 2: Build ProjectsGrid**

Grid layout (responsive: 1 col mobile, 2 col tablet, 3 col desktop). Click opens ProjectDetail.

- [ ] **Step 3: Build ProjectDetail**

Full-width panel (could be modal or route):
- Collapsible section panels
- Each section editable inline
- Files tab showing uploaded + generated files
- Export button (DOCX/PDF)
- Back to grid button

- [ ] **Step 4: Build SectionEditor**

Rich text editor for individual sections. Auto-saves on blur. Marks `source: 'edited'` on change.

- [ ] **Step 5: Build FilesTab**

Two-column layout: Uploaded files (left), Generated files (right). Upload button. Download buttons.

- [ ] **Step 6: Wire up projects page**

```typescript
// app/src/app/[locale]/proiecte/page.tsx
import { ProjectsGrid } from '@/components/projects/ProjectsGrid'
// Fetch user's projects, render grid
```

- [ ] **Step 7: Test manually**

Run: `cd app && npm run dev`
Navigate to /ro/proiecte, verify layout.

- [ ] **Step 8: Commit**

```bash
git add app/src/app/[locale]/proiecte/ app/src/components/projects/
git commit -m "feat(ui): build projects page — grid, detail view, section editor, files tab"
```

---

### Task 8.4: Remove Old UI

**Files:**
- Delete: `app/src/app/[locale]/(dashboard)/panou/`
- Delete: `app/src/app/[locale]/(dashboard)/documente/`
- Delete: `app/src/app/[locale]/(dashboard)/legislatie/`
- Delete: `app/src/app/[locale]/(dashboard)/setari/`
- Delete: `app/src/app/[locale]/(dashboard)/aprobari/`
- Delete: `app/src/app/[locale]/(dashboard)/audit/`
- Delete: `app/src/app/[locale]/(dashboard)/asistent/`
- Delete: `app/src/components/ai/ConversationalWizard.tsx`
- Delete: `app/src/components/ai/GrantMatcher.tsx`
- Delete: `app/src/components/ai/ProposalWizard.tsx`
- Delete: `app/src/components/ai/ProjectWizard.tsx`
- Delete: Other unused AI widgets
- Modify: `app/src/app/[locale]/(dashboard)/layout.tsx` — remove sidebar

- [ ] **Step 1: List all files to delete**

Run: `ls app/src/app/[locale]/(dashboard)/` and `ls app/src/components/ai/`
Confirm which files/directories to remove.

- [ ] **Step 2: Delete old pages**

```bash
rm -rf app/src/app/[locale]/(dashboard)/panou
rm -rf app/src/app/[locale]/(dashboard)/documente
rm -rf app/src/app/[locale]/(dashboard)/legislatie
rm -rf app/src/app/[locale]/(dashboard)/setari
rm -rf app/src/app/[locale]/(dashboard)/aprobari
rm -rf app/src/app/[locale]/(dashboard)/audit
rm -rf app/src/app/[locale]/(dashboard)/asistent
```

- [ ] **Step 3: Delete old AI widgets**

```bash
rm -f app/src/components/ai/ConversationalWizard.tsx
rm -f app/src/components/ai/GrantMatcher.tsx
rm -f app/src/components/ai/ProposalWizard.tsx
rm -f app/src/components/ai/ProjectWizard.tsx
rm -f app/src/components/ai/DocumentUpload.tsx
rm -f app/src/components/ai/RomanianMarketIntelligenceWidget.tsx
```

- [ ] **Step 4: Remove old API endpoints**

```bash
rm -rf app/src/app/api/ai/analyze-document
rm -rf app/src/app/api/ai/validate-compliance
rm -rf app/src/app/api/ai/project-analysis
rm -rf app/src/app/api/ai/project-health
rm -rf app/src/app/api/ai/predict-success
rm -rf app/src/app/api/ai/forecast-lifecycle
rm -rf app/src/app/api/ai/optimize-timeline
rm -rf app/src/app/api/ai/optimize-budget
rm -rf app/src/app/api/ai/analyze-consortium
rm -rf app/src/app/api/ai/recommend-partners
rm -rf app/src/app/api/ai/market-intelligence
rm -rf app/src/app/api/ai/advanced-analytics
rm -rf app/src/app/api/ai/roman-market-intelligence
rm -rf app/src/app/api/ai/deadline-risk-assessment
rm -rf app/src/app/api/ai/wizard
```

- [ ] **Step 5: Simplify dashboard layout**

Remove sidebar from `app/src/app/[locale]/(dashboard)/layout.tsx`. The layout should just wrap content with the top bar.

- [ ] **Step 6: Fix typecheck**

Run: `cd app && npm run typecheck`
Fix any broken imports from deleted files.

- [ ] **Step 7: Fix tests**

Run: `cd app && npm test`
Delete or fix tests that reference removed components/routes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): remove old dashboard pages, sidebar, AI widgets, and unused API endpoints"
```

---

### Task 8.5: Update Navigation & Auth Pages

**Files:**
- Modify: `app/src/app/[locale]/(auth)/autentificare/page.tsx` — Google + magic link UI
- Modify: `app/src/middleware.ts` — update public paths, redirects

- [ ] **Step 1: Update login page**

Replace credentials form with:
- Google sign-in button (prominent, primary)
- "Or continue with email" divider
- Email input + "Send magic link" button
- Clean, minimal Apple style

- [ ] **Step 2: Update middleware redirects**

- Authenticated users landing on `/` → render chat page (not redirect to `/panou`)
- Remove references to deleted pages in `publicPaths`

- [ ] **Step 3: Remove register and password reset pages**

```bash
rm -rf app/src/app/[locale]/(auth)/inregistrare
rm -rf app/src/app/[locale]/(auth)/resetare-parola
```

- [ ] **Step 4: Run dev server and test full flow**

1. Open localhost:3000 → should see login page
2. Login → should see chat page
3. Navigate to /proiecte → should see projects grid
4. Check project selector in chat top bar

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): update auth pages for Google + magic link, clean up navigation"
```

---

## Final Verification

- [ ] **Run full test suite:** `cd app && npm test`
- [ ] **Run typecheck:** `cd app && npm run typecheck`
- [ ] **Run lint:** `cd app && npm run lint`
- [ ] **Run build:** `cd app && npm run build`
- [ ] **Manual E2E test:** Login → describe idea → follow 7-step workflow → view project → export

---

## Summary

| Phase | Tasks | Estimated Commits |
|-------|-------|-------------------|
| 1. Schema & Migration | 6 tasks | ~8 commits |
| 2. Auth Simplification | 3 tasks | ~4 commits |
| 3. Gateway Streaming | 2 tasks | ~3 commits |
| 4. Billing & Tiers | 2 tasks | ~3 commits |
| 5. Orchestrator Engine | 17 tasks | ~20 commits |
| 6. Funding Discovery | 2 tasks | ~3 commits |
| 7. Project Builder & Export | 4 tasks | ~5 commits |
| 8. UI Redesign | 5 tasks | ~7 commits |
| **Total** | **41 tasks** | **~53 commits** |
