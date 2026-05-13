// e2e/generate-section.spec.ts
//
// PR 5 happy path. Sets up a session pre-conditioned for drafting (outline
// frozen, eligibility passed, no draft rows yet), clicks the Generate
// button, asserts SSE deltas arrive and the section persists as `draft`.
//
// Pre-conditions:
//   - DATABASE_URL set
//   - dev server on localhost:3002
//   - auth storage state at e2e/.auth/user.json
//
// Skips gracefully when DATABASE_URL is absent.

import { test, expect } from '@playwright/test'
import postgres from 'postgres'
import { randomUUID } from 'crypto'

const DATABASE_URL = process.env.DATABASE_URL

async function withDb<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const sql = postgres(DATABASE_URL!, { max: 1 })
  try {
    return await fn(sql)
  } finally {
    await sql.end()
  }
}

const FLAGS_ON = [
  'preselect_no_auto_send',
  'deterministic_actions_enabled',
  'chat_tools_trimmed',
  'generate_section_endpoint_enabled',
]

test.describe('generate-section happy path', () => {
  test.skip(!DATABASE_URL, 'DATABASE_URL not set — skipping DB-dependent E2E')

  let userId: string
  const sessionId = randomUUID()

  test.beforeAll(async () => {
    await withDb(async (sql) => {
      // Toggle all required flags ON. Restore in afterAll.
      for (const f of FLAGS_ON) {
        await sql`UPDATE feature_flags SET enabled = true WHERE key = ${f}`
      }

      // Find the authenticated test user id. The auth.setup.ts test logs in
      // as the seed admin — query the user row that the storage state
      // corresponds to (we don't have the email at hand, so pick the
      // platform admin).
      const [u] = await sql<{ id: string }[]>`
        SELECT id FROM users WHERE is_platform_admin = true ORDER BY created_at LIMIT 1
      `
      if (!u) throw new Error('No platform-admin user found — auth.setup.ts must run first')
      userId = u.id

      // Seed an agent_sessions row in drafting phase with outline frozen,
      // eligibility passed, no section rows yet. The Generate click on this
      // session should hit ensureDraftingReady, find everything ready, and
      // stream the first section.
      await sql`
        INSERT INTO agent_sessions (
          id, user_id, status, locale, selected_call_id,
          current_phase, outline_frozen, outline, eligibility,
          state_version, created_at, updated_at
        ) VALUES (
          ${sessionId}, ${userId}, 'active', 'ro', 'C-1',
          'drafting', true,
          ${sql.json([
            {
              id: 'intro',
              title: 'Introducere',
              description: 'Prezentare generală',
              order: 1,
              generationOrder: 1,
              importance: 'critical',
              expectedLength: 'medium',
              dependsOn: [],
              modelHint: 'light',
              mandatory: true,
              confidence: 1,
            },
          ])},
          ${sql.json({ score: 100, results: [], passCount: 1, failCount: 0, warningCount: 0 })},
          0, NOW(), NOW()
        )
      `
    })
  })

  test.afterAll(async () => {
    await withDb(async (sql) => {
      // Drop the seeded session + its rows
      await sql`DELETE FROM agent_sections WHERE session_id = ${sessionId}`
      await sql`DELETE FROM agent_messages WHERE session_id = ${sessionId}`
      await sql`DELETE FROM agent_sessions WHERE id = ${sessionId}`
      // Restore flags
      for (const f of FLAGS_ON) {
        await sql`UPDATE feature_flags SET enabled = false WHERE key = ${f}`
      }
    })
  })

  test('Generate click streams deltas and persists section as draft', async ({ page }) => {
    // Dismiss cookie banner so it doesn't block clicks.
    await page.addInitScript(() => {
      localStorage.setItem('eufund:cookie-consent-dismissed:v1', '1')
    })

    // Navigate directly to the prepared session.
    await page.goto(`/ro/proiecte/nou?session=${sessionId}`)

    // Wait for the workspace to load — the Generate button is the canary.
    const generateBtn = page.getByRole('button', { name: /generează|generate/i })
    await expect(generateBtn).toBeVisible({ timeout: 15_000 })

    // Click and watch network for the SSE request.
    const ssePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/v1/agent-sessions/${sessionId}/sections/generate`) &&
        resp.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await generateBtn.click()

    const sseResp = await ssePromise
    expect(sseResp.status()).toBe(200)
    expect(sseResp.headers()['content-type']).toMatch(/text\/event-stream/)

    // Wait for DB to reflect the persisted draft. Up to 90s for the model
    // to finish streaming + saveSectionDraft to land.
    const deadline = Date.now() + 90_000
    let drafted = false
    while (Date.now() < deadline) {
      const found = await withDb(async (sql) =>
        sql<{ status: string; content: string | null }[]>`
          SELECT status, content FROM agent_sections
          WHERE session_id = ${sessionId} AND section_key = 'intro'
          LIMIT 1
        `,
      )
      if (found[0] && found[0].status === 'draft' && (found[0].content?.length ?? 0) > 0) {
        drafted = true
        break
      }
      await page.waitForTimeout(1000)
    }

    expect(drafted, 'agent_sections row never reached status=draft with content').toBe(true)
  })
})
