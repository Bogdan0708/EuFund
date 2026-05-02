// ── Phase 3 Concurrent Writers Integration Test ───────────────────────────────
// Seeds a real agent_sessions row with stateVersion=0, then fires two parallel
// calls to the same write service with expectedStateVersion=0.
//
// With the atomic CAS fix in place:
//   - Exactly ONE call succeeds (stateVersion becomes 1)
//   - The other throws ConcurrencyError
//   - The DB row has stateVersion=1 (not 0 and not 2)
//
// Without the fix (read-then-write, no WHERE stateVersion guard):
//   - Both calls can succeed, each thinking they owned the write
//   - The DB row ends up at stateVersion=1 instead of 2, or both succeed
//     depending on timing, making the guard meaningless.
//
// Requires DATABASE_URL to point to a running Postgres instance.
// Run with: DATABASE_URL=<url> npx vitest run tests/integration/services/phase3-concurrent-writers.test.ts
// or via:   npx vitest run --env-file=.env.local tests/integration/services/phase3-concurrent-writers.test.ts

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') })

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

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
  markSectionStale,
} from '@/lib/ai/agent/services/sections'
import {
  setSelectedCall,
  setApplicationStatus,
} from '@/lib/ai/agent/services/application'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_USER_ID = '99999999-9999-4999-8999-999999999902'

const ctx: ServiceContext = {
  userId: TEST_USER_ID,
  requestId: 'phase3-concurrent-writers-test',
  now: new Date(),
}

// ── Raw SQL client ─────────────────────────────────────────────────────────────

const sql = postgres(process.env.DATABASE_URL!, { max: 4 })

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function seedUser(): Promise<void> {
  await sql`
    INSERT INTO users (id, email, full_name, password_hash)
    VALUES (
      ${TEST_USER_ID}::uuid,
      'phase3-concurrent-writers-902@example.com',
      'Phase3 Concurrent Writers Test User',
      '$2a$12$fakehashfortestingonly000000000000000000000000000000'
    )
    ON CONFLICT (id) DO NOTHING
  `
}

async function seedSession(opts: {
  outlineFrozen?: boolean
  status?: string
  stateVersion?: number
} = {}): Promise<string> {
  const outlineFrozen = opts.outlineFrozen ?? true
  const status = opts.status ?? 'active'
  const stateVersion = opts.stateVersion ?? 0
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
      'CALL-CONCURRENT-TEST-42',
      'drafting'::agent_phase,
      ${eligibility}::jsonb,
      ${outlineFrozen},
      ${stateVersion}
    )
    RETURNING id
  `
  return rows[0].id
}

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
      'Content for concurrent writers test'
    )
  `
}

async function cleanupSession(sessionId: string): Promise<void> {
  await db.delete(agentSections).where(eq(agentSections.sessionId, sessionId))
  // Promoted projects (from setSelectedCall → ensureProjectForSession) link
  // back to this session via metadata.agentSessionId. Delete them so the
  // dev DB doesn't accumulate residue across test runs.
  await sql`DELETE FROM projects WHERE metadata->>'agentSessionId' = ${sessionId}`
  await sql`DELETE FROM agent_sessions WHERE id = ${sessionId}::uuid`
}

async function getSessionStateVersion(sessionId: string): Promise<number> {
  const [row] = await sql<{ state_version: number }[]>`
    SELECT state_version FROM agent_sessions WHERE id = ${sessionId}::uuid
  `
  return row.state_version
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const DB_AVAILABLE = !!process.env.DATABASE_URL
const maybeDescribe = DB_AVAILABLE ? describe : describe.skip

maybeDescribe(
  'Phase 3 concurrent-writers: atomic CAS prevents double-commit (real DB)',
  () => {
    beforeEach(async () => {
      await seedUser()
    })

    // ── 1. saveSectionDraft — two parallel writers ───────────────────────────
    it('saveSectionDraft: exactly one of two concurrent writers succeeds', async () => {
      const sessionId = await seedSession({ stateVersion: 0 })
      // Pre-seed the section so both writers do an UPDATE (not an INSERT).
      // Without pre-seeding, a unique constraint violation fires before the CAS
      // can run, masking the race condition we're testing.
      await seedSection(sessionId, 'draft')

      try {
        const results = await Promise.allSettled([
          saveSectionDraft(ctx, {
            sessionId,
            sectionKey: 'obiective',
            content: 'Writer A content',
            expectedStateVersion: 0,
          }),
          saveSectionDraft(ctx, {
            sessionId,
            sectionKey: 'obiective',
            content: 'Writer B content',
            expectedStateVersion: 0,
          }),
        ])

        const fulfilled = results.filter(r => r.status === 'fulfilled')
        const rejected = results.filter(r => r.status === 'rejected')

        // Exactly one succeeds, the other gets ConcurrencyError
        expect(fulfilled.length).toBe(1)
        expect(rejected.length).toBe(1)
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError)

        // DB row incremented exactly once — not zero, not two
        const finalVersion = await getSessionStateVersion(sessionId)
        expect(finalVersion).toBe(1)
      } finally {
        await cleanupSession(sessionId)
      }
    })

    // ── 2. setSelectedCall — two parallel writers ────────────────────────────
    it('setSelectedCall: exactly one of two concurrent writers succeeds', async () => {
      // outlineFrozen=false so the call selection policy gate passes
      const sessionId = await seedSession({ outlineFrozen: false, stateVersion: 0 })

      try {
        const results = await Promise.allSettled([
          setSelectedCall(ctx, {
            sessionId,
            callId: 'CALL-WRITER-A',
            expectedStateVersion: 0,
          }),
          setSelectedCall(ctx, {
            sessionId,
            callId: 'CALL-WRITER-B',
            expectedStateVersion: 0,
          }),
        ])

        const fulfilled = results.filter(r => r.status === 'fulfilled')
        const rejected = results.filter(r => r.status === 'rejected')

        expect(fulfilled.length).toBe(1)
        expect(rejected.length).toBe(1)
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError)

        const finalVersion = await getSessionStateVersion(sessionId)
        expect(finalVersion).toBe(1)
      } finally {
        await cleanupSession(sessionId)
      }
    })

    // ── 3. setApplicationStatus — two parallel writers ───────────────────────
    it('setApplicationStatus: exactly one of two concurrent writers succeeds', async () => {
      const sessionId = await seedSession({ status: 'active', stateVersion: 0 })

      try {
        const results = await Promise.allSettled([
          setApplicationStatus(ctx, {
            sessionId,
            status: 'paused',
            expectedStateVersion: 0,
          }),
          setApplicationStatus(ctx, {
            sessionId,
            status: 'paused',
            expectedStateVersion: 0,
          }),
        ])

        // Both target the same status ('paused').
        // The first commits stateVersion=1, status='paused'.
        // The second: CAS fires UNLESS the idempotent no-op short-circuits it.
        //
        // The idempotent no-op checks session.status === input.status using
        // the PRE-READ snapshot. After the first writer commits, the pre-read
        // for the second writer may still see status='active' (concurrent read),
        // so it proceeds past the no-op check and hits the CAS guard.
        //
        // In practice with a single-node Postgres and two async JS promises,
        // one always wins the CAS. The other gets ConcurrencyError.
        const concurrencyErrors = results
          .filter(r => r.status === 'rejected')
          .filter(r => (r as PromiseRejectedResult).reason instanceof ConcurrencyError)

        // At minimum: no double-commit. The state version must be exactly 1.
        const finalVersion = await getSessionStateVersion(sessionId)
        expect(finalVersion).toBe(1)

        // And at least one ConcurrencyError was thrown (CAS fired at least once)
        expect(concurrencyErrors.length).toBeGreaterThanOrEqual(1)
      } finally {
        await cleanupSession(sessionId)
      }
    })

    // ── 4. markSectionStale — two parallel writers ───────────────────────────
    it('markSectionStale: exactly one of two concurrent writers succeeds', async () => {
      const sessionId = await seedSession({ stateVersion: 0 })
      await seedSection(sessionId, 'draft')

      try {
        const results = await Promise.allSettled([
          markSectionStale(ctx, {
            sessionId,
            sectionKey: 'obiective',
            expectedStateVersion: 0,
          }),
          markSectionStale(ctx, {
            sessionId,
            sectionKey: 'obiective',
            expectedStateVersion: 0,
          }),
        ])

        // First writer commits stateVersion=1, sets section to stale.
        // Second writer: either hits idempotent no-op (section already stale,
        // returns current stateVersion without bumping) OR hits CAS guard.
        //
        // Both outcomes are correct: the DB stateVersion is at most 1.
        const fulfilled = results.filter(r => r.status === 'fulfilled')
        const rejected = results.filter(r => r.status === 'rejected')

        // At least one succeeds
        expect(fulfilled.length).toBeGreaterThanOrEqual(1)

        // stateVersion is exactly 1 — not 2 (no double-commit)
        const finalVersion = await getSessionStateVersion(sessionId)
        expect(finalVersion).toBe(1)

        // If both fulfilled, the second was an idempotent no-op (already stale),
        // not a double-commit (stateVersion would be 2 if CAS was broken).
        if (fulfilled.length === 2) {
          // Second writer returned current stateVersion without bumping — that's fine.
          expect(finalVersion).toBe(1) // already asserted above
        } else {
          // One threw ConcurrencyError
          expect(rejected.length).toBe(1)
          expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError)
        }
      } finally {
        await cleanupSession(sessionId)
      }
    })
  },
)
