// ── Phase 3 Rollback Version-Number Race Integration Test ─────────────────────
// Seeds a section with two existing versions (versionNumber=1,2), then fires two
// parallel rollbackSection calls targeting versionNumber=1 with the same
// expectedStateVersion=0.
//
// With the FOR UPDATE lock fix in place:
//   - The second concurrent rollback blocks on the row lock until the first commits.
//   - The first succeeds: inserts versionNumber=3 (rollback), bumps stateVersion=1.
//   - The second re-reads max(version_number)=3, computes newVersionNumber=4,
//     then hits the stateVersion CAS and gets ConcurrencyError (stateVersion is now 1).
//   - Exactly ONE rollback version row is inserted (kind='rollback').
//   - DB state: stateVersion=1, exactly one kind='rollback' version row.
//
// Without the fix (max-version read outside tx, no FOR UPDATE lock):
//   - Both reads see max(version_number)=2, both compute newVersionNumber=3.
//   - One insert succeeds; the other hits the (section_id, version_number) unique
//     constraint and explodes with a raw DB error instead of ConcurrencyError.
//
// Requires DATABASE_URL to point to a running Postgres instance.
// Run with: npx vitest run tests/integration/services/phase3-rollback-version-race.test.ts
// or via:   npx vitest run --env-file=.env.local tests/integration/services/phase3-rollback-version-race.test.ts

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
import { rollbackSection } from '@/lib/ai/agent/services/sections'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_USER_ID = '99999999-9999-4999-8999-999999999905'

const ctx: ServiceContext = {
  userId: TEST_USER_ID,
  requestId: 'phase3-rollback-version-race-test',
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
      'phase3-rollback-version-race-905@example.com',
      'Phase3 Rollback Version Race Test User',
      '$2a$12$fakehashfortestingonly000000000000000000000000000000'
    )
    ON CONFLICT (id) DO NOTHING
  `
}

async function seedSession(stateVersion = 0): Promise<string> {
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
      'active'::agent_session_status,
      'ro',
      'CALL-ROLLBACK-RACE-TEST-99',
      'drafting'::agent_phase,
      ${eligibility}::jsonb,
      true,
      ${stateVersion}
    )
    RETURNING id
  `
  return rows[0].id
}

async function seedSection(sessionId: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO agent_sections (
      session_id, section_key, title,
      document_order, generation_order, status, content
    )
    VALUES (
      ${sessionId}::uuid,
      'obiective',
      'Obiective',
      1, 1,
      'draft'::agent_section_status,
      'Current content at version 2'
    )
    RETURNING id
  `
  return rows[0].id
}

async function seedVersions(sectionId: string): Promise<void> {
  // Seed versionNumber=1 (the target we will roll back to)
  await sql`
    INSERT INTO agent_section_versions (
      section_id, version_number, kind, content
    )
    VALUES (
      ${sectionId}::uuid,
      1,
      'draft'::agent_section_version_kind,
      'Content at version 1 — rollback target'
    )
  `
  // Seed versionNumber=2 (the "current" state)
  await sql`
    INSERT INTO agent_section_versions (
      section_id, version_number, kind, content
    )
    VALUES (
      ${sectionId}::uuid,
      2,
      'draft'::agent_section_version_kind,
      'Content at version 2 — current state'
    )
  `
}

async function cleanupSession(sessionId: string): Promise<void> {
  await db.delete(agentSections).where(eq(agentSections.sessionId, sessionId))
  await sql`DELETE FROM agent_sessions WHERE id = ${sessionId}::uuid`
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const DB_AVAILABLE = !!process.env.DATABASE_URL
const maybeDescribe = DB_AVAILABLE ? describe : describe.skip

maybeDescribe(
  'Phase 3 rollback-version-race: FOR UPDATE lock prevents concurrent version collision',
  () => {
    beforeEach(async () => {
      await seedUser()
    })

    it(
      'two concurrent rollbackSection calls: exactly one succeeds and one throws ConcurrencyError (not a DB constraint error)',
      async () => {
        const sessionId = await seedSession(0)
        const sectionId = await seedSection(sessionId)
        await seedVersions(sectionId)

        try {
          const results = await Promise.allSettled([
            rollbackSection(ctx, {
              sessionId,
              sectionKey: 'obiective',
              targetVersion: 1,
              expectedStateVersion: 0,
            }),
            rollbackSection(ctx, {
              sessionId,
              sectionKey: 'obiective',
              targetVersion: 1,
              expectedStateVersion: 0,
            }),
          ])

          const fulfilled = results.filter(r => r.status === 'fulfilled')
          const rejected = results.filter(r => r.status === 'rejected')

          // Exactly one succeeds, exactly one fails
          expect(fulfilled.length).toBe(1)
          expect(rejected.length).toBe(1)

          // KEY ASSERTION: the failure must be ConcurrencyError, NOT a DB
          // unique-constraint violation. Without the FOR UPDATE lock, the two
          // concurrent reads both see max(version_number)=2, both compute
          // newVersionNumber=3, and the losing insert crashes with a Postgres
          // unique-constraint error (code 23505), not ConcurrencyError.
          expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError)

          // The winner should report newStateVersion=1
          const winner = (fulfilled[0] as PromiseFulfilledResult<{ newStateVersion: number; restoredVersion: number; content: string }>).value
          expect(winner.newStateVersion).toBe(1)
          expect(winner.restoredVersion).toBe(1)

          // Verify DB state: stateVersion bumped exactly once
          const [finalSession] = await sql<{ state_version: number }[]>`
            SELECT state_version FROM agent_sessions WHERE id = ${sessionId}::uuid
          `
          expect(finalSession.state_version).toBe(1)

          // Verify exactly ONE rollback version row was inserted (not zero, not two)
          const rollbackVersions = await sql<{ version_number: number }[]>`
            SELECT version_number FROM agent_section_versions
            WHERE section_id = ${sectionId}::uuid AND kind = 'rollback'
          `
          expect(rollbackVersions.length).toBe(1)
        } finally {
          await cleanupSession(sessionId)
        }
      },
    )
  },
)
