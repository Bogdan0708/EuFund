// ── Phase 3 Audit Chain Integration Test ──────────────────────────────────────
// Runs a 3-step mutation sequence against the real DB:
//   setSelectedCall → freezeOutline → saveSectionDraft
// Then verifies that verifyAuditChainIntegrity reports isIntact=true for all
// audit entries produced during the test window.
//
// IMPORTANT: logAudit is NOT mocked here — we need real audit writes so the
// hash chain is actually built and can be validated.
//
// Requires DATABASE_URL to point to a running Postgres instance.
// Run with: npx vitest run tests/integration/services/phase3-audit-chain.test.ts

import dotenv from 'dotenv'
import path from 'path'
// Load .env.local so DATABASE_URL is available when db/index.ts initialises.
// This must happen before any @/ imports that touch the DB.
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') })

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import postgres from 'postgres'
import { db } from '@/lib/db'
import { agentSections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { verifyAuditChainIntegrity } from '@/lib/legal/audit-integrity'
import {
  setSelectedCall,
  freezeOutline,
} from '@/lib/ai/agent/services/application'
import { saveSectionDraft } from '@/lib/ai/agent/services/sections'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

// ── Test fixtures ─────────────────────────────────────────────────────────────

// Distinct UUID from phase3-concurrency.test.ts (99999999...) to avoid conflicts
const TEST_USER_ID = '88888888-8888-4888-8888-888888888888'

const ctx: ServiceContext = {
  userId: TEST_USER_ID,
  requestId: 'phase3-audit-chain-test',
  now: new Date(),
}

// ── Raw SQL client ─────────────────────────────────────────────────────────────

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
      'phase3-audit-test-888@example.com',
      'Phase3 Audit Chain Test User',
      '$2a$12$fakehashfortestingonly000000000000000000000000000000'
    )
    ON CONFLICT (id) DO NOTHING
  `
}

/**
 * Insert an agent_sessions row in a state ready for the 3-step sequence:
 *   - status=active, outline_frozen=false, state_version=0
 *   - eligibility with passCount=3, failCount=0 (passes the 'passed' gate)
 *   - NO selected_call_id (setSelectedCall will set it in step 1)
 */
async function seedSession(): Promise<string> {
  const eligibility = JSON.stringify({
    results: [],
    score: 100,
    passCount: 3,
    failCount: 0,
    warningCount: 0,
  })

  const rows = await sql<{ id: string }[]>`
    INSERT INTO agent_sessions (
      user_id, status, locale,
      current_phase, eligibility, outline_frozen, state_version
    )
    VALUES (
      ${TEST_USER_ID}::uuid,
      'active'::agent_session_status,
      'ro',
      'discovery'::agent_phase,
      ${eligibility}::jsonb,
      false,
      0
    )
    RETURNING id
  `
  return rows[0].id
}

/**
 * Delete sections and session rows created by the test.
 * agent_sections has ON DELETE CASCADE from agent_sessions, but we delete
 * sections first explicitly for safety.
 */
async function cleanupSession(sessionId: string): Promise<void> {
  await db.delete(agentSections).where(eq(agentSections.sessionId, sessionId))
  // Promoted projects (from setSelectedCall → ensureProjectForSession) link
  // back to this session via metadata.agentSessionId. Delete them so the
  // dev DB doesn't accumulate residue across test runs.
  await sql`DELETE FROM projects WHERE metadata->>'agentSessionId' = ${sessionId}`
  await sql`DELETE FROM agent_sessions WHERE id = ${sessionId}::uuid`
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const DB_AVAILABLE = !!process.env.DATABASE_URL
const maybeDescribe = DB_AVAILABLE ? describe : describe.skip

maybeDescribe(
  'Phase 3 audit chain integrity — real DB (no logAudit mock)',
  () => {
    beforeEach(async () => {
      await seedUser()
    })

    it('3-step mutation sequence produces an unbroken audit chain', async () => {
      const sessionId = await seedSession()
      // Capture start time just before mutations so we can filter audit entries
      // produced by this test only (avoids pre-existing chain entries from dev).
      const startTime = new Date()

      try {
        // ── Step 1: select a call ──────────────────────────────────────────────
        // Requires: active session, outline not frozen (eligibility=none)
        const step1 = await setSelectedCall(ctx, {
          sessionId,
          callId: 'CALL-AUDIT-CHAIN-42',
          expectedStateVersion: 0,
        })
        expect(step1.newStateVersion).toBe(1)

        // ── Step 2: freeze the outline ─────────────────────────────────────────
        // Requires: active session, call selected, eligibility=passed, not frozen
        const step2 = await freezeOutline(ctx, {
          sessionId,
          expectedStateVersion: 1,
        })
        expect(step2.newStateVersion).toBe(2)

        // ── Step 3: save a section draft ───────────────────────────────────────
        // Requires: active session, outline frozen, eligibility=passed
        // saveSectionDraft upserts the section row (creates if absent), so no
        // pre-seeding of agent_sections is needed.
        const step3 = await saveSectionDraft(ctx, {
          sessionId,
          sectionKey: 'obiective',
          content: 'Draft content written during audit chain integration test.',
          expectedStateVersion: 2,
        })
        expect(step3.newStateVersion).toBe(3)

        // ── Verify audit chain integrity ───────────────────────────────────────
        // We pass `from: startTime` so the verifier fetches the entry just before
        // our window to seed `lastHash`, then validates only entries we produced.
        // This means pre-existing chain state is implicitly validated via the
        // seed-hash lookup — a broken pre-existing chain would surface here too.
        const chainResult = await verifyAuditChainIntegrity({ from: startTime })

        expect(chainResult.isIntact).toBe(true)
        expect(chainResult.brokenLinks).toHaveLength(0)
        // We emitted 3 audit events (one per service call); at least those
        // must appear in the verified window.
        expect(chainResult.totalChecked).toBeGreaterThanOrEqual(3)
      } finally {
        await cleanupSession(sessionId)
      }
    })
  },
)
