// ── Phase 3 Concurrency Integration Test ─────────────────────────────────────
// Seeds a real agent_sessions row with stateVersion=10, then attempts each of
// the 8 write services with expectedStateVersion=9.
// All 8 must throw ConcurrencyError — proving the guard fires before any
// policy gate, DB write, or audit emission.
//
// Requires DATABASE_URL to point to a running Postgres instance.
// Run with: DATABASE_URL=<url> npx vitest run tests/integration/services/phase3-concurrency.test.ts
// or via:   npx vitest run --env-file=.env.local tests/integration/services/phase3-concurrency.test.ts

import dotenv from 'dotenv'
import path from 'path'
// Load .env.local so DATABASE_URL is available when db/index.ts initialises.
// This must happen before any @/ imports that touch the DB.
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') })

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// ── Mock audit logging so we never depend on audit table / hash chain ────────
vi.mock('@/lib/legal/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}))

import postgres from 'postgres'
import { db } from '@/lib/db'
import { agentSections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ConcurrencyError } from '@/lib/ai/agent/services/errors'
import {
  saveSectionDraft,
  approveSection,
  rollbackSection,
  markSectionStale,
  rejectSection,
} from '@/lib/ai/agent/services/sections'
import {
  setSelectedCall,
  freezeOutline,
  setApplicationStatus,
} from '@/lib/ai/agent/services/application'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TEST_USER_ID = '99999999-9999-4999-8999-999999999901'

const ctx: ServiceContext = {
  userId: TEST_USER_ID,
  requestId: 'phase3-concurrency-test',
  now: new Date(),
}

// ── Raw SQL client ─────────────────────────────────────────────────────────────
// Use a separate postgres.js connection for seeding so we can insert only the
// columns that exist in the live DB (which may lag behind the ORM schema for
// columns added in recent migrations but not yet pushed to dev).

const sql = postgres(process.env.DATABASE_URL!, { max: 2 })

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function seedUser(): Promise<void> {
  await sql`
    INSERT INTO users (id, email, full_name, password_hash)
    VALUES (
      ${TEST_USER_ID}::uuid,
      'phase3-concurrency-test-901@example.com',
      'Phase3 Concurrency Test User',
      '$2a$12$fakehashfortestingonly000000000000000000000000000000'
    )
    ON CONFLICT (id) DO NOTHING
  `
}

/**
 * Insert an agent_sessions row with state_version=10 using only the columns
 * that exist in the live DB (not the ORM schema which may have newer columns).
 * Returns the generated session UUID.
 */
async function seedSession(opts: {
  outlineFrozen?: boolean
  status?: string
} = {}): Promise<string> {
  const outlineFrozen = opts.outlineFrozen ?? true
  const status = opts.status ?? 'active'
  const eligibility = JSON.stringify({
    results: [],
    score: 100,
    passCount: 3,
    failCount: 0,
    warningCount: 0,
  })

  const rows = await sql<{ id: string }[]>`
    INSERT INTO agent_sessions (
      user_id, status, locale, selected_call_id,
      current_phase, eligibility, outline_frozen, state_version
    )
    VALUES (
      ${TEST_USER_ID}::uuid,
      ${status}::agent_session_status,
      'ro',
      'CALL-CONCURRENCY-42',
      'drafting'::agent_phase,
      ${eligibility}::jsonb,
      ${outlineFrozen},
      10
    )
    RETURNING id
  `
  return rows[0].id
}

/**
 * Delete sections and session rows created by the test.
 * agent_sections has ON DELETE CASCADE from agent_sessions, but we delete
 * sections first explicitly to be safe with any test isolation.
 */
async function cleanupSession(sessionId: string): Promise<void> {
  await db.delete(agentSections).where(eq(agentSections.sessionId, sessionId))
  // Promoted projects (from setSelectedCall → ensureProjectForSession) link
  // back to this session via metadata.agentSessionId. Delete them so the
  // dev DB doesn't accumulate residue across test runs.
  await sql`DELETE FROM projects WHERE metadata->>'agentSessionId' = ${sessionId}`
  await sql`DELETE FROM agent_sessions WHERE id = ${sessionId}::uuid`
}

// ── Section seed helper ───────────────────────────────────────────────────────

async function seedSection(
  sessionId: string,
  status = 'draft',
): Promise<void> {
  await sql`
    INSERT INTO agent_sections (
      session_id, section_key, title,
      document_order, generation_order, status, content
    )
    VALUES (
      ${sessionId}::uuid,
      'obiective',
      'Obiective',
      1, 1,
      ${status}::agent_section_status,
      'Draft content for concurrency test'
    )
  `
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const DB_AVAILABLE = !!process.env.DATABASE_URL
const maybeDescribe = DB_AVAILABLE ? describe : describe.skip

maybeDescribe(
  'Phase 3 concurrency enforcement across all 8 write services (real DB)',
  () => {
    beforeEach(async () => {
      await seedUser()
    })

    // ── 1. saveSectionDraft ────────────────────────────────────────────────────
    it('saveSectionDraft rejects stale expectedStateVersion', async () => {
      const sessionId = await seedSession()
      try {
        await expect(
          saveSectionDraft(ctx, {
            sessionId,
            sectionKey: 'obiective',
            content: 'some content',
            expectedStateVersion: 9,
          }),
        ).rejects.toBeInstanceOf(ConcurrencyError)
      } finally {
        await cleanupSession(sessionId)
      }
    })

    // ── 2. setSelectedCall ─────────────────────────────────────────────────────
    it('setSelectedCall rejects stale expectedStateVersion', async () => {
      // outlineFrozen=false so the service can reach the ConcurrencyError before
      // the POLICY_OUTLINE_ALREADY_FROZEN gate
      const sessionId = await seedSession({ outlineFrozen: false })
      try {
        await expect(
          setSelectedCall(ctx, {
            sessionId,
            callId: 'CALL-NEW-99',
            expectedStateVersion: 9,
          }),
        ).rejects.toBeInstanceOf(ConcurrencyError)
      } finally {
        await cleanupSession(sessionId)
      }
    })

    // ── 3. freezeOutline ──────────────────────────────────────────────────────
    it('freezeOutline rejects stale expectedStateVersion', async () => {
      // outlineFrozen=false so we don't hit the idempotent no-op path
      const sessionId = await seedSession({ outlineFrozen: false })
      try {
        await expect(
          freezeOutline(ctx, {
            sessionId,
            expectedStateVersion: 9,
          }),
        ).rejects.toBeInstanceOf(ConcurrencyError)
      } finally {
        await cleanupSession(sessionId)
      }
    })

    // ── 4. approveSection ─────────────────────────────────────────────────────
    it('approveSection rejects stale expectedStateVersion', async () => {
      const sessionId = await seedSession()
      await seedSection(sessionId, 'draft')
      try {
        await expect(
          approveSection(ctx, {
            sessionId,
            sectionKey: 'obiective',
            expectedStateVersion: 9,
          }),
        ).rejects.toBeInstanceOf(ConcurrencyError)
      } finally {
        await cleanupSession(sessionId)
      }
    })

    // ── 5. rollbackSection ────────────────────────────────────────────────────
    it('rollbackSection rejects stale expectedStateVersion', async () => {
      const sessionId = await seedSession()
      await seedSection(sessionId, 'draft')
      try {
        await expect(
          rollbackSection(ctx, {
            sessionId,
            sectionKey: 'obiective',
            targetVersion: 1,
            expectedStateVersion: 9,
          }),
        ).rejects.toBeInstanceOf(ConcurrencyError)
      } finally {
        await cleanupSession(sessionId)
      }
    })

    // ── 6. markSectionStale ───────────────────────────────────────────────────
    it('markSectionStale rejects stale expectedStateVersion', async () => {
      const sessionId = await seedSession()
      await seedSection(sessionId, 'draft')
      try {
        await expect(
          markSectionStale(ctx, {
            sessionId,
            sectionKey: 'obiective',
            expectedStateVersion: 9,
          }),
        ).rejects.toBeInstanceOf(ConcurrencyError)
      } finally {
        await cleanupSession(sessionId)
      }
    })

    // ── 7. rejectSection ──────────────────────────────────────────────────────
    it('rejectSection rejects stale expectedStateVersion', async () => {
      const sessionId = await seedSession()
      await seedSection(sessionId, 'draft')
      try {
        await expect(
          rejectSection(ctx, {
            sessionId,
            sectionKey: 'obiective',
            reason: 'content too short',
            expectedStateVersion: 9,
          }),
        ).rejects.toBeInstanceOf(ConcurrencyError)
      } finally {
        await cleanupSession(sessionId)
      }
    })

    // ── 8. setApplicationStatus ───────────────────────────────────────────────
    it('setApplicationStatus rejects stale expectedStateVersion', async () => {
      // status != 'paused' so we don't hit the idempotent no-op path
      const sessionId = await seedSession({ status: 'active' })
      try {
        await expect(
          setApplicationStatus(ctx, {
            sessionId,
            status: 'paused',
            expectedStateVersion: 9,
          }),
        ).rejects.toBeInstanceOf(ConcurrencyError)
      } finally {
        await cleanupSession(sessionId)
      }
    })
  },
)
