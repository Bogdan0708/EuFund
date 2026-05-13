// e2e/preselect-no-auto-send.spec.ts
//
// Asserts the PR 2 bootstrap fix:
//   - preselect-selected creates and adopts the session (banner appears)
//   - UI shows selected call banner + static welcome message
//   - no /api/ai/agent SSE call is made (flag blocks auto-send)
//   - DB has no agent_turns row for the new session until user explicitly acts
//
// Pre-condition: feature flag `preselect_no_auto_send` is toggled on via
//   beforeAll / restored to its exact previous state in afterAll. Requires
//   DATABASE_URL env var to be set so the DB pre/post-conditions can be inspected.
//
// Skips gracefully when DATABASE_URL is absent (informational, not merge gate).
// Requires: dev server on localhost:3002, auth storage state at
//   e2e/.auth/user.json (created by auth.setup.ts).

import { test, expect } from '@playwright/test'
import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
const FLAG_KEY = 'preselect_no_auto_send'

type FlagSnapshot =
  | { exists: false }
  | { exists: true; enabled: boolean; description: string | null; targeting: string | null }

// Helper: create a short-lived postgres.js connection, run `fn`, then end it.
async function withDb<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const sql = postgres(DATABASE_URL!, { max: 1 })
  try {
    return await fn(sql)
  } finally {
    await sql.end()
  }
}

async function readFlag(sql: ReturnType<typeof postgres>): Promise<FlagSnapshot> {
  const rows = await sql<Array<{ enabled: boolean; description: string | null; targeting: string | null }>>`
    SELECT enabled, description, targeting::text AS targeting
    FROM   feature_flags
    WHERE  key = ${FLAG_KEY}
  `
  const row = rows[0]
  return row ? { exists: true, ...row } : { exists: false }
}

test.describe('preselect no-auto-send', () => {
  // Skip the entire suite when DATABASE_URL is absent so CI without a live DB
  // doesn't hard-fail on these informational-only tests.
  test.skip(!DATABASE_URL, 'DATABASE_URL not set — skipping DB-dependent E2E')

  let previousFlag: FlagSnapshot | null = null

  test.beforeAll(async () => {
    previousFlag = await withDb(async sql => {
      const snapshot = await readFlag(sql)
      await sql`
        INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
        VALUES (
          ${FLAG_KEY},
          true,
          'E2E override: preselect no-auto-send bootstrap path',
          '{}'::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (key) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            description = EXCLUDED.description,
            targeting = EXCLUDED.targeting,
            updated_at = NOW()
      `
      return snapshot
    })
  })

  test.afterAll(async () => {
    // Restore the exact prior flag state so this E2E cannot leak global flag
    // changes into later tests or developer environments.
    if (!previousFlag) return
    const snapshot = previousFlag
    await withDb(async sql => {
      if (!snapshot.exists) {
        await sql`DELETE FROM feature_flags WHERE key = ${FLAG_KEY}`
        return
      }
      await sql`
        UPDATE feature_flags
        SET enabled = ${snapshot.enabled},
            description = ${snapshot.description},
            targeting = ${snapshot.targeting}::jsonb,
            updated_at = NOW()
        WHERE key = ${FLAG_KEY}
      `
    })
  })

  test('preselect selected → static welcome, no agent SSE, no agent_turns row', async ({ page }) => {
    // Dismiss cookie banner so it doesn't block clicks.
    await page.addInitScript(() => {
      localStorage.setItem('eufund:cookie-consent-dismissed:v1', '1')
    })

    // Track any POST to /api/ai/agent — with the flag on, we expect zero.
    let agentSseCalls = 0
    await page.route('**/api/ai/agent', (route, req) => {
      if (req.method() === 'POST') agentSseCalls++
      // Still allow the request through (don't abort) so the app doesn't error
      // in unexpected ways if the guard is bypassed.
      return route.continue()
    })

    await page.goto('/ro/proiecte/nou')
    await page.waitForLoadState('networkidle')

    // Fill the project description and submit — this triggers the preselect
    // rank call (`POST /api/v1/projects/preselect`).
    const description = 'Vrem să cumpărăm utilaje agricole pentru irigații în zona PNRR'
    await page.locator('input[type="text"]').first().fill(description)
    await page.locator('button[type="submit"]').first().click()

    // ── Assert 1: selected-call banner appears (preselect → selected branch). ──
    // Allow up to 20 s for the banner to appear because the preselect call
    // may need to reach the vector store.
    const banner = page.getByTestId('selected-call-banner')
    await expect(banner).toBeVisible({ timeout: 20_000 })

    // ── Assert 2: static welcome is visible; no model-generated messages. ──
    await expect(page.getByTestId('agent-welcome')).toBeVisible()
    // agent-message elements are rendered for every item in `messages[]`.
    // With no-auto-send, the array must be empty.
    await expect(page.getByTestId('agent-message')).toHaveCount(0)

    // ── Assert 3: no /api/ai/agent SSE call was made. ──
    // Wait a short tick to catch any deferred requests.
    await page.waitForTimeout(500)
    expect(agentSseCalls).toBe(0)

    // ── Assert 4: DB has no agent_turns row for this session. ──
    // The session ID is surfaced in the URL as `?session=<uuid>`.
    const url = page.url()
    const sessionId = new URL(url).searchParams.get('session')
    expect(sessionId, 'Expected ?session= in URL after preselect selected').toBeTruthy()

    await withDb(async sql => {
      const rows = await sql<Array<{ n: number }>>`
        SELECT count(*)::int AS n
        FROM   agent_turns
        WHERE  session_id = ${sessionId!}
      `
      expect(
        rows[0].n,
        `Expected 0 agent_turns for session ${sessionId}, got ${rows[0].n}`,
      ).toBe(0)
    })
  })
})
