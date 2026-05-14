// ── changeCall Transaction Atomicity Integration Test ─────────────────────
// Reproduces the destructive race: stateVersion bumped AFTER changeCall's
// pre-read but BEFORE its CAS. Without the fix, db.delete(agentSections)
// commits before the CAS realizes it's stale, and sections are gone.
//
// Requires DATABASE_URL to point to a running Postgres instance.

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') })

import { describe, it, expect, afterAll, vi } from 'vitest'

vi.mock('@/lib/legal/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: vi.fn().mockResolvedValue({
    matches: [{ callId: 'CALL-NEW' }],
  }),
}))

// lookupBlueprint runs AFTER changeCall's pre-read at line 65 and BEFORE
// the delete at line 120 — perfect injection point for the race bump.
const blueprintMockBump = vi.fn()
vi.mock('@/lib/ai/agent/services/blueprint', () => ({
  lookupBlueprint: vi.fn().mockImplementation(async () => {
    await blueprintMockBump()
    return { cached: false, blueprint: null }
  }),
  outlineFromBlueprint: vi.fn().mockReturnValue(null),
}))

import { randomUUID } from 'crypto'
import postgres from 'postgres'
import { changeCall } from '@/lib/ai/agent/services/change-call'
import { ConcurrencyError } from '@/lib/ai/agent/services/errors'

// Per-run TEST_USER_ID + email keeps the test idempotent across re-runs and
// safe in shared CI databases (no email-uniqueness collisions when the prior
// run's user row hasn't been cleaned up).
const TEST_USER_ID = randomUUID()
const TEST_USER_EMAIL = `changecall-tx-${TEST_USER_ID}@local`

// Lazy postgres init — the build-and-test CI job has no Postgres + no
// DATABASE_URL, so eager construction would throw at module load before
// the describe.skip gate below can fire. Only callsites inside the
// maybeDescribe block ever touch this, and they're guarded by the gate.
const sql = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL, { max: 4 })
  : (null as unknown as ReturnType<typeof postgres>)

async function seedSessionWithSections(): Promise<{ sessionId: string }> {
  await sql`
    INSERT INTO users (id, email, password_hash, full_name)
    VALUES (${TEST_USER_ID}::uuid, ${TEST_USER_EMAIL}, 'unused', 'Test')
    ON CONFLICT (id) DO NOTHING
  `

  const [{ id }] = await sql<{ id: string }[]>`
    INSERT INTO agent_sessions (
      user_id, status, locale, selected_call_id,
      current_phase, outline_frozen, state_version
    )
    VALUES (
      ${TEST_USER_ID}::uuid, 'active'::agent_session_status, 'ro',
      'CALL-ORIG', 'structuring'::agent_phase, false, 0
    )
    RETURNING id
  `

  await sql`
    INSERT INTO agent_sections (
      session_id, section_key, title,
      document_order, generation_order, status, content
    )
    VALUES
      (${id}::uuid, 'obiective', 'Obiective', 0, 0, 'draft', 'A'),
      (${id}::uuid, 'metoda',    'Metoda',    1, 1, 'draft', 'B')
  `

  return { sessionId: id }
}

async function cleanup(sessionId: string): Promise<void> {
  await sql`DELETE FROM agent_sections WHERE session_id = ${sessionId}::uuid`
  await sql`DELETE FROM agent_sessions WHERE id = ${sessionId}::uuid`
  await sql`DELETE FROM users WHERE id = ${TEST_USER_ID}::uuid`
}

// Same gate phase3-audit-chain.test.ts uses: build-and-test CI job runs
// without a Postgres service container and without DATABASE_URL, so this
// test skips there and only runs in the integration job (and locally).
const DB_AVAILABLE = !!process.env.DATABASE_URL
const maybeDescribe = DB_AVAILABLE ? describe : describe.skip

maybeDescribe('changeCall: transactional integrity', () => {
  afterAll(async () => {
    await sql.end()
  })

  it('rolls back the agent_sections delete when CAS fails mid-operation', async () => {
    const { sessionId } = await seedSessionWithSections()
    try {
      // Inject a stateVersion bump via lookupBlueprint's mock — fires AFTER
      // the pre-read passes (stateVersion=0 still) but BEFORE the delete.
      blueprintMockBump.mockImplementationOnce(async () => {
        await sql`
          UPDATE agent_sessions SET state_version = 99
          WHERE id = ${sessionId}::uuid
        `
      })

      const ctx = {
        userId: TEST_USER_ID,
        sessionId,
        projectId: undefined,
        requestId: 'req-tx-test',
        now: new Date(),
      }

      await expect(
        changeCall(ctx, {
          sessionId,
          newCallId: 'CALL-NEW',
          expectedStateVersion: 0,
        }),
      ).rejects.toBeInstanceOf(ConcurrencyError)

      // CRITICAL: sections must still exist — the delete must have rolled back.
      const [{ count }] = await sql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM agent_sections
        WHERE session_id = ${sessionId}::uuid
      `
      expect(Number(count)).toBe(2)
    } finally {
      await cleanup(sessionId)
    }
  })
})
