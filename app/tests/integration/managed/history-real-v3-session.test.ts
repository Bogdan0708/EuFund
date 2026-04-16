/**
 * Real-DB integration test for loadManagedHistory — V3 session replay.
 *
 * Seeds a user + agent_sessions row, then inserts agent_messages rows that
 * mirror V3's persistence shape exactly (role='assistant'/messageType='tool_call'
 * and role='tool'/messageType='tool_result', toolCallId=null). Calls
 * loadManagedHistory against the real DB and asserts the returned
 * MessageParam[] has the expected structure with no orphan tool_use blocks.
 *
 * Skips when DATABASE_URL is not set (CI without a DB, local dev without
 * docker-compose up). Mirrors the opt-in pattern used in
 * tests/integration/rls-postgres-enforcement.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'

const dbUrl = process.env.DATABASE_URL
const maybeIt = dbUrl ? it : it.skip

describe('loadManagedHistory — real V3 session replay', () => {
  let sql: ReturnType<typeof postgres>
  let userId: string
  let sessionId: string

  beforeEach(async () => {
    if (!dbUrl) return

    sql = postgres(dbUrl, { max: 1, prepare: false })
    userId = randomUUID()
    sessionId = randomUUID()

    // Seed user (only required NOT NULL columns; schema has sensible defaults)
    await sql`
      INSERT INTO users (id, email, full_name)
      VALUES (${userId}::uuid, ${`v3-hist-test-${userId}@test.local`}, 'V3 History Test User')
    `

    // Seed agent session
    await sql`
      INSERT INTO agent_sessions (id, user_id, status, locale, current_phase, state_version)
      VALUES (
        ${sessionId}::uuid,
        ${userId}::uuid,
        'active',
        'ro',
        'discovery',
        0
      )
    `

    // Seed 4 agent_messages rows that mirror V3 persistence exactly
    //   seq 0: user text (the initial user message)
    //   seq 1: assistant tool_call (V3 shape — no toolCallId, content={name,arguments})
    //   seq 2: tool tool_result (V3 shape — role='tool', no toolCallId, content={success,data})
    //   seq 3: assistant text (final answer)
    await sql`
      INSERT INTO agent_messages (id, session_id, role, message_type, content, tool_name, tool_call_id, sequence_number, runtime_mode)
      VALUES
        (
          ${randomUUID()}::uuid, ${sessionId}::uuid,
          'user', 'text',
          ${'hello'}::jsonb,
          NULL, NULL, 0, 'v3'
        ),
        (
          ${randomUUID()}::uuid, ${sessionId}::uuid,
          'assistant', 'tool_call',
          ${'{"name":"search_calls","arguments":{"query":"pnrr"}}'}::jsonb,
          'search_calls', NULL, 1, 'v3'
        ),
        (
          ${randomUUID()}::uuid, ${sessionId}::uuid,
          'tool', 'tool_result',
          ${'{"success":true,"data":{"results":[]}}'}::jsonb,
          'search_calls', NULL, 2, 'v3'
        ),
        (
          ${randomUUID()}::uuid, ${sessionId}::uuid,
          'assistant', 'text',
          ${'done'}::jsonb,
          NULL, NULL, 3, 'v3'
        )
    `
  })

  afterEach(async () => {
    if (!dbUrl || !sql) return
    try {
      // CASCADE on agent_sessions deletes agent_messages; delete user last
      await sql`DELETE FROM agent_sessions WHERE id = ${sessionId}::uuid`
      await sql`DELETE FROM users WHERE id = ${userId}::uuid`
    } finally {
      await sql.end({ timeout: 2 })
    }
  })

  maybeIt('replays a V3-era session into Anthropic MessageParam[] with paired tool_use/tool_result blocks', async () => {
    // Dynamic import so that the DB proxy is not initialised until the test
    // actually runs (avoids throwing at module-load time when DATABASE_URL
    // is absent in other test runs).
    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')

    const result = await loadManagedHistory(sessionId)

    // 1. systemSummary must be null — no system_summary row was seeded
    expect(result.systemSummary).toBeNull()

    // 2. At least 2 messages (assistant tool_call + user tool_result get merged
    //    into their Anthropic-shaped counterparts; the plain user 'hello' and
    //    assistant 'done' each produce one message).
    expect(result.messages.length).toBeGreaterThanOrEqual(2)

    // 3. Find the assistant message with a tool_use block
    const assistantToolCall = result.messages.find(
      m =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some(b => b.type === 'tool_use'),
    )
    expect(assistantToolCall).toBeDefined()

    const toolUseBlock = (assistantToolCall!.content as Array<{ type: string; id: string; name: string; input: unknown }>).find(
      b => b.type === 'tool_use',
    )!
    expect(toolUseBlock).toMatchObject({
      type: 'tool_use',
      name: 'search_calls',
      input: { query: 'pnrr' },
    })

    // V3 rows have toolCallId=null — the normaliser must generate a synthetic id
    expect(typeof toolUseBlock.id).toBe('string')
    expect(toolUseBlock.id).toMatch(/^tu_legacy_/)

    // 4. Find the user message with a tool_result block
    const userToolResult = result.messages.find(
      m =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some(b => b.type === 'tool_result'),
    )
    expect(userToolResult).toBeDefined()

    const toolResultBlock = (
      userToolResult!.content as Array<{ type: string; tool_use_id: string; is_error: boolean }>
    ).find(b => b.type === 'tool_result')!

    // FIFO pairing: the tool_result's tool_use_id must match the tool_use's id
    expect(toolResultBlock.tool_use_id).toBe(toolUseBlock.id)
    expect(toolResultBlock.is_error).toBe(false)

    // 5. Pairing invariant: every tool_use in every assistant message has a
    //    matching tool_result in the *immediately following* user message.
    for (let i = 0; i < result.messages.length; i++) {
      const msg = result.messages[i]
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue

      const toolUseIds = (msg.content as Array<{ type: string; id?: string }>)
        .filter(b => b.type === 'tool_use')
        .map(b => b.id as string)

      if (toolUseIds.length === 0) continue

      const next = result.messages[i + 1]
      expect(next).toBeDefined()
      expect(next!.role).toBe('user')
      expect(Array.isArray(next!.content)).toBe(true)

      const toolResultIds = new Set(
        (next!.content as Array<{ type: string; tool_use_id?: string }>)
          .filter(b => b.type === 'tool_result')
          .map(b => b.tool_use_id as string),
      )

      for (const id of toolUseIds) {
        expect(toolResultIds.has(id)).toBe(true)
      }
    }
  })

  maybeIt('returns an empty messages array and null systemSummary for a session with no messages', async () => {
    // Seed a second empty session
    const emptySessionId = randomUUID()
    await sql`
      INSERT INTO agent_sessions (id, user_id, status, locale, current_phase, state_version)
      VALUES (
        ${emptySessionId}::uuid,
        ${userId}::uuid,
        'active', 'ro', 'discovery', 0
      )
    `

    try {
      const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
      const result = await loadManagedHistory(emptySessionId)

      expect(result.messages).toHaveLength(0)
      expect(result.systemSummary).toBeNull()
    } finally {
      await sql`DELETE FROM agent_sessions WHERE id = ${emptySessionId}::uuid`
    }
  })
})
